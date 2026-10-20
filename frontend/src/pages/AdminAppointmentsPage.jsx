import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const API_BASE = 'http://localhost:8000/api/v1'
const OPENING_HOUR = 9
const CLOSING_HOUR = 18
const SLOT_MINUTES = 30
const SLOT_HEIGHT = 32

const formatDateLabel = (dateValue) =>
  new Date(`${dateValue}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

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

const fetchJson = async (url, options = {}) => {
  // Spread options first, then headers: otherwise options.headers would replace
  // the merged object and drop Content-Type whenever a caller passes a header.
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  return { response, data }
}

const SESSION_EXPIRED_MESSAGE = 'Your session has expired, please log in again'

export function AdminAppointmentsPage() {
  const navigate = useNavigate()
  const [adminToken, setAdminToken] = useState(localStorage.getItem('booking-admin-token') || '')
  const [adminUsername, setAdminUsername] = useState('admin')
  const [adminMessage, setAdminMessage] = useState({ type: '', text: '' })
  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  const [appointments, setAppointments] = useState([])
  const [showCancelled, setShowCancelled] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [viewMode, setViewMode] = useState('week')
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [selectedAppointment, setSelectedAppointment] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)
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

    const startsAt = new Date(appointment.starts_at)
    if (startsAt < new Date()) {
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
      return formatDateLong(dateKeyFromValue(selectedDate))
    }

    const firstDay = weekDates[0]?.date
    const lastDay = weekDates[weekDates.length - 1]?.date
    if (!firstDay || !lastDay) {
      return 'This week'
    }

    return `${firstDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${lastDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }

  const getCalendarColumns = () => {
    if (viewMode === 'day') {
      return barbers.map((barber) => ({
        id: `barber-${barber.id}`,
        type: 'barber',
        label: barber.name,
        key: dateKeyFromValue(selectedDate),
        barberId: barber.id,
        appointments: visibleAppointments.filter(
          (item) => Number(item.barber_id) === Number(barber.id) && isSameDateKey(item.starts_at, selectedDate),
        ),
      }))
    }

    return weekDates.map((day) => ({
      id: `day-${day.key}`,
      type: 'day',
      label: `${day.label} ${day.day}`,
      key: day.key,
      date: day.date,
      appointments: visibleAppointments.filter((item) => isSameDateKey(item.starts_at, day.date)),
    }))
  }

  const calendarColumns = useMemo(() => getCalendarColumns(), [barbers, selectedDate, viewMode, visibleAppointments])

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

  const isPastAppointment = (appointment) => new Date(appointment.starts_at) < new Date()

  const openAppointmentPanel = (appointment) => {
    setSelectedAppointment(appointment)
    setSelectedSlot(null)
  }

  const openSlotPanel = (barberId, slotStart) => {
    const serviceId = services[0]?.id || ''
    setSelectedSlot({ barberId, slotStart: new Date(slotStart) })
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

  // Every admin-only request goes through here. A 401 means the token is
  // missing, expired or forged: drop it and send the user back to log in.
  const adminFetch = async (url, options = {}) => {
    const result = await fetchJson(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${adminToken}` },
    })

    if (result.response.status === 401) {
      localStorage.removeItem('booking-admin-token')
      navigate('/admin', { replace: true, state: { message: SESSION_EXPIRED_MESSAGE } })
    }

    return result
  }

  const loadServices = async () => {
    const { response, data } = await fetchJson(`${API_BASE}/services`)
    if (response.ok) {
      setServices(data)
      if (!newBookingForm.service_id && data[0]) {
        setNewBookingForm((current) => ({ ...current, service_id: String(data[0].id) }))
      }
    }
  }

  const loadBarbers = async () => {
    const { response, data } = await fetchJson(`${API_BASE}/barbers`)
    if (response.ok) {
      setBarbers(data)
      if (!newBookingForm.barber_id && data[0]) {
        setNewBookingForm((current) => ({ ...current, barber_id: String(data[0].id) }))
      }
    }
  }

  const loadAppointments = async () => {
    const { response, data } = await adminFetch(`${API_BASE}/appointments`)
    if (response.ok) {
      setAppointments(data)
    }
  }

  useEffect(() => {
    if (!adminToken) {
      navigate('/admin', { replace: true })
      return
    }

    loadServices()
    loadBarbers()
    loadAppointments()
  }, [adminToken, navigate])

  useEffect(() => {
    if (!services.length) {
      return
    }

    setNewBookingForm((current) => ({
      ...current,
      service_id: current.service_id || String(services[0].id),
    }))
  }, [services])

  useEffect(() => {
    if (!barbers.length) {
      return
    }

    setNewBookingForm((current) => ({
      ...current,
      barber_id: current.barber_id || String(barbers[0].id),
    }))
  }, [barbers])

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const handleCancelAppointment = async (appointmentId) => {
    if (!adminToken) {
      setAdminMessage({ type: 'error', text: 'Log in first to cancel appointments.' })
      return
    }

    const { response, data } = await adminFetch(`${API_BASE}/appointments/${appointmentId}/cancel`, {
      method: 'PATCH',
    })

    if (!response.ok) {
      setAdminMessage({ type: 'error', text: data.detail || 'Cancellation failed.' })
      return
    }

    setAdminMessage({ type: 'success', text: 'Appointment cancelled.' })
    setSelectedAppointment(null)
    setSelectedSlot(null)
    loadAppointments()
  }

  const handleCreateBooking = async (event) => {
    event.preventDefault()

    if (!selectedSlot) {
      return
    }

    const service = services.find((item) => Number(item.id) === Number(newBookingForm.service_id))
    if (!service) {
      setAdminMessage({ type: 'error', text: 'Choose a valid service.' })
      return
    }

    const start = new Date(selectedSlot.slotStart)
    const end = new Date(start.getTime() + service.duration_minutes * 60000)

    const payload = {
      barber_id: Number(newBookingForm.barber_id || selectedSlot.barberId),
      service_id: Number(newBookingForm.service_id),
      customer_name: newBookingForm.customer_name,
      customer_phone: newBookingForm.customer_phone,
      customer_email: newBookingForm.customer_email || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      notes: 'Booked from admin calendar',
    }

    const { response, data } = await fetchJson(`${API_BASE}/appointments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      setAdminMessage({ type: 'error', text: data.detail || 'Could not create appointment.' })
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
    loadAppointments()
  }

  const handleLogout = () => {
    localStorage.removeItem('booking-admin-token')
    setAdminToken('')
    setAdminMessage({ type: 'success', text: 'Logged out.' })
    navigate('/admin', { replace: true })
  }

  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-brand">
            <div className="brand-mark">NS</div>
            <div>
              <p className="admin-eyebrow">Admin</p>
              <h1>North Street Studio</h1>
            </div>
          </div>

          <div className="admin-toolbar">
            <span className="admin-chip">Signed in as {adminUsername}</span>
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
                <h2>Appointments</h2>
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
                      <span>{headerColumn.label || headerColumn.day || 'Day'}</span>
                      <strong>{headerColumn.day || headerColumn.label?.split(' ')[1] || '1'}</strong>
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

                              // Past slots can't be booked (the API rejects them), so render
                              // a plain shaded cell instead of a clickable button.
                              if (slotStart < now) {
                                return <div key={`${column.id}-slot-${marker.id}`} className="admin-empty-slot is-past" aria-hidden="true" />
                              }

                              const barberId = viewMode === 'day' ? column.barberId : barbers[0]?.id || ''
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
                          {services.map((service) => (
                            <option key={service.id} value={service.id}>{service.name}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Barber
                        <select
                          value={newBookingForm.barber_id}
                          onChange={(event) => setNewBookingForm({ ...newBookingForm, barber_id: event.target.value })}
                        >
                          {barbers.map((barber) => (
                            <option key={barber.id} value={barber.id}>{barber.name}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Customer name
                        <input
                          type="text"
                          value={newBookingForm.customer_name}
                          onChange={(event) => setNewBookingForm({ ...newBookingForm, customer_name: event.target.value })}
                          placeholder="Jane Smith"
                        />
                      </label>

                      <label>
                        Phone number
                        <input
                          type="tel"
                          value={newBookingForm.customer_phone}
                          onChange={(event) => setNewBookingForm({ ...newBookingForm, customer_phone: event.target.value })}
                          placeholder="+46 70 123 45 67"
                        />
                      </label>

                      <label>
                        Email
                        <input
                          type="email"
                          value={newBookingForm.customer_email}
                          onChange={(event) => setNewBookingForm({ ...newBookingForm, customer_email: event.target.value })}
                          placeholder="jane@example.com"
                        />
                      </label>

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
