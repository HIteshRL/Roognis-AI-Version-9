require('./load-env');

const express = require('express');
const cookieParser = require('cookie-parser');
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
const {
  buildStudentAttemptWhere,
  buildStudentLearningContext,
} = require('./lib/student-learning');

const app = express();
const PORT = process.env.PORT || 3005;
const ANALYTICS_URL = process.env.ANALYTICS_URL || 'http://analytics:3004';
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

  const attempts = await prisma.quizAttempt.findMany({
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
        },
      },
    },
  });

  return res.status(200).json(buildStudentLearningContext(attempts, req.query || {}));
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

app.get('/api/quiz/student/chapters', ...studentOnly, asyncHandler(async (req, res) => {
  const sources = await prisma.chapterQuizSource.findMany({
    where: {
      schoolId: req.user.schoolId,
      quizStatus: 'ready',
      activeQuizId: { not: null },
    },
    orderBy: [
      { subject: 'asc' },
      { grade: 'asc' },
      { chapterNumber: 'asc' },
    ],
    include: {
      quizzes: {
        where: { status: 'ready' },
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
      status: 'ready',
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
      status: 'ready',
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
      status: 'ready',
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
}

module.exports = app;
