import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/client'
import { Avatar } from './ui.jsx'
import { relTime } from '../lib/format'
import { QuickActionModal } from '../features/workflows/components/QuickActionModal.tsx'

// Teacher navigation leads with the Command Center: the dashboard, not the
// class list, is the answer to "what do I do now?". Classes stay one click away.
const NAV = {
  teacher: [
    { to: '/dashboard', icon: '🧭', label: 'Command Center' },
    { to: '/inbox', icon: '🧠', label: 'AI Inbox' },
    { to: '/interventions', icon: '🚨', label: 'Interventions' },
    { to: '/classes', icon: '🏫', label: 'Classes' },
    { to: '/calendar', icon: '📅', label: 'Calendar' },
  ],
  student: [
    { to: '/classes', icon: '🎒', label: 'My Classes' },
    { to: '/calendar', icon: '📅', label: 'Calendar' },
  ],
  parent: [{ to: '/guardian', icon: '👨‍👩‍👧', label: 'My Children' }],
}

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'system')
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  return [theme, setTheme]
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const ref = useRef(null)

  const load = async () => {
    try {
      const data = await api.get('/lms/notifications?limit=15')
      setItems(data.notifications || [])
      setUnread(data.unreadCount || 0)
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const markAll = async () => {
    await api.post('/lms/notifications/read-all')
    load()
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn btn-ghost btn-icon" onClick={() => setOpen((o) => !o)} aria-label="Notifications" style={{ position: 'relative' }}>
        <span style={{ fontSize: 18 }}>🔔</span>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--rose-500)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 46, width: 340, zIndex: 20, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
          <div className="spread" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <strong style={{ fontSize: 14 }}>Notifications</strong>
            {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={markAll}>Mark all read</button>}
          </div>
          <div style={{ maxHeight: 380, overflow: 'auto' }}>
            {items.length === 0 && <div className="empty" style={{ padding: 28 }}><div className="empty-icon">🌙</div><div className="small">You're all caught up</div></div>}
            {items.map((n) => (
              <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: n.isRead ? 'transparent' : 'var(--primary-soft)' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{n.title}</div>
                {n.body && <div className="small muted" style={{ marginTop: 2 }}>{n.body}</div>}
                <div className="tiny faint" style={{ marginTop: 4 }}>{relTime(n.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AppShell() {
  const { user, logout } = useAuth()
  const [theme, setTheme] = useTheme()
  const nav = useNavigate()
  const links = NAV[user?.role] || NAV.teacher

  return (
    // Layout lives in index.css (`.app-shell`, `.app-sidebar`) rather than
    // inline, so the responsive rules can actually override it — an inline
    // style wins over any media query.
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to main content</a>
      <aside className="app-sidebar">
        <div className="row app-brand" style={{ padding: '4px 10px 18px', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, var(--indigo-500), var(--sky-500))', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>R</div>
          <div>
            <div style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>Roognis</div>
            <div className="tiny faint" style={{ textTransform: 'capitalize' }}>{user?.role} workspace</div>
          </div>
        </div>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10,
              fontWeight: 600, fontSize: 14.5, color: isActive ? 'var(--primary)' : 'var(--text-muted)',
              background: isActive ? 'var(--primary-soft)' : 'transparent',
            })}
          >
            <span style={{ fontSize: 18 }}>{l.icon}</span> {l.label}
          </NavLink>
        ))}
        <div className="grow app-sidebar-spacer" />
        <div className="tiny faint app-sidebar-version" style={{ padding: '10px 12px' }}>Roognis LMS · v0.1</div>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ height: 'var(--topbar-h)', borderBottom: '1px solid var(--border)', background: 'color-mix(in srgb, var(--bg-elevated) 88%, transparent)', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 15, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '0 22px' }}>
          <button className="btn btn-ghost btn-icon" title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <span style={{ fontSize: 17 }}>{theme === 'dark' ? '☀️' : '🌙'}</span>
          </button>
          <NotificationBell />
          <div style={{ width: 1, height: 26, background: 'var(--border)', margin: '0 4px' }} />
          <div className="row" style={{ gap: 10 }}>
            <Avatar name={user?.name} id={user?.userId} size="sm" />
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{user?.name}</div>
              <div className="tiny faint" style={{ textTransform: 'capitalize' }}>{user?.role}</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={async () => { await logout(); nav('/login') }}>Sign out</button>
          </div>
        </header>
        <main id="main" style={{ padding: '28px 30px', maxWidth: 1180, width: '100%', margin: '0 auto', minWidth: 0 }}>
          <Outlet />
        </main>
      </div>

      {/* Quick actions are routed (`?action=…`), so the modal lives here — one
          mount, reachable from every screen inside the shell. */}
      <QuickActionModal />
    </div>
  )
}
