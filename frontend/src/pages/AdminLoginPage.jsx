import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API_BASE = 'http://localhost:8000/api/v1'

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  return { response, data }
}

export function AdminLoginPage() {
  const navigate = useNavigate()
  const [adminUsername, setAdminUsername] = useState('admin')
  const [adminPassword, setAdminPassword] = useState('admin123')
  const [adminMessage, setAdminMessage] = useState({ type: '', text: '' })

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
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Admin access</p>
          <h1>North Street Studio</h1>
        </div>
      </header>

      <main className="layout single-column">
        <section className="panel admin-panel">
          <div className="panel-header">
            <h2>Admin login</h2>
            <span className="badge alt">JWT login</span>
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
              <p className={`status-message ${adminMessage.type}`}>{adminMessage.text}</p>
            )}
            <button type="submit" className="primary-button secondary">
              Log in
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}
