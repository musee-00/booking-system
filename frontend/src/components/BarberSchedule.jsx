import { useCallback, useEffect, useState } from 'react'
import { NETWORK_ERROR, getErrorMessage } from '../api.js'

// Shop days and hours, matching backend/app/schedule.py.
// Weekdays use Python's numbering (Monday = 0), like the API.
const SHOP_DAYS = [
  { weekday: 1, label: 'Tuesday' },
  { weekday: 2, label: 'Wednesday' },
  { weekday: 3, label: 'Thursday' },
  { weekday: 4, label: 'Friday' },
  { weekday: 5, label: 'Saturday' },
]
const OPENS = '09:00'
const CLOSES = '18:00'

// Every half hour from 09:00 to 18:00. Using a dropdown means only times the
// API accepts can be picked.
const TIME_OPTIONS = Array.from({ length: 19 }, (_, index) => {
  const minutes = 9 * 60 + index * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

const toHHMM = (value) => value.slice(0, 5) // "09:00:00" -> "09:00"

// The editor works with how a barber thinks about a day: "I work 09-18 with a
// break 13-14". The API stores working blocks instead (09-13 and 14-18), so we
// convert in both directions.
const DAY_OFF = { works: false, start: OPENS, end: CLOSES, hasBreak: false, breakStart: '12:00', breakEnd: '13:00' }

// API blocks -> { weekday: { works, start, end, hasBreak, breakStart, breakEnd } }
const toWeek = (blocks) => Object.fromEntries(
  SHOP_DAYS.map(({ weekday }) => {
    const day = blocks
      .filter((block) => block.weekday === weekday)
      .map((block) => ({ start: toHHMM(block.start_time), end: toHHMM(block.end_time) }))
      .sort((a, b) => a.start.localeCompare(b.start))
    if (day.length === 0) return [weekday, { ...DAY_OFF }]

    const first = day[0]
    const last = day[day.length - 1]
    return [weekday, {
      works: true,
      start: first.start,
      end: last.end,
      // The editor supports one break per day: the gap between the first two blocks.
      hasBreak: day.length > 1,
      breakStart: day.length > 1 ? first.end : DAY_OFF.breakStart,
      breakEnd: day.length > 1 ? day[1].start : DAY_OFF.breakEnd,
    }]
  }),
)

// { weekday: day } -> the flat list of working blocks the API expects.
const toBlocks = (week) => SHOP_DAYS.flatMap(({ weekday }) => {
  const day = week[weekday]
  if (!day.works) return []
  if (!day.hasBreak) return [{ weekday, start_time: day.start, end_time: day.end }]
  return [
    { weekday, start_time: day.start, end_time: day.breakStart },
    { weekday, start_time: day.breakEnd, end_time: day.end },
  ]
})

// Check before sending, with messages in the editor's own terms (the API would
// only know about blocks).
const findDayProblems = (week) => SHOP_DAYS.flatMap(({ weekday, label }) => {
  const day = week[weekday]
  if (!day.works) return []
  if (day.end <= day.start) return [`${label}: the working day must end after it starts.`]
  if (!day.hasBreak) return []
  if (day.breakEnd <= day.breakStart) return [`${label}: the break must end after it starts.`]
  if (day.breakStart <= day.start || day.breakEnd >= day.end) {
    return [`${label}: the break (${day.breakStart}–${day.breakEnd}) must be inside the working day (${day.start}–${day.end}).`]
  }
  return []
})

const formatDateTime = (value) => new Date(value).toLocaleString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

const formatDate = (value) => new Date(value).toLocaleDateString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short',
})

// "Whole days" time off: from the start of the first day to the start of the
// day after the last one, so a single day off is e.g. Fri 00:00 -> Sat 00:00.
const nextDay = (isoDate) => {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const describeTimeOff = (item) => {
  const start = new Date(item.starts_at)
  const end = new Date(item.ends_at)
  const isWholeDays = start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() === 0 && end.getMinutes() === 0
  if (!isWholeDays) return `${formatDateTime(item.starts_at)} – ${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`

  const lastDay = new Date(end.getTime() - 1)
  return start.toDateString() === lastDay.toDateString()
    ? `${formatDate(start)} (all day)`
    : `${formatDate(start)} – ${formatDate(lastDay)}`
}

// Existing bookings that clash with new hours or new time off. They're never
// cancelled automatically; the barber decides what to do.
function ConflictList({ appointments, reason }) {
  if (!appointments.length) return null
  return (
    <div className="admin-status-message error admin-schedule__wide" role="alert">
      <strong>
        {appointments.length === 1 ? '1 customer is' : `${appointments.length} customers are`} already booked {reason}.
      </strong>{' '}
      Their bookings were not cancelled. Contact them to move or cancel:
      <ul>
        {appointments.map((appointment) => (
          <li key={appointment.id}>
            {formatDateTime(appointment.starts_at)} · {appointment.customer_name} · {appointment.customer_phone}
          </li>
        ))}
      </ul>
    </div>
  )
}

const EMPTY_TIME_OFF = { wholeDays: true, fromDate: '', toDate: '', date: '', fromTime: '12:00', toTime: '13:00', reason: '' }

export function BarberSchedule({ barber, adminFetch, onClose }) {
  const [week, setWeek] = useState(null)
  const [timeOff, setTimeOff] = useState([])
  const [loadError, setLoadError] = useState('')
  const [hoursMessage, setHoursMessage] = useState({ type: '', text: '' })
  const [isSavingHours, setIsSavingHours] = useState(false)
  const [hoursConflicts, setHoursConflicts] = useState([])
  const [timeOffForm, setTimeOffForm] = useState(EMPTY_TIME_OFF)
  const [timeOffMessage, setTimeOffMessage] = useState({ type: '', text: '' })
  const [conflicts, setConflicts] = useState([])

  const basePath = `/barbers/${barber.id}`

  const fetchSchedule = useCallback(async () => {
    const [hours, absences] = await Promise.all([
      adminFetch(`${basePath}/working-hours`),
      adminFetch(`${basePath}/time-off`),
    ])
    if (hours.response.status === 401 || absences.response.status === 401) return null
    if (!hours.response.ok || !absences.response.ok) throw new Error('Load failed')
    return { week: toWeek(hours.data), timeOff: absences.data }
  }, [adminFetch, basePath])

  useEffect(() => {
    let ignore = false
    fetchSchedule()
      .then((schedule) => {
        if (ignore || !schedule) return
        setWeek(schedule.week)
        setTimeOff(schedule.timeOff)
      })
      .catch(() => {
        if (!ignore) setLoadError(NETWORK_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [fetchSchedule])

  // ---- Weekly hours -----------------------------------------------------------

  const updateDay = (weekday, changes) => {
    setWeek((current) => ({ ...current, [weekday]: { ...current[weekday], ...changes } }))
    setHoursMessage({ type: '', text: '' })
  }

  const toggleDay = (weekday) => updateDay(weekday, { works: !week[weekday].works })

  // Default break 12:00-13:00 when it fits, otherwise the middle hour of the day.
  const addBreak = (weekday) => {
    const day = week[weekday]
    if (day.start < '12:00' && day.end > '13:00') {
      updateDay(weekday, { hasBreak: true, breakStart: '12:00', breakEnd: '13:00' })
      return
    }
    const startIndex = TIME_OPTIONS.indexOf(day.start)
    const endIndex = TIME_OPTIONS.indexOf(day.end)
    if (endIndex - startIndex < 4) {
      setHoursMessage({ type: 'error', text: 'This day is too short to add a break.' })
      return
    }
    const middle = Math.floor((startIndex + endIndex) / 2) - 1
    updateDay(weekday, { hasBreak: true, breakStart: TIME_OPTIONS[middle], breakEnd: TIME_OPTIONS[middle + 2] })
  }

  const removeBreak = (weekday) => updateDay(weekday, { hasBreak: false })

  const saveHours = async () => {
    const problems = findDayProblems(week)
    if (problems.length) {
      setHoursMessage({ type: 'error', text: problems.join(' ') })
      return
    }

    setIsSavingHours(true)
    setHoursMessage({ type: '', text: '' })
    setHoursConflicts([])
    try {
      const { response, data } = await adminFetch(`${basePath}/working-hours`, {
        method: 'PUT',
        body: JSON.stringify(toBlocks(week)),
      })
      if (response.status === 401) return
      if (!response.ok) {
        setHoursMessage({ type: 'error', text: getErrorMessage(data, 'Could not save the hours.') })
        return
      }
      setWeek(toWeek(data.working_hours))
      setHoursConflicts(data.conflicting_appointments)
      setHoursMessage({ type: 'success', text: 'Working hours saved. Customers now only see these times.' })
    } catch {
      setHoursMessage({ type: 'error', text: NETWORK_ERROR })
    } finally {
      setIsSavingHours(false)
    }
  }

  // ---- Time off -----------------------------------------------------------------

  const updateTimeOffField = (field, value) => {
    setTimeOffForm((current) => ({ ...current, [field]: value }))
    setTimeOffMessage({ type: '', text: '' })
  }

  const reloadTimeOff = async () => {
    const { response, data } = await adminFetch(`${basePath}/time-off`)
    if (response.ok) setTimeOff(data)
  }

  const addTimeOff = async (event) => {
    event.preventDefault()
    const form = timeOffForm
    const payload = form.wholeDays
      ? { starts_at: `${form.fromDate}T00:00:00`, ends_at: `${nextDay(form.toDate || form.fromDate)}T00:00:00` }
      : { starts_at: `${form.date}T${form.fromTime}:00`, ends_at: `${form.date}T${form.toTime}:00` }

    setConflicts([])
    try {
      const { response, data } = await adminFetch(`${basePath}/time-off`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, reason: form.reason.trim() || null }),
      })
      if (response.status === 401) return
      if (!response.ok) {
        setTimeOffMessage({ type: 'error', text: getErrorMessage(data, 'Could not add the time off.') })
        return
      }
      setTimeOffForm(EMPTY_TIME_OFF)
      setConflicts(data.conflicting_appointments)
      setTimeOffMessage({ type: 'success', text: `Time off added: ${describeTimeOff(data.time_off)}.` })
      reloadTimeOff()
    } catch {
      setTimeOffMessage({ type: 'error', text: NETWORK_ERROR })
    }
  }

  const removeTimeOff = async (item) => {
    if (!window.confirm(`Remove time off ${describeTimeOff(item)}? Customers will be able to book this time again.`)) return
    try {
      const { response, data } = await adminFetch(`${basePath}/time-off/${item.id}`, { method: 'DELETE' })
      if (response.status === 401) return
      if (!response.ok) {
        setTimeOffMessage({ type: 'error', text: getErrorMessage(data, 'Could not remove the time off.') })
        return
      }
      setTimeOffMessage({ type: 'success', text: 'Time off removed.' })
      setConflicts([])
      reloadTimeOff()
    } catch {
      setTimeOffMessage({ type: 'error', text: NETWORK_ERROR })
    }
  }

  const timeSelect = (value, onChange, label) => (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
      {TIME_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  )

  // ---- Render -----------------------------------------------------------------------

  return (
    <section className="admin-schedule" aria-label={`Hours and time off for ${barber.name}`}>
      <div className="admin-schedule__header">
        <h3>Hours &amp; time off · {barber.name}</h3>
        <button type="button" className="admin-secondary-button" onClick={onClose}>Close</button>
      </div>

      {loadError && <p className="admin-status-message error" role="alert">{loadError}</p>}
      {!week && !loadError && <p className="admin-schedule__hint">Loading…</p>}

      {week && (
        <>
          <h4>Weekly hours</h4>
          <p className="admin-schedule__hint">The shop is open Tue–Sat 09:00–18:00. Set when the barber works and, if they take one, when their break is. Customers can't book during a break. Untick a day the barber doesn't work.</p>

          <div className="admin-schedule__days">
            {SHOP_DAYS.map(({ weekday, label }) => {
              const day = week[weekday]
              return (
                <div key={weekday} className={`admin-schedule__day ${day.works ? '' : 'is-off'}`}>
                  <label className="admin-schedule__check">
                    <input type="checkbox" checked={day.works} onChange={() => toggleDay(weekday)} />
                    {label}
                  </label>

                  {day.works ? (
                    <div className="admin-schedule__blocks">
                      <span className="admin-schedule__block">
                        <span className="admin-schedule__label">Works</span>
                        {timeSelect(day.start, (value) => updateDay(weekday, { start: value }), `${label} starts`)}
                        –
                        {timeSelect(day.end, (value) => updateDay(weekday, { end: value }), `${label} ends`)}
                      </span>

                      {day.hasBreak ? (
                        <span className="admin-schedule__block">
                          <span className="admin-schedule__label">Break</span>
                          {timeSelect(day.breakStart, (value) => updateDay(weekday, { breakStart: value }), `${label} break starts`)}
                          –
                          {timeSelect(day.breakEnd, (value) => updateDay(weekday, { breakEnd: value }), `${label} break ends`)}
                          <button type="button" className="admin-link-button" onClick={() => removeBreak(weekday)}>Remove break</button>
                        </span>
                      ) : (
                        <button type="button" className="admin-link-button" onClick={() => addBreak(weekday)}>+ Add break</button>
                      )}
                    </div>
                  ) : (
                    <span className="admin-schedule__hint">Day off</span>
                  )}
                </div>
              )
            })}
          </div>

          {hoursMessage.text && <p className={`admin-status-message ${hoursMessage.type}`} role="status">{hoursMessage.text}</p>}
          <ConflictList appointments={hoursConflicts} reason="at times outside these hours" />
          <div className="admin-panel-actions">
            <button type="button" className="admin-primary-button" onClick={saveHours} disabled={isSavingHours}>
              {isSavingHours ? 'Saving…' : 'Save hours'}
            </button>
          </div>

          <h4>Time off</h4>
          {timeOff.length === 0 ? (
            <p className="admin-schedule__hint">No upcoming time off.</p>
          ) : (
            <ul className="admin-schedule__timeoff">
              {timeOff.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{describeTimeOff(item)}</strong>
                    {item.reason && <small> · {item.reason}</small>}
                  </span>
                  <button type="button" className="admin-link-button" onClick={() => removeTimeOff(item)}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          <form className="admin-booking-form admin-schedule__form" onSubmit={addTimeOff}>
            <label className="admin-schedule__check admin-schedule__wide">
              <input
                type="checkbox"
                checked={timeOffForm.wholeDays}
                onChange={(event) => updateTimeOffField('wholeDays', event.target.checked)}
              />
              Whole days
            </label>

            {timeOffForm.wholeDays ? (
              <>
                <label>
                  From
                  <input type="date" required value={timeOffForm.fromDate} onChange={(event) => updateTimeOffField('fromDate', event.target.value)} />
                </label>
                <label>
                  To (last day off)
                  <input
                    type="date"
                    min={timeOffForm.fromDate || undefined}
                    value={timeOffForm.toDate}
                    onChange={(event) => updateTimeOffField('toDate', event.target.value)}
                    placeholder="Same day"
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Date
                  <input type="date" required value={timeOffForm.date} onChange={(event) => updateTimeOffField('date', event.target.value)} />
                </label>
                <label>
                  From – to
                  <span className="admin-schedule__block">
                    {timeSelect(timeOffForm.fromTime, (value) => updateTimeOffField('fromTime', value), 'Time off from')}
                    –
                    {timeSelect(timeOffForm.toTime, (value) => updateTimeOffField('toTime', value), 'Time off to')}
                  </span>
                </label>
              </>
            )}

            <label className="admin-schedule__wide">
              Reason (optional, only visible to staff)
              <input
                type="text"
                maxLength={200}
                placeholder="Holiday, dentist, course…"
                value={timeOffForm.reason}
                onChange={(event) => updateTimeOffField('reason', event.target.value)}
              />
            </label>

            {timeOffMessage.text && (
              <p className={`admin-status-message ${timeOffMessage.type} admin-schedule__wide`} role="status">{timeOffMessage.text}</p>
            )}

            <ConflictList appointments={conflicts} reason="in this time" />

            <div className="admin-panel-actions admin-schedule__wide">
              <button type="submit" className="admin-primary-button">Add time off</button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
