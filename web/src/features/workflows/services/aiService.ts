/**
 * AI service client for the generation steps of the material workflow.
 *
 * `services/ai` exists and serves the tutor, news and interest-graph routes,
 * but the lesson, worksheet, material-analysis and summary endpoints do not
 * exist yet. Rather than stubbing them, each call is attempted against the real
 * service: a `404`/`501` is recorded as an unprovisioned capability and the
 * step reports `blocked`. The moment the endpoint ships, the same code starts
 * succeeding — nothing here has to change.
 *
 * Probe results are cached for the session so a missing endpoint is discovered
 * once, not on every workflow run.
 */

import { ApiError, api } from '../../../api/client'
import { type CapabilityId, isUnimplemented } from '../../shared/services/capability'

export type Attempt<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly capability: CapabilityId }

/** Capabilities already discovered to be absent this session. */
const knownAbsent = new Set<CapabilityId>()

export const isKnownAbsent = (capability: CapabilityId): boolean => knownAbsent.has(capability)

/** Test seam: forget what was probed. */
export const resetCapabilityProbes = (): void => knownAbsent.clear()

async function attempt<T>(capability: CapabilityId, call: () => Promise<T>): Promise<Attempt<T>> {
  if (knownAbsent.has(capability)) return { ok: false, capability }
  try {
    return { ok: true, data: await call() }
  } catch (error) {
    if (error instanceof ApiError && isUnimplemented(error.status)) {
      knownAbsent.add(capability)
      return { ok: false, capability }
    }
    throw error
  }
}

export interface MaterialAnalysis {
  readonly summary: string
  readonly concepts: readonly string[]
  readonly readingLevel?: string
}

export interface GeneratedArtifact {
  readonly id: string
  readonly title: string
  readonly status: string
}

export function analyseMaterial(input: {
  classroomId: string
  title: string
  url?: string
  text?: string
}): Promise<Attempt<MaterialAnalysis>> {
  return attempt('ai.document-analysis', () =>
    api.post<MaterialAnalysis>('/ai/materials/analyse', input),
  )
}

export function generateLesson(input: {
  classroomId: string
  materialTitle: string
  concepts?: readonly string[]
}): Promise<Attempt<GeneratedArtifact>> {
  return attempt('ai.lesson-generation', () =>
    api.post<GeneratedArtifact>('/ai/lessons/generate', input),
  )
}

export function generateWorksheet(input: {
  classroomId: string
  materialTitle: string
  concepts?: readonly string[]
}): Promise<Attempt<GeneratedArtifact>> {
  return attempt('ai.worksheet-generation', () =>
    api.post<GeneratedArtifact>('/ai/worksheets/generate', input),
  )
}

export function summariseEvent(input: {
  eventId: string
  text: string
}): Promise<Attempt<{ summary: string }>> {
  return attempt('ai.event-summary', () => api.post<{ summary: string }>('/ai/summaries', input))
}

/**
 * Quiz drafting lives in `services/quiz`. The review-and-publish gate specified
 * in QUIZ_SERVICE_LLD was never built, so a generated quiz currently reaches
 * students without human approval — the workflow surfaces that as a blocked
 * approval step rather than quietly publishing.
 */
export function requestQuizApproval(quizId: string): Promise<Attempt<{ status: string }>> {
  return attempt('quiz.teacher-review', () =>
    api.post<{ status: string }>(`/quiz/quizzes/${encodeURIComponent(quizId)}/approve`),
  )
}
