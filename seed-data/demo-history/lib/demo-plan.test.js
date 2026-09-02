'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { uuidv5, demoId, seededRandom, dayAt } = require('./demo-ids');
const { buildDemoPlan, loadPlan, MAX_EVENTS } = require('./demo-plan');
const { chapterKey, isEligible, rankChapters, selectChaptersForPersona } = require('./chapter-select');

/* ── What these protect ──────────────────────────────────────────────────────
   The seeders run in three separate services that cannot read each other's
   schemas. Their only agreement mechanism is that they independently derive
   the same ids from the same inputs. If that derivation is not exactly
   reproducible, the failure is not a crash — it is a teacher dashboard whose
   numbers do not match its own drill-downs, discovered live.              ── */

const FIXED_NOW = new Date('2026-08-04T09:15:00.000Z');

/**
 * Stand-in for GET /api/rag/internal/chapters.
 *
 * The plan expansion is pure and takes the ingested corpus as an argument, so
 * these tests never touch the network — and, more usefully, they can describe a
 * corpus that is not NCERT, which is the whole point of the binding.
 */
function chapterFixture(overrides = {}) {
  return {
    schoolId: 'demo-school',
    board: 'CBSE',
    curriculum: 'NCERT',
    grade: 8,
    subject: 'Science',
    book: 'Science',
    chapterNumber: 1,
    chapterName: 'A Chapter',
    language: 'English',
    edition: '2026-27',
    documentIds: ['doc-1'],
    documentCount: 1,
    entityCount: 40,
    chunkCount: 90,
    status: 'ready',
    contentFingerprint: 'abc123',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const FIXTURE_CHAPTERS = [
  chapterFixture({ subject: 'Science', chapterNumber: 3, chapterName: 'Coal and Petroleum' }),
  chapterFixture({ subject: 'Science', chapterNumber: 8, chapterName: 'Force and Pressure' }),
  chapterFixture({ subject: 'Mathematics', book: 'Ganita Prakash', chapterNumber: 6, chapterName: 'We Distribute, Yet Things Multiply' }),
  chapterFixture({ subject: 'Mathematics', book: 'Ganita Prakash', chapterNumber: 2, chapterName: 'Power Play' }),
  chapterFixture({ subject: 'Social Science', book: 'Exploring Society', chapterNumber: 4, chapterName: 'The Colonial Era in India' }),
  chapterFixture({ subject: 'Social Science', book: 'Exploring Society', chapterNumber: 1, chapterName: 'Geographic Diversity' }),
];

const withChapters = (options = {}) => buildDemoPlan({ now: FIXED_NOW, chapters: FIXTURE_CHAPTERS, ...options });

test('uuidv5 matches the RFC 4122 test vector', () => {
  // The canonical DNS-namespace vector for "www.example.com".
  const dnsNamespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  assert.equal(
    uuidv5('www.example.com', dnsNamespace),
    '2ed6657d-e927-568b-95e1-2665a8aea6a2'
  );
});

test('generated ids are valid v5 UUIDs the services will accept', () => {
  // Must satisfy the same regex analytics validates incoming ids against.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const id = demoId('arjun@demo.com', 'session', 3);
  assert.match(id, UUID_RE);
  assert.equal(id[14], '5', 'version nibble must be 5');
});

test('the same inputs always derive the same id', () => {
  assert.equal(
    demoId('arjun@demo.com', 'session', 3),
    demoId('arjun@demo.com', 'session', 3)
  );
});

test('different inputs derive different ids, including across part boundaries', () => {
  const ids = new Set([
    demoId('arjun@demo.com', 'session', 3),
    demoId('priya@demo.com', 'session', 3),
    demoId('arjun@demo.com', 'attempt', 3),
    demoId('arjun@demo.com', 'session', 4),
    // Guards the join separator: these must not collide.
    demoId('a b', 'c'),
    demoId('a', 'b c'),
  ]);
  assert.equal(ids.size, 6);
});

test('seededRandom is reproducible and stays in range', () => {
  const a = seededRandom('arjun@demo.com:3:attempt');
  const b = seededRandom('arjun@demo.com:3:attempt');
  const first = [a(), a(), a()];
  const second = [b(), b(), b()];
  assert.deepEqual(first, second);
  for (const value of first) {
    assert.ok(value >= 0 && value < 1, `${value} out of range`);
  }
  // A different seed must actually diverge.
  const c = seededRandom('priya@demo.com:3:attempt');
  assert.notDeepEqual(first, [c(), c(), c()]);
});

test('every backdated timestamp lands at exactly 12:00 UTC', () => {
  // The streak calculation buckets by UTC day. Noon-Z guarantees no seeded
  // event can shift into an adjacent day for any viewer timezone.
  for (const offset of [0, 1, 9, 28]) {
    const at = dayAt(offset, FIXED_NOW);
    assert.equal(at.getUTCHours(), 12);
    assert.equal(at.getUTCMinutes(), 0);
    assert.equal(at.getUTCSeconds(), 0);
    assert.equal(at.getUTCMilliseconds(), 0);
  }
});

test('dayAt counts backwards correctly across a month boundary', () => {
  const at = dayAt(10, new Date('2026-08-04T00:00:00.000Z'));
  assert.equal(at.toISOString(), '2026-07-25T12:00:00.000Z');
});

test('the shipped fixture expands within the event budget', () => {
  const expanded = withChapters();
  assert.ok(
    expanded.eventCount <= MAX_EVENTS,
    `plan implies ${expanded.eventCount} events, budget is ${MAX_EVENTS}`
  );
  assert.ok(expanded.eventCount > 200, 'a demo this thin would not populate the dashboards');
});

test('expansion is byte-identical for the same now', () => {
  const first = withChapters();
  const second = withChapters();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('the last seven days are contiguous so the streak is at least 7', () => {
  const plan = loadPlan();
  for (let day = 0; day <= 6; day += 1) {
    assert.ok(plan.activeDayOffsets.includes(day), `day ${day} missing from streak run`);
  }
});

test('the plan has deliberate gaps, so the streak is computed not constant', () => {
  const plan = loadPlan();
  assert.ok(!plan.activeDayOffsets.includes(9));
  assert.ok(!plan.activeDayOffsets.includes(17));
});

test('every student gets at least three chat sessions', () => {
  // Below three, the low_session_count intervention fires for everyone and the
  // queue reads as broken rather than selective.
  const expanded = withChapters();
  for (const student of expanded.students) {
    const sessionIds = new Set(student.turns.map(turn => turn.sessionId));
    assert.ok(sessionIds.size >= 3, `${student.persona.email} has ${sessionIds.size} sessions`);
  }
});

test('every student has a graded attempt inside the last seven days', () => {
  // practiceProgressPercent reads the 7-day slice only.
  const expanded = withChapters();
  for (const student of expanded.students) {
    const recent = student.attempts.filter(attempt => attempt.dayOffset <= 6);
    assert.ok(recent.length >= 1, `${student.persona.email} has no recent attempt`);
  }
});

test('feedback is mixed, so the intervention queue is selective', () => {
  const expanded = withChapters();
  const means = expanded.students.map(student => {
    const ratings = student.feedback.map(f => f.rating);
    return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  });
  assert.ok(means.some(mean => mean < 3.0), 'no student would be flagged');
  assert.ok(means.some(mean => mean >= 3.0), 'every student would be flagged');
});

test('study ticks carry active seconds within the sane per-event range', () => {
  // Time-spent sums this metadata; the reader caps a single event at 2 hours.
  const expanded = withChapters();
  for (const student of expanded.students) {
    assert.ok(student.studyTicks.length > 0);
    for (const tick of student.studyTicks) {
      assert.ok(tick.activeSeconds > 0 && tick.activeSeconds <= 7200);
    }
  }
});

test('a session id derived independently by another seeder matches', () => {
  // This is the coupling the whole design rests on: the analytics seeder never
  // sees the AI seeder's rows, it recomputes their ids.
  const expanded = withChapters();
  const session = expanded.students[0].sessions[0];
  assert.equal(session.id, demoId(session.studentEmail, 'session', session.dayOffset));
});

/* ── Chapter binding ─────────────────────────────────────────────────────────
   The fixture used to name chapters literally, which rotted silently: the
   corpus moved to new editions, every seeded session pointed at a chapter that
   no longer existed, and the app filtered all of it out while the database
   looked perfectly seeded. These pin the properties that stop that recurring.
                                                                          ── */

test('every seeded session names a chapter that is actually ingested', () => {
  const known = new Set(FIXTURE_CHAPTERS.map(chapterKey));
  const expanded = withChapters();
  for (const student of expanded.students) {
    assert.ok(student.sessions.length > 0, `${student.persona.email} got no sessions`);
    for (const session of student.sessions) {
      assert.ok(
        known.has(session.chapterKey),
        `${student.persona.email} session names ${session.chapterName}, which is not in the corpus`
      );
    }
  }
});

test('every seeded session carries board and curriculum', () => {
  // GET /api/ai/chat/sessions turns these into hard equality filters, so a
  // session with them NULL is dropped in SQL and the history reads as empty.
  const expanded = withChapters();
  for (const student of expanded.students) {
    for (const session of student.sessions) {
      assert.ok(session.board, `${session.chapterName} has no board`);
      assert.ok(session.curriculum, `${session.chapterName} has no curriculum`);
    }
  }
});

test('quiz attempts land on bound chapters too', () => {
  const known = new Set(FIXTURE_CHAPTERS.map(chapterKey));
  const expanded = withChapters();
  for (const student of expanded.students) {
    for (const attempt of student.attempts) {
      assert.ok(known.has(attempt.chapterKey), `attempt names ${attempt.chapterName}`);
    }
  }
});

test('chapterKey ignores fields that change on re-ingest', () => {
  // Re-uploading the same PDF bumps counts and the fingerprint. If those fed
  // the key, every re-ingest would shuffle personas onto different chapters.
  const base = chapterFixture();
  const reingested = chapterFixture({
    contentFingerprint: 'totally-different',
    updatedAt: '2027-01-01T00:00:00.000Z',
    chunkCount: 999,
    entityCount: 888,
    documentIds: ['doc-9'],
    documentCount: 4,
  });
  assert.equal(chapterKey(base), chapterKey(reingested));
});

test('ranking does not depend on the order chapters arrived in', () => {
  const forward = rankChapters('arjun@demo.com', FIXTURE_CHAPTERS).map(chapterKey);
  const reversed = rankChapters('arjun@demo.com', [...FIXTURE_CHAPTERS].reverse()).map(chapterKey);
  assert.deepEqual(forward, reversed);
});

test('uploading another chapter does not reshuffle existing picks', () => {
  // This is why selection is rendezvous-hashed rather than index-modulo: a
  // teacher adding one PDF must not rewrite which chapter every student studied.
  const persona = loadPlan().personas.find(p => p.email === 'arjun@demo.com');
  const before = selectChaptersForPersona(persona, FIXTURE_CHAPTERS).chapters.map(chapterKey);

  const extra = chapterFixture({ subject: 'Science', chapterNumber: 11, chapterName: 'Sound' });
  const after = selectChaptersForPersona(persona, [...FIXTURE_CHAPTERS, extra]).chapters.map(chapterKey);

  const displaced = before.filter(key => !after.includes(key));
  assert.ok(
    displaced.length <= 1,
    `adding one chapter displaced ${displaced.length} picks: ${displaced.join(', ')}`
  );
});

test('selection honours declared subject preferences', () => {
  const persona = loadPlan().personas.find(p => p.email === 'priya@demo.com');
  const picked = selectChaptersForPersona(persona, FIXTURE_CHAPTERS).chapters;
  assert.ok(picked.length >= 1);
  const subjects = new Set(picked.map(chapter => chapter.subject));
  assert.ok(
    [...subjects].some(subject => persona.chapterIntent.preferredSubjects.includes(subject)),
    `picked ${[...subjects].join(', ')}, none preferred`
  );
});

test('a persona whose preferred subjects are absent still gets a chapter', () => {
  // A school that only uploaded one subject must still produce a working demo.
  const persona = loadPlan().personas.find(p => p.email === 'priya@demo.com');
  const historyOnly = [
    chapterFixture({ subject: 'History', book: 'Themes', chapterNumber: 1, chapterName: 'Early Societies' }),
    chapterFixture({ subject: 'History', book: 'Themes', chapterNumber: 2, chapterName: 'Empires' }),
  ];
  const result = selectChaptersForPersona(persona, historyOnly);
  assert.ok(result.chapters.length >= 1, 'degraded to nothing instead of another subject');
  assert.ok(result.warnings.length >= 1, 'degradation was silent');
});

test('isEligible rejects a chapter name too long for ChatSession', () => {
  // ChatSession.chapterName is VarChar(160); RAG allows 220. Without this the
  // seeder dies mid-run on an otherwise valid upload.
  assert.equal(isEligible(chapterFixture({ chapterName: 'x'.repeat(161) })), false);
  assert.equal(isEligible(chapterFixture({ chapterName: 'x'.repeat(160) })), true);
});

test('isEligible rejects chapters too thin to hold a conversation', () => {
  assert.equal(isEligible(chapterFixture({ chunkCount: 2 })), false);
  assert.equal(isEligible(chapterFixture({ entityCount: 1 })), false);
  assert.equal(isEligible(chapterFixture({ status: 'processing' })), false);
});

test('expanding without a chapter list is a loud error, not an empty demo', () => {
  assert.throws(() => buildDemoPlan({ now: FIXED_NOW }), /chapters/);
});

test('an empty corpus yields no sessions rather than fabricated ones', () => {
  const expanded = buildDemoPlan({ now: FIXED_NOW, chapters: [] });
  for (const student of expanded.students) {
    assert.equal(student.sessions.length, 0);
    assert.equal(student.turns.length, 0);
  }
  assert.ok(expanded.warnings.length >= 1, 'skipping was silent');
});

test('turn counts do not depend on having chapter text', () => {
  // The AI seeder passes LLM-written pairs; the quiz and analytics seeders pass
  // nothing and fall back. All three must still agree on how many messages
  // exist, or the dashboard contradicts its own drill-down.
  const withText = buildDemoPlan({
    now: FIXED_NOW,
    chapters: FIXTURE_CHAPTERS,
    qaPairsByChapterKey: new Map(FIXTURE_CHAPTERS.map(chapter => [
      chapterKey(chapter),
      [{ question: 'Written by the LLM?', answer: 'Yes, from the chapter text itself.' }],
    ])),
  });
  const withoutText = withChapters();

  for (const [i, student] of withText.students.entries()) {
    assert.equal(
      student.turns.length,
      withoutText.students[i].turns.length,
      `${student.persona.email} disagrees on turn count`
    );
  }
});

test('an unknown subject still gets a fallback script', () => {
  // Otherwise buildTurns skips the session entirely and the seeders desync.
  const plan = loadPlan();
  const exotic = [chapterFixture({ subject: 'Philosophy', book: 'Ideas', chapterNumber: 1, chapterName: 'Ethics' })];
  const expanded = buildDemoPlan({ plan, now: FIXED_NOW, chapters: exotic });
  for (const student of expanded.students) {
    assert.ok(student.turns.length > 0, `${student.persona.email} produced no turns`);
  }
});

test('an over-budget plan is rejected loudly', () => {
  const plan = loadPlan();
  const bloated = {
    ...plan,
    activeDayOffsets: Array.from({ length: 30 }, (_, i) => i),
    personas: [...plan.personas, ...plan.personas, ...plan.personas],
  };
  assert.throws(
    () => buildDemoPlan({ plan: bloated, now: FIXED_NOW, chapters: FIXTURE_CHAPTERS }),
    /over the \d+ budget/
  );
});
