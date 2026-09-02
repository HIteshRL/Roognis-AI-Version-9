/**
 * Typed access to `services/lms`.
 *
 * Reads go through `guardRoster` so every payload passes the §12 construct scan
 * on its way in. Writes go straight to the shared `api` client. Paths here are
 * exactly the routes registered in `services/lms/main.py`, `stream.py`,
 * `discussions.py`, `gradebook.py` and `calendar_view.py` — nothing speculative.
 */

import { api } from '../../../api/client'
import { guardRoster } from './privacyGuard'
import type {
  Announcement,
  AnnouncementsResponse,
  CalendarResponse,
  Classroom,
  ClassroomsResponse,
  Comment,
  CommentsResponse,
  Coursework,
  CourseworkResponse,
  CourseworkType,
  Gradebook,
  NotificationsResponse,
  StudentsResponse,
  Submission,
  SubmissionsResponse,
} from '../types/lms'

const enc = encodeURIComponent

/* ── Classrooms ───────────────────────────────────────────────────────────── */

export async function listTeacherClassrooms(): Promise<readonly Classroom[]> {
  const res = await guardRoster<ClassroomsResponse>('/lms/classrooms')
  return res.classrooms ?? []
}

export async function listStudentClassrooms(): Promise<readonly Classroom[]> {
  const res = await guardRoster<ClassroomsResponse>('/lms/student/classrooms')
  return res.classrooms ?? []
}

export function getClassroom(classroomId: string): Promise<Classroom> {
  return guardRoster<Classroom>(`/lms/classrooms/${enc(classroomId)}`)
}

export async function listClassroomStudents(classroomId: string) {
  const res = await guardRoster<StudentsResponse>(`/lms/classrooms/${enc(classroomId)}/students`)
  return res.students ?? []
}

/* ── Coursework ───────────────────────────────────────────────────────────── */

export async function listCoursework(classroomId: string): Promise<readonly Coursework[]> {
  const res = await guardRoster<CourseworkResponse>(`/lms/classrooms/${enc(classroomId)}/coursework`)
  return res.coursework ?? []
}

export async function listStudentCoursework(classroomId: string): Promise<readonly Coursework[]> {
  const res = await guardRoster<CourseworkResponse>(
    `/lms/student/classrooms/${enc(classroomId)}/coursework`,
  )
  return res.coursework ?? []
}

export async function listSubmissions(courseworkId: string): Promise<readonly Submission[]> {
  const res = await guardRoster<SubmissionsResponse>(`/lms/coursework/${enc(courseworkId)}/submissions`)
  return res.submissions ?? []
}

export interface CreateCourseworkInput {
  readonly type: CourseworkType
  readonly title: string
  readonly description?: string
  readonly topic?: string
  readonly chapterId?: string
  readonly maxPoints?: number
  readonly dueAt?: string
}

export function createCoursework(
  classroomId: string,
  input: CreateCourseworkInput,
): Promise<Coursework> {
  return api.post<Coursework>(`/lms/classrooms/${enc(classroomId)}/coursework`, input)
}

export function publishCoursework(courseworkId: string): Promise<Coursework> {
  return api.post<Coursework>(`/lms/coursework/${enc(courseworkId)}/publish`)
}

export function gradeSubmission(
  submissionId: string,
  input: { readonly grade: number; readonly feedback?: string },
): Promise<Submission> {
  return api.post<Submission>(`/lms/submissions/${enc(submissionId)}/grade`, input)
}

/* ── Stream ───────────────────────────────────────────────────────────────── */

export async function listAnnouncements(
  classroomId: string,
  limit = 100,
): Promise<readonly Announcement[]> {
  const res = await guardRoster<AnnouncementsResponse>(
    `/lms/classrooms/${enc(classroomId)}/announcements?limit=${limit}`,
  )
  return res.announcements ?? []
}

export interface CreateAnnouncementInput {
  readonly body: string
  readonly title?: string
  readonly status?: 'draft' | 'published' | 'scheduled'
  readonly scheduledFor?: string
  readonly attachments?: readonly { readonly url: string; readonly title?: string }[]
}

export function createAnnouncement(
  classroomId: string,
  input: CreateAnnouncementInput,
): Promise<Announcement> {
  return api.post<Announcement>(`/lms/classrooms/${enc(classroomId)}/announcements`, input)
}

export function setAnnouncementPinned(announcementId: string, pinned: boolean): Promise<Announcement> {
  return api.post<Announcement>(`/lms/announcements/${enc(announcementId)}/pin`, { pinned })
}

export function deleteAnnouncement(announcementId: string): Promise<unknown> {
  return api.del(`/lms/announcements/${enc(announcementId)}`)
}

/* ── Comments & reactions ─────────────────────────────────────────────────── */

export async function listComments(
  classroomId: string,
  scope: { readonly announcementId?: string; readonly courseworkId?: string },
): Promise<readonly Comment[]> {
  const query = scope.announcementId
    ? `announcementId=${enc(scope.announcementId)}`
    : scope.courseworkId
      ? `courseworkId=${enc(scope.courseworkId)}`
      : ''
  const res = await guardRoster<CommentsResponse>(
    `/lms/classrooms/${enc(classroomId)}/comments${query ? `?${query}` : ''}`,
  )
  return res.comments ?? []
}

export function createComment(
  classroomId: string,
  input: { readonly body: string; readonly announcementId?: string; readonly courseworkId?: string },
): Promise<Comment> {
  return api.post<Comment>(`/lms/classrooms/${enc(classroomId)}/comments`, input)
}

export function addCommentReaction(commentId: string, emoji: string): Promise<unknown> {
  return api.post(`/lms/comments/${enc(commentId)}/reactions`, { emoji })
}

export function removeCommentReaction(commentId: string, emoji: string): Promise<unknown> {
  return api.del(`/lms/comments/${enc(commentId)}/reactions/${enc(emoji)}`)
}

/* ── Calendar, gradebook, notifications ───────────────────────────────────── */

export function getCalendar(range: { readonly start: string; readonly end: string }): Promise<CalendarResponse> {
  return guardRoster<CalendarResponse>(
    `/lms/calendar?start=${enc(range.start)}&end=${enc(range.end)}`,
  )
}

export function getGradebook(classroomId: string): Promise<Gradebook> {
  return guardRoster<Gradebook>(`/lms/classrooms/${enc(classroomId)}/gradebook`)
}

export function listNotifications(limit = 30): Promise<NotificationsResponse> {
  return guardRoster<NotificationsResponse>(`/lms/notifications?limit=${limit}`)
}

export function markAllNotificationsRead(): Promise<unknown> {
  return api.post('/lms/notifications/read-all')
}
