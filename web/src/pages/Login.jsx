import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useToast, Spinner } from '../components/ui.jsx'

const ROLES = [
  { key: 'teacher', icon: '🧑‍🏫', title: 'Teacher', blurb: 'Create classes, post work, grade submissions.' },
  { key: 'student', icon: '🎒', title: 'Student', blurb: 'Join classes, turn in work, see your grades.' },
  { key: 'parent', icon: '👨‍👩‍👧', title: 'Guardian', blurb: 'Follow your child’s upcoming work and grades.' },
]

export default function Login() {
  const { login } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const [busy, setBusy] = useState(null)

  const pick = async (role) => {
    setBusy(role)
    try {
      const user = await login(role)
      nav(user.role === 'parent' ? '/guardian' : '/classes', { replace: true })
    } catch (e) {
      toast.error(e.message || 'Sign-in failed')
      setBusy(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1.05fr 1fr' }}>
      {/* Brand panel */}
      <div style={{ background: 'linear-gradient(150deg, #4338ca 0%, #6366f1 45%, #0ea5e9 100%)', color: '#fff', padding: '56px 60px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.18)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 22 }}>R</div>
          <strong style={{ fontSize: 20, letterSpacing: '-0.02em' }}>Roognis</strong>
        </div>
        <div>
          <h1 style={{ fontSize: 40, lineHeight: 1.1, letterSpacing: '-0.03em', maxWidth: 460 }}>The classroom, reimagined for every learner.</h1>
          <p style={{ fontSize: 16, opacity: 0.9, maxWidth: 440, marginTop: 18 }}>
            Classes, coursework, a live stream, gradebook and guardian summaries — all
            in one place, powered by Roognis’ adaptive tutoring engine.
          </p>
        </div>
        <div className="row" style={{ gap: 22, opacity: 0.9, fontSize: 13.5, flexWrap: 'wrap' }}>
          <span>📚 Classwork & rubrics</span>
          <span>📣 Class stream</span>
          <span>📊 Gradebook</span>
        </div>
      </div>

      {/* Sign-in panel */}
      <div style={{ display: 'grid', placeItems: 'center', padding: '40px 32px', background: 'var(--bg)' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <h2 style={{ fontSize: 24 }}>Welcome back</h2>
          <p className="muted" style={{ marginTop: 6, marginBottom: 26 }}>Choose how you want to sign in to the demo workspace.</p>
          <div className="col" style={{ gap: 12 }}>
            {ROLES.map((r) => (
              <button
                key={r.key}
                className="card card-hover"
                onClick={() => pick(r.key)}
                disabled={!!busy}
                style={{ textAlign: 'left', padding: 16, display: 'flex', alignItems: 'center', gap: 15, cursor: 'pointer', width: '100%' }}
              >
                <div style={{ fontSize: 28, width: 44, textAlign: 'center' }}>{r.icon}</div>
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>{r.title}</div>
                  <div className="small muted">{r.blurb}</div>
                </div>
                {busy === r.key ? <Spinner /> : <span className="faint" style={{ fontSize: 20 }}>→</span>}
              </button>
            ))}
          </div>
          <p className="tiny faint center" style={{ marginTop: 22 }}>
            Sessions use the same cookie-JWT contract as the Auth Service (`/api/auth`).
          </p>
        </div>
      </div>
    </div>
  )
}
