import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

const API_BASE = 'http://localhost:8000/api/v1'

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

export function AdminLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [adminUsername, setAdminUsername] = useState('admin')
  const [adminPassword, setAdminPassword] = useState('admin123')
  const [adminMessage, setAdminMessage] = useState(
    location.state?.message ? { type: 'error', text: location.state.message } : { type: '', text: '' },
  )

  const handleAdminLogin = async (event) => {
    event.preventDefault()
    setAdminMessage({ type: '', text: '' })

    const { response, data } = await fetchJson(`${API_BASE}/admin/login`, {
      method: 'POST',
      body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    })

    if (!response.ok) {
      setAdminMessage({ type: 'error', text: data.detail || 'Login failed.' })
      return
    }

    localStorage.setItem('booking-admin-token', data.token)
    setAdminMessage({ type: 'success', text: 'Logged in successfully.' })
    navigate('/admin/appointments')
  }

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-brand">
            <div className="brand-mark">NS</div>
            <div>
              <p className="admin-eyebrow">Admin access</p>
              <h1>North Street Studio</h1>
            </div>
          </div>

          <Link to="/" className="admin-secondary-button">Customer page</Link>
        </header>

        <main className="admin-main">
          <section className="admin-panel">
            <div className="admin-panel__header">
              <div>
                <p className="admin-kicker">Welcome</p>
                <h2>Admin login</h2>
              </div>
              <span className="admin-chip">JWT login</span>
            </div>

            <form onSubmit={handleAdminLogin} className="admin-form">
              <label>
                Username
                <input value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} />
              </label>
              <label>
                Password
                <input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
              </label>
              {adminMessage.text && (
                <p className={`admin-status-message ${adminMessage.type}`}>{adminMessage.text}</p>
              )}
              <button type="submit" className="admin-primary-button">
                Log in
              </button>
            </form>
          </section>
        </main>
      </div>
    </div>
  )
}
