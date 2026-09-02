'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { demoId, seededRandom, dayAt } = require('./demo-ids');
const { selectChaptersForPersona, chapterSetFingerprint, chapterKey } = require('./chapter-select');
const { deriveQaPairs, qaAnchorReport } = require('./chapter-qa');

/**
 * Expands the declarative fixture into concrete, dated activity.
 *
 * All three seeders call this with the same `now`, so all three see an
 * identical plan and derive identical ids for the same logical row. The AI
 * seeder writes the sessions and messages, the quiz seeder writes attempts,
 * and the analytics seeder writes the events that describe both — and because
 * the ids agree, a number on the teacher dashboard drills down to a row that
 * actually exists.
 *
 * The shape of the output is deliberately close to what the dashboards read,
 * because those readers impose real constraints (documented at each site
 * below) that a naive "just make some rows" seeder silently violates.
 */

const PLAN_PATH = path.join(__dirname, '..', 'plan.json');

// The teacher dashboard fetches 30 days of events with `take: 500`, ordered
// newest first. Past that cap the OLDEST events are dropped, so 30-day totals
// quietly under-report while looking fine. Stay well under it.
const MAX_EVENTS = 450;

function loadPlan(planPath = PLAN_PATH) {
  return JSON.parse(fs.readFileSync(planPath, 'utf8'));
}

/**
 * Bind each persona's declared intent to chapters that are actually ingested.
 *
 * Personas name subjects, never chapters. The concrete chapters are whatever
 * the school uploaded, read from RAG by the caller and injected here — so the
 * demo works on a non-NCERT corpus, and cannot rot when editions change.
 *
 * Pure: the network call happens in the seeder, before this runs.
 */
function bindChapters(plan, chapters, options = {}) {
  if (!Array.isArray(chapters)) {
    throw new TypeError('buildDemoPlan requires a `chapters` array read from GET /api/rag/internal/chapters.');
  }

  const eligibility = plan.chapterBinding || {};
  const warnings = [];
  const personas = plan.personas.map(persona => {
    const selection = selectChaptersForPersona(persona, chapters, {
      minChunkCount: eligibility.minChunkCount,
      minEntityCount: eligibility.minEntityCount,
      ...options,
    });
    warnings.push(...selection.warnings);
    return { ...persona, resolvedChapters: selection.chapters };
  });

  return {
    personas,
    warnings,
    fingerprint: chapterSetFingerprint(chapters),
  };
}

/** Sessions are per student, per chapter, per active day. */
function buildSessions(plan, persona, now) {
  const chapters = persona.resolvedChapters || [];
  if (!chapters.length) return [];

  const sessions = [];
  for (const [dayIndex, dayOffset] of plan.activeDayOffsets.entries()) {
    // Alternate chapters so each one accumulates activity.
    const chapter = chapters[dayIndex % chapters.length];
    const at = dayAt(dayOffset, now);
    sessions.push({
      id: demoId(persona.email, 'session', dayOffset),
      studentEmail: persona.email,
      dayOffset,
      at,
      subject: chapter.subject,
      grade: chapter.grade,
      // The chat-sessions endpoint filters on board and curriculum, so a
      // session missing them is invisible in the app however correct the rest
      // of it is. They come from the ingested document, not from the fixture.
      board: chapter.board,
      curriculum: chapter.curriculum,
      chapterNumber: chapter.chapterNumber,
      chapterName: chapter.chapterName,
      chapterKey: chapterKey(chapter),
      documentIds: chapter.documentIds || [],
    });
  }
  return sessions;
}

/**
 * Two or three turns per session.
 *
 * `usageStats.chatSessions` counts distinct sessionId on `chat_message` only,
 * and the intervention rule flags any student with fewer than 3 chat sessions.
 * With 23 active days every student clears that comfortably — the flag should
 * fire on merit, not on seeding thinness.
 */
function buildTurns(plan, persona, sessions, qaByChapterKey = null) {
  const turns = [];
  for (const session of sessions) {
    const random = seededRandom(`${persona.email}:${session.dayOffset}:turns`);
    const turnCount = 2 + Math.floor(random() * 2); // 2 or 3

    // Questions derived from the chapter's own ingested content. The authored
    // scripts remain only as a last resort for a chapter that yielded no
    // usable anchors — they are keyed by subject, so against a real chapter
    // they read as the tutor answering about something it is not teaching.
    const derived = qaByChapterKey ? qaByChapterKey.get(session.chapterKey) : null;
    // The fallback must never be empty: the other two seeders do not fetch
    // chapter text, so they reach this path for every session. If it yielded
    // nothing they would emit fewer chat_message events than the AI seeder
    // wrote messages, and the dashboard would contradict its own drill-down.
    const scripts = plan.chatScripts || {};
    const fallback = scripts.bySubject || {};
    const script = (derived && derived.length)
      ? derived
      : (fallback[session.subject] || scripts.default || []);
    if (!script.length) continue;

    for (let i = 0; i < turnCount; i += 1) {
      const entry = script[(session.dayOffset + i) % script.length];
      // Space turns a few minutes apart so ordering within a session is stable.
      const at = new Date(session.at.getTime() + i * 4 * 60 * 1000);
      turns.push({
        sessionId: session.id,
        studentEmail: persona.email,
        dayOffset: session.dayOffset,
        subject: session.subject,
        index: i,
        at,
        userMessageId: demoId(persona.email, 'message-user', session.dayOffset, i),
        assistantMessageId: demoId(persona.email, 'message-assistant', session.dayOffset, i),
        question: entry.question,
        answer: entry.answer,
      });
    }
  }
  return turns;
}

/**
 * Quiz attempts on a subset of days, at least one inside the last 7.
 *
 * `practiceProgressPercent` is computed from the 7-day slice only, so without a
 * recent graded attempt that card reads 0% no matter how much older history
 * exists.
 */
function buildAttempts(plan, persona, now) {
  const chapters = persona.resolvedChapters || [];
  if (!chapters.length) return [];

  const attemptDays = plan.activeDayOffsets.filter((_, i) => i % 4 === 0);
  const [minScore, maxScore] = persona.scoreRange;

  return attemptDays.map((dayOffset, i) => {
    const random = seededRandom(`${persona.email}:${dayOffset}:attempt`);
    const chapter = chapters[i % chapters.length];
    const scorePercent = Math.round(minScore + random() * (maxScore - minScore));
    return {
      id: demoId(persona.email, 'attempt', dayOffset),
      studentEmail: persona.email,
      dayOffset,
      at: dayAt(dayOffset, now),
      subject: chapter.subject,
      grade: chapter.grade,
      chapterNumber: chapter.chapterNumber,
      chapterName: chapter.chapterName,
      chapterKey: chapterKey(chapter),
      scorePercent,
    };
  });
}

/**
 * Study-time ticks.
 *
 * `timeSpentSeconds` sums metadata on learning events; `chat_message` carries
 * none, so without these the time-spent card stays at zero however much chat
 * is seeded.
 */
function buildStudyTicks(plan, persona, sessions) {
  return sessions.map(session => {
    const random = seededRandom(`${persona.email}:${session.dayOffset}:study`);
    return {
      studentEmail: persona.email,
      dayOffset: session.dayOffset,
      at: new Date(session.at.getTime() + 20 * 60 * 1000),
      subject: session.subject,
      // 6-22 minutes, capped well under the 2-hour per-event sanity limit.
      activeSeconds: 360 + Math.floor(random() * 960),
    };
  });
}

/**
 * Feedback ratings, biased per persona.
 *
 * The low-rating intervention flag triggers below a 3.0 mean. One persona is
 * seeded below it and two above, so the intervention queue is non-empty and
 * non-uniform — an all-clear or all-red queue demonstrates nothing.
 */
function buildFeedback(plan, persona, sessions) {
  return sessions
    .filter((_, i) => i % 3 === 0)
    .map(session => {
      const random = seededRandom(`${persona.email}:${session.dayOffset}:rating`);
      const rating = persona.ratingBias === 'low'
        ? 1 + Math.floor(random() * 3)  // 1-3
        : 4 + Math.floor(random() * 2); // 4-5
      return {
        studentEmail: persona.email,
        dayOffset: session.dayOffset,
        at: new Date(session.at.getTime() + 6 * 60 * 1000),
        subject: session.subject,
        sessionId: session.id,
        rating,
      };
    });
}

/** Render `{chapterName}`/`{subject}`/`{grade}` against the bound chapter. */
function renderMediaTemplate(template, session) {
  return String(template || '')
    .replace(/\{chapterName\}/g, session.chapterName || '')
    .replace(/\{subject\}/g, session.subject || '')
    .replace(/\{grade\}/g, String(session.grade || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMedia(plan, persona, sessions) {
  const videos = [];
  const diagrams = [];
  // Templates, not per-subject literals: a fixed list goes stale the same way
  // the chapter names did, and "labelled diagram of a plant cell" on a chapter
  // about coal is exactly the tell we are removing.
  const videoTemplates = plan.videoTopicTemplates || [];
  const diagramTemplates = plan.diagramPromptTemplates || [];

  for (const [i, session] of sessions.entries()) {
    if (i % 3 === 1 && videoTemplates.length) {
      const topic = renderMediaTemplate(videoTemplates[session.dayOffset % videoTemplates.length], session);
      if (topic) {
        videos.push({
          studentEmail: persona.email,
          dayOffset: session.dayOffset,
          at: new Date(session.at.getTime() + 9 * 60 * 1000),
          subject: session.subject,
          topic,
          // Recommended always; opened only sometimes. A 1:1 ratio would look
          // synthetic, and "opened" is the signal a teacher actually cares about.
          opened: i % 6 === 1,
        });
      }
    }
    if (i % 5 === 2 && diagramTemplates.length) {
      const prompt = renderMediaTemplate(diagramTemplates[session.dayOffset % diagramTemplates.length], session);
      if (prompt) {
        diagrams.push({
          studentEmail: persona.email,
          dayOffset: session.dayOffset,
          at: new Date(session.at.getTime() + 12 * 60 * 1000),
          subject: session.subject,
          prompt,
        });
      }
    }
  }
  return { videos, diagrams };
}

/** News signals, backdated so interest-graph decay is exact rather than approximated. */
function buildNewsSignals(plan, persona, now) {
  const signals = [];
  const kinds = ['impression', 'impression', 'open', 'dwell', 'open', 'skip', 'share'];
  for (const [i, dayOffset] of plan.activeDayOffsets.entries()) {
    const random = seededRandom(`${persona.email}:${dayOffset}:news`);
    const kind = kinds[i % kinds.length];
    signals.push({
      studentEmail: persona.email,
      dayOffset,
      at: dayAt(dayOffset, now),
      category: persona.newsCategories[i % persona.newsCategories.length],
      kind,
      // Dwell weight is per-minute and capped at 4 minutes upstream.
      dwellMs: kind === 'dwell' ? 45000 + Math.floor(random() * 150000) : null,
    });
  }
  return signals;
}

function buildForPersona(plan, persona, now, qaByChapterKey) {
  const sessions = buildSessions(plan, persona, now);
  const { videos, diagrams } = buildMedia(plan, persona, sessions);
  return {
    persona,
    sessions,
    turns: buildTurns(plan, persona, sessions, qaByChapterKey),
    attempts: buildAttempts(plan, persona, now),
    studyTicks: buildStudyTicks(plan, persona, sessions),
    feedback: buildFeedback(plan, persona, sessions),
    videos,
    diagrams,
    newsSignals: buildNewsSignals(plan, persona, now),
  };
}

/**
 * Count the analytics events this plan implies, so the 500-row read cap can be
 * asserted at build time instead of discovered as a wrong number on stage.
 */
function countEvents(expanded) {
  let total = 0;
  for (const student of expanded.students) {
    total += student.sessions.length;                       // lesson_started
    total += student.turns.length;                          // chat_message
    total += student.studyTicks.length;                     // study_time_tracked
    total += student.feedback.length;                       // feedback_submitted
    total += student.diagrams.length;                       // image_generated
    total += student.videos.length;                         // video_recommended
    total += student.videos.filter(v => v.opened).length;   // video_opened
    total += student.attempts.length * 3;                   // opened + submitted + graded
    total += 1;                                             // student_onboarding_completed
  }
  return total;
}

/**
 * Turn the fetched chapter contexts into ready-to-use Q&A, keyed by chapter.
 *
 * Only the AI seeder passes `chapterContexts` — it is the only one that writes
 * message text. The others get the same sessions and counts without paying for
 * the extra fetches.
 */
function buildQaByChapterKey(plan, chapterContexts = []) {
  const byKey = new Map();
  const templates = plan.qaTemplates || {};
  const citation = plan.qaCitation || '';
  const minAnchors = Number((plan.chapterBinding || {}).minQaAnchors || 0);

  const rejected = [];
  for (const context of chapterContexts) {
    if (!context || !context.chapter) continue;
    const name = context.chapter.chapterName;

    // Too few usable anchors and the session would repeat itself; take the next
    // chapter in rank instead.
    const { anchors, candidateCount } = qaAnchorReport(context);
    if (anchors.length < minAnchors) {
      rejected.push(`${name} (${anchors.length}/${candidateCount} entities usable)`);
      continue;
    }

    // Session count per chapter is bounded by activeDayOffsets; three turns
    // apiece is the ceiling, so this covers the worst case without cycling.
    const limit = plan.activeDayOffsets.length * 3;
    const pairs = deriveQaPairs(context, { templates, citation, limit });
    if (!pairs.length) {
      rejected.push(`${name} (no renderable pairs)`);
      continue;
    }
    byKey.set(chapterKey(context.chapter), pairs);
  }

  return { byKey, rejected };
}

function buildDemoPlan(options = {}) {
  const plan = options.plan || loadPlan(options.planPath);
  const now = options.now || new Date();

  const bound = bindChapters(plan, options.chapters, options.eligibility);
  // Pre-rendered pairs win when the caller supplied them (the AI seeder renders
  // them with the LLM); otherwise derive deterministically from any contexts.
  const qaByChapterKey = options.qaPairsByChapterKey
    || buildQaByChapterKey(plan, options.chapterContexts || []).byKey;

  const expanded = {
    version: plan.version,
    now,
    chapterSetFingerprint: bound.fingerprint,
    warnings: bound.warnings,
    students: bound.personas.map(persona => buildForPersona(plan, persona, now, qaByChapterKey)),
  };

  expanded.eventCount = countEvents(expanded);
  if (expanded.eventCount > MAX_EVENTS) {
    throw new Error(
      `Demo plan implies ${expanded.eventCount} events, over the ${MAX_EVENTS} budget. ` +
      'The teacher dashboard reads 30 days with take:500 newest-first, so the oldest ' +
      'events would be silently dropped from every 30-day aggregate.'
    );
  }

  return expanded;
}

module.exports = {
  MAX_EVENTS,
  PLAN_PATH,
  loadPlan,
  bindChapters,
  buildQaByChapterKey,
  buildDemoPlan,
  countEvents,
};
