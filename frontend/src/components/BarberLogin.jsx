import { useState } from 'react'
import { NETWORK_ERROR, getErrorMessage } from '../api.js'

// A random password the owner can hand to the barber (14 characters, no
// look-alike characters such as l/1 or O/0).
const generatePassword = () => {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(14))
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')
}

const suggestUsername = (name) => name.trim().split(/\s+/)[0].toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')

// Owner only: create, reset or remove a barber's own login (Setmore-style
// "Standard" access: they see and manage only their own calendar).
export function BarberLogin({ barber, account, adminFetch, onChanged, onClose }) {
  const [username, setUsername] = useState(() => suggestUsername(barber.name))
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState({ type: '', text: '' })
  const [isSaving, setIsSaving] = useState(false)

  const send = async (path, options, successText) => {
    setIsSaving(true)
    setMessage({ type: '', text: '' })
    try {
      const { response, data } = await adminFetch(path, options)
      if (response.status === 401) return false
      if (!response.ok) {
        setMessage({ type: 'error', text: getErrorMessage(data, 'Something went wrong.') })
        return false
      }
      setMessage({ type: 'success', text: successText })
      onChanged()
      return true
    } catch {
      setMessage({ type: 'error', text: NETWORK_ERROR })
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const createLogin = (event) => {
    event.preventDefault()
    send(
      '/accounts',
      { method: 'POST', body: JSON.stringify({ username, password, barber_id: barber.id }) },
      `Login created. Give ${barber.name} the username "${username.trim().toLowerCase()}" and the password.`,
    )
  }

  const resetPassword = async (event) => {
    event.preventDefault()
    const ok = await send(
      `/accounts/${account.id}/password`,
      { method: 'PUT', body: JSON.stringify({ password }) },
      `New password saved. Give it to ${barber.name}.`,
    )
    if (ok) setPassword('')
  }

  const removeLogin = () => {
    if (!window.confirm(`Remove ${barber.name}'s login? They won't be able to log in any more. Their bookings are kept.`)) return
    send(`/accounts/${account.id}`, { method: 'DELETE' }, 'Login removed.')
  }

  const passwordField = (label) => (
    <label>
      {label}
      <span className="admin-login-password">
        <input
          type="text"
          required
          minLength={10}
          maxLength={200}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 10 characters"
        />
        <button type="button" className="admin-secondary-button" onClick={() => setPassword(generatePassword())}>Generate</button>
      </span>
    </label>
  )

  return (
    <section className="admin-schedule" aria-label={`Login for ${barber.name}`}>
      <div className="admin-schedule__header">
        <h3>Login · {barber.name}</h3>
        <button type="button" className="admin-secondary-button" onClick={onClose}>Close</button>
      </div>
      <p className="admin-schedule__hint">
        With their own login, {barber.name.split(' ')[0]} sees and manages only their own bookings.
        Services, hours and other barbers stay with you.
      </p>

      {account ? (
        <>
          <p>Username: <strong>{account.username}</strong></p>
          <form className="admin-booking-form" onSubmit={resetPassword}>
            {passwordField('Set a new password')}
            <div className="admin-panel-actions">
              <button type="button" className="admin-secondary-button" onClick={removeLogin} disabled={isSaving}>Remove login</button>
              <button type="submit" className="admin-primary-button" disabled={isSaving}>Save new password</button>
            </div>
          </form>
        </>
      ) : (
        <form className="admin-booking-form" onSubmit={createLogin}>
          <label>
            Username
            <input
              type="text"
              required
              minLength={3}
              maxLength={80}
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          {passwordField('Password')}
          <div className="admin-panel-actions">
            <button type="submit" className="admin-primary-button" disabled={isSaving}>Create login</button>
          </div>
        </form>
      )}

      {message.text && <p className={`admin-status-message ${message.type}`} role="status">{message.text}</p>}
    </section>
  )
}
