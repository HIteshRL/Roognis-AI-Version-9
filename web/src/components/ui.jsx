import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { colorFor, initials } from '../lib/format'

export function Avatar({ name, id, size = 'md' }) {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar'
  return (
    <span className={cls} style={{ background: colorFor(id || name) }} title={name}>
      {initials(name)}
    </span>
  )
}

export function Badge({ children, tone = 'default', dot = false }) {
  const toneClass = { default: '', primary: 'badge-primary', success: 'badge-success', warn: 'badge-warn', danger: 'badge-danger' }[tone] || ''
  return <span className={`badge ${toneClass} ${dot ? 'badge-dot' : ''}`}>{children}</span>
}

export function Spinner({ size = 20 }) {
  return (
    <span
      style={{
        width: size, height: size, display: 'inline-block',
        border: '2.5px solid var(--border-strong)', borderTopColor: 'var(--primary)',
        borderRadius: '50%', animation: 'spin .7s linear infinite',
      }}
    />
  )
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 40, gap: 10, color: 'var(--text-muted)' }}>
      <Spinner /> <span>{label}</span>
    </div>
  )
}

export function EmptyState({ icon = '📭', title, hint, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16 }}>{title}</div>
      {hint && <div className="small" style={{ marginTop: 4 }}>{hint}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={wide ? { maxWidth: 720 } : undefined} role="dialog" aria-modal="true">
        <div className="spread" style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 17 }}>{title}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card-pad">{children}</div>
        {footer && <div className="spread" style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', justifyContent: 'flex-end', gap: 10 }}>{footer}</div>}
      </div>
    </div>
  )
}

/* ── Toasts ──────────────────────────────────────────────────────────────── */
const ToastCtx = createContext(null)
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((msg, tone = 'default') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800)
  }, [])
  const toast = {
    show: (m) => push(m, 'default'),
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
  }
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

// keyframes for Spinner (index.css owns most; keep spin local to avoid clutter)
const style = document.createElement('style')
style.textContent = '@keyframes spin { to { transform: rotate(360deg) } }'
if (typeof document !== 'undefined' && !document.getElementById('spin-kf')) {
  style.id = 'spin-kf'
  document.head.appendChild(style)
}
