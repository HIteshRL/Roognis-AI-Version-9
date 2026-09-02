import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Avatar, Badge, Loading, useToast } from '../components/ui.jsx'
import { dueLabel, fmtDateTime } from '../lib/format'

function TeacherGrading({ cwId, maxPoints }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [drafts, setDrafts] = useState({})

  const load = async () => {
    try {
      setData(await api.get(`/lms/coursework/${cwId}/submissions`))
    } catch (e) {
      toast.error(e.message)
    }
  }
  useEffect(() => {
    load() // eslint-disable-next-line
  }, [cwId])

  const grade = async (sub) => {
    const d = drafts[sub.id] || {}
    const value = d.grade ?? sub.grade
    if (value == null || value === '') return toast.error('Enter a grade')
    try {
      await api.post(`/lms/submissions/${sub.id}/grade`, { grade: Number(value), feedback: d.feedback ?? sub.feedback ?? null })
      toast.success(`Graded ${sub.studentName || 'student'}`)
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  if (!data) return <Loading />
  return (
    <div>
      <div className="row" style={{ gap: 12, marginBottom: 14 }}>
        <Badge tone="primary">{data.stats.turnedIn} turned in</Badge>
        <Badge tone="success">{data.stats.graded} graded</Badge>
      </div>
      {data.submissions.length === 0 ? (
        <div className="empty"><div className="empty-icon">📭</div><div className="small">No submissions yet.</div></div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {data.submissions.map((s) => {
            const d = drafts[s.id] || {}
            return (
              <div key={s.id} className="card card-pad">
                <div className="spread" style={{ marginBottom: 10 }}>
                  <div className="row" style={{ gap: 10 }}><Avatar name={s.studentName} id={s.studentId} size="sm" /><strong>{s.studentName || s.studentId}</strong></div>
                  {s.status === 'returned' ? <Badge tone="success">Returned · {s.grade}</Badge> : <Badge tone="primary">Turned in</Badge>}
                </div>
                {s.content?.text && <div className="card" style={{ background: 'var(--surface-2)', padding: 12, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{s.content.text}</div>}
                <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
                  <div className="field" style={{ width: 120 }}><label>Grade{maxPoints != null ? ` / ${maxPoints}` : ''}</label><input className="input" type="number" min="0" defaultValue={s.grade ?? ''} onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, grade: e.target.value } })} /></div>
                  <div className="field grow"><label>Feedback</label><input className="input" placeholder="Nice work…" defaultValue={s.feedback ?? ''} onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, feedback: e.target.value } })} /></div>
                  <button className="btn btn-primary" onClick={() => grade(s)}>Return grade</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StudentSubmit({ classroomId, cwId }) {
  const toast = useToast()
  const [cw, setCw] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const { coursework } = await api.get(`/lms/student/classrooms/${classroomId}/coursework`)
      setCw((coursework || []).find((c) => c.id === cwId) || null)
    } catch (e) {
      toast.error(e.message)
    }
  }
  useEffect(() => {
    load() // eslint-disable-next-line
  }, [cwId])

  if (!cw) return <Loading />
  const sub = cw.mySubmission
  const isMaterial = cw.type === 'material'

  const submit = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api.post(`/lms/coursework/${cwId}/submit`, { text })
      toast.success('Turned in')
      setText('')
      load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad" style={{ maxWidth: 640 }}>
      <h3>Your work</h3>
      {sub?.status === 'returned' ? (
        <div style={{ marginTop: 12 }}>
          <Badge tone="success">Graded · {sub.grade}{cw.maxPoints != null ? ` / ${cw.maxPoints}` : ''}</Badge>
          {sub.feedback && <div className="card" style={{ background: 'var(--surface-2)', padding: 12, marginTop: 12 }}><div className="tiny faint">Feedback</div>{sub.feedback}</div>}
          {sub.content?.text && <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }} className="small muted">You wrote: {sub.content.text}</div>}
        </div>
      ) : isMaterial ? (
        <p className="muted" style={{ marginTop: 8 }}>This is a reference material — nothing to turn in.</p>
      ) : (
        <>
          {sub?.status === 'turned_in' && <Badge tone="primary" style={{ marginBottom: 10 }}>Turned in — you can resubmit until it’s graded</Badge>}
          <textarea className="textarea" style={{ marginTop: 12 }} placeholder="Type your answer…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="spread" style={{ marginTop: 10 }}>
            <span className="tiny faint">{sub ? 'Resubmitting replaces your previous answer.' : 'Your teacher will be notified.'}</span>
            <button className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()}>{sub ? 'Resubmit' : 'Turn in'}</button>
          </div>
        </>
      )}
    </div>
  )
}

export default function CourseworkDetail() {
  const { id, cwId } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const isTeacher = user.role === 'teacher'
  const [cw, setCw] = useState(null)

  useEffect(() => {
    ;(async () => {
      try {
        if (isTeacher) setCw(await api.get(`/lms/coursework/${cwId}`))
        else {
          const { coursework } = await api.get(`/lms/student/classrooms/${id}/coursework`)
          setCw((coursework || []).find((c) => c.id === cwId) || null)
        }
      } catch (e) {
        toast.error(e.message)
      }
    })() // eslint-disable-next-line
  }, [cwId])

  if (!cw) return <Loading />
  const due = dueLabel(cw.dueAt)

  return (
    <div style={{ maxWidth: 820 }}>
      <Link to={`/classes/${id}`} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>← Back to class</Link>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="spread">
          <div>
            <div className="row" style={{ gap: 10 }}>
              <h1 style={{ fontSize: 24 }}>{cw.title}</h1>
              <Badge tone="default" >{cw.type}</Badge>
              {cw.status === 'draft' && <Badge tone="warn">Draft</Badge>}
            </div>
            <div className="row small muted" style={{ gap: 14, marginTop: 8 }}>
              {cw.maxPoints != null && <span>🎯 {cw.maxPoints} points</span>}
              {cw.dueAt && <span>📅 {fmtDateTime(cw.dueAt)}</span>}
            </div>
          </div>
          {due && cw.type !== 'material' && <Badge tone={due.tone}>{due.text}</Badge>}
        </div>
        {cw.description && <div style={{ marginTop: 16, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{cw.description}</div>}
        {Array.isArray(cw.attachments?.rubric) && cw.attachments.rubric.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="tiny faint" style={{ marginBottom: 6 }}>RUBRIC</div>
            <div className="col" style={{ gap: 6 }}>
              {cw.attachments.rubric.map((c, i) => (
                <div key={i} className="spread card" style={{ padding: '8px 12px', background: 'var(--surface-2)' }}>
                  <span className="small"><strong>{c.criterion}</strong>{c.description ? ` — ${c.description}` : ''}</span>
                  <Badge>{c.maxPoints} pts</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isTeacher ? <TeacherGrading cwId={cwId} maxPoints={cw.maxPoints} /> : <StudentSubmit classroomId={id} cwId={cwId} />}
    </div>
  )
}
