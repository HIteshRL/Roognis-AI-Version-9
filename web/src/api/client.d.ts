/**
 * Types for the existing `client.js` fetch wrapper. The runtime implementation
 * is unchanged and remains the single HTTP entry point for the whole SPA —
 * this file only gives TypeScript callers a checked view of it.
 */

export declare class ApiError extends Error {
  readonly name: 'ApiError'
  readonly status: number
  readonly data: unknown
  constructor(message: string, status: number, data: unknown)
}

export interface AuthUser {
  readonly userId: string
  readonly role: 'teacher' | 'student' | 'parent'
  readonly schoolId: string
  readonly name: string
  readonly studentIds?: readonly string[]
}

export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
  patch<T = unknown>(path: string, body?: unknown): Promise<T>
  del<T = unknown>(path: string): Promise<T>
  login(role: string): Promise<{ user: AuthUser }>
  me(): Promise<{ user: AuthUser }>
  logout(): Promise<unknown>
}

export declare const api: ApiClient
