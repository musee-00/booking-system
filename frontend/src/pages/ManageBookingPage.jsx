import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_BASE, NETWORK_ERROR, fetchJson, getErrorMessage } from '../api.js'
import { SHOP, SHOP_ADDRESS, SHOP_PHONE_LINK } from '../shop.js'
import { ThemeToggle } from '../components/ThemeToggle.jsx'

const formatDate = (value) => new Date(value).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const formatTime = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const formatPrice = (amount) => `${Number(amount).toFixed(0)} kr`

const statusLabel = (booking) => {
  if (booking.status === 'cancelled') return 'Cancelled'
  if (new Date(booking.ends_at) < new Date()) return 'Passed'
  return 'Upcoming'
}

// Opened from the link in the confirmation email: /booking/<secret token>.
// No login: the token in the URL is the key (see backend manage_routes.py).
export function ManageBookingPage() {
  const { token } = useParams()
  const [booking, setBooking] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [isConfirming, setIsConfirming] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    let ignore = false
    fetchJson(`${API_BASE}/manage/${encodeURIComponent(token)}`)
      .then(({ response, data }) => {
        if (ignore) return
        if (response.ok) setBooking(data)
        else setLoadError(response.status === 404 ? 'not-found' : getErrorMessage(data, 'Something went wrong.'))
      })
      .catch(() => {
        if (!ignore) setLoadError(NETWORK_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [token])

  const cancelBooking = async () => {
    setIsCancelling(true)
    setMessage({ type: '', text: '' })
    try {
      const { response, data } = await fetchJson(`${API_BASE}/manage/${encodeURIComponent(token)}/cancel`, { method: 'POST' })
      if (!response.ok) {
        setMessage({ type: 'error', text: getErrorMessage(data, 'Your booking could not be cancelled.') })
        return
      }
      setBooking(data)
      setMessage({ type: 'success', text: 'Your booking is cancelled. A confirmation email is on its way.' })
    } catch {
      setMessage({ type: 'error', text: NETWORK_ERROR })
    } finally {
      setIsCancelling(false)
      setIsConfirming(false)
    }
  }

  let content
  if (loadError === 'not-found') {
    content = (
      <>
        <h2>This link isn't valid</h2>
        <p className="manage-booking__lead">
          Check that you opened the whole link from your confirmation email. If it still doesn't work,
          call us on <a href={SHOP_PHONE_LINK}>{SHOP.phone}</a>.
        </p>
        <Link to="/" className="primary-button">Go to the booking page</Link>
      </>
    )
  } else if (loadError) {
    content = <p className="status-message error" role="alert">{loadError}</p>
  } else if (!booking) {
    content = <p className="manage-booking__lead" aria-live="polite">Loading your booking…</p>
  } else {
    const status = statusLabel(booking)
    content = (
      <>
        <div className="manage-booking__heading">
          <h2>Your booking</h2>
          <span className={`manage-booking__status is-${status.toLowerCase()}`}>{status}</span>
        </div>
        <p className="manage-booking__lead">Hi {booking.customer_name.split(' ')[0]}, here are your booking details.</p>

        <div className="confirm-card">
          {[
            ['Service', booking.service_name],
            ['Barber', booking.barber_name],
            ['Date', formatDate(booking.starts_at)],
            ['Time', `${formatTime(booking.starts_at)} – ${formatTime(booking.ends_at)}`],
            ['Price', formatPrice(booking.price)],
            ['Address', SHOP_ADDRESS],
            ['Booking reference', `#${booking.id}`],
          ].map(([label, value]) => (
            <div key={label} className="confirm-row">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        {message.text && <p className={`status-message ${message.type}`} role="status">{message.text}</p>}

        {booking.can_cancel ? (
          isConfirming ? (
            <div className="manage-booking__confirm" role="alertdialog" aria-label="Confirm cancellation">
              <p>Cancel this booking? The time will be given to someone else.</p>
              <div className="booking-actions">
                <button type="button" className="secondary-button" onClick={() => setIsConfirming(false)} disabled={isCancelling}>
                  Keep my booking
                </button>
                <button type="button" className="primary-button manage-booking__danger" onClick={cancelBooking} disabled={isCancelling}>
                  {isCancelling ? 'Cancelling…' : 'Yes, cancel'}
                </button>
              </div>
            </div>
          ) : (
            <div className="booking-actions">
              <button type="button" className="secondary-button" onClick={() => setIsConfirming(true)}>Cancel booking</button>
            </div>
          )
        ) : (
          booking.status !== 'cancelled' && status !== 'Passed' && (
            <p className="manage-booking__lead">
              {booking.cancel_blocked_reason} Call <a href={SHOP_PHONE_LINK}>{SHOP.phone}</a>.
            </p>
          )
        )}

        {booking.status === 'cancelled' && (
          <div className="booking-actions">
            <Link to="/" className="primary-button">Book a new time</Link>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="premium-page">
      <header className="topbar">
        <Link to="/" className="topbar__brand">
          <div className="brand-mark">{SHOP.initials}</div>
          <span>{SHOP.shortName}</span>
        </Link>
        <div className="topbar__contact">
          <span>Call us</span>
          <a href={SHOP_PHONE_LINK}>{SHOP.phone}</a>
          <ThemeToggle />
        </div>
      </header>

      <main className="manage-booking">{content}</main>
    </div>
  )
}
