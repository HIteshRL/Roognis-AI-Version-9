require('./load-env');

const express = require('express');
const cookieParser = require('cookie-parser');
const { createHash } = require('node:crypto');
const prisma = require('./lib/prisma');
const requireAuth = require('./middleware/auth');
const requireInternalToken = require('./middleware/internal-token');
const {
  upsertChapterSource,
  needsGeneration,
  sanitizeChapterSource,
} = require('./lib/chapters');
const {
  generateQuizForSource,
  fetchReadyRagChapters,
} = require('./lib/generation');
const { gradeQuizAttempt } = require('./lib/scoring');
const { fetchCardOutcomes } = require('./lib/discover-card-outcomes');
const { QUIZ_STATUS, ACTIVE_STATUSES, approvalDecision } = require('./lib/quiz-status');
const {
  buildStudentAttemptWhere,
  buildStudentLearningContext,
} = require('./lib/student-learning');

const app = express();
const PORT = process.env.PORT || 3005;
const ANALYTICS_URL = process.env.ANALYTICS_URL || 'http://analytics:3004';
const PSV_SERVICE_URL = process.env.PSV_SERVICE_URL || 'http://psv:3011';
const KG_SERVICE_URL = process.env.KG_SERVICE_URL || 'http://kg:3012';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';
const teacherOnly = [requireAuth, requireAuth.requireRole('teacher')];
const studentOnly = [requireAuth, requireAuth.requireRole('student')];
const backgroundTasks = new Set();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'quiz' }));
app.get('/api/quiz/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'quiz' }));

app.post('/api/quiz/internal/chapter-ready', requireInternalToken, asyncHandler(async (req, res) => {
  const source = await upsertChapterSource(prisma, req.body?.chapter || req.body || {});
  const activeQuiz = await findActiveQuizForSource(source);
  const shouldGenerate = source.quizStatus !== 'generating' && needsGeneration(source, activeQuiz);

  if (shouldGenerate) {
    enqueueGeneration(source, { trigger: req.body?.trigger || 'ingestion' });
  }

  res.status(202).json({
    sourceId: source.id,
    quizStatus: shouldGenerate ? 'generating' : source.quizStatus,
    queued: shouldGenerate,
  });
}));

app.get('/api/quiz/internal/student-learning-context', requireInternalToken, asyncHandler(async (req, res) => {
  let where;
  try {
    where = buildStudentAttemptWhere(req.query || {});
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  // Concurrent, not sequential: the Discover read is a leaf call with its own
  // shorter budget, and serialising it would add its latency to this route's.
  // It fails soft to [], so there is deliberately no depends_on: discover —
  // Discover being down degrades this context, it does not break it.
  const [attempts, cardOutcomes] = await Promise.all([
    prisma.quizAttempt.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 10,
      select: {
        percentage: true,
        result: true,
        submittedAt: true,
        source: {
          select: {
            subject: true,
            grade: true,
            chapterNumber: true,
            chapterName: true,
            // Names which RAG documents a weak area came from, which is what
            // makes that area groundable as an Academic Card in Discover.
            documentIds: true,
          },
        },
      },
    }),
    fetchCardOutcomes({ studentId: where.studentId }),
  ]);

  return res.status(200).json(buildStudentLearningContext(attempts, req.query || {}, cardOutcomes));
}));

app.get('/api/quiz/chapters', ...teacherOnly, asyncHandler(async (req, res) => {
  const sync = await syncReadyRagSources({
    schoolId: req.user.schoolId,
    subject: req.query?.subject,
    grade: req.query?.grade,
  });
  const sources = await prisma.chapterQuizSource.findMany({
    where: { schoolId: req.user.schoolId },
    orderBy: [
      { subject: 'asc' },
      { grade: 'asc' },
      { chapterNumber: 'asc' },
      { updatedAt: 'desc' },
    ],
    include: {
      quizzes: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  res.status(200).json({
    sync,
    chapters: sources.map(source => sanitizeChapterSource(source, source.quizzes[0] || null)),
  });
}));

app.post('/api/quiz/backfill', ...teacherOnly, asyncHandler(async (req, res) => {
  const payload = await fetchReadyRagChapters({
    schoolId: req.user.schoolId,
    subject: req.body?.subject,
    grade: req.body?.grade,
  });
  const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
  const queued = [];
  const skipped = [];
  const failed = [];

  for (const chapter of chapters) {
    try {
      const source = await upsertChapterSource(prisma, chapter);
      const activeQuiz = await findActiveQuizForSource(source);
      if (source.quizStatus === 'generating') {
        skipped.push({ sourceId: source.id, reason: 'already_generating' });
      } else if (needsGeneration(source, activeQuiz)) {
        queued.push({ sourceId: source.id, chapterName: source.chapterName });
        enqueueGeneration(source, {
          trigger: 'backfill',
          teacherId: req.user.userId,
        });
      } else {
        skipped.push({ sourceId: source.id, reason: 'up_to_date' });
      }
    } catch (err) {
      failed.push({ chapterName: chapter.chapterName || 'unknown', error: err.message });
    }
  }

  res.status(202).json({
    discovered: chapters.length,
    queued,
    skipped,
    failed,
  });
}));

app.post('/api/quiz/sources/:sourceId/generate', ...teacherOnly, asyncHandler(async (req, res) => {
  const source = await prisma.chapterQuizSource.findFirst({
    where: {
      id: req.params.sourceId,
      schoolId: req.user.schoolId,
    },
  });
  if (!source) return res.status(404).json({ error: 'Chapter quiz source not found.' });
  if (source.quizStatus === 'generating') {
    return res.status(202).json({ sourceId: source.id, queued: false, quizStatus: source.quizStatus });
  }

  enqueueGeneration(source, {
    trigger: 'manual',
    teacherId: req.user.userId,
    questionCount: req.body?.questionCount,
    force: true,
  });
  return res.status(202).json({ sourceId: source.id, queued: true, quizStatus: 'generating' });
}));

/**
 * Approve a drafted quiz so students can open it.
 *
 * This is the human correctness gate. `validateQuizDraft` can only check the
 * shape of a generated quiz — option counts, difficulty spread, resolvable
 * citation ids — and nothing in the pipeline can establish that an answer key
 * is right. So a teacher reads the questions (via `GET /api/quiz/:quizId`,
 * which returns answers) and approves here.
 *
 * Deliberately not idempotent-by-silence: approving something already approved
 * returns 409 rather than pretending, so a double-submit in the UI cannot be
 * mistaken for a second reviewer having checked it.
 */
app.post('/api/quiz/quizzes/:quizId/approve', ...teacherOnly, asyncHandler(async (req, res) => {
  const quiz = await prisma.quiz.findFirst({
    where: { id: req.params.quizId, schoolId: req.user.schoolId },
  });
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });

  const decision = approvalDecision(quiz.status);
  if (!decision.ok) {
    return res.status(decision.httpStatus).json({ error: decision.error, status: quiz.status });
  }

  const approved = await prisma.$transaction(async tx => {
    const updated = await tx.quiz.update({
      where: { id: quiz.id },
      data: {
        status: QUIZ_STATUS.READY,
        approvedAt: new Date(),
        approvedBy: req.user.userId,
      },
      include: { source: true, questions: { orderBy: { orderIndex: 'asc' } } },
    });

    // Only advance the source once its active quiz is the one approved,
    // otherwise a stale draft could mark the chapter publishable.
    await tx.chapterQuizSource.updateMany({
      where: { id: updated.sourceId, activeQuizId: updated.id },
      data: { quizStatus: QUIZ_STATUS.READY },
    });

    return updated;
  });

  // `quiz_published` has been in the analytics allowlist and consumed by the
  // teacher dashboard since the beginning, with no producer — this is it.
  fireAnalyticsEvent({
    type: 'quiz_published',
    schoolId: req.user.schoolId,
    subject: approved.source?.subject || null,
    metadata: {
      quizId: approved.id,
      quizTitle: approved.title,
      sourceId: approved.sourceId,
      questionCount: approved.questionCount,
      approvedBy: req.user.userId,
    },
  });
  await syncApprovedQuizToKg(approved, req.user.userId).catch(error => {
    // Approval remains authoritative even if Neo4j is temporarily down. The
    // stable ids on the quiz preserve replayability for a later reconciliation.
    console.warn('[quiz] approved concept mapping could not reach KG:', error.message);
  });

  res.status(200).json(formatQuiz(approved, { includeAnswers: true }));
}));

/**
 * Per-student scores for one quiz. Student names are not resolved here —
 * `auth_db` is a separate service/schema and the frontend already has a
 * teacher-scoped name-lookup route (`GET /api/auth/users?role=student`), so
 * the client joins studentId -> name itself instead of this service reaching
 * across schemas or auth needing a new internal route for it.
 */
app.get('/api/quiz/quizzes/:quizId/attempts', ...teacherOnly, asyncHandler(async (req, res) => {
  const quiz = await prisma.quiz.findFirst({
    where: { id: req.params.quizId, schoolId: req.user.schoolId },
    select: { id: true, title: true, questionCount: true },
  });
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });

  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId: quiz.id, schoolId: req.user.schoolId },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      studentId: true,
      score: true,
      maxScore: true,
      percentage: true,
      submittedAt: true,
    },
  });

  res.status(200).json({
    quizId: quiz.id,
    quizTitle: quiz.title,
    questionCount: quiz.questionCount,
    attempts: attempts.map(attempt => ({
      attemptId: attempt.id,
      studentId: attempt.studentId,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      submittedAt: attempt.submittedAt,
    })),
  });
}));

app.get('/api/quiz/student/chapters', ...studentOnly, asyncHandler(async (req, res) => {
  const sources = await prisma.chapterQuizSource.findMany({
    where: {
      schoolId: req.user.schoolId,
      quizStatus: QUIZ_STATUS.READY,
      activeQuizId: { not: null },
    },
    orderBy: [
      { subject: 'asc' },
      { grade: 'asc' },
      { chapterNumber: 'asc' },
    ],
    include: {
      quizzes: {
        where: { status: QUIZ_STATUS.READY },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          attempts: {
            where: { studentId: req.user.userId },
            orderBy: { submittedAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  res.status(200).json({
    quizzes: sources
      .filter(source => source.quizzes[0])
      .map(source => ({
        source: sanitizeChapterSource(source, source.quizzes[0]),
        quiz: publicQuizSummary(source.quizzes[0], source.quizzes[0].attempts?.[0] || null),
      })),
  });
}));

app.get('/api/quiz/student/quizzes/:quizId', ...studentOnly, asyncHandler(async (req, res) => {
  const quiz = await prisma.quiz.findFirst({
    where: {
      id: req.params.quizId,
      schoolId: req.user.schoolId,
      status: QUIZ_STATUS.READY,
    },
    include: {
      source: true,
      questions: { orderBy: { orderIndex: 'asc' } },
      attempts: {
        where: { studentId: req.user.userId },
        orderBy: { submittedAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  fireAnalyticsEvent({
    type: 'quiz_opened',
    studentId: req.user.userId,
    schoolId: req.user.schoolId,
    subject: quiz.source?.subject,
    metadata: quizAnalyticsMetadata(quiz),
  });
  res.status(200).json(formatQuiz(quiz, {
    includeAnswers: false,
    latestAttempt: quiz.attempts?.[0] || null,
  }));
}));

app.post('/api/quiz/student/quizzes/:quizId/submit', ...studentOnly, asyncHandler(async (req, res) => {
  const quiz = await prisma.quiz.findFirst({
    where: {
      id: req.params.quizId,
      schoolId: req.user.schoolId,
      status: QUIZ_STATUS.READY,
    },
    include: {
      source: true,
      questions: { orderBy: { orderIndex: 'asc' } },
    },
  });
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  if (!quiz.questions.length) return res.status(409).json({ error: 'Quiz has no questions to submit.' });

  const graded = gradeQuizAttempt(quiz, req.body?.answers || {});
  const attempt = await prisma.quizAttempt.create({
    data: {
      quizId: quiz.id,
      sourceId: quiz.sourceId,
      schoolId: req.user.schoolId,
      studentId: req.user.userId,
      answers: graded.answers,
      result: {
        results: graded.results,
        weakAreas: graded.weakAreas,
        correctCount: graded.correctCount,
        questionCount: graded.questionCount,
      },
      score: graded.score,
      maxScore: graded.maxScore,
      percentage: graded.percentage,
    },
  });

  const metadata = {
    ...quizAnalyticsMetadata(quiz),
    attemptId: attempt.id,
    score: graded.score,
    maxScore: graded.maxScore,
    scorePercent: graded.percentage,
    correctCount: graded.correctCount,
    questionCount: graded.questionCount,
    weakAreas: graded.weakAreas.map(item => item.label),
    weakArea: graded.weakAreas[0]?.label || null,
  };
  fireAnalyticsEvent({
    type: 'quiz_submitted',
    studentId: req.user.userId,
    schoolId: req.user.schoolId,
    subject: quiz.source?.subject,
    metadata,
  });
  fireAnalyticsEvent({
    type: 'quiz_graded',
    studentId: req.user.userId,
    schoolId: req.user.schoolId,
    subject: quiz.source?.subject,
    metadata,
  });
  firePsvQuizEvidence({
    attempt,
    quiz,
    graded,
    studentId: req.user.userId,
    schoolId: req.user.schoolId,
  });

  res.status(201).json(formatAttempt(attempt, graded));
}));

app.get('/api/quiz/:quizId', ...teacherOnly, asyncHandler(async (req, res) => {
  const quiz = await prisma.quiz.findFirst({
    where: {
      id: req.params.quizId,
      schoolId: req.user.schoolId,
    },
    include: {
      source: true,
      questions: { orderBy: { orderIndex: 'asc' } },
    },
  });
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  res.status(200).json(formatQuiz(quiz, { includeAnswers: true }));
}));

app.use('/api/quiz', (_req, res) => res.status(404).json({ error: 'Quiz endpoint not implemented.' }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

async function findActiveQuizForSource(source) {
  if (source.activeQuizId) {
    const quiz = await prisma.quiz.findUnique({ where: { id: source.activeQuizId } });
    if (quiz) return quiz;
  }
  return prisma.quiz.findFirst({
    where: {
      sourceId: source.id,
      // Includes pending_review: a quiz awaiting approval still occupies the
      // chapter's slot, so `needsGeneration` must see it and not regenerate.
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
  });
}

function enqueueGeneration(source, options = {}) {
  const task = generateQuizForSource(prisma, source, options).catch(err => {
    console.error('[quiz] generation failed:', err);
  });
  backgroundTasks.add(task);
  task.finally(() => backgroundTasks.delete(task));
  return task;
}

async function syncReadyRagSources(options = {}) {
  try {
    const payload = await fetchReadyRagChapters(options);
    const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
    const synced = [];
    const failed = [];
    for (const chapter of chapters) {
      try {
        const source = await upsertChapterSource(prisma, chapter);
        synced.push(source.id);
      } catch (err) {
        failed.push({ chapterName: chapter.chapterName || 'unknown', error: err.message });
      }
    }
    return { discovered: chapters.length, synced: synced.length, failed };
  } catch (err) {
    console.warn('[quiz] ready chapter sync skipped:', err.message);
    return { discovered: 0, synced: 0, failed: [{ error: err.message }] };
  }
}

function formatQuiz(quiz, { includeAnswers, latestAttempt = null }) {
  const payload = {
    quizId: quiz.id,
    sourceId: quiz.sourceId,
    title: quiz.title,
    chapterSummary: quiz.chapterSummary,
    status: quiz.status,
    approvedAt: quiz.approvedAt || null,
    approvedBy: quiz.approvedBy || null,
    questionCount: quiz.questionCount,
    difficultyCounts: {
      simple: quiz.simpleCount,
      medium: quiz.mediumCount,
      hard: quiz.hardCount,
    },
    generationModel: quiz.generationModel,
    sourceCoverage: quiz.sourceCoverage,
    source: quiz.source ? sanitizeChapterSource(quiz.source, quiz) : null,
    questions: quiz.questions.map(question => formatQuestion(question, { includeAnswers })),
    createdAt: quiz.createdAt,
    updatedAt: quiz.updatedAt,
  };
  if (latestAttempt) payload.latestAttempt = formatAttemptSummary(latestAttempt);
  return payload;
}

function formatQuestion(question, { includeAnswers }) {
  const base = {
    questionId: question.id,
    order: question.orderIndex,
    type: question.type,
    difficulty: question.difficulty,
    bloomLevel: question.bloomLevel,
    conceptTag: question.conceptTag,
    conceptId: question.conceptId,
    misconceptionIds: Array.isArray(question.misconceptionIds) ? question.misconceptionIds : [],
    weakAreaLabel: question.weakAreaLabel,
    prompt: question.prompt,
    options: Array.isArray(question.options) ? question.options : [],
    marks: question.marks,
    sourceChunkIds: Array.isArray(question.sourceChunkIds) ? question.sourceChunkIds : [],
  };
  if (!includeAnswers) return base;
  return {
    ...base,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
  };
}

function publicQuizSummary(quiz, latestAttempt = null) {
  const payload = {
    quizId: quiz.id,
    title: quiz.title,
    status: quiz.status,
    questionCount: quiz.questionCount,
    difficultyCounts: {
      simple: quiz.simpleCount,
      medium: quiz.mediumCount,
      hard: quiz.hardCount,
    },
    createdAt: quiz.createdAt,
  };
  if (latestAttempt) payload.latestAttempt = formatAttemptSummary(latestAttempt);
  return payload;
}

function formatAttempt(attempt, graded) {
  return {
    attemptId: attempt.id,
    quizId: attempt.quizId,
    score: graded.score,
    maxScore: graded.maxScore,
    percentage: graded.percentage,
    correctCount: graded.correctCount,
    questionCount: graded.questionCount,
    weakAreas: graded.weakAreas,
    results: graded.results,
    submittedAt: attempt.submittedAt,
  };
}

function formatAttemptSummary(attempt) {
  return {
    attemptId: attempt.id,
    quizId: attempt.quizId,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: attempt.percentage,
    submittedAt: attempt.submittedAt,
  };
}

function quizAnalyticsMetadata(quiz) {
  const source = quiz.source || {};
  return {
    quizId: quiz.id,
    quizTitle: quiz.title,
    sourceId: quiz.sourceId,
    subject: source.subject,
    grade: source.grade,
    chapterNumber: source.chapterNumber,
    chapterName: source.chapterName,
  };
}

function fireAnalyticsEvent(event) {
  if (!ANALYTICS_URL || !INTERNAL_SERVICE_TOKEN) return;
  fetch(`${ANALYTICS_URL.replace(/\/+$/, '')}/api/analytics/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Service-Token': INTERNAL_SERVICE_TOKEN,
    },
    body: JSON.stringify(event),
  }).catch(err => {
    console.warn('[quiz] analytics event failed:', err.message);
  });
}

function firePsvQuizEvidence({ attempt, quiz, graded, studentId, schoolId }) {
  if (!PSV_SERVICE_URL || !INTERNAL_SERVICE_TOKEN) return;
  const wallTs = new Date(attempt.submittedAt || Date.now()).toISOString();
  const events = graded.results
    .filter(result => result.conceptId)
    .map(result => ({
      eventId: stableEvidenceEventId('quiz', attempt.id, result.questionId, 'outcome'),
      schemaVersion: 1,
      studentId,
      schoolId,
      sessionId: `quiz:${attempt.id}`,
      itemId: result.questionId,
      conceptId: result.conceptId,
      clientTsMono: 0,
      clientTsWall: wallTs,
      source: result.type === 'short_answer' ? 'written_answer' : 'quiz',
      eventType: result.type === 'short_answer' ? 'written_answer_scored' : 'answer_submitted',
      payload: {
        correct: result.correct,
        scoreNormalized: result.marks > 0 ? result.awardedMarks / result.marks : 0,
        difficulty: result.difficulty,
        questionType: result.type,
        resultRef: `quiz-attempt:${attempt.id}`,
        misconceptionIds: result.correct ? [] : result.misconceptionIds,
        gradingAuthority: 'quiz-service',
        quizId: quiz.id,
      },
    }));
  if (!events.length) return;
  fetch(`${PSV_SERVICE_URL.replace(/\/+$/, '')}/api/psv/internal/events/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Service-Token': INTERNAL_SERVICE_TOKEN,
    },
    body: JSON.stringify({ events }),
  }).catch(err => console.warn('[quiz] PSV evidence delivery failed:', err.message));
}

async function syncApprovedQuizToKg(quiz, approvedBy) {
  if (!KG_SERVICE_URL || !INTERNAL_SERVICE_TOKEN) return;
  const base = KG_SERVICE_URL.replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'application/json',
    'X-Internal-Service-Token': INTERNAL_SERVICE_TOKEN,
  };
  const request = async (path, method, body) => {
    const response = await fetch(`${base}${path}`, {
      method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`KG ${method} ${path} returned ${response.status}`);
  };
  for (const question of quiz.questions || []) {
    if (!question.conceptId) continue;
    const curriculum = {
      board: quiz.source?.board || null,
      curriculum: quiz.source?.curriculum || null,
      grade: quiz.source?.grade || null,
      subject: quiz.source?.subject || null,
      chapter: quiz.source?.chapterName || null,
    };
    await request(`/api/kg/v1/nodes/${encodeURIComponent(question.conceptId)}`, 'PUT', {
      nodeId: question.conceptId,
      kind: 'Concept',
      label: question.conceptTag,
      status: 'active',
      ...curriculum,
      metadata: { activation: 'teacher_quiz_approval', quizId: quiz.id, approvedBy },
    });
    const assessmentId = `assessment:${question.id}`;
    await request(`/api/kg/v1/nodes/${encodeURIComponent(assessmentId)}`, 'PUT', {
      nodeId: assessmentId,
      kind: 'AssessmentItem',
      label: `Quiz item ${question.orderIndex}`,
      status: 'active',
      ...curriculum,
      metadata: { quizId: quiz.id, sourceId: quiz.sourceId, approvedBy },
    });
    await request('/api/kg/v1/relationships', 'POST', {
      fromNodeId: assessmentId,
      toNodeId: question.conceptId,
      relationship: 'MEASURES',
      status: 'active',
      evidenceRef: `quiz-approval:${quiz.id}`,
    });
    for (const misconceptionId of Array.isArray(question.misconceptionIds) ? question.misconceptionIds : []) {
      await request(`/api/kg/v1/nodes/${encodeURIComponent(misconceptionId)}`, 'PUT', {
        nodeId: misconceptionId,
        kind: 'Misconception',
        label: question.weakAreaLabel || `Misconception for ${question.conceptTag}`,
        status: 'active',
        ...curriculum,
        metadata: {
          activation: 'teacher_quiz_approval',
          quizId: quiz.id,
          questionId: question.id,
          approvedBy,
        },
      });
      await request('/api/kg/v1/relationships', 'POST', {
        fromNodeId: misconceptionId,
        toNodeId: question.conceptId,
        relationship: 'DISTRACTOR_FOR',
        status: 'active',
        evidenceRef: `quiz-approval:${quiz.id}`,
      });
    }
  }
}

function stableEvidenceEventId(namespace, ...parts) {
  const digest = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 48);
  return `${namespace}:${digest}`;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.use((err, _req, res, _next) => {
  console.error('[quiz] unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

async function shutdown(signal) {
  console.log(`[quiz] ${signal} received. Shutting down...`);
  await Promise.allSettled([...backgroundTasks]);
  await prisma.$disconnect();
  process.exit(0);
}

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`[quiz] Service running on :${PORT}`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[quiz] Port ${PORT} is already in use.`);
      process.exit(1);
    }
    throw err;
  });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A stray throw outside the request path would otherwise crash the
  // process silently under Node's default behavior, taking down every
  // concurrently in-flight request with it — worst at peak load. Log with
  // full context and exit so the container's `restart: unless-stopped`
  // policy brings it back.
  process.on('uncaughtException', err => {
    console.error('[quiz] uncaughtException:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', reason => {
    console.error('[quiz] unhandledRejection:', reason);
    process.exit(1);
  });
}

module.exports = app;
