/**
 * Command Center derivations.
 *
 * Pure selectors over LMS payloads: the same inputs always give the same
 * dashboard. Nothing here calls a model, and nothing here reads learner state —
 * every number is a count over records the teacher already owns.
 *
 * Where a section needs something the LMS does not model (period times,
 * guardian threads) the derivation says so through `capability` rather than
 * filling the gap with a guess.
 */

import { colorFor, parseApiDate } from '../../../lib/format'
import { type ClassFacts, factsWindowLabel } from '../../shared/services/classFacts'
import type { Priority, SuggestedAction } from '../../shared/types/common'
import type {
  CalendarResponse,
  Classroom,
  Coursework,
  LmsNotification,
} from '../../shared/types/lms'
import type {
  CalendarItem,
  DeadlineGroup,
  PendingReview,
  PendingReviewSummary,
  QuickAction,
  ScheduleDueItem,
  ScheduleEntry,
  TodaySchedule,
} from '../types/dashboard'

const DAY_MS = 86_400_000

const startOfDay = (time: number): number => {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const isSameDay = (iso: string | null, reference: number): boolean => {
  const time = parseApiDate(iso)?.getTime()
  return time !== undefined && startOfDay(time) === startOfDay(reference)
}

/* ── A. Today's schedule ──────────────────────────────────────────────────── */

export function buildTodaySchedule(
  classrooms: readonly Classroom[],
  courseworkByClassroom: ReadonlyMap<string, readonly Coursework[]>,
  now: number = Date.now(),
): TodaySchedule {
  const entries: ScheduleEntry[] = classrooms.map((classroom) => {
    const coursework = courseworkByClassroom.get(classroom.id) ?? []
    const dueToday: ScheduleDueItem[] = coursework
      .filter((work) => work.status === 'published' && isSameDay(work.dueAt, now))
      .map((work) => ({
        courseworkId: work.id,
        title: work.title,
        type: work.type,
        dueAt: work.dueAt as string,
      }))
      .sort((a, b) => (parseApiDate(a.dueAt)?.getTime() ?? 0) - (parseApiDate(b.dueAt)?.getTime() ?? 0))

    const upcoming = dueToday.find((item) => (parseApiDate(item.dueAt)?.getTime() ?? 0) > now)

    return {
      classroomId: classroom.id,
      classroomName: classroom.name,
      subject: classroom.subject,
      section: classroom.section,
      color: classroom.color || colorFor(classroom.id),
      studentCount: classroom.studentCount ?? 0,
      dueToday,
      nextDueAt: upcoming?.dueAt ?? null,
    }
  })

  // Classes with work due today lead; the rest keep roster order.
  const ordered = [...entries].sort((a, b) => b.dueToday.length - a.dueToday.length)

  return {
    date: new Date(now).toISOString(),
    entries: ordered,
    totalDueToday: ordered.reduce((sum, entry) => sum + entry.dueToday.length, 0),
    missingCapabilities: ['lms.timetable', 'lms.attendance'],
  }
}

/* ── B. Pending reviews ───────────────────────────────────────────────────── */

const gradeAction = (
  classroomId: string,
  courseworkId: string | null,
  label: string,
): SuggestedAction => ({
  id: `${courseworkId ?? classroomId}:grade`,
  label,
  kind: 'grade-submissions',
  intent: 'primary',
  params: { classroomId, ...(courseworkId ? { courseworkId } : {}) },
})

export function buildPendingReviews(args: {
  readonly classrooms: readonly Classroom[]
  readonly courseworkByClassroom: ReadonlyMap<string, readonly Coursework[]>
  readonly notifications: readonly LmsNotification[]
  readonly focusedFacts: ClassFacts | null
}): PendingReviewSummary {
  const { classrooms, courseworkByClassroom, notifications, focusedFacts } = args
  const items: PendingReview[] = []
  const nameOf = new Map(classrooms.map((classroom) => [classroom.id, classroom.name]))

  // Ungraded work, split by type so "grade assignments" and "review quizzes"
  // stay the distinct jobs they are for a teacher.
  const ungraded = { assignment: 0, quiz: 0 }
  let biggestAssignment: { classroomId: string; courseworkId: string; title: string; count: number } | null = null
  let biggestQuiz: { classroomId: string; courseworkId: string; title: string; count: number } | null = null

  for (const [classroomId, coursework] of courseworkByClassroom) {
    for (const work of coursework) {
      const stats = work.submissionStats
      if (!stats || work.status !== 'published') continue
      // `turnedIn` is the LMS's status-`turned_in` bucket: submitted and not yet
      // returned to the student. `graded` is the `returned` bucket. Subtracting
      // one from the other double-counts nothing and undercounts the queue.
      const pending = stats.turnedIn
      if (pending === 0) continue

      if (work.type === 'quiz') {
        ungraded.quiz += pending
        if (!biggestQuiz || pending > biggestQuiz.count) {
          biggestQuiz = { classroomId, courseworkId: work.id, title: work.title, count: pending }
        }
      } else if (work.type === 'assignment' || work.type === 'question') {
        ungraded.assignment += pending
        if (!biggestAssignment || pending > biggestAssignment.count) {
          biggestAssignment = { classroomId, courseworkId: work.id, title: work.title, count: pending }
        }
      }
    }
  }

  if (ungraded.assignment > 0 && biggestAssignment) {
    items.push({
      id: 'pending:assignments',
      kind: 'assignment-grading',
      label: 'Assignments awaiting grading',
      detail: `Largest queue: “${biggestAssignment.title}” with ${biggestAssignment.count}.`,
      count: ungraded.assignment,
      priority: ungraded.assignment >= 20 ? 'high' : 'medium',
      classroomId: biggestAssignment.classroomId,
      classroomName: nameOf.get(biggestAssignment.classroomId) ?? null,
      courseworkId: biggestAssignment.courseworkId,
      capability: null,
      action: gradeAction(biggestAssignment.classroomId, biggestAssignment.courseworkId, 'Start grading'),
    })
  }

  if (ungraded.quiz > 0 && biggestQuiz) {
    items.push({
      id: 'pending:quizzes',
      kind: 'quiz-review',
      label: 'Quizzes awaiting review',
      detail: `Largest queue: “${biggestQuiz.title}” with ${biggestQuiz.count}.`,
      count: ungraded.quiz,
      priority: 'medium',
      classroomId: biggestQuiz.classroomId,
      classroomName: nameOf.get(biggestQuiz.classroomId) ?? null,
      courseworkId: biggestQuiz.courseworkId,
      capability: null,
      action: gradeAction(biggestQuiz.classroomId, biggestQuiz.courseworkId, 'Review quiz'),
    })
  }

  // Late submissions need per-submission turn-in times, which only the focused
  // class loads. The row states its own scope rather than implying a total.
  if (focusedFacts) {
    const late = focusedFacts.students.reduce((sum, student) => sum + student.lateCount, 0)
    if (late > 0) {
      items.push({
        id: 'pending:late',
        kind: 'late-submission',
        label: 'Late submissions',
        detail: `In ${focusedFacts.classroom.name} · ${factsWindowLabel(focusedFacts).toLowerCase()}.`,
        count: late,
        priority: 'low',
        classroomId: focusedFacts.classroom.id,
        classroomName: focusedFacts.classroom.name,
        courseworkId: null,
        capability: null,
        action: {
          id: `${focusedFacts.classroom.id}:open`,
          label: 'Open class',
          kind: 'open-classroom',
          intent: 'secondary',
          params: { classroomId: focusedFacts.classroom.id },
        },
      })
    }
  }

  // Student doubts: the LMS notifies a teacher on @mention and on a reply to
  // their comment. A plain comment on an announcement notifies nobody, so this
  // count is mentions and replies — not every question asked.
  const doubts = notifications.filter(
    (notification) => !notification.isRead && (notification.type === 'mention' || notification.type === 'reply'),
  )
  if (doubts.length > 0) {
    const first = doubts[0]
    const classroomId = typeof first?.data.classroomId === 'string' ? first.data.classroomId : null
    items.push({
      id: 'pending:doubts',
      kind: 'student-doubt',
      label: 'Student questions',
      detail: 'Unread mentions and replies from students.',
      count: doubts.length,
      priority: 'high',
      classroomId,
      classroomName: classroomId ? (nameOf.get(classroomId) ?? null) : null,
      courseworkId: null,
      capability: null,
      action: classroomId
        ? {
            id: `${classroomId}:open-timeline`,
            label: 'Open timeline',
            kind: 'open-classroom',
            intent: 'secondary',
            params: { classroomId },
          }
        : null,
    })
  }

  items.push({
    id: 'pending:guardians',
    kind: 'guardian-message',
    label: 'Parent messages',
    detail: 'Guardian threads are not modelled by the LMS yet.',
    count: 0,
    priority: 'low',
    classroomId: null,
    classroomName: null,
    courseworkId: null,
    capability: 'lms.guardian-messages',
    action: null,
  })

  const total = items
    .filter((item) => item.capability === null)
    .reduce((sum, item) => sum + item.count, 0)

  return {
    items,
    total,
    scopedNote: focusedFacts
      ? `Late submissions are counted for ${focusedFacts.classroom.name} only — per-submission times are loaded one class at a time.`
      : null,
  }
}

/* ── E. Deadlines ─────────────────────────────────────────────────────────── */

export function buildDeadlines(
  calendar: CalendarResponse | null,
  now: number = Date.now(),
): readonly DeadlineGroup[] {
  if (!calendar) return []
  const today = startOfDay(now)

  return calendar.days
    .map((day) => {
      const dayStart = startOfDay(new Date(`${day.date}T00:00:00`).getTime())
      const offset = Math.round((dayStart - today) / DAY_MS)
      const label =
        offset === 0
          ? 'Today'
          : offset === 1
            ? 'Tomorrow'
            : offset < 0
              ? `${Math.abs(offset)} days ago`
              : new Date(dayStart).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })

      const items: CalendarItem[] = day.events.map((event) => ({
        id: event.courseworkId,
        title: event.title,
        type: event.type,
        dueAt: event.dueAt,
        classroomId: event.classroomId,
        classroomName: event.classroomName ?? 'Class',
        maxPoints: event.maxPoints,
      }))

      return { date: day.date, label, items }
    })
    .filter((group) => group.items.length > 0)
}

/* ── F. Quick actions ─────────────────────────────────────────────────────── */

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'create-assignment',
    label: 'Create assignment',
    hint: 'Publish, schedule and notify',
    icon: '📝',
    kind: 'create-assignment',
    capability: null,
  },
  {
    id: 'create-quiz',
    label: 'Create quiz',
    hint: 'Same chain, quiz type',
    icon: '🧪',
    kind: 'create-quiz',
    capability: null,
  },
  {
    id: 'upload-material',
    label: 'Upload material',
    hint: 'Analyse, then generate',
    icon: '📎',
    kind: 'upload-material',
    capability: null,
  },
  {
    id: 'generate-lesson',
    label: 'AI lesson generator',
    hint: 'Needs the AI lesson endpoint',
    icon: '✨',
    kind: 'generate-lesson',
    capability: 'ai.lesson-generation',
  },
  {
    id: 'take-attendance',
    label: 'Attendance',
    hint: 'Needs an attendance register',
    icon: '✅',
    kind: 'take-attendance',
    capability: 'lms.attendance',
  },
  {
    id: 'post-announcement',
    label: 'Announcement',
    hint: 'Posts and notifies everyone',
    icon: '📣',
    kind: 'post-announcement',
    capability: null,
  },
]

/* ── Shared helpers ───────────────────────────────────────────────────────── */

export const PRIORITY_TONE: Readonly<Record<Priority, 'danger' | 'warn' | 'primary' | 'default'>> = {
  critical: 'danger',
  high: 'warn',
  medium: 'primary',
  low: 'default',
}

/** "2h 14m" / "18m" / "now". Used by the schedule countdown. */
export function countdownLabel(targetIso: string, now: number = Date.now()): string {
  const target = parseApiDate(targetIso)?.getTime()
  const remaining = target === undefined ? 0 : target - now
  if (remaining <= 0) return 'now'
  const minutes = Math.floor(remaining / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours >= 1) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}
