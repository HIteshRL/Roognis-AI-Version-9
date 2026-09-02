import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EmptyState, Loading, Modal, useToast } from '../components/ui.jsx'
import { colorFor } from '../lib/format'

function ClassCard({ c, isTeacher }) {
  const color = c.color || colorFor(c.id)
  return (
    <Link to={`/classes/${c.id}`} className="card card-hover" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: color, height: 84, padding: '16px 18px', color: '#fff', position: 'relative' }}>
        <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>{c.name}</div>
        <div style={{ fontSize: 13, opacity: 0.92 }}>{c.subject}{c.section ? ` · ${c.section}` : ''}</div>
        <div className="avatar" style={{ position: 'absolute', right: 16, bottom: -19, background: '#fff', color, border: '2px solid var(--surface)' }}>
          {c.subject?.[0]?.toUpperCase() || 'C'}
        </div>
      </div>
      <div style={{ padding: '24px 18px 16px', flex: 1 }}>
        {c.grade && <span className="badge" style={{ marginBottom: 10 }}>{c.grade}</span>}
        <div className="row muted small" style={{ gap: 16, marginTop: 4 }}>
          {isTeacher && <span>👥 {c.studentCount ?? 0} students</span>}
          <span>📖 {c.chapterCount ?? 0} chapters</span>
        </div>
      </div>
      {isTeacher && (
        <div className="row small" style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', gap: 8, color: 'var(--text-muted)' }}>
          <span>Join code</span>
          <code style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>{c.joinCode}</code>
        </div>
      )}
    </Link>
  )
}

export default function Classrooms() {
  const { user } = useAuth()
  const toast = useToast()
  const isTeacher = user.role === 'teacher'
  const [items, setItems] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const path = isTeacher ? '/lms/classrooms' : '/lms/student/classrooms'
    try {
      const data = await api.get(path)
      setItems(data.classrooms || [])
    } catch (e) {
      toast.error(e.message)
      setItems([])
    }
  }
  useEffect(() => {
    load() // eslint-disable-next-line
  }, [])

  const submit = async () => {
    setBusy(true)
    try {
      if (isTeacher) {
        if (!form.name || !form.subject) throw new Error('Name and subject are required')
        await api.post('/lms/classrooms', form)
        toast.success('Class created')
      } else {
        if (!form.joinCode) throw new Error('Enter a join code')
        await api.post('/lms/enrollments/join', { joinCode: form.joinCode.trim().toUpperCase() })
        toast.success('Joined class')
      }
      setShowModal(false)
      setForm({})
      load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>{isTeacher ? 'Your classes' : 'My classes'}</h1>
          <p className="muted" style={{ marginTop: 4 }}>{isTeacher ? 'Create and manage the classes you teach.' : 'Classes you’ve joined.'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          {isTeacher ? '＋ Create class' : '＋ Join class'}
        </button>
      </div>

      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          icon={isTeacher ? '🏫' : '🎒'}
          title={isTeacher ? 'No classes yet' : 'You haven’t joined a class'}
          hint={isTeacher ? 'Create your first class to start posting coursework.' : 'Ask your teacher for a join code.'}
          action={<button className="btn btn-primary" onClick={() => setShowModal(true)}>{isTeacher ? 'Create a class' : 'Join a class'}</button>}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
          {items.map((c) => (
            <ClassCard key={c.id} c={c} isTeacher={isTeacher} />
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={isTeacher ? 'Create a class' : 'Join a class'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>{isTeacher ? 'Create' : 'Join'}</button>
          </>
        }
      >
        {isTeacher ? (
          <div className="col" style={{ gap: 14 }}>
            <div className="field"><label>Class name *</label><input className="input" placeholder="Class 8 Science" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>Subject *</label><input className="input" placeholder="Science" value={form.subject || ''} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div className="row" style={{ gap: 14 }}>
              <div className="field grow"><label>Section</label><input className="input" placeholder="A" value={form.section || ''} onChange={(e) => setForm({ ...form, section: e.target.value })} /></div>
              <div className="field grow"><label>Grade</label><input className="input" placeholder="Grade 8" value={form.grade || ''} onChange={(e) => setForm({ ...form, grade: e.target.value })} /></div>
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Class join code</label>
            <input className="input" placeholder="e.g. ABC2345" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }} value={form.joinCode || ''} onChange={(e) => setForm({ ...form, joinCode: e.target.value })} />
            <span className="tiny faint">Ask your teacher for the 7-character code.</span>
          </div>
        )}
      </Modal>
    </div>
  )
}
