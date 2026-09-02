import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { Badge, EmptyState, Loading, Modal, useToast } from '../../components/ui.jsx'
import { dueLabel, fmtDate } from '../../lib/format'

const TYPE_ICON = { assignment: '📝', quiz: '❓', question: '💬', material: '📎' }

function statusBadge(sub) {
  if (!sub) return <Badge tone="default">Assigned</Badge>
  if (sub.status === 'returned') return <Badge tone="success">Graded{sub.grade != null ? ` · ${sub.grade}` : ''}</Badge>
  if (sub.status === 'turned_in') return <Badge tone="primary">Turned in</Badge>
  return <Badge>{sub.status}</Badge>
}

export default function ClassworkTab({ classroom, isTeacher }) {
  const nav = useNavigate()
  const toast = useToast()
  const [items, setItems] = useState(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ type: 'assignment' })
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const path = isTeacher ? `/lms/classrooms/${classroom.id}/coursework` : `/lms/student/classrooms/${classroom.id}/coursework`
    try {
      const data = await api.get(path)
      setItems(data.coursework || [])
    } catch (e) {
      toast.error(e.message)
      setItems([])
    }
  }
  useEffect(() => {
    load() // eslint-disable-next-line
  }, [classroom.id])

  const create = async () => {
    if (!form.title) return toast.error('Title is required')
    setBusy(true)
    try {
      const payload = { title: form.title, type: form.type, description: form.description || null }
      if (form.maxPoints) payload.maxPoints = Number(form.maxPoints)
      if (form.dueAt) payload.dueAt = new Date(form.dueAt).toISOString()
      await api.post(`/lms/classrooms/${classroom.id}/coursework`, payload)
      toast.success('Coursework created as draft')
      setShow(false)
      setForm({ type: 'assignment' })
      load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const publish = async (cw, e) => {
    e.stopPropagation()
    try {
      await api.post(`/lms/coursework/${cw.id}/publish`)
      toast.success('Published')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      {isTeacher && (
        <div className="spread" style={{ marginBottom: 16 }}>
          <p className="muted small">Assignments, quizzes and materials for this class.</p>
          <button className="btn btn-primary" onClick={() => setShow(true)}>＋ Create</button>
        </div>
      )}

      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState icon="📚" title="No classwork yet" hint={isTeacher ? 'Create an assignment, quiz or material.' : 'Nothing has been assigned yet.'} />
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {items.map((cw) => {
            const due = dueLabel(cw.dueAt)
            return (
              <div key={cw.id} className="card card-pad card-hover" style={{ cursor: 'pointer' }} onClick={() => nav(`/classes/${classroom.id}/work/${cw.id}`)}>
                <div className="spread">
                  <div className="row" style={{ gap: 14 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--primary-soft)', display: 'grid', placeItems: 'center', fontSize: 20 }}>{TYPE_ICON[cw.type] || '📝'}</div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{cw.title}</div>
                      <div className="row small muted" style={{ gap: 10, marginTop: 3 }}>
                        <span style={{ textTransform: 'capitalize' }}>{cw.type}</span>
                        {cw.maxPoints != null && <span>· {cw.maxPoints} pts</span>}
                        {cw.dueAt && <span>· Due {fmtDate(cw.dueAt)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    {isTeacher ? (
                      <>
                        {cw.status === 'draft' ? (
                          <>
                            <Badge tone="warn">Draft</Badge>
                            <button className="btn btn-primary btn-sm" onClick={(e) => publish(cw, e)}>Publish</button>
                          </>
                        ) : (
                          <span className="small muted">{cw.submissionStats?.turnedIn ?? 0} turned in · {cw.submissionStats?.graded ?? 0} graded</span>
                        )}
                      </>
                    ) : (
                      <>
                        {due && cw.type !== 'material' && <Badge tone={due.tone}>{due.text}</Badge>}
                        {statusBadge(cw.mySubmission)}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={show}
        onClose={() => setShow(false)}
        title="Create classwork"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={create} disabled={busy}>Create draft</button>
          </>
        }
      >
        <div className="col" style={{ gap: 14 }}>
          <div className="field"><label>Title *</label><input className="input" placeholder="Photosynthesis worksheet" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="row" style={{ gap: 14 }}>
            <div className="field grow"><label>Type</label>
              <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="assignment">Assignment</option>
                <option value="quiz">Quiz</option>
                <option value="question">Question</option>
                <option value="material">Material</option>
              </select>
            </div>
            <div className="field grow"><label>Max points</label><input className="input" type="number" min="0" placeholder="10" value={form.maxPoints || ''} onChange={(e) => setForm({ ...form, maxPoints: e.target.value })} /></div>
          </div>
          <div className="field"><label>Due date</label><input className="input" type="datetime-local" value={form.dueAt || ''} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></div>
          <div className="field"><label>Instructions</label><textarea className="textarea" placeholder="Describe the task…" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  )
}
