import { useMemo, useState } from 'react'
import type { CalendarResponse } from '../../shared/types/lms'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

const isoDay = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Month grid marking days that carry deadlines.
 *
 * The LMS calendar is a view over coursework due dates (`calendar_view.py`), so
 * a dot means "work is due", not "an event exists". Selecting a day filters the
 * deadline list beside it rather than opening a separate view.
 */
export function CalendarMini({
  calendar,
  selectedDate,
  onSelectDate,
}: {
  calendar: CalendarResponse | null
  selectedDate: string | null
  onSelectDate: (date: string | null) => void
}): JSX.Element {
  const [monthOffset, setMonthOffset] = useState(0)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const day of calendar?.days ?? []) map.set(day.date, day.events.length)
    return map
  }, [calendar])

  const { cells, label } = useMemo(() => {
    const anchor = new Date()
    anchor.setDate(1)
    anchor.setMonth(anchor.getMonth() + monthOffset)

    const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    const firstWeekday = anchor.getDay()
    const start = new Date(anchor)
    start.setDate(start.getDate() - firstWeekday)

    // Six rows always, so the grid never reflows when the month changes.
    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      return {
        key: isoDay(date),
        dayOfMonth: date.getDate(),
        inMonth: date.getMonth() === anchor.getMonth(),
        isToday: isoDay(date) === isoDay(new Date()),
      }
    })

    return { cells: days, label: monthLabel }
  }, [monthOffset])

  return (
    <div>
      <div className="spread" style={{ marginBottom: 10 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setMonthOffset((offset) => offset - 1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <strong style={{ fontSize: 13.5 }}>{label}</strong>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setMonthOffset((offset) => offset + 1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="cal-mini">
        {DOW.map((day, index) => (
          <div className="cal-dow" key={`${day}-${index}`} aria-hidden="true">
            {day}
          </div>
        ))}

        {cells.map((cell) => {
          const count = counts.get(cell.key) ?? 0
          const selected = selectedDate === cell.key
          const classes = [
            'cal-cell',
            cell.inMonth ? '' : 'cal-cell-muted',
            cell.isToday ? 'cal-cell-today' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <button
              key={cell.key}
              className={classes}
              aria-pressed={selected}
              aria-label={`${cell.key}${count ? `, ${count} due` : ', nothing due'}`}
              onClick={() => onSelectDate(selected ? null : cell.key)}
            >
              <span>{cell.dayOfMonth}</span>
              {count > 0 && <span className="cal-dot" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
