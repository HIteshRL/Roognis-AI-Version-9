import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { Avatar, EmptyState, Loading, useToast } from '../../components/ui.jsx'
import { guardAggregate } from '../../features/shared/services/privacyGuard'

function ClassKnowledgeGaps({ classroomId }) {
  const [state, setState] = useState({ kind: 'loading' })

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    guardAggregate('classroom-mastery', classroomId).then((result) => {
      if (active) setState(result)
    })
    return () => { active = false }
  }, [classroomId])

  if (state.kind === 'loading') {
    return <div className="card card-pad" style={{ marginBottom: 18 }}><Loading /></div>
  }

  if (state.kind === 'unprovisioned') {
    return null
  }

  if (state.kind === 'error') {
    const suppressed = state.error?.name === 'CohortTooSmallError'
    return (
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <strong>Class knowledge gaps</strong>
        <div className="small muted" style={{ marginTop: 8 }}>
          {suppressed
            ? 'Hidden until at least five learners contribute to the class aggregate.'
            : 'The privacy-filtered class aggregate is temporarily unavailable.'}
        </div>
      </div>
    )
  }

  const concepts = state.data.data?.concepts || []
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <strong>Class knowledge gaps</strong>
        <div className="small muted" style={{ marginTop: 4 }}>
          Cohort-only academic patterns. Student evidence and preferences are never shown here.
        </div>
      </div>
      {concepts.length === 0 ? (
        <EmptyState icon="◫" title="No eligible patterns yet" hint="Concepts appear after five or more learners have evidence." />
      ) : concepts
        .slice()
        .sort((a, b) => b.averageGapScore - a.averageGapScore)
        .map((concept) => (
          <div key={concept.conceptId} className="spread" style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', gap: 18 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{concept.conceptId}</div>
              <div className="small muted">{concept.coveredStudentCount} learners in aggregate</div>
            </div>
            <div style={{ minWidth: 135, textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>{Math.round(concept.averageGapScore * 100)}% gap</div>
              <div className="small muted">{Math.round(concept.averageMastery * 100)}% mastery</div>
            </div>
          </div>
        ))}
      <div className="small muted" style={{ padding: '10px 18px' }}>
        Privacy gate {state.data.provenance.gateVersion}
      </div>
    </div>
  )
}

export default function PeopleTab({ classroom, isTeacher }) {
  const toast = useToast()
  const [roster, setRoster] = useState(null)
  const [pending, setPending] = useState([])

  const load = async () => {
    if (!isTeacher) {
      setRoster([])
      return
    }
    try {
      const [r, p] = await Promise.all([
        api.get(`/lms/classrooms/${classroom.id}/students`),
        api.get(`/lms/classrooms/${classroom.id}/enrollments/pending`).catch(() => ({ pending: [] })),
      ])
      setRoster(r.students || [])
      setPending(p.pending || [])
    } catch (e) {
      toast.error(e.message)
      setRoster([])
    }
  }
  useEffect(() => {
    load() // eslint-disable-next-line
  }, [classroom.id])

  const act = async (studentId, action) => {
    try {
      if (action === 'remove') await api.del(`/lms/classrooms/${classroom.id}/students/${studentId}`)
      else await api.post(`/lms/classrooms/${classroom.id}/enrollments/${studentId}/${action}`)
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  if (!isTeacher) {
    return (
      <div className="card card-pad" style={{ maxWidth: 620 }}>
        <div className="row" style={{ gap: 12 }}>
          <Avatar name="Teacher" id={classroom.teacherId} />
          <div>
            <div style={{ fontWeight: 600 }}>Class teacher</div>
            <div className="small muted">You’re an enrolled member of this class.</div>
          </div>
        </div>
      </div>
    )
  }

  if (roster === null) return <Loading />

  return (
    <div style={{ maxWidth: 720 }}>
      <ClassKnowledgeGaps classroomId={classroom.id} />
      {pending.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 18, borderColor: 'color-mix(in srgb, var(--amber-500) 40%, var(--border))' }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>⏳ Pending requests ({pending.length})</div>
          {pending.map((s) => (
            <div key={s.studentId} className="spread" style={{ padding: '8px 0' }}>
              <div className="row" style={{ gap: 10 }}><Avatar name={s.studentName} id={s.studentId} size="sm" /><span className="small">{s.studentName || s.studentId}</span></div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => act(s.studentId, 'approve')}>Approve</button>
                <button className="btn btn-ghost btn-sm" onClick={() => act(s.studentId, 'reject')}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="spread" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <strong>Students</strong>
          <span className="badge">{roster.length}</span>
        </div>
        {roster.length === 0 ? (
          <EmptyState icon="👥" title="No students yet" hint={`Share the join code “${classroom.joinCode}” with your class.`} />
        ) : (
          roster.map((s) => (
            <div key={s.studentId} className="spread" style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 12 }}>
                <Avatar name={s.studentName} id={s.studentId} size="sm" />
                <span>{s.studentName || s.studentId}</span>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => act(s.studentId, 'remove')}>Remove</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
