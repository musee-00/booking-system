import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { API_BASE, NETWORK_ERROR, fetchJson, getErrorMessage, saveSession } from '../api.js'
import { SHOP } from '../shop.js'

export function AdminLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [adminMessage, setAdminMessage] = useState(
    location.state?.message ? { type: 'error', text: location.state.message } : { type: '', text: '' },
  )

  const handleAdminLogin = async (event) => {
    event.preventDefault()
    setAdminMessage({ type: '', text: '' })
    setIsLoggingIn(true)

    let result
    try {
      result = await fetchJson(`${API_BASE}/admin/login`, {
        method: 'POST',
        body: JSON.stringify({ username: adminUsername.trim(), password: adminPassword }),
      })
    } catch {
      setAdminMessage({ type: 'error', text: NETWORK_ERROR })
      return
    } finally {
      setIsLoggingIn(false)
    }

    const { response, data } = result
    if (!response.ok) {
      setAdminMessage({ type: 'error', text: getErrorMessage(data, 'Login failed.') })
      return
    }

    saveSession(data)
    setAdminMessage({ type: 'success', text: 'Logged in successfully.' })
    navigate('/admin/appointments')
  }

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-brand">
            <div className="brand-mark">{SHOP.initials}</div>
            <div>
              <p className="admin-eyebrow">Admin access</p>
              <h1>{SHOP.name}</h1>
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
                <input required autoComplete="username" value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} />
              </label>
              <label>
                Password
                <input type="password" required autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
              </label>
              {adminMessage.text && (
                <p className={`admin-status-message ${adminMessage.type}`}>{adminMessage.text}</p>
              )}
              <button type="submit" className="admin-primary-button" disabled={isLoggingIn}>
                {isLoggingIn ? 'Logging in…' : 'Log in'}
              </button>
            </form>
          </section>
        </main>
      </div>
    </div>
  )
}
