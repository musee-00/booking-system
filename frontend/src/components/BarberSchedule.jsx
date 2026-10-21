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

// API list -> { weekday: [{ start, end }, ...] } for the five shop days.
const toWeek = (blocks) => Object.fromEntries(
  SHOP_DAYS.map(({ weekday }) => [
    weekday,
    blocks
      .filter((block) => block.weekday === weekday)
      .map((block) => ({ start: toHHMM(block.start_time), end: toHHMM(block.end_time) }))
      .sort((a, b) => a.start.localeCompare(b.start)),
  ]),
)

// { weekday: [...] } -> the flat list the API expects.
const toBlocks = (week) => SHOP_DAYS.flatMap(({ weekday }) => (
  week[weekday].map((block) => ({ weekday, start_time: block.start, end_time: block.end }))
))

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

const EMPTY_TIME_OFF = { wholeDays: true, fromDate: '', toDate: '', date: '', fromTime: '12:00', toTime: '13:00', reason: '' }

export function BarberSchedule({ barber, adminFetch, onClose }) {
  const [week, setWeek] = useState(null)
  const [timeOff, setTimeOff] = useState([])
  const [loadError, setLoadError] = useState('')
  const [hoursMessage, setHoursMessage] = useState({ type: '', text: '' })
  const [isSavingHours, setIsSavingHours] = useState(false)
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

  const updateDay = (weekday, blocks) => {
    setWeek((current) => ({ ...current, [weekday]: blocks }))
    setHoursMessage({ type: '', text: '' })
  }

  const toggleDay = (weekday) => {
    updateDay(weekday, week[weekday].length ? [] : [{ start: OPENS, end: CLOSES }])
  }

  const updateBlock = (weekday, index, field, value) => {
    updateDay(weekday, week[weekday].map((block, i) => (i === index ? { ...block, [field]: value } : block)))
  }

  // A lunch break = two blocks. Default to 12:00-13:00, adjustable afterwards.
  const addBreak = (weekday) => {
    const [block] = week[weekday]
    const breakStart = block.start < '12:00' && block.end > '13:00' ? '12:00' : TIME_OPTIONS[TIME_OPTIONS.indexOf(block.start) + 2]
    const breakEnd = TIME_OPTIONS[TIME_OPTIONS.indexOf(breakStart) + 2]
    if (!breakStart || !breakEnd || breakEnd >= block.end) {
      setHoursMessage({ type: 'error', text: 'This day is too short to add a break.' })
      return
    }
    updateDay(weekday, [{ start: block.start, end: breakStart }, { start: breakEnd, end: block.end }])
  }

  const removeBreak = (weekday) => {
    const blocks = week[weekday]
    updateDay(weekday, [{ start: blocks[0].start, end: blocks[blocks.length - 1].end }])
  }

  const saveHours = async () => {
    setIsSavingHours(true)
    setHoursMessage({ type: '', text: '' })
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
      setWeek(toWeek(data))
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
          <p className="admin-schedule__hint">The shop is open Tue–Sat 09:00–18:00. Untick a day the barber doesn't work.</p>

          <div className="admin-schedule__days">
            {SHOP_DAYS.map(({ weekday, label }) => {
              const blocks = week[weekday]
              const works = blocks.length > 0
              return (
                <div key={weekday} className={`admin-schedule__day ${works ? '' : 'is-off'}`}>
                  <label className="admin-schedule__check">
                    <input type="checkbox" checked={works} onChange={() => toggleDay(weekday)} />
                    {label}
                  </label>

                  {works ? (
                    <div className="admin-schedule__blocks">
                      {blocks.map((block, index) => (
                        <span key={index} className="admin-schedule__block">
                          {index > 0 && <span className="admin-schedule__break">break</span>}
                          {timeSelect(block.start, (value) => updateBlock(weekday, index, 'start', value), `${label} start ${index + 1}`)}
                          –
                          {timeSelect(block.end, (value) => updateBlock(weekday, index, 'end', value), `${label} end ${index + 1}`)}
                        </span>
                      ))}
                      {blocks.length === 1
                        ? <button type="button" className="admin-link-button" onClick={() => addBreak(weekday)}>+ Add break</button>
                        : <button type="button" className="admin-link-button" onClick={() => removeBreak(weekday)}>Remove break</button>}
                    </div>
                  ) : (
                    <span className="admin-schedule__hint">Day off</span>
                  )}
                </div>
              )
            })}
          </div>

          {hoursMessage.text && <p className={`admin-status-message ${hoursMessage.type}`} role="status">{hoursMessage.text}</p>}
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

            {conflicts.length > 0 && (
              <div className="admin-status-message error admin-schedule__wide" role="alert">
                <strong>
                  {conflicts.length === 1 ? '1 customer is' : `${conflicts.length} customers are`} already booked in this time.
                </strong>{' '}
                Their bookings were not cancelled. Contact them to move or cancel:
                <ul>
                  {conflicts.map((appointment) => (
                    <li key={appointment.id}>
                      {formatDateTime(appointment.starts_at)} · {appointment.customer_name} · {appointment.customer_phone}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="admin-panel-actions admin-schedule__wide">
              <button type="submit" className="admin-primary-button">Add time off</button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
