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
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>North Street Studio</h1>
        </div>
      </header>

      <main className="layout single-column">
        <section className="panel admin-panel">
          <div className="panel-header">
            <h2>Appointments</h2>
            <div className="admin-actions">
              <span className="badge alt">Signed in as {adminUsername}</span>
              <button className="secondary-button" onClick={handleLogout} type="button">
                Log out
              </button>
            </div>
          </div>

          {adminMessage.text && (
            <p className={`status-message ${adminMessage.type}`}>{adminMessage.text}</p>
          )}

          <div className="appointments-list">
            {appointments.length === 0 ? (
              <p className="empty-state">No appointments yet.</p>
            ) : (
              appointments.map((appointment) => {
                const service = services.find((item) => Number(item.id) === Number(appointment.service_id))
                const barber = barbers.find((item) => Number(item.id) === Number(appointment.barber_id))

                return (
                  <div key={appointment.id} className="appointment-card">
                    <div>
                      <strong>{appointment.customer_name}</strong>
                      <p>
                        {service ? service.name : 'Service'} · {barber ? barber.name : 'Barber'}
                      </p>
                      <p>
                        {formatDateLabel(appointment.starts_at.slice(0, 10))} · {formatTimeLabel(appointment.starts_at)} – {formatTimeLabel(appointment.ends_at)}
                      </p>
                      <small>
                        {appointment.status === 'cancelled' ? (
                          <span className="status-badge cancelled">Cancelled</span>
                        ) : (
                          <span className="status-badge active">{appointment.status}</span>
                        )}
                      </small>
                    </div>

                    {appointment.status === 'cancelled' ? (
                      <span className="status-badge cancelled">Cancelled</span>
                    ) : (
                      <button
                        type="button"
                        className="cancel-button"
                        onClick={() => handleCancelAppointment(appointment.id)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
