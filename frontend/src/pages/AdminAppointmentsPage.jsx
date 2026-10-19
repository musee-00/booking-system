import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API_BASE = 'http://localhost:8000/api/v1'

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

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  return { response, data }
}

export function AdminAppointmentsPage() {
  const navigate = useNavigate()
  const [adminToken, setAdminToken] = useState(localStorage.getItem('booking-admin-token') || '')
  const [adminUsername, setAdminUsername] = useState('admin')
  const [adminMessage, setAdminMessage] = useState({ type: '', text: '' })
  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  const [appointments, setAppointments] = useState([])
  const [showCancelled, setShowCancelled] = useState(false)

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

  const isPastAppointment = (appointment) => new Date(appointment.starts_at) < new Date()

  const visibleAppointments = [...appointments]
    .filter((appointment) => (showCancelled ? true : appointment.status !== 'cancelled'))
    .sort((left, right) => {
      const leftUpcoming = !isPastAppointment(left)
      const rightUpcoming = !isPastAppointment(right)

      if (leftUpcoming !== rightUpcoming) {
        return leftUpcoming ? -1 : 1
      }

      return new Date(left.starts_at) - new Date(right.starts_at)
    })

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
    if (!adminToken) {
      navigate('/admin', { replace: true })
      return
    }

    loadServices()
    loadBarbers()
    loadAppointments()
  }, [adminToken, navigate])

  const handleCancelAppointment = async (appointmentId) => {
    if (!adminToken) {
      setAdminMessage({ type: 'error', text: 'Log in first to cancel appointments.' })
      return
    }

    const { response, data } = await fetchJson(`${API_BASE}/appointments/${appointmentId}/cancel`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })

    if (!response.ok) {
      setAdminMessage({ type: 'error', text: data.detail || 'Cancellation failed.' })
      return
    }

    setAdminMessage({ type: 'success', text: 'Appointment cancelled.' })
    loadAppointments()
  }

  const handleLogout = () => {
    localStorage.removeItem('booking-admin-token')
    setAdminToken('')
    setAdminMessage({ type: 'success', text: 'Logged out.' })
    navigate('/admin', { replace: true })
  }

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
            <button className="admin-secondary-button" onClick={() => setShowCancelled((current) => !current)} type="button">
              {showCancelled ? 'Hide cancelled' : 'Show cancelled'}
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
            </div>

            {adminMessage.text && (
              <p className={`admin-status-message ${adminMessage.type}`}>{adminMessage.text}</p>
            )}

            <div className="admin-appointments-list">
              {visibleAppointments.length === 0 ? (
                <p className="admin-empty-state">No appointments yet.</p>
              ) : (
                visibleAppointments.map((appointment) => {
                  const service = services.find((item) => Number(item.id) === Number(appointment.service_id))
                  const barber = barbers.find((item) => Number(item.id) === Number(appointment.barber_id))
                  const statusLabel = getStatusLabel(appointment)
                  const isPast = isPastAppointment(appointment)

                  return (
                    <article key={appointment.id} className="admin-appointment-card">
                      <div className="admin-appointment-card__top">
                        <div>
                          <p className="admin-appointment-label">Customer</p>
                          <h3>{appointment.customer_name}</h3>
                        </div>
                        <span className={`admin-status-badge admin-status-badge--${statusLabel.toLowerCase()}`}>
                          {statusLabel}
                        </span>
                      </div>

                      <div className="admin-appointment-card__meta">
                        <span>{service ? service.name : 'Service'} · {barber ? barber.name : 'Barber'}</span>
                        <span>{formatDateLabel(appointment.starts_at.slice(0, 10))}</span>
                        <span>{formatTimeLabel(appointment.starts_at)} – {formatTimeLabel(appointment.ends_at)}</span>
                      </div>

                      {!isPast && appointment.status !== 'cancelled' && (
                        <button type="button" className="admin-cancel-button" onClick={() => handleCancelAppointment(appointment.id)}>
                          Cancel
                        </button>
                      )}
                    </article>
                  )
                })
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
