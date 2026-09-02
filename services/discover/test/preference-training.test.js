'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPreferenceTrainingSamples,
  isReclaimableRefreshLease,
  trainPreferenceGnn,
} = require('../preference/refresh');

test('preference training holds out the target edge and its signed baseline', () => {
  const samples = buildPreferenceTrainingSamples([{
    preferences: [
      { topicKey: 'space', stance: 'LIKE', muted: false },
      { topicKey: 'sport', stance: 'DISLIKE', muted: false },
    ],
    graph: {
      topics: [
        { topicId: 'space', features: [1, 0, 0, 1], baselineScore: 0.9 },
        { topicId: 'sport', features: [0, 1, 0, 1], baselineScore: -0.8 },
      ],
      interactions: [
        { topicId: 'space', stance: 'LIKE', weight: 2 },
        { topicId: 'sport', stance: 'DISLIKE', weight: 2 },
      ],
      edges: [{ fromId: 'space', toId: 'sport' }],
    },
  }]);

  const space = samples.find(row => row.targetTopicId === 'space');
  assert.equal(space.targetStance, 'LIKE');
  assert.equal(space.topics.find(row => row.topicId === 'space').baselineScore, 0);
  assert.ok(space.interactions.every(row => row.topicId !== 'space'));
  assert.deepEqual(space.edges, [{ fromId: 'space', toId: 'sport' }]);
});

test('preference training failures are non-fatal to daily refresh', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('worker down'); };
  try {
    const result = await trainPreferenceGnn({
      url: 'http://trainer', token: 'token', runKey: 'preference:2026-09-01', samples: [{}],
    });
    assert.deepEqual(result, { attempted: true, promoted: false, reason: 'trainer_unavailable' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('only an expired running refresh lease can be reclaimed', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  assert.equal(isReclaimableRefreshLease({
    status: 'running', leaseExpiresAt: new Date('2026-09-01T11:59:59Z'),
  }, now), true);
  assert.equal(isReclaimableRefreshLease({
    status: 'running', leaseExpiresAt: new Date('2026-09-01T12:00:01Z'),
  }, now), false);
  assert.equal(isReclaimableRefreshLease({
    status: 'done', leaseExpiresAt: new Date('2026-09-01T11:59:59Z'),
  }, now), false);
});
