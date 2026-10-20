import { useEffect, useMemo, useRef, useState } from 'react'

const API_BASE = 'http://localhost:8000/api/v1'
const NAV_ITEMS = [
  { label: 'Services', href: '#services' },
  { label: 'Team', href: '#team' },
  { label: 'Gallery', href: '#gallery' },
  { label: 'Reviews', href: '#reviews' },
  { label: 'Address', href: '#address' },
]

const GALLERY = [
  'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1517832606299-7ae9b720a186?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1585747860679-3b1d1d5793d0?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=900&q=80',
]

const REVIEWS = [
  { name: 'Sam', text: 'Best fade in town. The whole experience feels premium and relaxed.' },
  { name: 'Alex', text: 'Sharp cut, clean atmosphere, and the team genuinely listens.' },
  { name: 'Jamie', text: 'Efficient, friendly, and the beard trim was exactly right.' },
]

const SERVICE_IMAGES = [
  'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1521341057461-6eb5f40b07ab?auto=format&fit=crop&w=900&q=80',
]

const SHOP_ADDRESS = '27 North Street, Gothenburg'
const SHOP_PHONE = '+46 70 123 45 67'

const WIZARD_STEPS = ['Service', 'Barber', 'Time', 'Details', 'Confirm']
const STEP = { SERVICE: 0, BARBER: 1, TIME: 2, DETAILS: 3, CONFIRM: 4 }

// Build YYYY-MM-DD from local date parts. toISOString() would convert to UTC
// and shift the day backwards in timezones ahead of UTC (e.g. Sweden).
const formatDateValue = (date) => {
  const value = new Date(date)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatDateLabel = (dateValue) =>
  new Date(`${dateValue}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

const formatDateLong = (dateValue) =>
  new Date(dateValue).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

const formatTimeLabel = (dateValue) =>
  new Date(dateValue).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

const formatPrice = (amount) => `${Number(amount).toFixed(0)} kr`

const getBarberInitials = (name = '') => {
  const parts = name.split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'NS'
}

const buildWeekDates = () => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      iso: formatDateValue(date),
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      day: date.toLocaleDateString(undefined, { day: 'numeric' }),
    }
  })
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

const DETAIL_FIELDS = [
  { name: 'customer_name', label: 'Full name', type: 'text', autoComplete: 'name', placeholder: 'Jane Smith' },
  { name: 'customer_phone', label: 'Phone number', type: 'tel', autoComplete: 'tel', placeholder: '+46 70 123 45 67' },
  {
    name: 'customer_email',
    label: 'Email',
    type: 'email',
    autoComplete: 'email',
    placeholder: 'jane@example.com',
    hint: "We'll send your booking confirmation here.",
    fullWidth: true,
  },
]

const NO_SLOTS = {}

const NETWORK_ERROR = "We can't reach the booking server right now. Check your connection and try again."

// Same rules as the API (backend/app/schemas.py), so most mistakes are caught
// before the request is sent.
const PHONE_PATTERN = /^\+?[0-9(][0-9 ()-]*[0-9]$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FIELD_MESSAGES = {
  customer_name: 'Please enter your full name.',
  customer_phone: 'Please enter a valid phone number, e.g. +46 70 123 45 67.',
  customer_email: 'Please enter a valid email address, e.g. jane@example.com.',
}

const validateBookingForm = (values) => {
  const errors = {}
  const name = values.customer_name.trim()
  const phone = values.customer_phone.trim()
  const email = values.customer_email.trim()

  if (!name || name.length > 150) errors.customer_name = FIELD_MESSAGES.customer_name
  if (!PHONE_PATTERN.test(phone) || phone.length < 6 || phone.length > 30) errors.customer_phone = FIELD_MESSAGES.customer_phone
  if (!EMAIL_PATTERN.test(email) || email.length > 254) errors.customer_email = FIELD_MESSAGES.customer_email

  return errors
}

// FastAPI sends `detail` as a string for our own errors (400/404/409), but as a
// list of field errors for validation failures (422). Turn the list into
// { field: message } so it can be shown next to the right input.
const getFieldErrors = (detail) => {
  if (!Array.isArray(detail)) return {}
  return Object.fromEntries(
    detail
      .map((error) => error.loc?.[error.loc.length - 1])
      .filter((field) => field in FIELD_MESSAGES)
      .map((field) => [field, FIELD_MESSAGES[field]]),
  )
}

const getErrorMessage = (data, fallback) => (typeof data?.detail === 'string' ? data.detail : fallback)

const normalizeSlot = (slot) => (
  slot
    ? {
        ...slot,
        start: slot.start ? new Date(slot.start) : null,
        end: slot.end ? new Date(slot.end) : null,
      }
    : null
)

export function CustomerPage() {
  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  // Free slots are stored with the barber/service `key` they were fetched for.
  // If the key doesn't match the current selection, the data is still loading.
  const [availability, setAvailability] = useState({ key: '', slots: {}, error: false })
  const [availabilityRetry, setAvailabilityRetry] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [isBookingOpen, setIsBookingOpen] = useState(false)
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [currentStep, setCurrentStep] = useState(0)
  const [selectedBarberId, setSelectedBarberId] = useState('')
  const [selectedBarberProfile, setSelectedBarberProfile] = useState(null)
  const [selectedDate, setSelectedDate] = useState(formatDateValue(new Date(Date.now() + 86400000)))
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [bookingForm, setBookingForm] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
  })
  const [touchedFields, setTouchedFields] = useState({})
  const [serverErrors, setServerErrors] = useState({})
  const [bookingMessage, setBookingMessage] = useState({ type: '', text: '' })
  // Set after a successful booking; while set, the modal shows the success view.
  const [confirmedBooking, setConfirmedBooking] = useState(null)
  const successHeadingRef = useRef(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const weekDates = useMemo(() => buildWeekDates(), [])

  const selectedService = useMemo(
    () => services.find((service) => String(service.id) === String(selectedServiceId)) || null,
    [services, selectedServiceId],
  )

  const selectedBarber = useMemo(
    () => barbers.find((barber) => String(barber.id) === String(selectedBarberId)) || null,
    [barbers, selectedBarberId],
  )

  const isPastDay = (dateString) => new Date(`${dateString}T00:00:00`) < new Date(new Date().setHours(0, 0, 0, 0))

  const servicesWithImages = useMemo(
    () => services.map((service, index) => ({
      ...service,
      image: SERVICE_IMAGES[index % SERVICE_IMAGES.length],
    })),
    [services],
  )

  const availabilityKey = selectedService && selectedBarberId
    ? `${selectedBarberId}:${selectedService.id}:${availabilityRetry}`
    : ''
  const isLoadingSlots = Boolean(availabilityKey) && availability.key !== availabilityKey
  const hasAvailabilityError = !isLoadingSlots && availability.key === availabilityKey && availability.error
  const slotAvailability = availability.key === availabilityKey ? availability.slots : NO_SLOTS

  useEffect(() => {
    if (!availabilityKey) {
      return undefined
    }

    // If the customer switches barber/service before this finishes, the cleanup
    // sets `ignore` so a slow, outdated response can't overwrite the new one.
    let ignore = false

    const fetchAvailability = async () => {
      try {
        const results = await Promise.all(
          weekDates.map((dayInfo) => fetchJson(
            `${API_BASE}/availability?barber_id=${encodeURIComponent(selectedBarberId)}&service_id=${encodeURIComponent(selectedService.id)}&date=${dayInfo.iso}`,
          )),
        )

        if (results.some(({ response }) => !response.ok)) {
          throw new Error('Availability request failed')
        }

        const slotsByDay = Object.fromEntries(
          weekDates.map((dayInfo, index) => [
            dayInfo.iso,
            results[index].data
              .map((slot) => ({ ...slot, start: new Date(slot.start), end: new Date(slot.end) }))
              .sort((left, right) => left.start - right.start),
          ]),
        )

        if (ignore) return
        setAvailability({ key: availabilityKey, slots: slotsByDay, error: false })
        // Keep the chosen day if it has free times, otherwise jump to the first day that does.
        setSelectedDate((current) => (
          slotsByDay[current]?.length ? current : weekDates.find((dayInfo) => slotsByDay[dayInfo.iso].length)?.iso ?? current
        ))
      } catch {
        if (!ignore) setAvailability({ key: availabilityKey, slots: {}, error: true })
      }
    }

    fetchAvailability()
    return () => {
      ignore = true
    }
  }, [availabilityKey, selectedBarberId, selectedService, weekDates])

  const selectedDaySlots = slotAvailability[selectedDate] || []

  const liveErrors = useMemo(() => validateBookingForm(bookingForm), [bookingForm])

  // Show a field's error once the customer has left the field (or pressed
  // Continue), not while they are still typing the first characters.
  const getFieldError = (field) => (touchedFields[field] && liveErrors[field]) || serverErrors[field] || ''

  const updateBookingField = (field, value) => {
    setBookingForm((current) => ({ ...current, [field]: value }))
    setServerErrors((current) => ({ ...current, [field]: '' }))
  }

  const touchField = (field) => setTouchedFields((current) => ({ ...current, [field]: true }))

  const summaryBarber = selectedBarber?.name || 'Barber'

  const today = new Date()
  const todayIndex = today.getDay()
  const isOpenNow = todayIndex >= 2 && todayIndex <= 6 && today.getHours() >= 9 && today.getHours() < 18

  useEffect(() => {
    const loadShopData = async () => {
      try {
        const [servicesResult, barbersResult] = await Promise.all([
          fetchJson(`${API_BASE}/services`),
          fetchJson(`${API_BASE}/barbers`),
        ])

        if (!servicesResult.response.ok || !barbersResult.response.ok) {
          throw new Error('Could not load services or barbers')
        }

        setServices(servicesResult.data)
        setBarbers(barbersResult.data)
      } catch {
        setLoadError("We couldn't load our services right now. Please refresh the page in a moment.")
      }
    }

    loadShopData()
  }, [])

  const resetBookingWizard = () => {
    setConfirmedBooking(null)
    setSelectedServiceId('')
    setSelectedBarberId('')
    setSelectedBarberProfile(null)
    setSelectedSlot(null)
    setBookingForm({ customer_name: '', customer_phone: '', customer_email: '' })
    setTouchedFields({})
    setServerErrors({})
    setBookingMessage({ type: '', text: '' })
    setCurrentStep(0)
    setSelectedDate(formatDateValue(new Date(Date.now() + 86400000)))
    setIsBookingOpen(false)
    setIsSubmitting(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // The wizard can be opened from a service row, a barber profile, or the
  // generic "Book now" button. Start on the first question not yet answered.
  const openBooking = ({ serviceId = '', barberId = '', keepCustomerDetails = false } = {}) => {
    setConfirmedBooking(null)
    setSelectedServiceId(String(serviceId))
    setSelectedBarberId(String(barberId))
    setSelectedBarberProfile(null)
    setSelectedSlot(null)
    if (!keepCustomerDetails) {
      setBookingForm({ customer_name: '', customer_phone: '', customer_email: '' })
    }
    setTouchedFields({})
    setServerErrors({})
    setBookingMessage({ type: '', text: '' })
    setCurrentStep(!serviceId ? STEP.SERVICE : !barberId ? STEP.BARBER : STEP.TIME)
    setSelectedDate(formatDateValue(new Date(Date.now() + 86400000)))
    setIsBookingOpen(true)
  }

  const handleDetailsContinue = () => {
    // Mark every field as touched so all remaining errors become visible.
    setTouchedFields({ customer_name: true, customer_phone: true, customer_email: true })

    if (Object.keys(liveErrors).length > 0) {
      return
    }

    setCurrentStep(STEP.CONFIRM)
  }

  const handlePreviousStep = () => {
    setCurrentStep((previous) => Math.max(previous - 1, 0))
  }

  // Slots depend on both service (duration) and barber, so changing either
  // one clears any previously picked time.
  const handleServiceSelect = (serviceId) => {
    setSelectedServiceId(String(serviceId))
    setSelectedSlot(null)
    setCurrentStep(selectedBarberId ? STEP.TIME : STEP.BARBER)
  }

  const handleBarberSelect = (barberId) => {
    setSelectedBarberId(String(barberId))
    setSelectedSlot(null)
    setCurrentStep(STEP.TIME)
  }

  const handleSlotSelect = (slot) => {
    const normalizedSlot = normalizeSlot(slot)
    setSelectedSlot(normalizedSlot)
    setBookingMessage({ type: '', text: '' })
    setCurrentStep(STEP.DETAILS)
  }

  const handleBookAppointment = async () => {
    if (!selectedService || !selectedSlot) {
      setBookingMessage({ type: 'error', text: 'Choose a service and a free slot before confirming.' })
      return
    }

    const payload = {
      barber_id: Number(selectedSlot.barber_id || selectedBarberId),
      service_id: Number(selectedService.id),
      customer_name: bookingForm.customer_name.trim(),
      customer_phone: bookingForm.customer_phone.trim(),
      customer_email: bookingForm.customer_email.trim(),
      starts_at: new Date(selectedSlot.start).toISOString(),
      ends_at: new Date(selectedSlot.end).toISOString(),
      notes: 'Booked via customer portal',
    }

    setIsSubmitting(true)
    setBookingMessage({ type: '', text: '' })

    let result
    try {
      result = await fetchJson(`${API_BASE}/appointments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch {
      setBookingMessage({ type: 'error', text: NETWORK_ERROR })
      return
    } finally {
      setIsSubmitting(false)
    }

    const { response, data } = result

    if (response.status === 409) {
      // Someone else got this time first: go back, refresh the slots, pick again.
      setSelectedSlot(null)
      setAvailabilityRetry((count) => count + 1)
      setCurrentStep(STEP.TIME)
      setBookingMessage({ type: 'error', text: 'Sorry, that time was just booked by someone else. Please choose another time.' })
      return
    }

    const fieldErrors = response.status === 422 ? getFieldErrors(data.detail) : {}
    if (Object.keys(fieldErrors).length > 0) {
      setServerErrors(fieldErrors)
      setCurrentStep(STEP.DETAILS)
      return
    }

    if (!response.ok) {
      setBookingMessage({ type: 'error', text: getErrorMessage(data, 'Your booking could not be completed. Please try again.') })
      return
    }

    // Snapshot what was booked, so the summary doesn't change if the wizard state does.
    setConfirmedBooking({
      id: data.id,
      serviceName: selectedService.name,
      barberName: selectedBarber?.name || 'your barber',
      start: new Date(data.starts_at),
      end: new Date(data.ends_at),
      price: selectedService.price,
      email: data.customer_email,
    })
    setBookingMessage({ type: '', text: '' })
  }

  // Move keyboard/screen-reader focus to the success heading so it is announced.
  useEffect(() => {
    if (confirmedBooking) successHeadingRef.current?.focus()
  }, [confirmedBooking])

  // Closing after a booking resets the wizard; closing mid-way keeps the progress.
  const closeBooking = () => {
    if (confirmedBooking) {
      resetBookingWizard()
    } else {
      setIsBookingOpen(false)
    }
  }

  return (
    <div className="premium-page">
      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-mark">NS</div>
          <span>North Street</span>
        </div>

        <nav className="topbar__nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <a key={item.label} href={item.href}>{item.label}</a>
          ))}
        </nav>

        <div className="topbar__contact">
          <span>Call us</span>
          <a href="tel:+46701234567">+46 70 123 45 67</a>
        </div>
      </header>

      <main className="page-content">
        <section className="hero-section">
          <div className="hero-image" aria-label="Studio interior" />
          <div className="hero-overlay" />
        </section>

        <div className="content-grid">
          <section id="services" className="content-column">
            <div className="section-header">
              <p className="section-kicker">Services</p>
              <h2>Cut, refine, repeat.</h2>
            </div>

            {loadError && <p className="status-message error" role="alert">{loadError}</p>}

            <div className="service-list">
              {servicesWithImages.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  className="service-row"
                  onClick={() => openBooking({ serviceId: service.id })}
                >
                  <div className="service-thumb" style={{ backgroundImage: `url(${service.image})` }} aria-hidden="true" />
                  <div className="service-row__text">
                    <strong>{service.name}</strong>
                    {service.description && <small>{service.description}</small>}
                    <span>{service.duration_minutes} mins · {formatPrice(service.price)}</span>
                  </div>
                  <span className="service-arrow">›</span>
                </button>
              ))}
            </div>
          </section>

          <aside className="booking-sidecard">
            <div className="sidecard-brand">
              <div className="brand-mark brand-mark--dark">NS</div>
              <div>
                <p className="section-kicker section-kicker--small">Barber studio</p>
                <h3>North Street</h3>
              </div>
            </div>

            <button type="button" className="primary-button" onClick={() => openBooking()}>
              Book now
            </button>

            <div className="status-box">
              <div className={`status-dot ${isOpenNow ? 'open' : 'closed'}`} />
              <div>
                <strong>{isOpenNow ? 'Open now' : 'Closed now'}</strong>
                <span>Today · Tue–Sat · 09:00–18:00</span>
              </div>
            </div>

            <div className="address-block">
              <p>Address</p>
              <strong>27 North Street</strong>
              <span>Gothenburg</span>
            </div>
          </aside>
        </div>

        <section id="team" className="info-section">
          <div className="section-header">
            <p className="section-kicker">Team</p>
            <h2>Meet the barbers.</h2>
          </div>

          <div className="team-grid">
            {barbers.map((barber) => (
              <button key={barber.id} type="button" className="team-card" onClick={() => setSelectedBarberProfile(barber)}>
                <div className="team-card__photo">
                  {barber.photo_url ? (
                    <img src={barber.photo_url} alt={barber.name} />
                  ) : (
                    <span>{getBarberInitials(barber.name)}</span>
                  )}
                </div>

                <div className="team-card__body">
                  <strong>{barber.name}</strong>
                  <span>{barber.role || 'Barber'}</span>
                </div>

                <span className="team-card__arrow">›</span>
              </button>
            ))}
          </div>
        </section>

        <section id="gallery" className="info-section">
          <div className="section-header">
            <p className="section-kicker">Gallery</p>
            <h2>Our latest work.</h2>
          </div>

          <div className="gallery-grid">
            {GALLERY.map((image) => (
              <div key={image} className="gallery-tile" style={{ backgroundImage: `url(${image})` }} aria-label="Studio gallery" />
            ))}
          </div>
        </section>

        <section id="reviews" className="info-section">
          <div className="section-header">
            <p className="section-kicker">Reviews</p>
            <h2>Clients keep coming back.</h2>
          </div>

          <div className="review-grid">
            {REVIEWS.map((review) => (
              <article key={review.name} className="review-card">
                <div className="stars" aria-label="5 star review">★★★★★</div>
                <p>“{review.text}”</p>
                <strong>{review.name}</strong>
              </article>
            ))}
          </div>
        </section>

        <section id="address" className="info-section address-section">
          <div className="section-header">
            <p className="section-kicker">Address</p>
            <h2>Find us downtown.</h2>
          </div>

          <div className="address-card">
            <div>
              <strong>North Street Studio</strong>
              <p>27 North Street<br />Gothenburg</p>
              <p>Tue–Sat · 09:00–18:00</p>
            </div>
            <div className="map-placeholder" aria-label="Map placeholder" />
          </div>
        </section>
      </main>

      <footer className="customer-footer">
        <a href="/admin">Staff login</a>
      </footer>

      {selectedBarberProfile && (
        <div className="booking-modal-backdrop" onClick={() => setSelectedBarberProfile(null)}>
          <div className="barber-profile-panel" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="close-button" onClick={() => setSelectedBarberProfile(null)}>×</button>

            <div className="barber-profile-header">
              <div className="barber-profile-photo">
                {selectedBarberProfile.photo_url ? (
                  <img src={selectedBarberProfile.photo_url} alt={selectedBarberProfile.name} />
                ) : (
                  <span>{getBarberInitials(selectedBarberProfile.name)}</span>
                )}
              </div>

              <div>
                <p className="section-kicker section-kicker--small">Barber</p>
                <h3>{selectedBarberProfile.name}</h3>
                <span className="barber-profile-role">{selectedBarberProfile.role || 'Barber'}</span>
              </div>
            </div>

            <p className="barber-profile-bio">{selectedBarberProfile.bio || 'A talented barber dedicated to clean cuts, modern finishing, and a comfortable client experience.'}</p>

            <div className="barber-profile-services">
              <strong>Services</strong>
              <ul>
                {services.map((service) => (
                  <li key={service.id}>{service.name}</li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              className="primary-button"
              onClick={() => openBooking({ barberId: selectedBarberProfile.id })}
            >
              Book with {selectedBarberProfile.name}
            </button>
          </div>
        </div>
      )}

      {isBookingOpen && (
        <div className="booking-modal-backdrop" onClick={closeBooking}>
          <div className="booking-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="section-kicker section-kicker--small">{confirmedBooking ? 'Booking confirmed' : 'Book appointment'}</p>
                <h3>
                  {selectedService?.name || 'Choose a service'}
                  {selectedBarber && currentStep > STEP.BARBER && <small className="modal-header__barber"> with {selectedBarber.name}</small>}
                </h3>
              </div>
              <button type="button" className="close-button" onClick={closeBooking} aria-label="Close">×</button>
            </div>

            {confirmedBooking && (
              <div className="booking-step-panel booking-success">
                <div className="booking-success__icon" aria-hidden="true">✓</div>
                <div className="section-header small-header">
                  <h2 ref={successHeadingRef} tabIndex={-1}>You're booked!</h2>
                  <p className="booking-success__lead">
                    See you on {formatDateLong(confirmedBooking.start)} at {formatTimeLabel(confirmedBooking.start)} with {confirmedBooking.barberName}.
                  </p>
                </div>

                <div className="confirm-card">
                  {[
                    ['Service', confirmedBooking.serviceName],
                    ['Barber', confirmedBooking.barberName],
                    ['Date', formatDateLong(confirmedBooking.start)],
                    ['Time', `${formatTimeLabel(confirmedBooking.start)} – ${formatTimeLabel(confirmedBooking.end)}`],
                    ['Price', formatPrice(confirmedBooking.price)],
                    ['Address', SHOP_ADDRESS],
                    ['Booking reference', `#${confirmedBooking.id}`],
                  ].map(([label, value]) => (
                    <div key={label} className="confirm-row">
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>

                <div className="booking-success__notes">
                  <p>
                    A confirmation email is on its way to <strong>{confirmedBooking.email}</strong>.
                    If you can't find it in a few minutes, check your junk or spam folder.
                  </p>
                  <p>Need to change or cancel? Call us on <a href={`tel:${SHOP_PHONE.replace(/\s/g, '')}`}>{SHOP_PHONE}</a>.</p>
                </div>

                <div className="booking-actions">
                  <button type="button" className="secondary-button" onClick={() => openBooking({ keepCustomerDetails: true })}>
                    Book another
                  </button>
                  <button type="button" className="primary-button" onClick={resetBookingWizard}>Done</button>
                </div>
              </div>
            )}

            {!confirmedBooking && (
              <>
                <div className="booking-modal__stepper" aria-label="Booking steps">
                  {WIZARD_STEPS.map((step, index) => (
                    <div key={step} className={`modal-step ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'done' : ''}`}>
                      {index + 1}
                      <span>{step}</span>
                    </div>
                  ))}
                </div>

                {currentStep === STEP.SERVICE && (
                  <div className="booking-step-panel">
                    <div className="section-header small-header">
                      <p className="section-kicker">Step 1</p>
                      <h2>Choose a service</h2>
                    </div>

                    <div className="service-list">
                      {servicesWithImages.map((service) => (
                        <button
                          key={service.id}
                          type="button"
                          className={`service-row ${String(service.id) === String(selectedServiceId) ? 'selected' : ''}`}
                          onClick={() => handleServiceSelect(service.id)}
                        >
                          <div className="service-thumb" style={{ backgroundImage: `url(${service.image})` }} aria-hidden="true" />
                          <div className="service-row__text">
                            <strong>{service.name}</strong>
                            {service.description && <small>{service.description}</small>}
                            <span>{service.duration_minutes} mins · {formatPrice(service.price)}</span>
                          </div>
                          <span className="service-arrow">›</span>
                        </button>
                      ))}
                    </div>

                    <div className="booking-actions">
                      <button type="button" className="secondary-button" onClick={() => setIsBookingOpen(false)}>Cancel</button>
                    </div>
                  </div>
                )}

                {currentStep === STEP.BARBER && (
                  <div className="booking-step-panel">
                    <div className="section-header small-header">
                      <p className="section-kicker">Step 2</p>
                      <h2>Choose your barber</h2>
                    </div>

                    <div className="modal-barber-grid">
                      {barbers.map((barber) => (
                        <button
                          key={barber.id}
                          type="button"
                          className={`barber-option ${String(barber.id) === String(selectedBarberId) ? 'selected' : ''}`}
                          onClick={() => handleBarberSelect(barber.id)}
                        >
                          <div className="barber-option__photo">
                            {barber.photo_url ? (
                              <img src={barber.photo_url} alt={barber.name} />
                            ) : (
                              <span>{getBarberInitials(barber.name)}</span>
                            )}
                          </div>

                          <div className="barber-option__body">
                            <strong>{barber.name}</strong>
                            <small>{barber.role || 'Barber'}</small>
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="booking-actions">
                      <button type="button" className="secondary-button" onClick={handlePreviousStep}>Back</button>
                    </div>
                  </div>
                )}

                {currentStep === STEP.TIME && (
                  <div className="booking-step-panel">
                    <div className="section-header small-header">
                      <p className="section-kicker">Step 3</p>
                      <h2>Pick a time</h2>
                    </div>

                    <div className="day-picker">
                      {weekDates.map((dayInfo) => (
                        <button
                          key={dayInfo.iso}
                          type="button"
                          className={`day-pill ${selectedDate === dayInfo.iso ? 'selected' : ''}`}
                          onClick={() => setSelectedDate(dayInfo.iso)}
                          disabled={isPastDay(dayInfo.iso) || (slotAvailability[dayInfo.iso] || []).length === 0}
                        >
                          <span>{dayInfo.label}</span>
                          <strong>{dayInfo.day}</strong>
                        </button>
                      ))}
                    </div>

                    <div className="slot-panel modal-slot-panel">
                      <div className="slot-panel__header">
                        <h3>{formatDateLabel(selectedDate)}</h3>
                        <span>{isLoadingSlots ? 'Loading…' : `${selectedDaySlots.length} openings`}</span>
                      </div>

                      {bookingMessage.text && (
                        <p className={`status-message ${bookingMessage.type}`} role="alert">{bookingMessage.text}</p>
                      )}

                      {isLoadingSlots ? (
                        <p className="empty-state" aria-live="polite">Finding free times…</p>
                      ) : hasAvailabilityError ? (
                        <div className="status-message error" role="alert">
                          <p>We couldn't load free times. Check your connection and try again.</p>
                          <button type="button" className="secondary-button" onClick={() => setAvailabilityRetry((count) => count + 1)}>
                            Try again
                          </button>
                        </div>
                      ) : Object.values(slotAvailability).every((daySlots) => daySlots.length === 0) ? (
                        <p className="empty-state">No free times with {selectedBarber?.name || 'this barber'} in the next 7 days. Try another barber.</p>
                      ) : selectedDaySlots.length === 0 ? (
                        <p className="empty-state">No free times on this day. Pick another day above.</p>
                      ) : (
                        <div className="slot-grid">
                          {selectedDaySlots.map((slot, index) => {
                            const normalizedSlot = normalizeSlot(slot)
                            const slotStartKey = normalizedSlot?.start instanceof Date ? normalizedSlot.start.toISOString() : ''
                            const isSelected = Boolean(
                              selectedSlot
                              && normalizedSlot
                              && selectedSlot.start instanceof Date
                              && normalizedSlot.start instanceof Date
                              && selectedSlot.start.toISOString() === slotStartKey
                              && Number(selectedSlot.barber_id) === Number(normalizedSlot.barber_id),
                            )

                            return (
                              <button
                                key={`${normalizedSlot?.barber_id ?? slot.barber_id}-${slotStartKey || index}`}
                                type="button"
                                className={`slot-button ${isSelected ? 'selected' : ''}`}
                                onClick={() => handleSlotSelect(normalizedSlot)}
                              >
                                <span>{formatTimeLabel(normalizedSlot?.start ?? slot.start)} – {formatTimeLabel(normalizedSlot?.end ?? slot.end)}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div className="booking-actions">
                      <button type="button" className="secondary-button" onClick={handlePreviousStep}>Back</button>
                    </div>
                  </div>
                )}

                {currentStep === STEP.DETAILS && (
                  <div className="booking-step-panel">
                    <div className="section-header small-header">
                      <p className="section-kicker">Step 4</p>
                      <h2>Your details</h2>
                    </div>

                    <form
                      className="modal-form-grid"
                      noValidate
                      onSubmit={(event) => {
                        event.preventDefault()
                        handleDetailsContinue()
                      }}
                    >
                      {DETAIL_FIELDS.map((field) => {
                        const error = getFieldError(field.name)
                        const errorId = `${field.name}-error`

                        return (
                          <label key={field.name} className={field.fullWidth ? 'full-width' : undefined}>
                            {field.label}
                            <input
                              type={field.type}
                              name={field.name}
                              autoComplete={field.autoComplete}
                              value={bookingForm[field.name]}
                              onChange={(event) => updateBookingField(field.name, event.target.value)}
                              onBlur={() => touchField(field.name)}
                              placeholder={field.placeholder}
                              aria-invalid={Boolean(error)}
                              aria-describedby={error ? errorId : undefined}
                            />
                            {error
                              ? <span id={errorId} className="field-error" role="alert">{error}</span>
                              : field.hint && <small className="field-hint">{field.hint}</small>}
                          </label>
                        )
                      })}

                      <div className="booking-actions full-width">
                        <button type="button" className="secondary-button" onClick={handlePreviousStep}>Back</button>
                        <button type="submit" className="primary-button">Continue</button>
                      </div>
                    </form>
                  </div>
                )}

                {currentStep === STEP.CONFIRM && (
                  <div className="booking-step-panel">
                    <div className="section-header small-header">
                      <p className="section-kicker">Step 5</p>
                      <h2>Confirm booking</h2>
                    </div>

                    <div className="confirm-card">
                      <div className="confirm-row">
                        <span>Service</span>
                        <strong>{selectedService?.name}</strong>
                      </div>
                      <div className="confirm-row">
                        <span>Barber</span>
                        <strong>{summaryBarber}</strong>
                      </div>
                      <div className="confirm-row">
                        <span>Date</span>
                        <strong>{formatDateLabel(selectedDate)}</strong>
                      </div>
                      <div className="confirm-row">
                        <span>Time</span>
                        <strong>{selectedSlot ? `${formatTimeLabel(selectedSlot.start)} – ${formatTimeLabel(selectedSlot.end)}` : '—'}</strong>
                      </div>
                      <div className="confirm-row">
                        <span>Price</span>
                        <strong>{selectedService ? formatPrice(selectedService.price) : '—'}</strong>
                      </div>
                      <div className="confirm-row">
                        <span>Customer</span>
                        <strong>{bookingForm.customer_name}</strong>
                      </div>
                    </div>

                    {bookingMessage.text && (
                      <p className={`status-message ${bookingMessage.type}`}>{bookingMessage.text}</p>
                    )}

                    <div className="booking-actions">
                      <button type="button" className="secondary-button" onClick={handlePreviousStep}>Back</button>
                      <button type="button" className="primary-button" onClick={handleBookAppointment} disabled={isSubmitting || !selectedSlot || !selectedService}>
                        {isSubmitting ? 'Confirming...' : 'Confirm booking'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
