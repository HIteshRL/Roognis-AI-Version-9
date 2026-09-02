/**
 * The LMS wire contract, transcribed from the service's own serializers so the
 * frontend and `services/lms` cannot drift silently:
 *
 *   classrooms.py  → serialize_classroom / serialize_student_classroom
 *   coursework.py  → serialize_coursework / serialize_submission / submission_stats
 *   stream.py      → serialize_announcement
 *   discussions.py → comments and reactions
 *   notifications.py → serialize_notification
 *   calendar_view.py → GET /api/lms/calendar
 *
 * Optional fields are optional because the serializer omits them for some
 * roles, not because they are unreliable.
 */

export type CourseworkType = 'assignment' | 'quiz' | 'material' | 'question'
export type CourseworkStatus = 'draft' | 'published' | 'scheduled'
export type SubmissionStatus = 'assigned' | 'turned_in' | 'returned'
export type AnnouncementStatus = 'draft' | 'published' | 'scheduled'

export interface Classroom {
  readonly id: string
  readonly schoolId?: string
  readonly teacherId?: string
  readonly name: string
  readonly subject: string | null
  readonly section: string | null
  readonly room?: string | null
  readonly grade: string | null
  readonly description?: string | null
  readonly color: string | null
  readonly joinCode?: string | null
  readonly joinCodeEnabled?: boolean
  readonly isArchived?: boolean
  readonly settings?: Readonly<Record<string, unknown>>
  readonly studentCount?: number
  readonly chapterCount?: number
  readonly createdAt?: string | null
  readonly updatedAt?: string | null
}

export interface SubmissionStats {
  readonly total: number
  readonly turnedIn: number
  readonly graded: number
}

export interface CourseworkAttachments {
  readonly links?: readonly { readonly url: string; readonly title?: string }[]
  readonly files?: readonly { readonly name: string; readonly url?: string }[]
  readonly [key: string]: unknown
}

export interface Coursework {
  readonly id: string
  readonly classroomId: string
  readonly chapterId: string | null
  readonly schoolId?: string
  readonly teacherId?: string
  readonly type: CourseworkType
  readonly title: string
  readonly description: string | null
  readonly topic: string | null
  readonly topicId: string | null
  readonly maxPoints: number | null
  readonly dueAt: string | null
  readonly status: CourseworkStatus
  readonly publishedAt: string | null
  readonly attachments: CourseworkAttachments
  readonly createdAt: string | null
  readonly updatedAt: string | null
  /** Teacher listings only. */
  readonly submissionStats?: SubmissionStats
  /** Student listings only; explicitly null before the student submits. */
  readonly mySubmission?: Submission | null
}

export interface Submission {
  readonly id: string
  readonly courseworkId: string
  readonly studentId: string
  readonly studentName: string | null
  readonly status: SubmissionStatus
  readonly content: Readonly<Record<string, unknown>>
  readonly grade: number | null
  readonly feedback: string | null
  readonly turnedInAt: string | null
  readonly gradedAt: string | null
  readonly createdAt: string | null
  readonly updatedAt: string | null
}

export interface AnnouncementAttachment {
  readonly url?: string
  readonly title?: string
  readonly type?: string
  readonly [key: string]: unknown
}

export interface Announcement {
  readonly id: string
  readonly classroomId: string
  readonly authorId: string
  readonly authorName: string
  readonly title: string | null
  readonly body: string
  readonly attachments: readonly AnnouncementAttachment[]
  readonly status: AnnouncementStatus
  readonly scheduledFor: string | null
  readonly isPinned: boolean
  readonly publishedAt: string | null
  readonly commentCount: number
  readonly createdAt: string | null
  readonly updatedAt: string | null
}

export interface Comment {
  readonly id: string
  readonly classroomId: string
  readonly announcementId: string | null
  readonly courseworkId: string | null
  readonly authorId: string
  readonly authorName: string | null
  readonly body: string
  readonly createdAt: string | null
  readonly reactions?: Readonly<Record<string, number>>
}

export interface StudentMembership {
  readonly studentId: string
  readonly studentName: string | null
  readonly email?: string | null
  readonly status?: string
}

export interface LmsNotification {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly body: string
  readonly data: Readonly<Record<string, unknown>>
  readonly isRead: boolean
  readonly createdAt: string | null
}

export interface CalendarEventDto {
  readonly courseworkId: string
  readonly classroomId: string
  readonly classroomName: string | null
  readonly title: string
  readonly type: CourseworkType
  readonly dueAt: string
  readonly maxPoints: number | null
}

export interface CalendarDay {
  readonly date: string
  readonly events: readonly CalendarEventDto[]
}

export interface CalendarResponse {
  readonly start: string
  readonly end: string
  readonly days: readonly CalendarDay[]
  readonly total: number
}

export interface GradebookColumn {
  readonly courseworkId: string
  readonly title: string
  readonly type: CourseworkType
  readonly maxPoints: number | null
  readonly dueAt: string | null
}

/**
 * One cell of the gradebook.
 *
 * `gradebook.py` emits a cell for *every* student × published-gradeable task,
 * using the synthetic status `"missing"` where no submission row exists. That
 * makes the gradebook a complete, positive record of non-submission across the
 * whole class — which is why it, and not the sampled submission window, is the
 * authority on what is missing.
 *
 * `score` stays null until the work is graded; `returned` distinguishes
 * "graded" from "graded and handed back".
 */
export interface GradebookCell {
  readonly status: SubmissionStatus | 'missing'
  readonly score: number | null
  readonly returned: boolean
}

export interface GradebookRow {
  readonly studentId: string
  readonly studentName: string | null
  /** Keyed by coursework id. Absent key = no submission record at all. */
  readonly cells: Readonly<Record<string, GradebookCell | undefined>>
  readonly averagePercent: number | null
}

export interface Gradebook {
  readonly classroomId: string
  readonly columns: readonly GradebookColumn[]
  readonly rows: readonly GradebookRow[]
  readonly classAveragePercent: number | null
  readonly studentCount: number
}

/* ── Envelope shapes ──────────────────────────────────────────────────────── */

export interface ClassroomsResponse {
  readonly classrooms: readonly Classroom[]
}
export interface CourseworkResponse {
  readonly coursework: readonly Coursework[]
}
export interface SubmissionsResponse {
  readonly submissions: readonly Submission[]
}
export interface AnnouncementsResponse {
  readonly announcements: readonly Announcement[]
}
export interface CommentsResponse {
  readonly comments: readonly Comment[]
}
export interface StudentsResponse {
  readonly students: readonly StudentMembership[]
}
export interface NotificationsResponse {
  readonly notifications: readonly LmsNotification[]
  readonly unreadCount: number
}
