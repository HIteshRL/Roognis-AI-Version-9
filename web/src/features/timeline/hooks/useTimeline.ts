import { useCallback, useMemo, useState } from 'react'
import { buildInsights } from '../../ai-inbox/services/insightRules'
import { useClassFacts } from '../../shared/hooks/useClassFacts'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { useInfiniteList } from '../../shared/hooks/useInfiniteList'
import { useMutation } from '../../shared/hooks/useMutation'
import { usePreferences } from '../../shared/hooks/usePreferences'
import { type UseQueryResult, useQuery } from '../../shared/hooks/useQuery'
import { COLLECTIONS } from '../../shared/services/preferenceStore'
import {
  listAnnouncements,
  listCoursework,
  listStudentCoursework,
  setAnnouncementPinned,
} from '../../shared/services/lmsService'
import type { Announcement, Classroom, Coursework } from '../../shared/types/lms'
import {
  ANNOUNCEMENT_PAGE_LIMIT,
  buildTimeline,
  filterCounts,
  filterEvents,
  groupByMonth,
  searchEvents,
} from '../services/timelineService'
import type { TimelineEvent, TimelineFilterId, TimelineMonthGroup } from '../types/timeline'

const PAGE_SIZE = 12

export interface UseTimelineResult {
  readonly months: readonly TimelineMonthGroup[]
  readonly allEvents: readonly TimelineEvent[]
  readonly matchedCount: number
  readonly shownCount: number
  readonly hasMore: boolean
  readonly loadMore: () => void
  readonly sentinelRef: (node: HTMLElement | null) => void

  readonly filter: TimelineFilterId
  readonly setFilter: (filter: TimelineFilterId) => void
  readonly counts: Readonly<Record<TimelineFilterId, number>>
  readonly search: string
  readonly setSearch: (value: string) => void

  readonly isBookmarked: (eventId: string) => boolean
  readonly toggleBookmark: (eventId: string) => void
  readonly togglePin: (event: TimelineEvent) => Promise<void>
  readonly pinPending: boolean

  readonly announcementsQuery: UseQueryResult<readonly Announcement[]>
  readonly courseworkQuery: UseQueryResult<readonly Coursework[]>
  readonly refetch: () => void
  /** True when the LMS returned a full page and older posts may exist. */
  readonly announcementsTruncated: boolean
}

/**
 * The timeline's state, split by kind:
 *
 *   server state — announcements, coursework and class facts, each cached
 *   UI state     — filter, search box, bookmarks
 *   derived      — merge → filter → search → page → group, all pure
 *
 * The derived chain runs on every keystroke, which is only viable because none
 * of it touches the network: search is over the already-merged set.
 *
 * Insights are computed for teachers only. They are class-level teacher
 * intelligence, and §12 keeps teacher-facing analysis off student surfaces.
 */
export function useTimeline(classroom: Classroom | null, isTeacher: boolean): UseTimelineResult {
  const preferences = usePreferences()
  const [filter, setFilter] = useState<TimelineFilterId>('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)

  const announcementsQuery = useQuery<readonly Announcement[]>(
    ['lms', 'announcements', classroom?.id],
    () => {
      if (!classroom) throw new Error('No classroom')
      return listAnnouncements(classroom.id, ANNOUNCEMENT_PAGE_LIMIT)
    },
    { enabled: Boolean(classroom), staleTime: 30_000 },
  )

  // Teachers and students hit different LMS routes for the same list — the
  // teacher route 403s for a student, same as `useClassrooms`.
  const courseworkQuery = useQuery<readonly Coursework[]>(
    ['lms', 'coursework', classroom?.id, isTeacher],
    () => {
      if (!classroom) throw new Error('No classroom')
      return isTeacher ? listCoursework(classroom.id) : listStudentCoursework(classroom.id)
    },
    { enabled: Boolean(classroom), staleTime: 60_000 },
  )

  const factsQuery = useClassFacts(isTeacher ? classroom : null)

  const insights = useMemo(
    () => (isTeacher && factsQuery.data ? buildInsights(factsQuery.data) : []),
    [isTeacher, factsQuery.data],
  )

  const allEvents = useMemo(
    () =>
      classroom
        ? buildTimeline({
            classroom,
            announcements: announcementsQuery.data ?? [],
            coursework: courseworkQuery.data ?? [],
            insights,
            isTeacher,
          })
        : [],
    [classroom, announcementsQuery.data, courseworkQuery.data, insights, isTeacher],
  )

  const bookmarkedIds = useMemo(
    () => new Set(preferences.list(COLLECTIONS.bookmarkedEvents)),
    [preferences],
  )

  const counts = useMemo(() => filterCounts(allEvents, bookmarkedIds), [allEvents, bookmarkedIds])

  const matched = useMemo(
    () => searchEvents(filterEvents(allEvents, filter, bookmarkedIds), debouncedSearch),
    [allEvents, filter, bookmarkedIds, debouncedSearch],
  )

  // The reset key describes the query, not the results: changing filter or
  // search should return the user to the top, a background refetch should not.
  const paged = useInfiniteList(matched, PAGE_SIZE, `${filter}|${debouncedSearch}`)
  const months = useMemo(() => groupByMonth(paged.visible), [paged.visible])

  const pinMutation = useMutation<{ announcementId: string; pinned: boolean }, Announcement>(
    ({ announcementId, pinned }) => setAnnouncementPinned(announcementId, pinned),
    {
      optimistic: [
        {
          key: ['lms', 'announcements', classroom?.id],
          apply: (previous, input) =>
            ((previous as readonly Announcement[] | null) ?? []).map((announcement) =>
              announcement.id === input.announcementId
                ? { ...announcement, isPinned: input.pinned }
                : announcement,
            ),
        },
      ],
      invalidates: [['lms', 'announcements', classroom?.id]],
    },
  )

  const togglePin = useCallback(
    async (event: TimelineEvent): Promise<void> => {
      if (!event.announcementId) return
      await pinMutation.mutate({ announcementId: event.announcementId, pinned: !event.isPinned })
    },
    [pinMutation],
  )

  const refetch = useCallback(() => {
    void announcementsQuery.refetch()
    void courseworkQuery.refetch()
    void factsQuery.refetch()
  }, [announcementsQuery, courseworkQuery, factsQuery])

  return {
    months,
    allEvents,
    matchedCount: matched.length,
    shownCount: paged.shownCount,
    hasMore: paged.hasMore,
    loadMore: paged.loadMore,
    sentinelRef: paged.sentinelRef,
    filter,
    setFilter,
    counts,
    search,
    setSearch,
    isBookmarked: useCallback(
      (eventId: string) => preferences.has(COLLECTIONS.bookmarkedEvents, eventId),
      [preferences],
    ),
    toggleBookmark: useCallback(
      (eventId: string) => {
        preferences.toggle(COLLECTIONS.bookmarkedEvents, eventId)
      },
      [preferences],
    ),
    togglePin,
    pinPending: pinMutation.pending,
    announcementsQuery,
    courseworkQuery,
    refetch,
    announcementsTruncated: (announcementsQuery.data?.length ?? 0) >= ANNOUNCEMENT_PAGE_LIMIT,
  }
}
