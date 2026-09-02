import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, Loading } from '../../../components/ui'
import { fmtDate, fmtDateTime } from '../../../lib/format'
import { CalendarMini } from '../../dashboard/components/CalendarMini'
import { DashboardCard } from '../../shared/components/DashboardCard'
import { CapabilityNotice } from '../../shared/components/CapabilityNotice'
import { CAPABILITIES } from '../../shared/services/capability'
import type { CourseworkType } from '../../shared/types/lms'
import { useCalendarRange } from '../hooks/useCalendarRange'

const ICON: Readonly<Record<CourseworkType, string>> = {
  assignment: '📝',
  quiz: '🧪',
  question: '❓',
  material: '📎',
}

/**
 * Calendar.
 *
 * The LMS calendar is a *view* over published coursework due dates
 * (`calendar_view.py`) — there is no separate event store, and non-gradeable
 * material is excluded by the service. So this shows deadlines, honestly
 * labelled as such, with the missing timetable and event models declared rather
 * than mocked up as empty week grids.
 */
export default function CalendarPage(): JSX.Element {
  const calendar = useCalendarRange()
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const days = useMemo(() => {
    const all = calendar.query.data?.days ?? []
    return selectedDate ? all.filter((day) => day.date === selectedDate) : all
  }, [calendar.query.data, selectedDate])

  const total = calendar.query.data?.total ?? 0

  return (
    <div>
      <header className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="page-sub">
            Every published due date across your classes. Setting a due date is what schedules work.
          </div>
        </div>

        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={calendar.previous} aria-label="Previous month">
            ‹
          </button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{calendar.range.label}</strong>
          <button className="btn btn-ghost btn-sm" onClick={calendar.next} aria-label="Next month">
            ›
          </button>
          {!calendar.isCurrentMonth && (
            <button className="btn btn-outline btn-sm" onClick={calendar.today}>
              Today
            </button>
          )}
        </div>
      </header>

      <div className="cc-grid">
        <div className="cc-span-4">
          <DashboardCard
            title={calendar.range.label}
            icon="📆"
            subtitle={`${total} deadline${total === 1 ? '' : 's'} this month`}
            status={calendar.query.status}
            error={calendar.query.error}
            refreshing={calendar.query.refreshing}
            onRetry={() => void calendar.query.refetch()}
            footer={<CapabilityNotice capability={CAPABILITIES['lms.timetable']} compact />}
          >
            <CalendarMini
              calendar={calendar.query.data}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          </DashboardCard>
        </div>

        <div className="cc-span-8">
          <DashboardCard
            title={selectedDate ? fmtDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' }) : 'All deadlines'}
            icon="⏳"
            subtitle={selectedDate ? 'Selected day' : calendar.range.label}
            status={calendar.query.status}
            error={calendar.query.error}
            refreshing={calendar.query.refreshing}
            onRetry={() => void calendar.query.refetch()}
            isEmpty={days.length === 0}
            emptyIcon="🌱"
            emptyTitle={selectedDate ? 'Nothing due that day' : 'Nothing due this month'}
            emptyHint="Due dates from published coursework appear here automatically."
            action={
              selectedDate ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDate(null)}>
                  Show whole month
                </button>
              ) : null
            }
          >
            {calendar.query.status === 'loading' ? (
              <Loading />
            ) : (
              <div className="col" style={{ gap: 18 }}>
                {days.map((day) => (
                  <div key={day.date}>
                    <div className="row" style={{ gap: 9, marginBottom: 8 }}>
                      <strong style={{ fontSize: 14 }}>
                        {fmtDate(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}
                      </strong>
                      <Badge>{day.events.length}</Badge>
                    </div>

                    <div className="col" style={{ gap: 4 }}>
                      {day.events.map((event) => (
                        <Link
                          key={event.courseworkId}
                          className="cc-row"
                          to={`/classes/${event.classroomId}/work/${event.courseworkId}`}
                        >
                          <span aria-hidden="true" style={{ fontSize: 17 }}>
                            {ICON[event.type] ?? '📝'}
                          </span>
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="cc-row-title">{event.title}</div>
                            <div className="cc-row-meta">
                              {event.classroomName ?? 'Class'}
                              {event.maxPoints !== null ? ` · ${event.maxPoints} points` : ''}
                            </div>
                          </div>
                          <Badge tone="primary">{fmtDateTime(event.dueAt)}</Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DashboardCard>
        </div>
      </div>

      {calendar.query.status === 'success' && total === 0 && !selectedDate && (
        <div style={{ marginTop: 18 }}>
          <EmptyState
            icon="📅"
            title="Nothing scheduled this month"
            hint="Create an assignment with a due date and it will appear here."
            action={
              <Link className="btn btn-primary btn-sm" to="/dashboard?action=create-assignment">
                Create assignment
              </Link>
            }
          />
        </div>
      )}
    </div>
  )
}
