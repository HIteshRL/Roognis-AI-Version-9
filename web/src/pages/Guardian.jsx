import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Avatar, Badge, EmptyState, Loading, useToast } from '../components/ui.jsx'
import { fmtDate } from '../lib/format'

function Section({ title, icon, items, render, empty }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 8, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 17 }}>{icon}</span>
        <strong>{title}</strong>
        <span className="badge">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="small muted" style={{ padding: '16px 18px' }}>{empty}</div>
      ) : (
        items.map(render)
      )}
    </div>
  )
}

export default function Guardian() {
  const toast = useToast()
  const [students, setStudents] = useState(null)
  const [active, setActive] = useState(null)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    ;(async () => {
      try {
        const { students } = await api.get('/lms/guardian/students')
        setStudents(students || [])
        if (students?.length) setActive(students[0].studentId)
      } catch (e) {
        toast.error(e.message)
        setStudents([])
      }
    })()
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!active) return
    setSummary(null)
    ;(async () => {
      try {
        setSummary(await api.get(`/lms/guardian/students/${active}/summary`))
      } catch (e) {
        toast.error(e.message)
      }
    })()
  }, [active]) // eslint-disable-line

  if (students === null) return <Loading />
  if (students.length === 0) return <EmptyState icon="👨‍👩‍👧" title="No linked students" hint="A teacher can invite you as a guardian to follow a student’s progress." />

  const current = students.find((s) => s.studentId === active)

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 26 }}>My children</h1>
      <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>A read-only summary of upcoming work and recent grades.</p>

      {students.length > 1 && (
        <div className="row wrap" style={{ gap: 10, marginBottom: 18 }}>
          {students.map((s) => (
            <button key={s.studentId} className={`btn ${active === s.studentId ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActive(s.studentId)}>
              {s.studentName || 'Student'}
            </button>
          ))}
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={current?.studentName} id={active} size="lg" />
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{current?.studentName || 'Student'}</div>
            <div className="small muted">Guardian summary</div>
          </div>
        </div>
      </div>

      {!summary ? (
        <Loading />
      ) : (
        <div className="col" style={{ gap: 16 }}>
          <Section
            title="Upcoming" icon="⏳" items={summary.upcoming} empty="Nothing due soon."
            render={(e) => (
              <div key={e.courseworkId} className="spread" style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                <div><div style={{ fontWeight: 600 }}>{e.title}</div><div className="tiny muted">{e.classroomName}</div></div>
                {e.dueAt && <Badge tone="primary">Due {fmtDate(e.dueAt)}</Badge>}
              </div>
            )}
          />
          <Section
            title="Missing" icon="⚠️" items={summary.missing} empty="No missing work — nice!"
            render={(e) => (
              <div key={e.courseworkId} className="spread" style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                <div><div style={{ fontWeight: 600 }}>{e.title}</div><div className="tiny muted">{e.classroomName}</div></div>
                <Badge tone="danger">Overdue</Badge>
              </div>
            )}
          />
          <Section
            title="Recent grades" icon="✅" items={summary.recentGrades} empty="No grades returned yet."
            render={(e) => (
              <div key={e.courseworkId} className="spread" style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                <div><div style={{ fontWeight: 600 }}>{e.title}</div><div className="tiny muted">{e.classroomName}</div></div>
                <Badge tone="success">{e.score}{e.maxPoints != null ? ` / ${e.maxPoints}` : ''}</Badge>
              </div>
            )}
          />
        </div>
      )}
    </div>
  )
}
