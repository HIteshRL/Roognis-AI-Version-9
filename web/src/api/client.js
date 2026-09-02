// Thin fetch wrapper over the gateway. Cookies (the JWT session) travel with
// every request via credentials: 'include'. Errors surface the service's
// `detail`/`error` message so the UI can show something meaningful.
const BASE = '/api'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

async function request(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const detail = (data && (data.detail || data.error || data.message)) || res.statusText
    throw new ApiError(typeof detail === 'string' ? detail : 'Request failed', res.status, data)
  }
  return data
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body: body ?? {} }),
  patch: (p, body) => request(p, { method: 'PATCH', body: body ?? {} }),
  del: (p) => request(p, { method: 'DELETE' }),

  // Auth (real Auth Service in prod; dev shim under `vite dev`).
  login: (role) => request('/auth/login', { method: 'POST', body: { role } }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
}
