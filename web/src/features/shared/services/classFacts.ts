/**
 * Class facts — the single input to every deterministic ruleset.
 *
 * `buildClassFacts` is pure: LMS payloads in, per-student and per-task facts
 * out. It performs no I/O and no scoring, so it can be tested exhaustively and
 * lifted into `services/decisions` unchanged when Layer 3 is built. `loadClassSnapshot`
 * is the thin I/O shell around it.
 *
 * Provenance of the inputs matters as much as the arithmetic:
 *
 *   - grades come from the teacher's own gradebook (`GET .../gradebook`)
 *   - completion counts come from `submissionStats` on the coursework list
 *   - lateness and last-activity come from `GET /coursework/{id}/submissions`
 *
 * All three are LMS records the teacher can already open. None is PSV, so none
 * of this is gated by Layer 5 — see `privacyGuard.ts` for the boundary that is.
 *
 * Submission detail is fetched for the most recent `RECENT_COURSEWORK_LIMIT`
 * published tasks rather than the whole history. The bound is surfaced in the
 * UI (`factsWindowLabel`) so a teacher is never shown a partial picture that
 * looks complete.
 */

import { parseApiDate } from '../../../lib/format'
import type { StudentRef } from '../types/common'
import type { Classroom, Coursework, Gradebook, GradebookCell, Submission } from '../types/lms'
import {
  getGradebook,
  listClassroomStudents,
  listCoursework,
  listSubmissions,
} from './lmsService'

export const RECENT_COURSEWORK_LIMIT = 10

/** Coursework types that carry a grade. `material` is excluded everywhere. */
const GRADEABLE: ReadonlySet<string> = new Set(['assignment', 'quiz', 'question'])

export const isGradeable = (work: Coursework): boolean => GRADEABLE.has(work.type)

export const isPublished = (work: Coursework): boolean => work.status === 'published'

/** Raw LMS payloads for one classroom, before any derivation. */
export interface ClassSnapshot {
  readonly classroom: Classroom
  readonly students: readonly StudentRef[]
  readonly coursework: readonly Coursework[]
  readonly submissionsByCoursework: ReadonlyMap<string, readonly Submission[]>
  readonly gradebook: Gradebook | null
  /** Coursework ids whose submissions were actually fetched (the window). */
  readonly detailedCourseworkIds: readonly string[]
}

/** What one student did, derived only from the snapshot. */
export interface StudentFacts {
  readonly student: StudentRef
  readonly assignedCount: number
  readonly submittedCount: number
  readonly missingCount: number
  readonly lateCount: number
  readonly gradedCount: number
  /** 0-100, or null when nothing is graded yet. */
  readonly averagePercent: number | null
  /** Average over the most recent third of graded tasks. */
  readonly recentAveragePercent: number | null
  /** Average over everything before that window. */
  readonly earlierAveragePercent: number | null
  readonly lastActivityAt: string | null
  readonly daysSinceActivity: number | null
  /** Per-task detail, newest first — the citable evidence. */
  readonly tasks: readonly StudentTaskFact[]
}

export interface StudentTaskFact {
  readonly courseworkId: string
  readonly title: string
  readonly type: string
  readonly dueAt: string | null
  readonly maxPoints: number | null
  readonly grade: number | null
  readonly percent: number | null
  readonly turnedInAt: string | null
  readonly isLate: boolean
  readonly isMissing: boolean
}

/**
 * What the class did on one task.
 *
 * A note on the LMS submission buckets, because the naming is a trap:
 * `submission_stats` reports `turnedIn` as the count with status `turned_in`
 * and `graded` as the count with status `returned` — and grading only moves a
 * submission to `returned` when the teacher chooses to return it
 * (`coursework.py::grade_submission`). So `turnedIn` is "submitted, not yet
 * back with the student", *not* "submitted". Reading it as the latter makes a
 * fully graded task look like nobody handed it in.
 */
export interface TaskFacts {
  readonly coursework: Coursework
  readonly assignedCount: number
  /** Everyone who submitted at all: `turnedIn` + `returned`. */
  readonly submittedCount: number
  /** Submitted and already returned to the student. */
  readonly returnedCount: number
  readonly gradedCount: number
  readonly completionRate: number | null
  readonly averagePercent: number | null
  readonly isPastDue: boolean
  /** Submitted but not yet back with the student. */
  readonly awaitingFeedbackCount: number
  /** Days since the due date passed; null when not yet due or undated. */
  readonly daysPastDue: number | null
}

export interface ClassFacts {
  readonly classroom: Classroom
  readonly students: readonly StudentFacts[]
  readonly tasks: readonly TaskFacts[]
  readonly studentCount: number
  readonly classAveragePercent: number | null
  /** How many published gradeable tasks the window actually covers. */
  readonly windowSize: number
  readonly totalGradeableCount: number
  readonly generatedAt: string
}

const DAY_MS = 86_400_000

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10

const percentOf = (grade: number | null, maxPoints: number | null): number | null => {
  if (grade === null || maxPoints === null || maxPoints <= 0) return null
  return Math.round((grade / maxPoints) * 1000) / 10
}

/**
 * Split graded percentages into a recent window and everything before it, so a
 * trend can be stated without a model. The recent window is the last third,
 * minimum two tasks — below four graded tasks there is no trend to claim and
 * both halves come back null.
 */
function splitTrend(percentsNewestFirst: readonly number[]): {
  recent: number | null
  earlier: number | null
} {
  if (percentsNewestFirst.length < 4) return { recent: null, earlier: null }
  const windowSize = Math.max(2, Math.floor(percentsNewestFirst.length / 3))
  return {
    recent: mean(percentsNewestFirst.slice(0, windowSize)),
    earlier: mean(percentsNewestFirst.slice(windowSize)),
  }
}

/* ── Pure derivation ──────────────────────────────────────────────────────── */

export function buildClassFacts(snapshot: ClassSnapshot, now: number = Date.now()): ClassFacts {
  const publishedGradeable = snapshot.coursework
    .filter((work) => isPublished(work) && isGradeable(work))
    .sort((a, b) => sortKey(b) - sortKey(a))

  const detailed = new Set(snapshot.detailedCourseworkIds)

  // courseworkId → studentId → submission
  const submissionIndex = new Map<string, Map<string, Submission>>()
  for (const [courseworkId, submissions] of snapshot.submissionsByCoursework) {
    const byStudent = new Map<string, Submission>()
    for (const submission of submissions) byStudent.set(submission.studentId, submission)
    submissionIndex.set(courseworkId, byStudent)
  }

  // studentId → courseworkId → gradebook cell. The gradebook is the only grade
  // source for the lite loader, and a second source for the full one.
  const cellIndex = new Map<string, Readonly<Record<string, GradebookCell | undefined>>>()
  for (const row of snapshot.gradebook?.rows ?? []) cellIndex.set(row.studentId, row.cells ?? {})

  const students: StudentFacts[] = snapshot.students.map((student) => {
    const cells = cellIndex.get(student.studentId) ?? {}
    const tasks: StudentTaskFact[] = publishedGradeable.map((work) => {
      const submission = submissionIndex.get(work.id)?.get(student.studentId) ?? null
      const cell = cells[work.id]
      const grade = submission?.grade ?? cell?.score ?? null
      const turnedInAt = submission?.turnedInAt ?? null
      const dueTime = parseApiDate(work.dueAt)?.getTime() ?? null
      const pastDue = dueTime !== null && dueTime < now

      // "Missing" needs positive evidence that nothing was submitted. The
      // gradebook states it outright with status `missing` on every task, so it
      // is the authority whenever a cell exists. Otherwise the fetched
      // submission window can attest to it. With neither, absence of a record
      // is absence of evidence, not evidence of absence, and nothing is claimed.
      const isMissing =
        pastDue &&
        turnedInAt === null &&
        (cell !== undefined ? cell.status === 'missing' : detailed.has(work.id) && grade === null)
      const isLate =
        turnedInAt !== null && dueTime !== null && (parseApiDate(turnedInAt)?.getTime() ?? 0) > dueTime

      return {
        courseworkId: work.id,
        title: work.title,
        type: work.type,
        dueAt: work.dueAt,
        maxPoints: work.maxPoints,
        grade,
        percent: percentOf(grade, work.maxPoints),
        turnedInAt,
        isLate,
        isMissing,
      }
    })

    const gradedPercents = tasks
      .map((task) => task.percent)
      .filter((percent): percent is number => percent !== null)
    const { recent, earlier } = splitTrend(gradedPercents)

    const activityTimes = tasks
      .map((task) => task.turnedInAt)
      .filter((iso): iso is string => iso !== null)
      .map((iso) => parseApiDate(iso)?.getTime() ?? Number.NaN)
      .filter((time) => !Number.isNaN(time))
    const lastActivity = activityTimes.length ? Math.max(...activityTimes) : null

    return {
      student,
      assignedCount: tasks.length,
      submittedCount: tasks.filter((task) => task.turnedInAt !== null).length,
      missingCount: tasks.filter((task) => task.isMissing).length,
      lateCount: tasks.filter((task) => task.isLate).length,
      gradedCount: gradedPercents.length,
      averagePercent: mean(gradedPercents),
      recentAveragePercent: recent,
      earlierAveragePercent: earlier,
      lastActivityAt: lastActivity === null ? null : new Date(lastActivity).toISOString(),
      daysSinceActivity:
        lastActivity === null ? null : Math.floor((now - lastActivity) / DAY_MS),
      tasks,
    }
  })

  const studentCount = snapshot.students.length

  const tasks: TaskFacts[] = publishedGradeable.map((work) => {
    const stats = work.submissionStats
    const submissions = snapshot.submissionsByCoursework.get(work.id) ?? []

    // `submission_stats.total` sums the three submission statuses, so it counts
    // rows that exist — a student who never opened the task has no row and is
    // invisible to it. The roster is the real denominator for "how much of the
    // class did this", so take the larger. Without this, completion rate can
    // never fall below 100% and no missing-work rule can ever fire.
    const assigned = Math.max(stats?.total ?? 0, studentCount, submissions.length)

    // `stats.turnedIn` = status `turned_in`; `stats.graded` = status `returned`.
    // Submitted-at-all is their sum; awaiting feedback is the former alone.
    const awaitingFeedback =
      stats?.turnedIn ??
      submissions.filter((entry) => entry.turnedInAt !== null && entry.status !== 'returned').length
    const returned =
      stats?.graded ?? submissions.filter((entry) => entry.status === 'returned').length
    const submitted = awaitingFeedback + returned

    const percents = students
      .map((facts) => facts.tasks.find((task) => task.courseworkId === work.id)?.percent ?? null)
      .filter((percent): percent is number => percent !== null)

    const dueTime = parseApiDate(work.dueAt)?.getTime() ?? null
    const isPastDue = dueTime !== null && dueTime < now

    return {
      coursework: work,
      assignedCount: assigned,
      submittedCount: submitted,
      returnedCount: returned,
      // How many scores actually exist, which is what an average rests on.
      gradedCount: percents.length,
      completionRate: assigned > 0 ? Math.round((submitted / assigned) * 1000) / 10 : null,
      averagePercent: mean(percents),
      isPastDue,
      awaitingFeedbackCount: awaitingFeedback,
      daysPastDue: isPastDue && dueTime !== null ? Math.floor((now - dueTime) / DAY_MS) : null,
    }
  })

  const studentAverages = students
    .map((facts) => facts.averagePercent)
    .filter((average): average is number => average !== null)

  return {
    classroom: snapshot.classroom,
    students,
    tasks,
    studentCount,
    classAveragePercent: snapshot.gradebook?.classAveragePercent ?? mean(studentAverages),
    windowSize: snapshot.detailedCourseworkIds.length,
    totalGradeableCount: publishedGradeable.length,
    generatedAt: new Date(now).toISOString(),
  }
}

/** Newest-first ordering key: due date, else publication, else creation. */
function sortKey(work: Coursework): number {
  const iso = work.dueAt ?? work.publishedAt ?? work.createdAt
  return parseApiDate(iso)?.getTime() ?? 0
}

/** Human statement of the evidence window, shown wherever facts are rendered. */
export function factsWindowLabel(facts: ClassFacts): string {
  if (facts.totalGradeableCount === 0) return 'No published graded work yet'
  const covered = Math.min(facts.windowSize, facts.totalGradeableCount)
  // A zero window means the lite loader ran: class-level figures are complete,
  // per-student detail was never fetched. Saying "0 of N tasks" would read as
  // "no evidence", which is the opposite of true.
  if (covered === 0) {
    return `Class-level figures across ${facts.totalGradeableCount} published tasks`
  }
  return covered >= facts.totalGradeableCount
    ? `All ${facts.totalGradeableCount} published tasks`
    : `Most recent ${covered} of ${facts.totalGradeableCount} published tasks`
}

/* ── I/O shell ────────────────────────────────────────────────────────────── */

/**
 * Requests issued at once when fanning out over the coursework window.
 *
 * A dashboard that opens a dozen sockets the instant it mounts is hostile to
 * whatever is on the other end — and the snapshot is the heaviest read in the
 * product. Four keeps it prompt without stampeding the LMS.
 */
const FETCH_CONCURRENCY = 4

/** Map with a bounded number of in-flight calls, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      if (item === undefined) continue
      results[index] = await worker(item)
    }
  })

  await Promise.all(runners)
  return results
}

export async function loadClassSnapshot(classroom: Classroom): Promise<ClassSnapshot> {
  const [rosterResult, coursework, gradebook] = await Promise.all([
    // The roster is enrichment, not a dependency: the gradebook already names
    // every enrolled student, so a failure here costs nothing but is not
    // allowed to blank the whole panel.
    listClassroomStudents(classroom.id).catch(() => null),
    listCoursework(classroom.id),
    // A class with no gradeable work has no gradebook columns; a failure here
    // must not take down the whole snapshot either.
    getGradebook(classroom.id).catch(() => null),
  ])

  const window = coursework
    .filter((work) => isPublished(work) && isGradeable(work))
    .sort((a, b) => sortKey(b) - sortKey(a))
    .slice(0, RECENT_COURSEWORK_LIMIT)

  const submissionLists = await mapWithConcurrency(window, FETCH_CONCURRENCY, async (work) => {
    try {
      return [work.id, await listSubmissions(work.id)] as const
    } catch {
      // A task whose submissions could not be read drops out of the evidence
      // window rather than being reported as "nobody submitted".
      return [work.id, [] as readonly Submission[]] as const
    }
  })

  const roster: readonly StudentRef[] = rosterResult
    ? rosterResult.map((student) => ({
        studentId: student.studentId,
        name: student.studentName ?? 'Student',
        classroomId: classroom.id,
        classroomName: classroom.name,
      }))
    : (gradebook?.rows ?? []).map((row) => ({
        studentId: row.studentId,
        name: row.studentName ?? 'Student',
        classroomId: classroom.id,
        classroomName: classroom.name,
      }))

  const readable = new Set(
    submissionLists.filter(([, list]) => list.length > 0).map(([id]) => id),
  )

  return {
    classroom,
    students: roster,
    coursework,
    submissionsByCoursework: new Map(submissionLists),
    gradebook,
    // Only tasks whose submissions actually came back count as attested. A
    // failed read must not be mistaken for "nothing was submitted".
    detailedCourseworkIds: window.filter((work) => readable.has(work.id)).map((work) => work.id),
  }
}

export async function loadClassFacts(classroom: Classroom): Promise<ClassFacts> {
  return buildClassFacts(await loadClassSnapshot(classroom))
}

/**
 * Two requests per class instead of twelve: roster and per-submission detail
 * are skipped, and everything is derived from the gradebook plus the
 * `submissionStats` already carried on the coursework list.
 *
 * What this costs precisely: class-level facts (task averages, completion
 * rates, grading backlog, trends) are identical to the full loader, because
 * they come from the same two sources. Per-student facts are unavailable, so
 * `students` is empty — no missing/late counts, and no named students on an
 * insight. The AI Inbox uses this across every class; the intervention queue,
 * which is inherently per-student, always uses the full loader on one class.
 */
export async function loadClassFactsLite(classroom: Classroom): Promise<ClassFacts> {
  const [coursework, gradebook] = await Promise.all([
    listCoursework(classroom.id),
    getGradebook(classroom.id).catch(() => null),
  ])

  const students: StudentRef[] = (gradebook?.rows ?? []).map((row) => ({
    studentId: row.studentId,
    name: row.studentName ?? 'Student',
    classroomId: classroom.id,
    classroomName: classroom.name,
  }))

  return buildClassFacts({
    classroom,
    students,
    coursework,
    submissionsByCoursework: new Map(),
    gradebook,
    // Empty window: without submission records, "past due and not submitted"
    // is not assertable, so no student is marked missing.
    detailedCourseworkIds: [],
  })
}
