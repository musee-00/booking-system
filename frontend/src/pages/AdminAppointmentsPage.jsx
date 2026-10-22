import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_BASE, NETWORK_ERROR, clearSession, fetchJson, getSession, useAdminFetch } from '../api.js'
import { SHOP } from '../shop.js'
import { ThemeToggle } from '../components/ThemeToggle.jsx'
const OPENING_HOUR = 9
const CLOSING_HOUR = 18
const SLOT_MINUTES = 30
const SLOT_HEIGHT = 32
// Same opening days as the API (is_business_day): Tuesday-Saturday.
// JavaScript's getDay() counts Sunday as 0, so Tue-Sat is 2-6.
const OPEN_WEEKDAYS = [2, 3, 4, 5, 6]

const isClosedDay = (dateValue) => !OPEN_WEEKDAYS.includes(new Date(dateValue).getDay())

// The API numbers weekdays like Python (Monday = 0); JavaScript's getDay() has Sunday = 0.
const toApiWeekday = (date) => (date.getDay() + 6) % 7
const timeToMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) // "13:30:00" -> 810

const formatDateLong = (dateValue) =>
  new Date(`${dateValue}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

const formatTimeLabel = (dateValue) =>
  new Date(dateValue).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

const dateKeyFromValue = (dateValue) => {
  const value = new Date(dateValue)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const isSameDateKey = (left, right) => dateKeyFromValue(left) === dateKeyFromValue(right)

const getStartOfWeek = (anchorDate) => {
  const copy = new Date(anchorDate)
  copy.setHours(0, 0, 0, 0)
  const day = copy.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + mondayOffset)
  return copy
}

const buildWeekDates = (anchorDate) => {
  const start = getStartOfWeek(anchorDate)

  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start)
    next.setDate(start.getDate() + index)
    return { date: next, key: dateKeyFromValue(next), label: next.toLocaleDateString(undefined, { weekday: 'short' }), day: next.toLocaleDateString(undefined, { day: 'numeric' }) }
  })
}

const getMinutesFromDate = (dateValue) => {
  const date = new Date(dateValue)
  return date.getHours() * 60 + date.getMinutes()
}

const getDurationMinutes = (start, end) => {
  const diffMs = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(0, Math.round(diffMs / 60000))
}

const DEFAULT_BARBER_COLOR = '#d9b57f'

const getBarberColor = (barber) => barber?.color || DEFAULT_BARBER_COLOR

const getReadableTextColor = (hexColor) => {
  const normalized = hexColor.replace('#', '')
  if (normalized.length !== 6) {
    return '#fff9f0'
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.62 ? '#111827' : '#fff9f0'
}

// FastAPI sends `detail` as a string for our own errors, but as a list of
// field errors for validation failures (422). Never render the raw list.
const FIELD_LABELS = { customer_name: 'name', customer_phone: 'phone number', customer_email: 'email' }

const getErrorMessage = (data, fallback) => {
  if (typeof data?.detail === 'string') return data.detail
  if (Array.isArray(data?.detail)) {
    const fields = data.detail.map((error) => FIELD_LABELS[error.loc?.[error.loc.length - 1]]).filter(Boolean)
    if (fields.length) return `Please check the customer's ${fields.join(' and ')}.`
  }
  return fallback
}

export function AdminAppointmentsPage() {
  const navigate = useNavigate()
  const adminFetch = useAdminFetch()
  // ProtectedRoute guarantees a token exists; the API checks if it's valid.
  // Owner sees every barber; a barber only themselves (the API filters bookings too).
  const [session] = useState(getSession)
  const [adminMessage, setAdminMessage] = useState({ type: '', text: '' })
  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  const [appointments, setAppointments] = useState([])
  const [showCancelled, setShowCancelled] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [now, setNow] = useState(() => new Date())
  // { barberId: { working_hours, time_off } } for the visible week; null until loaded.
  const [schedules, setSchedules] = useState(null)
  const [viewMode, setViewMode] = useState('week')
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [selectedAppointment, setSelectedAppointment] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [bookingFormError, setBookingFormError] = useState('')
  const [newBookingForm, setNewBookingForm] = useState({
    barber_id: '',
    service_id: '',
    customer_name: '',
    customer_phone: '',
    customer_email: '',
  })

  const visibleAppointments = useMemo(
    () =>
      [...appointments]
        .filter((appointment) => (showCancelled ? true : appointment.status !== 'cancelled'))
        // Completed = already ended. An appointment in progress right now stays visible.
        .filter((appointment) => (showCompleted ? true : new Date(appointment.ends_at) > now))
        .sort((left, right) => new Date(left.starts_at) - new Date(right.starts_at)),
    [appointments, showCancelled, showCompleted, now],
  )

  const weekDates = useMemo(() => buildWeekDates(selectedDate), [selectedDate])

  // Inactive barbers/services are kept so existing bookings show the right
  // name and colour, but new bookings can only use active ones.
  const visibleBarbers = useMemo(
    () => (session.isOwner ? barbers : barbers.filter((barber) => barber.id === session.barberId)),
    [barbers, session],
  )
  const activeBarbers = useMemo(() => visibleBarbers.filter((barber) => barber.active), [visibleBarbers])
  const activeServices = useMemo(() => services.filter((service) => service.active), [services])

  const timeMarkers = useMemo(
    () =>
      Array.from({ length: (CLOSING_HOUR - OPENING_HOUR) * 2 + 1 }, (_, index) => {
        const totalMinutes = OPENING_HOUR * 60 + index * SLOT_MINUTES
        const hour = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60
        const label = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`

        return {
          id: `time-${index}`,
          label,
          minutes: totalMinutes,
        }
      }),
    [],
  )

  const getStatusLabel = (appointment) => {
    if (appointment.status === 'cancelled') {
      return 'Cancelled'
    }

    if (new Date(appointment.starts_at) < now) {
      return 'Completed'
    }

    return 'Confirmed'
  }

  const getNextPeriodDate = (direction) => {
    const next = new Date(selectedDate)
    next.setHours(0, 0, 0, 0)
    next.setDate(next.getDate() + (viewMode === 'week' ? 7 : 1) * direction)
    setSelectedDate(next)
  }

  const getDateRangeLabel = () => {
    if (viewMode === 'day') {
      const label = formatDateLong(dateKeyFromValue(selectedDate))
      return isClosedDay(selectedDate) ? `${label} · Closed` : label
    }

    const firstDay = weekDates[0]?.date
    const lastDay = weekDates[weekDates.length - 1]?.date
    if (!firstDay || !lastDay) {
      return 'This week'
    }

    return `${firstDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${lastDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }

  // Day view: one column per barber. Week view: one column per day.
  const calendarColumns = useMemo(() => {
    if (viewMode === 'day') {
      return visibleBarbers
        .map((barber) => ({
          id: `barber-${barber.id}`,
          type: 'barber',
          label: barber.active ? barber.name : `${barber.name} (inactive)`,
          key: dateKeyFromValue(selectedDate),
          barberId: barber.id,
          active: barber.active,
          appointments: visibleAppointments.filter(
            (item) => Number(item.barber_id) === Number(barber.id) && isSameDateKey(item.starts_at, selectedDate),
          ),
        }))
        // An inactive barber only gets a column if they have bookings that day.
        .filter((column) => column.active || column.appointments.length > 0)
    }

    return weekDates.map((day) => ({
      id: `day-${day.key}`,
      type: 'day',
      label: `${day.label} ${day.day}`,
      key: day.key,
      date: day.date,
      appointments: visibleAppointments.filter((item) => isSameDateKey(item.starts_at, day.date)),
    }))
  }, [visibleBarbers, selectedDate, viewMode, visibleAppointments, weekDates])

  const getAppointmentLayout = (appointments, appointment) => {
    const sortedAppointments = [...appointments].sort((left, right) => new Date(left.starts_at) - new Date(right.starts_at))
    const appointmentStart = new Date(appointment.starts_at).getTime()
    const appointmentEnd = new Date(appointment.ends_at).getTime()
    const overlappingAppointments = sortedAppointments.filter((candidate) => {
      if (candidate.id === appointment.id) {
        return false
      }

      const candidateStart = new Date(candidate.starts_at).getTime()
      const candidateEnd = new Date(candidate.ends_at).getTime()
      return candidateStart < appointmentEnd && candidateEnd > appointmentStart
    })

    const laneIndex = overlappingAppointments.reduce((index, candidate) => {
      if (new Date(candidate.starts_at).getTime() >= appointmentEnd || new Date(candidate.ends_at).getTime() <= appointmentStart) {
        return index
      }
      return index + 1
    }, 0)

    const laneCount = Math.max(1, overlappingAppointments.length + 1)
    const leftPercent = (laneIndex * 100) / laneCount
    const widthPercent = 100 / laneCount

    return {
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
    }
  }

  const getAppointmentStyle = (appointment) => {
    const startMinutes = getMinutesFromDate(appointment.starts_at)
    const durationMinutes = getDurationMinutes(appointment.starts_at, appointment.ends_at)
    const top = ((Math.max(startMinutes, OPENING_HOUR * 60) - OPENING_HOUR * 60) / SLOT_MINUTES) * SLOT_HEIGHT
    const height = Math.max(((durationMinutes / SLOT_MINUTES) * SLOT_HEIGHT) - 8, 34)

    return {
      top: `${Math.max(top, 0)}px`,
      height: `${height}px`,
    }
  }

  const getAppointmentBlockStyle = (appointment, barber) => {
    const barberColor = getBarberColor(barber)
    const readableTextColor = getReadableTextColor(barberColor)
    const blockStyle = {
      background: appointment.status === 'cancelled'
        ? 'repeating-linear-gradient(135deg, rgba(148,163,184,0.24), rgba(148,163,184,0.24) 8px, rgba(100,116,139,0.35) 8px, rgba(100,116,139,0.35) 16px)'
        : barberColor,
      color: appointment.status === 'cancelled' ? '#f8fafc' : readableTextColor,
      borderColor: appointment.status === 'cancelled' ? 'rgba(148,163,184,0.45)' : barberColor,
    }

    return blockStyle
  }

  const isPastAppointment = (appointment) => new Date(appointment.starts_at) < now

  const openAppointmentPanel = (appointment) => {
    setSelectedAppointment(appointment)
    setSelectedSlot(null)
  }

  // Active services the barber offers (each service is assigned to barbers).
  const servicesOfferedBy = (barberId) => activeServices.filter((service) => service.barber_ids.includes(Number(barberId)))

  const openSlotPanel = (barberId, slotStart) => {
    const serviceId = servicesOfferedBy(barberId)[0]?.id || ''
    setSelectedSlot({ barberId, slotStart: new Date(slotStart) })
    setBookingFormError('')
    setSelectedAppointment(null)
    setNewBookingForm({
      barber_id: String(barberId),
      service_id: String(serviceId),
      customer_name: '',
      customer_phone: '',
      customer_email: '',
    })
  }

  const closePanels = () => {
    setSelectedAppointment(null)
    setSelectedSlot(null)
  }

  // Load everything once when the page opens. Admin lists include inactive
  // barbers/services (see activeBarbers above).
  useEffect(() => {
    let ignore = false

    const loadCalendarData = async () => {
      try {
        const [servicesResult, barbersResult, appointmentsResult] = await Promise.all([
          adminFetch('/admin/services'),
          adminFetch('/admin/barbers'),
          adminFetch('/appointments'),
        ])
        if (ignore) return
        if (servicesResult.response.ok) setServices(servicesResult.data)
        if (barbersResult.response.ok) setBarbers(barbersResult.data)
        if (appointmentsResult.response.ok) setAppointments(appointmentsResult.data)
      } catch {
        if (!ignore) setAdminMessage({ type: 'error', text: NETWORK_ERROR })
      }
    }

    loadCalendarData()
    return () => {
      ignore = true
    }
  }, [adminFetch])

  // Each barber's hours and time off for the visible week (reloaded when the week changes).
  const weekStartKey = weekDates[0].key
  const weekEndKey = weekDates[weekDates.length - 1].key
  useEffect(() => {
    let ignore = false
    adminFetch(`/barbers/schedules?start=${weekStartKey}&end=${weekEndKey}`)
      .then(({ response, data }) => {
        if (!ignore && response.ok) setSchedules(Object.fromEntries(data.map((item) => [item.barber_id, item])))
      })
      .catch(() => {
        if (!ignore) setAdminMessage({ type: 'error', text: NETWORK_ERROR })
      })
    return () => {
      ignore = true
    }
  }, [adminFetch, weekStartKey, weekEndKey])

  // Is the barber working during the half-hour cell starting at slotStart?
  // Returns { working: true } or { working: false, reason } for the cell's tooltip.
  const getBarberStatus = (barberId, slotStart) => {
    const schedule = schedules?.[barberId]
    if (!schedule) return { working: true } // not loaded yet: don't grey anything out

    const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60000)
    const away = schedule.time_off.find(
      (item) => new Date(item.starts_at) < slotEnd && new Date(item.ends_at) > slotStart,
    )
    if (away) return { working: false, reason: away.reason ? `Time off: ${away.reason}` : 'Time off' }

    const blocks = schedule.working_hours.filter((block) => block.weekday === toApiWeekday(slotStart))
    if (!blocks.length) return { working: false, reason: 'Day off' }

    const startMinutes = slotStart.getHours() * 60 + slotStart.getMinutes()
    const endMinutes = startMinutes + SLOT_MINUTES
    const fits = blocks.some(
      (block) => timeToMinutes(block.start_time) <= startMinutes && endMinutes <= timeToMinutes(block.end_time),
    )
    if (fits) return { working: true }

    const dayStart = Math.min(...blocks.map((block) => timeToMinutes(block.start_time)))
    const dayEnd = Math.max(...blocks.map((block) => timeToMinutes(block.end_time)))
    return { working: false, reason: startMinutes >= dayStart && endMinutes <= dayEnd ? 'Break' : 'Not working' }
  }

  // Refresh after creating or cancelling a booking.
  const reloadAppointments = async () => {
    try {
      const { response, data } = await adminFetch('/appointments')
      if (response.ok) setAppointments(data)
    } catch {
      setAdminMessage({ type: 'error', text: NETWORK_ERROR })
    }
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const handleCancelAppointment = async (appointmentId) => {
    const { response, data } = await adminFetch(`/appointments/${appointmentId}/cancel`, {
      method: 'PATCH',
    })

    if (!response.ok) {
      setAdminMessage({ type: 'error', text: getErrorMessage(data, 'Cancellation failed.') })
      return
    }

    setAdminMessage({ type: 'success', text: 'Appointment cancelled.' })
    setSelectedAppointment(null)
    setSelectedSlot(null)
    reloadAppointments()
  }

  const handleCreateBooking = async (event) => {
    event.preventDefault()

    if (!selectedSlot) {
      return
    }

    const service = services.find((item) => Number(item.id) === Number(newBookingForm.service_id))
    if (!service) {
      setBookingFormError('Choose a valid service.')
      return
    }

    const start = new Date(selectedSlot.slotStart)
    const end = new Date(start.getTime() + service.duration_minutes * 60000)

    const payload = {
      barber_id: Number(newBookingForm.barber_id || selectedSlot.barberId),
      service_id: Number(newBookingForm.service_id),
      customer_name: newBookingForm.customer_name.trim(),
      customer_phone: newBookingForm.customer_phone.trim(),
      customer_email: newBookingForm.customer_email.trim(),
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      notes: 'Booked from admin calendar',
    }

    setBookingFormError('')

    let result
    try {
      result = await fetchJson(`${API_BASE}/appointments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch {
      setBookingFormError(NETWORK_ERROR)
      return
    }

    const { response, data } = result
    if (!response.ok) {
      // Shown inside the side panel, next to the form the admin is filling in.
      setBookingFormError(getErrorMessage(data, 'Could not create appointment.'))
      return
    }

    setAdminMessage({ type: 'success', text: 'Appointment created successfully.' })
    setSelectedSlot(null)
    setNewBookingForm({
      barber_id: newBookingForm.barber_id,
      service_id: newBookingForm.service_id,
      customer_name: '',
      customer_phone: '',
      customer_email: '',
    })
    reloadAppointments()
  }

  const handleLogout = () => {
    clearSession()
    navigate('/admin', { replace: true })
  }

  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-brand">
            <div className="brand-mark">{SHOP.initials}</div>
            <div>
              <p className="admin-eyebrow">Admin</p>
              <h1>{SHOP.name}</h1>
            </div>
          </div>

          <div className="admin-toolbar">
            <ThemeToggle />
            <span className="admin-chip">
              Signed in as {session.username}{session.isOwner ? ' (owner)' : ''}
            </span>
            <div className="admin-calendar-toggle" aria-label="Calendar view switcher">
              <button
                type="button"
                className={viewMode === 'day' ? 'active' : ''}
                onClick={() => setViewMode('day')}
              >
                Day
              </button>
              <button
                type="button"
                className={viewMode === 'week' ? 'active' : ''}
                onClick={() => setViewMode('week')}
              >
                Week
              </button>
            </div>
            {session.isOwner && <Link to="/admin/team" className="admin-secondary-button">Team &amp; services</Link>}
            <Link to="/" className="admin-secondary-button">Customer page</Link>
            <button className="admin-secondary-button" onClick={() => setShowCancelled((current) => !current)} type="button">
              {showCancelled ? 'Hide cancelled' : 'Show cancelled'}
            </button>
            <button className="admin-secondary-button" onClick={() => setShowCompleted((current) => !current)} type="button">
              {showCompleted ? 'Hide completed' : 'Show completed'}
            </button>
            <button className="admin-secondary-button" onClick={handleLogout} type="button">
              Log out
            </button>
          </div>
        </header>

        <main className="admin-main">
          <section className="admin-panel">
            <div className="admin-panel__header">
              <div>
                <p className="admin-kicker">Overview</p>
                <h2>{session.isOwner ? 'Appointments' : 'My appointments'}</h2>
              </div>

              <div className="admin-calendar-nav">
                <button type="button" className="admin-secondary-button" onClick={() => getNextPeriodDate(-1)} aria-label="Previous period">
                  ‹
                </button>
                <button type="button" className="admin-secondary-button" onClick={() => setSelectedDate(new Date())}>
                  Today
                </button>
                <button type="button" className="admin-secondary-button" onClick={() => getNextPeriodDate(1)} aria-label="Next period">
                  ›
                </button>
              </div>
            </div>

            {adminMessage.text && (
              <p className={`admin-status-message ${adminMessage.type}`}>{adminMessage.text}</p>
            )}

            <div className="admin-calendar-header">
              <strong>{getDateRangeLabel()}</strong>
            </div>

            <div className="admin-calendar-layout">
              <div className="admin-calendar-main">
                <div
                  className="admin-calendar-grid"
                  style={{
                    gridTemplateColumns:
                      viewMode === 'week'
                        ? '80px repeat(7, minmax(0, 1fr))'
                        : `80px repeat(${calendarColumns.length}, minmax(0, 1fr))`,
                  }}
                >
                  <div className="admin-calendar-header-cell admin-calendar-header-cell--blank" aria-hidden="true" />
                  {(viewMode === 'week' ? weekDates : calendarColumns).map((headerColumn) => (
                    <div key={`header-${headerColumn.id || headerColumn.key}`} className="admin-calendar-header-cell">
                      {viewMode === 'week' ? (
                        <>
                          <span>{headerColumn.label}</span>
                          <strong>{headerColumn.day}</strong>
                        </>
                      ) : (
                        // Day view: one column per barber, so the header is just the name.
                        <strong>{headerColumn.label}</strong>
                      )}
                      {viewMode === 'week' && isClosedDay(headerColumn.date) && <small className="admin-closed-label">Closed</small>}
                    </div>
                  ))}

                  <div className="admin-time-column">
                    {timeMarkers.map((marker) => (
                      <div key={marker.id} className="admin-time-label">
                        {marker.label}
                      </div>
                    ))}
                  </div>

                  {calendarColumns.map((column) => {
                    const currentDayKey = dateKeyFromValue(now)
                    const currentLineTop = ((currentTimeMinutes - OPENING_HOUR * 60) / SLOT_MINUTES) * SLOT_HEIGHT
                    const shouldShowCurrentLine =
                      column.key === currentDayKey && currentTimeMinutes >= OPENING_HOUR * 60 && currentTimeMinutes <= CLOSING_HOUR * 60

                    return (
                      <div key={column.id} className="admin-calendar-column">
                        <div className="admin-slot-surface">
                          {timeMarkers.map((marker) => (
                            <div key={`${column.id}-${marker.id}`} className={`admin-slot-row ${marker.minutes < OPENING_HOUR * 60 || marker.minutes >= CLOSING_HOUR * 60 ? 'is-off-hours' : ''}`} />
                          ))}

                          {column.appointments.map((appointment) => {
                            const style = getAppointmentStyle(appointment)
                            const layout = getAppointmentLayout(column.appointments, appointment)
                            const service = services.find((item) => Number(item.id) === Number(appointment.service_id))
                            const barber = barbers.find((item) => Number(item.id) === Number(appointment.barber_id))
                            const statusLabel = getStatusLabel(appointment)
                            const blockHeight = Number.parseFloat(style.height || '0')
                            const blockCompact = blockHeight < 70
                            const tooltipText = [
                              `${formatTimeLabel(appointment.starts_at)} – ${formatTimeLabel(appointment.ends_at)}`,
                              appointment.customer_name,
                              service?.name || 'Appointment',
                              barber?.name || 'Barber',
                              statusLabel,
                            ].join(' • ')

                            return (
                              <button
                                key={appointment.id}
                                type="button"
                                className={`admin-booking-block admin-booking-block--${appointment.status}`}
                                style={{
                                  ...style,
                                  ...layout,
                                  right: 'auto',
                                  ...getAppointmentBlockStyle(appointment, barber),
                                }}
                                onClick={() => openAppointmentPanel(appointment)}
                                aria-label={tooltipText}
                              >
                                <div className="admin-booking-block__content">
                                  <strong>{appointment.customer_name}</strong>
                                  {!blockCompact && (
                                    <>
                                      <span>{formatTimeLabel(appointment.starts_at)} – {formatTimeLabel(appointment.ends_at)}</span>
                                      <small>{service?.name || 'Appointment'}</small>
                                    </>
                                  )}
                                </div>
                                <span className="admin-booking-block__tooltip">{tooltipText}</span>
                              </button>
                            )
                          })}

                          {shouldShowCurrentLine && (
                            <div
                              className="admin-current-line"
                              style={{ top: `${Math.max(0, currentLineTop)}px` }}
                              aria-label="Current time line"
                            />
                          )}

                          <div className="admin-column-rows">
                            {timeMarkers.map((marker) => {
                              // Day view: one column per barber. Week view: one column per day.
                              const slotStart = new Date(viewMode === 'day' ? selectedDate : column.date)
                              slotStart.setHours(Math.floor(marker.minutes / 60), marker.minutes % 60, 0, 0)

                              // Slots the API would reject (past, closed day, or starting at
                              // closing time) are plain shaded cells, not clickable buttons.
                              const isUnavailable = slotStart < now
                                || isClosedDay(slotStart)
                                || column.active === false
                                || marker.minutes >= CLOSING_HOUR * 60
                              if (isUnavailable) {
                                return <div key={`${column.id}-slot-${marker.id}`} className="admin-empty-slot is-unavailable" aria-hidden="true" />
                              }

                              // Day view: this column's barber must be working. Week view: at
                              // least one barber must be, and the booking defaults to them.
                              const workingBarbers = viewMode === 'day'
                                ? [column.barberId].filter((id) => getBarberStatus(id, slotStart).working)
                                : activeBarbers.filter((barber) => getBarberStatus(barber.id, slotStart).working).map((barber) => barber.id)
                              if (!workingBarbers.length) {
                                const reason = viewMode === 'day' ? getBarberStatus(column.barberId, slotStart).reason : 'No barber working'
                                return (
                                  <div
                                    key={`${column.id}-slot-${marker.id}`}
                                    className="admin-empty-slot is-barber-off"
                                    title={`${marker.label} · ${reason}`}
                                    aria-label={`${marker.label}: ${reason}`}
                                  />
                                )
                              }

                              const barberId = workingBarbers[0]
                              return (
                                <button
                                  key={`${column.id}-slot-${marker.id}`}
                                  type="button"
                                  className="admin-empty-slot"
                                  onClick={() => openSlotPanel(barberId, slotStart)}
                                  aria-label={`Book ${viewMode === 'day' ? column.label : `on ${column.label}`} at ${marker.label}`}
                                />
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {(selectedAppointment || selectedSlot) && (
                <aside className="admin-calendar-panel">
                  {selectedAppointment && (
                    <>
                      <div className="admin-panel__header admin-panel__header--stacked">
                        <div>
                          <p className="admin-kicker">Details</p>
                          <h3>{selectedAppointment.customer_name}</h3>
                        </div>
                        <span className={`admin-status-badge admin-status-badge--${getStatusLabel(selectedAppointment).toLowerCase()}`}>
                          {getStatusLabel(selectedAppointment)}
                        </span>
                      </div>

                      <div className="admin-detail-list">
                        <div>
                          <span>Service</span>
                          <strong>
                            {services.find((item) => Number(item.id) === Number(selectedAppointment.service_id))?.name || 'Service'}
                          </strong>
                        </div>
                        <div>
                          <span>Barber</span>
                          <strong>
                            {barbers.find((item) => Number(item.id) === Number(selectedAppointment.barber_id))?.name || 'Barber'}
                          </strong>
                        </div>
                        <div>
                          <span>Date</span>
                          <strong>{formatDateLong(dateKeyFromValue(selectedAppointment.starts_at))}</strong>
                        </div>
                        <div>
                          <span>Time</span>
                          <strong>{formatTimeLabel(selectedAppointment.starts_at)} – {formatTimeLabel(selectedAppointment.ends_at)}</strong>
                        </div>
                        <div>
                          <span>Phone</span>
                          <strong>{selectedAppointment.customer_phone}</strong>
                        </div>
                        <div>
                          <span>Email</span>
                          <strong>{selectedAppointment.customer_email || '—'}</strong>
                        </div>
                      </div>

                      {!isPastAppointment(selectedAppointment) && selectedAppointment.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="admin-cancel-button admin-cancel-button--panel"
                          onClick={() => handleCancelAppointment(selectedAppointment.id)}
                        >
                          Cancel appointment
                        </button>
                      )}
                    </>
                  )}

                  {selectedSlot && (
                    <form onSubmit={handleCreateBooking} className="admin-booking-form">
                      <div className="admin-panel__header admin-panel__header--stacked">
                        <div>
                          <p className="admin-kicker">New booking</p>
                          <h3>{formatDateLong(dateKeyFromValue(selectedSlot.slotStart))}</h3>
                        </div>
                      </div>

                      <div className="admin-detail-list">
                        <div>
                          <span>Barber</span>
                          <strong>{barbers.find((item) => Number(item.id) === Number(newBookingForm.barber_id))?.name || 'Barber'}</strong>
                        </div>
                        <div>
                          <span>Time</span>
                          <strong>{formatTimeLabel(selectedSlot.slotStart)}</strong>
                        </div>
                      </div>

                      <label>
                        Service
                        <select
                          value={newBookingForm.service_id}
                          onChange={(event) => setNewBookingForm({ ...newBookingForm, service_id: event.target.value })}
                        >
                          {servicesOfferedBy(newBookingForm.barber_id).map((service) => (
                            <option key={service.id} value={service.id}>{service.name}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Barber
                        <select
                          value={newBookingForm.barber_id}
                          onChange={(event) => {
                            // Switching barber: keep the service only if the new barber offers it.
                            const barberId = event.target.value
                            const offered = servicesOfferedBy(barberId)
                            const keepService = offered.some((service) => String(service.id) === String(newBookingForm.service_id))
                            setNewBookingForm({
                              ...newBookingForm,
                              barber_id: barberId,
                              service_id: keepService ? newBookingForm.service_id : String(offered[0]?.id || ''),
                            })
                          }}
                        >
                          {activeBarbers
                            .filter((barber) => getBarberStatus(barber.id, selectedSlot.slotStart).working)
                            .map((barber) => (
                              <option key={barber.id} value={barber.id}>{barber.name}</option>
                            ))}
                        </select>
                      </label>

                      <label>
                        Customer name
                        <input
                          type="text"
                          required
                          maxLength={150}
                          value={newBookingForm.customer_name}
                          onChange={(event) => setNewBookingForm({ ...newBookingForm, customer_name: event.target.value })}
                          placeholder="Jane Smith"
                        />
                      </label>

                      <label>
                        Phone number
                        <input
                          type="tel"
                          required
                          minLength={6}
                          maxLength={30}
                          pattern="\+?[0-9\(][0-9 \(\)\-]*[0-9]"
                          title="Digits, spaces, +, - and ( ), e.g. +46 70 123 45 67"
                          value={newBookingForm.customer_phone}
                          onChange={(event) => setNewBookingForm({ ...newBookingForm, customer_phone: event.target.value })}
                          placeholder="+46 70 123 45 67"
                        />
                      </label>

                      <label>
                        Email (for the confirmation)
                        <input
                          type="email"
                          required
                          maxLength={254}
                          value={newBookingForm.customer_email}
                          onChange={(event) => setNewBookingForm({ ...newBookingForm, customer_email: event.target.value })}
                          placeholder="jane@example.com"
                        />
                      </label>

                      {bookingFormError && (
                        <p className="admin-status-message error" role="alert">{bookingFormError}</p>
                      )}

                      <div className="admin-panel-actions">
                        <button type="button" className="admin-secondary-button" onClick={closePanels}>Close</button>
                        <button type="submit" className="admin-primary-button">Save booking</button>
                      </div>
                    </form>
                  )}
                </aside>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
