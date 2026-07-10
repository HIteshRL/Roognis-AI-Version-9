const RECENT_EVENT_LIMIT = 50;

const SENSITIVE_METADATA_KEYS = new Set([
  'prompt',
  'message',
  'content',
  'comment',
  'userMessage',
  'assistantMessage',
]);

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function uniqueIds(ids) {
  return [...new Set(ids.filter(Boolean))];
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};

  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key)) continue;
    safe[key] = value;
  }
  return safe;
}

function sanitizeEvent(event) {
  return {
    id: event.id,
    type: event.type,
    studentId: event.studentId,
    schoolId: event.schoolId,
    subject: event.subject,
    sessionId: event.sessionId,
    metadata: sanitizeMetadata(event.metadata),
    createdAt: event.createdAt,
  };
}

function buildAttendanceSummary(records) {
  const byStatus = countBy(records, r => r.status);
  return {
    totalRecords: records.length,
    byStatus,
    recent: records.slice(0, 10).map(r => ({
      id: r.id,
      date: r.date,
      status: r.status,
    })),
  };
}

function buildScoreSummary(records) {
  if (records.length === 0) {
    return { totalRecords: 0, averagePercent: null, bySubject: {}, recent: [] };
  }

  const percents = records.map(r => {
    const score = Number(r.score);
    const maxScore = Number(r.maxScore) || 100;
    return maxScore > 0 ? (score / maxScore) * 100 : 0;
  });

  const averagePercent = percents.reduce((sum, p) => sum + p, 0) / percents.length;
  const bySubject = {};

  for (const record of records) {
    if (!bySubject[record.subject]) bySubject[record.subject] = { count: 0, averagePercent: 0, totalPercent: 0 };
    const score = Number(record.score);
    const maxScore = Number(record.maxScore) || 100;
    const percent = maxScore > 0 ? (score / maxScore) * 100 : 0;
    bySubject[record.subject].count += 1;
    bySubject[record.subject].totalPercent += percent;
  }

  for (const subject of Object.keys(bySubject)) {
    const entry = bySubject[subject];
    entry.averagePercent = entry.totalPercent / entry.count;
    delete entry.totalPercent;
  }

  return {
    totalRecords: records.length,
    averagePercent,
    bySubject,
    recent: records.slice(0, 10).map(r => ({
      id: r.id,
      subject: r.subject,
      testName: r.testName,
      score: Number(r.score),
      maxScore: Number(r.maxScore),
      testDate: r.testDate,
    })),
  };
}

function buildUsageSummary(events) {
  const sessionIds = uniqueIds(events.filter(e => e.type === 'chat_message' && e.sessionId).map(e => e.sessionId));

  return {
    totalEvents: events.length,
    byType: countBy(events, e => e.type),
    chatSessions: sessionIds.length,
    activeStudents: uniqueIds(events.map(e => e.studentId)).length,
  };
}

function buildSubjectTrends(events) {
  const bySubject = {};

  for (const event of events) {
    if (!event.subject) continue;
    if (!bySubject[event.subject]) {
      bySubject[event.subject] = {
        subject: event.subject,
        eventCount: 0,
        sessionIds: new Set(),
        ratings: [],
      };
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

module.exports = {
  RECENT_EVENT_LIMIT,
  daysAgo,
  uniqueIds,
  sanitizeEvent,
  buildAttendanceSummary,
  buildScoreSummary,
  buildUsageSummary,
  buildSubjectTrends,
};
