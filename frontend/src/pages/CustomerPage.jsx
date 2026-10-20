import { useEffect, useMemo, useState } from 'react'

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
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  return { response, data }
}

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
  const [slotAvailability, setSlotAvailability] = useState({})
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
  const [formErrors, setFormErrors] = useState({})
  const [bookingMessage, setBookingMessage] = useState({ type: '', text: '' })
  const [customerNotice, setCustomerNotice] = useState('')
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

  const getNextAvailableDate = () => weekDates.find((dayInfo) => !isPastDay(dayInfo.iso) && (slotAvailability[dayInfo.iso] || []).length > 0)

  const servicesWithImages = useMemo(
    () => services.map((service, index) => ({
      ...service,
      image: SERVICE_IMAGES[index % SERVICE_IMAGES.length],
    })),
    [services],
  )

  useEffect(() => {
    if (!selectedService || !barbers.length) {
      setSlotAvailability({})
      return
    }

    const relevantBarberIds = [Number(selectedBarberId)].filter(Boolean)

    if (!relevantBarberIds.length) {
      setSlotAvailability({})
      return
    }

    const fetchAvailability = async () => {
      const results = await Promise.all(
        weekDates.flatMap((dayInfo) => relevantBarberIds.map((barberId) => fetchJson(
          `${API_BASE}/availability?barber_id=${encodeURIComponent(barberId)}&service_id=${encodeURIComponent(selectedService.id)}&date=${dayInfo.iso}`,
        ))),
      )

      const aggregated = {}
      for (const { response, data } of results) {
        if (!response.ok) {
          continue
        }

        for (const slot of data) {
          const dateKey = String(slot.start).slice(0, 10)
          if (!aggregated[dateKey]) {
            aggregated[dateKey] = []
          }
          aggregated[dateKey].push({ ...slot, start: new Date(slot.start), end: new Date(slot.end) })
        }
      }

      for (const dayInfo of weekDates) {
        aggregated[dayInfo.iso] = (aggregated[dayInfo.iso] || []).sort((left, right) => new Date(left.start) - new Date(right.start))
      }

      setSlotAvailability(aggregated)
    }

    fetchAvailability()
  }, [barbers, selectedBarberId, selectedService, weekDates])

  const selectedDaySlots = slotAvailability[selectedDate] || []

  const validateBookingForm = (values = bookingForm) => {
    const nextErrors = {}
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!values.customer_name.trim()) {
      nextErrors.customer_name = 'Please enter your full name.'
    }

    if (!values.customer_phone.trim()) {
      nextErrors.customer_phone = 'Please enter your phone number.'
    }

    if (!values.customer_email.trim()) {
      nextErrors.customer_email = 'Please enter your email address.'
    } else if (!emailPattern.test(values.customer_email.trim())) {
      nextErrors.customer_email = 'Please enter a valid email address.'
    }

    return nextErrors
  }

  const currentStepIsValid = useMemo(() => {
    if (currentStep === STEP.SERVICE) {
      return Boolean(selectedService)
    }

    if (currentStep === STEP.BARBER) {
      return Boolean(selectedBarber)
    }

    if (currentStep === STEP.TIME) {
      return Boolean(selectedSlot)
    }

    if (currentStep === STEP.DETAILS) {
      const nextErrors = validateBookingForm()
      return Object.keys(nextErrors).length === 0
    }

    return true
  }, [bookingForm.customer_name, bookingForm.customer_phone, bookingForm.customer_email, currentStep, selectedService, selectedBarber, selectedBarberId, selectedSlot])

  const summaryBarber = selectedBarber?.name || 'Barber'

  const today = new Date()
  const todayIndex = today.getDay()
  const isOpenNow = todayIndex >= 2 && todayIndex <= 6 && today.getHours() >= 9 && today.getHours() < 18

  const fetchServices = async () => {
    const { response, data } = await fetchJson(`${API_BASE}/services`)
    if (response.ok) {
      setServices(data)
    }
  }

  const fetchBarbers = async () => {
    const { response, data } = await fetchJson(`${API_BASE}/barbers`)
    if (response.ok) {
      setBarbers(data)
    }
  }

  useEffect(() => {
    fetchServices()
    fetchBarbers()
  }, [])

  const resetBookingWizard = () => {
    setSelectedServiceId('')
    setSelectedBarberId('')
    setSelectedBarberProfile(null)
    setSelectedSlot(null)
    setBookingForm({ customer_name: '', customer_phone: '', customer_email: '' })
    setFormErrors({})
    setBookingMessage({ type: '', text: '' })
    setCurrentStep(0)
    setSelectedDate(formatDateValue(new Date(Date.now() + 86400000)))
    setIsBookingOpen(false)
    setIsSubmitting(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // The wizard can be opened from a service row, a barber profile, or the
  // generic "Book now" button. Start on the first question not yet answered.
  const openBooking = ({ serviceId = '', barberId = '' } = {}) => {
    setCustomerNotice('')
    setSelectedServiceId(String(serviceId))
    setSelectedBarberId(String(barberId))
    setSelectedBarberProfile(null)
    setSelectedSlot(null)
    setBookingForm({ customer_name: '', customer_phone: '', customer_email: '' })
    setFormErrors({})
    setBookingMessage({ type: '', text: '' })
    setCurrentStep(!serviceId ? STEP.SERVICE : !barberId ? STEP.BARBER : STEP.TIME)
    setSelectedDate(formatDateValue(new Date(Date.now() + 86400000)))
    setIsBookingOpen(true)
  }

  useEffect(() => {
    if (!selectedService || !weekDates.length) {
      return
    }

    const nextAvailable = getNextAvailableDate()
    if (nextAvailable && (slotAvailability[selectedDate] || []).length === 0) {
      setSelectedDate(nextAvailable.iso)
    }
  }, [selectedDate, selectedService, slotAvailability, weekDates])

  const handleNextStep = () => {
    if (!currentStepIsValid) return
    setCurrentStep((previous) => Math.min(previous + 1, WIZARD_STEPS.length - 1))
  }

  const handleDetailsContinue = () => {
    const errors = validateBookingForm()
    setFormErrors(errors)

    if (Object.keys(errors).length > 0) {
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
      customer_name: bookingForm.customer_name,
      customer_phone: bookingForm.customer_phone,
      customer_email: bookingForm.customer_email,
      starts_at: new Date(selectedSlot.start).toISOString(),
      ends_at: new Date(selectedSlot.end).toISOString(),
      notes: 'Booked via customer portal',
    }

    setIsSubmitting(true)
    setBookingMessage({ type: '', text: '' })

    const { response, data } = await fetchJson(`${API_BASE}/appointments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    setIsSubmitting(false)

    if (!response.ok) {
      const message = response.status === 409
        ? 'That slot was just taken. Please choose another one.'
        : data.detail || 'Booking could not be completed.'
      setBookingMessage({ type: 'error', text: message })
      return
    }

    const barberName = selectedBarber?.name || barbers.find((barber) => Number(barber.id) === Number(selectedSlot.barber_id))?.name || 'your barber'
    const confirmationNotice = `Booking confirmed! See you on ${formatDateLabel(selectedDate)} at ${formatTimeLabel(selectedSlot.start)} with ${barberName}`

    setCustomerNotice(confirmationNotice)
    setBookingMessage({ type: '', text: '' })
    setIsBookingOpen(false)
    setCurrentStep(0)
  }

  useEffect(() => {
    if (!customerNotice) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setCustomerNotice('')
      resetBookingWizard()
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [customerNotice])

  return (
    <div className="premium-page">
      {customerNotice && (
        <div className="customer-success-banner" role="status" aria-live="polite">
          {customerNotice}
        </div>
      )}

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
        <div className="booking-modal-backdrop" onClick={() => setIsBookingOpen(false)}>
          <div className="booking-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="section-kicker section-kicker--small">Book appointment</p>
                <h3>
                  {selectedService?.name || 'Choose a service'}
                  {selectedBarber && currentStep > STEP.BARBER && <small className="modal-header__barber"> with {selectedBarber.name}</small>}
                </h3>
              </div>
              <button type="button" className="close-button" onClick={() => setIsBookingOpen(false)}>×</button>
            </div>

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
                    <span>{selectedDaySlots.length} openings</span>
                  </div>

                  {selectedDaySlots.length === 0 ? (
                    <p className="empty-state">No available slots on this day.</p>
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

                <div className="modal-form-grid">
                  <label>
                    Full name
                    <input
                      type="text"
                      value={bookingForm.customer_name}
                      onChange={(event) => {
                        setBookingForm({ ...bookingForm, customer_name: event.target.value })
                        setFormErrors((current) => ({ ...current, customer_name: '' }))
                      }}
                      placeholder="Jane Smith"
                    />
                    {formErrors.customer_name && <span className="field-error">{formErrors.customer_name}</span>}
                  </label>

                  <label>
                    Phone number
                    <input
                      type="tel"
                      value={bookingForm.customer_phone}
                      onChange={(event) => {
                        setBookingForm({ ...bookingForm, customer_phone: event.target.value })
                        setFormErrors((current) => ({ ...current, customer_phone: '' }))
                      }}
                      placeholder="+46 70 123 45 67"
                    />
                    {formErrors.customer_phone && <span className="field-error">{formErrors.customer_phone}</span>}
                  </label>

                  <label className="full-width">
                    Email
                    <input
                      type="email"
                      required
                      value={bookingForm.customer_email}
                      onChange={(event) => {
                        setBookingForm({ ...bookingForm, customer_email: event.target.value })
                        setFormErrors((current) => ({ ...current, customer_email: '' }))
                      }}
                      placeholder="jane@example.com"
                    />
                    {formErrors.customer_email && <span className="field-error">{formErrors.customer_email}</span>}
                  </label>
                </div>

                <div className="booking-actions">
                  <button type="button" className="secondary-button" onClick={handlePreviousStep}>Back</button>
                  <button type="button" className="primary-button" onClick={handleDetailsContinue} disabled={!currentStepIsValid}>Continue</button>
                </div>
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
          </div>
        </div>
      )}
    </div>
  )
}
