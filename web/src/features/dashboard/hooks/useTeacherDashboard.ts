import { useCallback, useMemo, useState } from 'react'
import { buildInsights } from '../../ai-inbox/services/insightRules'
import type { AIInsight } from '../../ai-inbox/types/insight'
import { buildInterventionQueue } from '../../interventions/services/riskRules'
import type { InterventionQueue } from '../../interventions/types/intervention'
import { useClassFacts } from '../../shared/hooks/useClassFacts'
import { useClassrooms } from '../../shared/hooks/useClassrooms'
import { type UseQueryResult, useQuery } from '../../shared/hooks/useQuery'
import { getCalendar, listCoursework, listNotifications } from '../../shared/services/lmsService'
import type { CalendarResponse, Classroom, Coursework, LmsNotification } from '../../shared/types/lms'
import {
  buildDeadlines,
  buildPendingReviews,
  buildTodaySchedule,
} from '../services/dashboardService'
import { buildRecommendations } from '../services/recommendationService'
import type {
  DeadlineGroup,
  PendingReviewSummary,
  Recommendation,
  TodaySchedule,
} from '../types/dashboard'

const DEADLINE_HORIZON_DAYS = 21

export interface TeacherDashboard {
  readonly classrooms: readonly Classroom[]
  /** The class the deep panels (queue, recommendations) are scoped to. */
  readonly focusedClassroom: Classroom | null
  readonly setFocusedClassroomId: (id: string) => void

  readonly schedule: TodaySchedule | null
  readonly pendingReviews: PendingReviewSummary | null
  readonly deadlines: readonly DeadlineGroup[]
  readonly interventions: InterventionQueue | null
  readonly recommendations: readonly Recommendation[]
  readonly recommendationTotal: number
  readonly insights: readonly AIInsight[]

  readonly classroomsQuery: UseQueryResult<readonly Classroom[]>
  readonly courseworkQuery: UseQueryResult<ReadonlyMap<string, readonly Coursework[]>>
  readonly calendarQuery: UseQueryResult<CalendarResponse>
  readonly notificationsQuery: UseQueryResult<readonly LmsNotification[]>
  readonly factsQuery: ReturnType<typeof useClassFacts>

  readonly refetchAll: () => void
}

/**
 * Assembles the Command Center.
 *
 * Two scopes on purpose. Cheap, class-count-bounded reads (coursework lists,
 * calendar, notifications) cover *all* the teacher's classes, so counts and
 * deadlines are whole-workload figures. The expensive read — the gradebook plus
 * submission detail that the rulesets need — runs for one focused class, and
 * every panel built from it says which class it is describing. Fanning that out
 * across every class would mean dozens of requests before the dashboard paints.
 */
export function useTeacherDashboard(): TeacherDashboard {
  const classroomsQuery = useClassrooms()
  const classrooms = useMemo(() => classroomsQuery.data ?? [], [classroomsQuery.data])

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedClassroom = useMemo(
    () => classrooms.find((entry) => entry.id === focusedId) ?? classrooms[0] ?? null,
    [classrooms, focusedId],
  )

  const classroomIds = useMemo(() => classrooms.map((entry) => entry.id).join(','), [classrooms])

  const courseworkQuery = useQuery<ReadonlyMap<string, readonly Coursework[]>>(
    ['lms', 'coursework-all', classroomIds],
    async () => {
      const entries = await Promise.all(
        classrooms.map(async (classroom) => {
          try {
            return [classroom.id, await listCoursework(classroom.id)] as const
          } catch {
            // One unreadable class must not blank the whole dashboard.
            return [classroom.id, [] as readonly Coursework[]] as const
          }
        }),
      )
      return new Map(entries)
    },
    { enabled: classrooms.length > 0, staleTime: 60_000 },
  )

  const calendarQuery = useQuery<CalendarResponse>(
    ['lms', 'calendar', 'dashboard'],
    () => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start.getTime() + DEADLINE_HORIZON_DAYS * 86_400_000)
      return getCalendar({ start: start.toISOString(), end: end.toISOString() })
    },
    { staleTime: 120_000 },
  )

  const notificationsQuery = useQuery<readonly LmsNotification[]>(
    ['lms', 'notifications', 'dashboard'],
    async () => (await listNotifications(50)).notifications,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const factsQuery = useClassFacts(focusedClassroom)

  const schedule = useMemo(
    () =>
      classrooms.length && courseworkQuery.data
        ? buildTodaySchedule(classrooms, courseworkQuery.data)
        : null,
    [classrooms, courseworkQuery.data],
  )

  const pendingReviews = useMemo(
    () =>
      courseworkQuery.data
        ? buildPendingReviews({
            classrooms,
            courseworkByClassroom: courseworkQuery.data,
            notifications: notificationsQuery.data ?? [],
            focusedFacts: factsQuery.data,
          })
        : null,
    [classrooms, courseworkQuery.data, notificationsQuery.data, factsQuery.data],
  )

  const deadlines = useMemo(() => buildDeadlines(calendarQuery.data), [calendarQuery.data])

  const interventions = useMemo(
    () => (factsQuery.data ? buildInterventionQueue(factsQuery.data) : null),
    [factsQuery.data],
  )

  const insights = useMemo(
    () => (factsQuery.data ? buildInsights(factsQuery.data) : []),
    [factsQuery.data],
  )

  const recommendations = useMemo(() => buildRecommendations(insights), [insights])

  const refetchAll = useCallback(() => {
    void classroomsQuery.refetch()
    void courseworkQuery.refetch()
    void calendarQuery.refetch()
    void notificationsQuery.refetch()
    void factsQuery.refetch()
  }, [classroomsQuery, courseworkQuery, calendarQuery, notificationsQuery, factsQuery])

  return {
    classrooms,
    focusedClassroom,
    setFocusedClassroomId: setFocusedId,
    schedule,
    pendingReviews,
    deadlines,
    interventions,
    recommendations: recommendations.items,
    recommendationTotal: recommendations.total,
    insights,
    classroomsQuery,
    courseworkQuery,
    calendarQuery,
    notificationsQuery,
    factsQuery,
    refetchAll,
  }
}
