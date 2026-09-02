import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { EmptyState, Loading, useToast } from '../../components/ui.jsx'

function cellColor(cell, maxPoints) {
  if (!cell || cell.score == null) return {}
  if (!maxPoints) return {}
  const pct = cell.score / maxPoints
  if (pct >= 0.8) return { color: 'var(--emerald-600)', fontWeight: 700 }
  if (pct >= 0.5) return { color: 'var(--amber-500)', fontWeight: 700 }
  return { color: 'var(--rose-500)', fontWeight: 700 }
}

export default function GradesTab({ classroom }) {
  const toast = useToast()
  const [book, setBook] = useState(null)

  useEffect(() => {
    ;(async () => {
      try {
        setBook(await api.get(`/lms/classrooms/${classroom.id}/gradebook`))
      } catch (e) {
        toast.error(e.message)
      }
    })() // eslint-disable-next-line
  }, [classroom.id])

  if (!book) return <Loading />
  if (!book.columns.length || !book.rows.length) {
    return <EmptyState icon="📊" title="Nothing to grade yet" hint="Publish gradeable coursework and collect submissions to build the gradebook." />
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="card card-pad" style={{ padding: '10px 16px' }}><div className="tiny faint">Class average</div><div style={{ fontSize: 22, fontWeight: 800 }}>{book.classAveragePercent != null ? `${book.classAveragePercent}%` : '—'}</div></div>
          <div className="card card-pad" style={{ padding: '10px 16px' }}><div className="tiny faint">Students</div><div style={{ fontSize: 22, fontWeight: 800 }}>{book.studentCount}</div></div>
        </div>
        <a className="btn btn-outline" href={`/api/lms/classrooms/${classroom.id}/gradebook.csv`}>⬇ Export CSV</a>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '12px 16px', position: 'sticky', left: 0, background: 'var(--surface)', borderBottom: '1px solid var(--border)', minWidth: 160 }}>Student</th>
              {book.columns.map((c) => (
                <th key={c.courseworkId} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', textAlign: 'center', fontSize: 13, whiteSpace: 'nowrap' }}>
                  <div>{c.title}</div>
                  <div className="tiny faint" style={{ fontWeight: 500 }}>/ {c.maxPoints ?? '—'}</div>
                </th>
              ))}
              <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Avg</th>
            </tr>
          </thead>
          <tbody>
            {book.rows.map((r) => (
              <tr key={r.studentId}>
                <td style={{ padding: '12px 16px', position: 'sticky', left: 0, background: 'var(--surface)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{r.studentName}</td>
                {book.columns.map((c) => {
                  const cell = r.cells[c.courseworkId]
                  return (
                    <td key={c.courseworkId} style={{ padding: '12px 14px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                      {cell && cell.score != null ? (
                        <span style={cellColor(cell, c.maxPoints)}>{cell.score}</span>
                      ) : cell && cell.status === 'turned_in' ? (
                        <span className="tiny badge badge-primary">turned in</span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  )
                })}
                <td style={{ padding: '12px 16px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontWeight: 800 }}>{r.averagePercent != null ? `${r.averagePercent}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
