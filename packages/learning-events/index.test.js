'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLearningEvent } = require('./index');

test('creates a versioned academic event envelope', () => {
  const event = createLearningEvent({
    eventType: 'answer_submitted',
    source: 'quiz',
    itemId: 'question-1',
    conceptId: 'fractions.addition',
    clientTsMono: 12.5,
    clientTsWall: '2026-08-31T10:00:00.000Z',
    payload: { correct: true },
  });
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.source, 'quiz');
  assert.equal(event.payload.correct, true);
  assert.match(event.eventId, /^[0-9a-f-]{36}$/i);
});

test('preference sources cannot enter the academic queue', () => {
  assert.throws(() => createLearningEvent({
    eventType: 'answer_submitted',
    source: 'discover',
    clientTsMono: 1,
  }), /Unsupported academic event source/);
});

test('raw assessment text cannot be persisted even when nested', () => {
  assert.throws(() => createLearningEvent({
    eventType: 'answer_changed',
    source: 'written_answer',
    clientTsMono: 1,
    payload: { response: { answerText: 'private written response' } },
  }), /Raw assessment text field/);
});
