'use strict';

/**
 * Framework-neutral, browser-safe learning event client.
 *
 * The event queue is intentionally academic-only. Preference signals use the
 * Discover GraphQL boundary and cannot be enqueued here, which makes the
 * engagement/measurement split enforceable in both portals as well as on the
 * server.
 */

const SCHEMA_VERSION = 1;

const EVENT_TYPES = Object.freeze([
  'item_rendered',
  'first_interaction',
  'answer_changed',
  'answer_submitted',
  'item_skipped',
  'hint_requested',
  'confidence_reported',
  'focus_lost',
  'focus_gained',
  'written_answer_scored',
  'flashcard_revealed',
  'flashcard_review_completed',
]);

const EVENT_SOURCES = Object.freeze(['quiz', 'written_answer', 'flashcard', 'practice']);
const FORBIDDEN_RAW_TEXT_KEYS = new Set(['answer', 'answertext', 'rawanswer', 'prompt', 'content', 'text']);

function assertNoRawAssessmentText(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertNoRawAssessmentText);
    return;
  }
  Object.entries(value).forEach(([key, nested]) => {
    const normalized = key.toLowerCase().replace(/[_\-\s]/g, '');
    if (FORBIDDEN_RAW_TEXT_KEYS.has(normalized)) {
      throw new TypeError(`Raw assessment text field is not allowed in learning telemetry: ${key}`);
    }
    assertNoRawAssessmentText(nested);
  });
}

function randomEventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : ((value & 0x3) | 0x8)).toString(16);
  });
}

function cleanOptionalString(value, max = 160) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('Event identifiers must be strings.');
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) throw new TypeError(`Event identifier must be 1-${max} characters.`);
  return cleaned;
}

function createLearningEvent(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Learning event input is required.');
  if (!EVENT_TYPES.includes(input.eventType)) throw new TypeError(`Unsupported academic event type: ${input.eventType}`);
  if (!EVENT_SOURCES.includes(input.source)) throw new TypeError(`Unsupported academic event source: ${input.source}`);

  const clientTsMono = Number(input.clientTsMono ?? globalThis.performance?.now?.());
  if (!Number.isFinite(clientTsMono) || clientTsMono < 0) {
    throw new TypeError('clientTsMono must be a non-negative monotonic timestamp.');
  }

  const wall = input.clientTsWall ? new Date(input.clientTsWall) : new Date();
  if (Number.isNaN(wall.getTime())) throw new TypeError('clientTsWall must be an ISO-8601 timestamp.');

  const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload
    : {};
  assertNoRawAssessmentText(payload);

  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: cleanOptionalString(input.eventId || randomEventId(), 64),
    eventType: input.eventType,
    source: input.source,
    sessionId: cleanOptionalString(input.sessionId, 128),
    itemId: cleanOptionalString(input.itemId, 160),
    conceptId: cleanOptionalString(input.conceptId, 160),
    clientTsMono,
    clientTsWall: wall.toISOString(),
    payload,
  };
}

class LearningEventQueue {
  constructor(options = {}) {
    this.endpoint = options.endpoint || '/api/psv/v1/events/batch';
    this.dbName = options.dbName || 'roognis-learning-events';
    this.storeName = options.storeName || 'events';
    this.batchSize = Math.min(100, Math.max(1, Number(options.batchSize) || 40));
    this.flushIntervalMs = Math.max(1000, Number(options.flushIntervalMs) || 15000);
    this.memory = [];
    this.flushPromise = null;
    this.timer = null;
    this.boundOnline = () => this.flush().catch(() => {});
    this.boundVisibility = () => {
      if (globalThis.document?.visibilityState === 'hidden') this.flush({ keepalive: true }).catch(() => {});
    };
  }

  async start() {
    await this.openDatabase().catch(() => null);
    if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('online', this.boundOnline);
    globalThis.document?.addEventListener?.('visibilitychange', this.boundVisibility);
    this.timer = globalThis.setInterval?.(() => this.flush().catch(() => {}), this.flushIntervalMs) || null;
    return this;
  }

  stop() {
    if (this.timer) globalThis.clearInterval?.(this.timer);
    this.timer = null;
    if (typeof globalThis.removeEventListener === 'function') globalThis.removeEventListener('online', this.boundOnline);
    globalThis.document?.removeEventListener?.('visibilitychange', this.boundVisibility);
  }

  async enqueue(input) {
    const event = createLearningEvent(input);
    const db = await this.openDatabase().catch(() => null);
    if (!db) {
      this.memory.push(event);
    } else {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        transaction.objectStore(this.storeName).put(event);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed.'));
      });
    }
    if (this.memory.length >= this.batchSize) this.flush().catch(() => {});
    return event;
  }

  async flush(options = {}) {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushOnce(options).finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  async flushOnce(options = {}) {
    if (typeof globalThis.fetch !== 'function') return { accepted: 0, pending: this.memory.length };
    const db = await this.openDatabase().catch(() => null);
    const events = db ? await this.readBatch(db) : this.memory.slice(0, this.batchSize);
    if (!events.length) return { accepted: 0, pending: 0 };

    const response = await globalThis.fetch(this.endpoint, {
      method: 'POST',
      credentials: 'include',
      keepalive: options.keepalive === true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    if (!response.ok) throw new Error(`Learning event upload failed with ${response.status}.`);
    const result = await response.json();
    const acceptedIds = new Set(Array.isArray(result.acceptedEventIds) ? result.acceptedEventIds : events.map(event => event.eventId));
    if (db) await this.deleteBatch(db, [...acceptedIds]);
    else this.memory = this.memory.filter(event => !acceptedIds.has(event.eventId));
    return result;
  }

  openDatabase() {
    if (this.dbPromise) return this.dbPromise;
    if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable.'));
    this.dbPromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName, { keyPath: 'eventId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed.'));
    });
    return this.dbPromise;
  }

  readBatch(db) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).getAll(null, this.batchSize);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('IndexedDB read failed.'));
    });
  }

  deleteBatch(db, eventIds) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      eventIds.forEach(eventId => store.delete(eventId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB delete failed.'));
    });
  }
}

const api = { SCHEMA_VERSION, EVENT_TYPES, EVENT_SOURCES, createLearningEvent, LearningEventQueue };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.RoognisLearningEvents = api;
