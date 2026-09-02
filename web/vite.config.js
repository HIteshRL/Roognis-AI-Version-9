import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import crypto from 'node:crypto'

// In production the SPA talks to the real gateway: /api/* is served by Traefik
// (auth, lms, ai, ...). In `vite dev` there is no gateway, so we (a) proxy
// /api/lms to a locally-running LMS service and (b) stand in for the Auth
// Service with a tiny shim that signs the SAME { userId, role, schoolId, name,
// studentIds } cookie-JWT the LMS verifies. The shim only runs under `apply:
// 'serve'` — production builds never include it.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-lms-secret'
const LMS_TARGET = process.env.LMS_URL || 'http://127.0.0.1:3006'

const SCHOOL = '22222222-2222-2222-2222-222222222222'
const STUDENT_ID = '33333333-3333-3333-3333-333333333333'
const DEMO_USERS = {
  teacher: { userId: '11111111-1111-1111-1111-111111111111', role: 'teacher', schoolId: SCHOOL, name: 'Ms. Rao' },
  student: { userId: STUDENT_ID, role: 'student', schoolId: SCHOOL, name: 'Aarav Shah' },
  parent: { userId: '77777777-7777-7777-7777-777777777777', role: 'parent', schoolId: SCHOOL, name: 'Priya Shah', studentIds: [STUDENT_ID] },
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const hmac = (data) =>
  crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }))
  const data = `${header}.${body}`
  return `${data}.${hmac(data)}`
}
function verifyJwt(token) {
  try {
    const [h, b, s] = String(token).split('.')
    if (!h || !b || s !== hmac(`${h}.${b}`)) return null
    return JSON.parse(Buffer.from(b, 'base64').toString())
  } catch {
    return null
  }
}
const readBody = (req) =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
  })
const parseCookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p[0])
  )

function devAuth() {
  return {
    name: 'roognis-dev-auth',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/auth/')) return next()
        const send = (code, obj, cookie) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          if (cookie) res.setHeader('Set-Cookie', cookie)
          res.end(JSON.stringify(obj))
        }
        if (req.url.startsWith('/api/auth/login') && req.method === 'POST') {
          const body = await readBody(req)
          const user = DEMO_USERS[body.role] || DEMO_USERS.teacher
          return send(200, { user }, `jwt=${signJwt(user)}; Path=/; HttpOnly; SameSite=Lax`)
        }
        if (req.url.startsWith('/api/auth/me')) {
          const payload = verifyJwt(parseCookies(req).jwt || '')
          return payload ? send(200, { user: payload }) : send(401, { error: 'unauthorized' })
        }
        if (req.url.startsWith('/api/auth/logout')) {
          return send(200, { ok: true }, 'jwt=; Path=/; HttpOnly; Max-Age=0')
        }
        return next()
      })
    },
  }
}

export default defineConfig({
  // Served at '/' in dev; the container build sets VITE_BASE=/classroom/ so the
  // SPA can live behind Traefik alongside the existing frontend at '/'.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), devAuth()],
  server: {
    proxy: {
      '/api/lms': { target: LMS_TARGET, changeOrigin: true },
    },
  },
})
