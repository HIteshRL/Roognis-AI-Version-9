'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchReadyChapters, fetchChapterContext, RagUnavailableError } = require('./rag-chapters');

/* ── What these protect ──────────────────────────────────────────────────────
   The distinction that matters is "nothing is ingested yet" (a clean skip)
   versus "we cannot talk to RAG" (a misconfiguration). Collapsing the two
   produces the worst outcome available: a silently empty demo that looks
   deliberate, discovered on stage.                                        ── */

const BASE = {
  ragServiceUrl: 'http://rag:3003',
  internalServiceToken: 'test-token',
  schoolId: 'demo-school',
  backoffMs: 0,
  sleepFn: async () => {},
};

const jsonResponse = body => ({ ok: true, status: 200, json: async () => body });

test('chapters are requested with the school and grade scoped', async () => {
  const calls = [];
  await fetchReadyChapters({
    ...BASE,
    grade: 8,
    fetchFn: async (url, init) => {
      calls.push({ url, token: init.headers['x-internal-service-token'] });
      return jsonResponse({ chapters: [] });
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /schoolId=demo-school/);
  assert.match(calls[0].url, /grade=8/);
  assert.equal(calls[0].token, 'test-token', 'internal token must be sent');
});

test('a missing internal token fails immediately rather than seeding nothing', async () => {
  await assert.rejects(
    () => fetchReadyChapters({ ...BASE, internalServiceToken: '', fetchFn: async () => jsonResponse({}) }),
    /INTERNAL_SERVICE_TOKEN/
  );
});

test('an auth rejection is not retried and names the likely cause', async () => {
  let attempts = 0;
  await assert.rejects(
    () => fetchReadyChapters({
      ...BASE,
      fetchFn: async () => {
        attempts += 1;
        return { ok: false, status: 401, json: async () => ({}) };
      },
    }),
    /INTERNAL_SERVICE_TOKEN/
  );
  assert.equal(attempts, 1, 'a 401 will never succeed on retry');
});

test('a transport failure is retried, then surfaces as unavailable', async () => {
  let attempts = 0;
  await assert.rejects(
    () => fetchReadyChapters({
      ...BASE,
      attempts: 3,
      fetchFn: async () => {
        attempts += 1;
        throw new Error('ECONNREFUSED');
      },
    }),
    RagUnavailableError
  );
  assert.equal(attempts, 3);
});

test('a transient 503 recovers without failing the seed', async () => {
  let attempts = 0;
  const chapters = await fetchReadyChapters({
    ...BASE,
    attempts: 3,
    fetchFn: async () => {
      attempts += 1;
      if (attempts < 3) return { ok: false, status: 503, json: async () => ({}) };
      return jsonResponse({ chapters: [{ chapterName: 'Coal and Petroleum' }] });
    },
  });
  assert.equal(chapters.length, 1);
  assert.equal(attempts, 3);
});

test('an empty corpus is a normal answer, not an error', async () => {
  const chapters = await fetchReadyChapters({ ...BASE, fetchFn: async () => jsonResponse({ chapters: [] }) });
  assert.deepEqual(chapters, []);
});

test('chapter context is addressed by documentIds and respects the 120 cap', async () => {
  let requested = '';
  await fetchChapterContext(
    { documentIds: ['d1', 'd2'] },
    { ...BASE, maxChunks: 5000, fetchFn: async url => { requested = url; return jsonResponse({}); } },
  );
  assert.match(requested, /documentIds=d1%2Cd2/);
  assert.match(requested, /maxChunks=120/, 'the endpoint rejects anything over 120');
});

test('a 404 from chapter context is absence, not failure', async () => {
  const context = await fetchChapterContext(
    { documentIds: ['d1'] },
    { ...BASE, fetchFn: async () => ({ ok: false, status: 404, json: async () => ({}) }) },
  );
  assert.equal(context, null);
});

test('a chapter with no documents is skipped without a request', async () => {
  let called = false;
  const context = await fetchChapterContext(
    { documentIds: [] },
    { ...BASE, fetchFn: async () => { called = true; return jsonResponse({}); } },
  );
  assert.equal(context, null);
  assert.equal(called, false);
});
