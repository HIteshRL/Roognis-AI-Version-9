const express = require('express');
const { PrismaClient } = require('@prisma/client');

const requireAuth = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const teacherOnly = [requireAuth, requireAuth.requireRole('teacher')];
const parentOnly  = [requireAuth, requireAuth.requireRole('parent')];

// POST /api/analytics/event — fire-and-forget ingestion from internal services (no JWT)
router.post('/event', async (req, res) => {
  try {
    const { type, studentId, schoolId, subject, sessionId, metadata } = req.body || {};

    if (!type || typeof type !== 'string' || !type.trim())
      return res.status(400).json({ error: 'type is required.' });

    if (!schoolId)
      return res.status(400).json({ error: 'schoolId is required.' });

    await prisma.event.create({
      data: {
        type: type.trim(),
        studentId: studentId || null,
        schoolId,
        subject: typeof subject === 'string' ? subject.trim() || null : null,
        sessionId: sessionId || null,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
      },
    });

    return res.status(202).json({ received: true });
  } catch (err) {
    console.error('[analytics] event error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/analytics/attendance — mark attendance (teacher only)
router.post('/attendance', ...teacherOnly, async (req, res) => {
  try {
    const { studentId, date, status } = req.body || {};

    if (!studentId)
      return res.status(400).json({ error: 'studentId is required.' });
    if (!date)
      return res.status(400).json({ error: 'date is required.' });
    if (!status || typeof status !== 'string' || !status.trim())
      return res.status(400).json({ error: 'status is required.' });

    const attendanceDate = new Date(date);
    if (Number.isNaN(attendanceDate.getTime()))
      return res.status(400).json({ error: 'date must be a valid date.' });

    const record = await prisma.attendance.upsert({
      where: {
        studentId_date: {
          studentId,
          date: attendanceDate,
        },
      },
      create: {
        studentId,
        schoolId: req.user.schoolId,
        teacherId: req.user.userId,
        date: attendanceDate,
        status: status.trim(),
      },
      update: {
        status: status.trim(),
        teacherId: req.user.userId,
      },
      select: { id: true },
    });

    return res.status(201).json({ attendanceId: record.id });
  } catch (err) {
    console.error('[analytics] attendance error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/analytics/score — enter test score (teacher only)
router.post('/score', ...teacherOnly, async (req, res) => {
  try {
    const { studentId, subject, testName, score, maxScore, testDate } = req.body || {};

    if (!studentId)
      return res.status(400).json({ error: 'studentId is required.' });
    if (!subject || typeof subject !== 'string' || !subject.trim())
      return res.status(400).json({ error: 'subject is required.' });
    if (!testName || typeof testName !== 'string' || !testName.trim())
      return res.status(400).json({ error: 'testName is required.' });
    if (score === undefined || score === null || Number.isNaN(Number(score)))
      return res.status(400).json({ error: 'score is required.' });
    if (!testDate)
      return res.status(400).json({ error: 'testDate is required.' });

    const parsedTestDate = new Date(testDate);
    if (Number.isNaN(parsedTestDate.getTime()))
      return res.status(400).json({ error: 'testDate must be a valid date.' });

    if (maxScore !== undefined && maxScore !== null && Number.isNaN(Number(maxScore)))
      return res.status(400).json({ error: 'maxScore must be a number.' });

    const record = await prisma.score.create({
      data: {
        studentId,
        schoolId: req.user.schoolId,
        teacherId: req.user.userId,
        subject: subject.trim(),
        testName: testName.trim(),
        score,
        maxScore: maxScore ?? 100,
        testDate: parsedTestDate,
      },
      select: { id: true },
    });

    return res.status(201).json({ scoreId: record.id });
  } catch (err) {
    console.error('[analytics] score error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/teacher/dashboard
router.get('/teacher/dashboard', ...teacherOnly, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const since7d = daysAgo(7);

    const [attendance, scores, events] = await Promise.all([
      prisma.attendance.findMany({
        where: { schoolId },
        orderBy: { date: 'desc' },
      }),
      prisma.score.findMany({
        where: { schoolId },
        orderBy: { testDate: 'desc' },
      }),
      prisma.event.findMany({
        where: { schoolId, createdAt: { gte: since7d } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const studentIds = uniqueIds([
      ...attendance.map(r => r.studentId),
      ...scores.map(r => r.studentId),
      ...events.map(r => r.studentId).filter(Boolean),
    ]);

    return res.status(200).json({
      schoolId,
      studentCount: studentIds.length,
      attendance,
      scores,
      recentEvents: events,
    });
  } catch (err) {
    console.error('[analytics] teacher dashboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/teacher/interventions
router.get('/teacher/interventions', ...teacherOnly, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const since7d = daysAgo(7);

    const events = await prisma.event.findMany({
      where: {
        schoolId,
        createdAt: { gte: since7d },
        studentId: { not: null },
      },
      select: {
        studentId: true,
        type: true,
        sessionId: true,
        metadata: true,
      },
    });

    const byStudent = groupByStudent(events);
    const interventions = [];

    for (const [studentId, studentEvents] of Object.entries(byStudent)) {
      const flags = evaluateIntervention(studentEvents);
      if (flags.length > 0) {
        interventions.push({ studentId, flags });
      }
    }

    return res.status(200).json({ schoolId, periodDays: 7, interventions });
  } catch (err) {
    console.error('[analytics] interventions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/parent/dashboard?studentId=xxx
router.get('/parent/dashboard', ...parentOnly, async (req, res) => {
  try {
    const { studentId } = req.query;

    if (!studentId)
      return res.status(400).json({ error: 'studentId is required.' });

    if (!req.user.studentIds?.includes(studentId))
      return res.status(403).json({ error: 'Forbidden.' });

    const since7d = daysAgo(7);

    const [attendance, scores, events] = await Promise.all([
      prisma.attendance.findMany({
        where: { studentId },
        orderBy: { date: 'desc' },
      }),
      prisma.score.findMany({
        where: { studentId },
        orderBy: { testDate: 'desc' },
      }),
      prisma.event.findMany({
        where: { studentId, createdAt: { gte: since7d } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.status(200).json({ studentId, attendance, scores, recentEvents: events });
  } catch (err) {
    console.error('[analytics] parent dashboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/queries/trends
router.get('/queries/trends', ...teacherOnly, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const since30d = daysAgo(30);

    const events = await prisma.event.findMany({
      where: { schoolId, createdAt: { gte: since30d } },
      select: {
        type: true,
        subject: true,
        studentId: true,
        sessionId: true,
        metadata: true,
      },
    });

    const usageStats = {
      totalEvents: events.length,
      byType: countBy(events, e => e.type),
      activeStudents: uniqueIds(events.map(e => e.studentId).filter(Boolean)).length,
    };

    const subjectTrends = buildSubjectTrends(events);

    return res.status(200).json({
      schoolId,
      periodDays: 30,
      usageStats,
      subjectTrends,
    });
  } catch (err) {
    console.error('[analytics] queries/trends error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function uniqueIds(ids) {
  return [...new Set(ids)];
}

function groupByStudent(events) {
  return events.reduce((acc, event) => {
    if (!event.studentId) return acc;
    if (!acc[event.studentId]) acc[event.studentId] = [];
    acc[event.studentId].push(event);
    return acc;
  }, {});
}

function evaluateIntervention(studentEvents) {
  const flags = [];

  const feedbackEvents = studentEvents.filter(e => e.type === 'feedback_submitted');
  const ratings = feedbackEvents
    .map(e => Number(e.metadata?.rating))
    .filter(r => Number.isFinite(r));

  if (ratings.length > 0) {
    const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
    if (avg < 3.0) flags.push('low_feedback_rating');
  }

  const sessionIds = uniqueIds(
    studentEvents
      .filter(e => e.type === 'chat_message' && e.sessionId)
      .map(e => e.sessionId)
  );

  if (sessionIds.length < 3) flags.push('low_session_count');

  return flags;
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildSubjectTrends(events) {
  const bySubject = {};

  for (const event of events) {
    if (!event.subject) continue;
    if (!bySubject[event.subject]) {
      bySubject[event.subject] = { subject: event.subject, eventCount: 0, sessionIds: new Set(), ratings: [] };
    }
    const entry = bySubject[event.subject];
    entry.eventCount += 1;
    if (event.sessionId) entry.sessionIds.add(event.sessionId);
    if (event.type === 'feedback_submitted' && Number.isFinite(Number(event.metadata?.rating))) {
      entry.ratings.push(Number(event.metadata.rating));
    }
  }

  return Object.values(bySubject).map(entry => ({
    subject: entry.subject,
    eventCount: entry.eventCount,
    sessionCount: entry.sessionIds.size,
    avgRating: entry.ratings.length > 0
      ? entry.ratings.reduce((sum, r) => sum + r, 0) / entry.ratings.length
      : null,
  }));
}

module.exports = router;
