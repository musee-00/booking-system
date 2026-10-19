import { useEffect, useMemo, useState } from 'react'

const API_BASE = 'http://localhost:8000/api/v1'

const formatDateValue = (date) => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next.toISOString().slice(0, 10)
}

const formatDateLabel = (dateValue) =>
  new Date(`${dateValue}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

const formatTimeLabel = (dateValue) =>
  new Date(dateValue).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

const formatPrice = (amount) => `${Number(amount).toFixed(0)} kr`

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  return { response, data }
}

export function CustomerPage() {
  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  const [appointments, setAppointments] = useState([])
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [selectedBarberId, setSelectedBarberId] = useState('')
  const [selectedDate, setSelectedDate] = useState(formatDateValue(new Date(Date.now() + 86400000)))
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [bookingForm, setBookingForm] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
  })
  const [bookingMessage, setBookingMessage] = useState({ type: '', text: '' })

  const selectedService = useMemo(
    () => services.find((service) => String(service.id) === String(selectedServiceId)) || null,
    [services, selectedServiceId],
  )

  const selectedBarber = useMemo(
    () => barbers.find((barber) => String(barber.id) === String(selectedBarberId)) || null,
    [barbers, selectedBarberId],
  )

  const availableSlots = useMemo(() => {
    if (!selectedBarberId || !selectedDate || !selectedService) {
      return []
    }

    const durationMs = selectedService.duration_minutes * 60 * 1000
    const startOfDay = new Date(`${selectedDate}T09:00:00`)
    const endOfDay = new Date(`${selectedDate}T18:00:00`)
    const slots = []
    const now = new Date()
    const isToday = selectedDate === formatDateValue(now)

    for (let candidate = new Date(startOfDay); candidate.getTime() + durationMs <= endOfDay.getTime(); candidate = new Date(candidate.getTime() + 30 * 60000)) {
      const candidateEnd = new Date(candidate.getTime() + durationMs)

      if (isToday && candidate.getTime() < now.getTime()) {
        continue
      }

      const isBlocked = appointments.some((appointment) => {
        if (Number(appointment.barber_id) !== Number(selectedBarberId)) {
          return false
        }
        if (appointment.status === 'cancelled') {
          return false
        }

        const appointmentStarts = new Date(appointment.starts_at)
        const appointmentEnds = new Date(appointment.ends_at)
        return appointmentStarts < candidateEnd && appointmentEnds > candidate
      })

      if (!isBlocked) {
        slots.push({ start: candidate, end: candidateEnd })
      }
    }

    return slots
  }, [appointments, selectedBarberId, selectedDate, selectedService])

  const loadServices = async () => {
    const { response, data } = await fetchJson(`${API_BASE}/services`)
    if (response.ok) {
      setServices(data)
    }
  }

  const loadBarbers = async () => {
    const { response, data } = await fetchJson(`${API_BASE}/barbers`)
    if (response.ok) {
      setBarbers(data)
    }
  }

  const loadAppointments = async () => {
    const { response, data } = await fetchJson(`${API_BASE}/appointments`)
    if (response.ok) {
      setAppointments(data)
    }
  }

  useEffect(() => {
    loadServices()
    loadBarbers()
    loadAppointments()
  }, [])

  useEffect(() => {
    if (!selectedServiceId && services[0]) {
      setSelectedServiceId(String(services[0].id))
    }

    if (!selectedBarberId && barbers[0]) {
      setSelectedBarberId(String(barbers[0].id))
    }
  }, [barbers, selectedBarberId, selectedServiceId, services])

  const handleBookAppointment = async (event) => {
    event.preventDefault()

    if (!selectedService || !selectedBarber || !selectedSlot) {
      setBookingMessage({ type: 'error', text: 'Select a service, barber, and an available time slot.' })
      return
    }

    const payload = {
      barber_id: Number(selectedBarber.id),
      service_id: Number(selectedService.id),
      customer_name: bookingForm.customer_name,
      customer_phone: bookingForm.customer_phone,
      customer_email: bookingForm.customer_email,
      starts_at: selectedSlot.start.toISOString(),
      ends_at: selectedSlot.end.toISOString(),
      notes: 'Booked via customer portal',
    }

    const { response, data } = await fetchJson(`${API_BASE}/appointments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const message = response.status === 409
        ? 'That slot has just been taken. Please choose another appointment time.'
        : data.detail || 'Booking could not be completed.'
      setBookingMessage({ type: 'error', text: message })
      return
    }

    setBookingMessage({ type: 'success', text: 'Appointment booked successfully.' })
    setBookingForm({ customer_name: '', customer_phone: '', customer_email: '' })
    setSelectedSlot(null)
    loadAppointments()
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Barber booking</p>
          <h1>North Street Studio</h1>
        </div>
      </header>

      <main className="layout single-column">
        <section className="panel booking-panel">
          <div className="panel-header">
            <h2>Customer booking</h2>
            <span className="badge">Simple booking flow</span>
          </div>

          <form onSubmit={handleBookAppointment} className="booking-form">
            <label>
              Service
              <select value={selectedServiceId} onChange={(event) => setSelectedServiceId(event.target.value)}>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} — {formatPrice(service.price)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Barber
              <select value={selectedBarberId} onChange={(event) => setSelectedBarberId(event.target.value)}>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
            </label>

            <div className="slot-panel">
              <p className="slot-title">Available slots</p>
              <div className="slot-grid">
                {availableSlots.length === 0 ? (
                  <p className="empty-state">No free slots available for this barber and date.</p>
                ) : (
                  availableSlots.map((slot, index) => {
                    const isSelected = selectedSlot && selectedSlot.start.getTime() === slot.start.getTime()
                    return (
                      <button
                        key={`${slot.start.toISOString()}-${index}`}
                        type="button"
                        className={`slot-button ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedSlot(slot)}
                      >
                        {formatTimeLabel(slot.start)} – {formatTimeLabel(slot.end)}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {selectedSlot && (
              <div className="selected-slot-box">
                <strong>Chosen time:</strong> {formatDateLabel(selectedDate)} · {formatTimeLabel(selectedSlot.start)} to {formatTimeLabel(selectedSlot.end)}
              </div>
            )}

            <div className="customer-fields">
              <label>
                Your name
                <input
                  type="text"
                  value={bookingForm.customer_name}
                  onChange={(event) => setBookingForm({ ...bookingForm, customer_name: event.target.value })}
                  placeholder="Jane Smith"
                  required
                />
              </label>
              <label>
                Phone
                <input
                  type="tel"
                  value={bookingForm.customer_phone}
                  onChange={(event) => setBookingForm({ ...bookingForm, customer_phone: event.target.value })}
                  placeholder="+46 70 123 45 67"
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={bookingForm.customer_email}
                  onChange={(event) => setBookingForm({ ...bookingForm, customer_email: event.target.value })}
                  placeholder="jane@example.com"
                />
              </label>
            </div>

            {bookingMessage.text && (
              <p className={`status-message ${bookingMessage.type}`}>{bookingMessage.text}</p>
            )}

            <button type="submit" className="primary-button" disabled={!selectedService || !selectedBarber || !selectedSlot}>
              Book appointment
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}
