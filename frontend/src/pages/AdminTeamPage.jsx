import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NETWORK_ERROR, clearSession, getErrorMessage, useAdminFetch } from '../api.js'
import { BarberLogin } from '../components/BarberLogin.jsx'
import { BarberSchedule } from '../components/BarberSchedule.jsx'

const DEFAULT_BARBER_COLOR = '#d9b57f'

// Form fields per kind. `required` and the input types give native browser
// validation; the API validates again on save.
const FORMS = {
  barber: {
    path: '/barbers',
    label: 'barber',
    empty: { name: '', role: '', email: '', phone: '', photo_url: '', color: DEFAULT_BARBER_COLOR, bio: '' },
    fields: [
      { name: 'name', label: 'Name', required: true, maxLength: 150 },
      { name: 'role', label: 'Role', placeholder: 'Barber' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'photo_url', label: 'Photo URL', type: 'url', placeholder: 'https://…' },
      { name: 'color', label: 'Calendar colour', type: 'color' },
      { name: 'bio', label: 'Bio', textarea: true },
    ],
  },
  service: {
    path: '/services',
    label: 'service',
    empty: { name: '', duration_minutes: '30', price: '', description: '', barber_ids: [] },
    fields: [
      { name: 'name', label: 'Name', required: true, maxLength: 150 },
      { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', required: true, min: 5, max: 480, step: 5 },
      { name: 'price', label: 'Price (kr)', type: 'number', required: true, min: 0, step: 1 },
      { name: 'description', label: 'Description', textarea: true },
      // Like Setmore: each service is assigned to the barbers who provide it.
      { name: 'barber_ids', label: 'Offered by', type: 'barbers' },
    ],
  },
}

const formatPrice = (amount) => `${Number(amount).toFixed(0)} kr`

// Turn form values into the API payload: trim text, send empty optional fields
// as null, and send numbers as numbers.
const toPayload = (kind, values) => {
  const payload = Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const trimmed = typeof value === 'string' ? value.trim() : value
      return [key, trimmed === '' ? null : trimmed]
    }),
  )

  if (kind === 'service') {
    payload.duration_minutes = Number(payload.duration_minutes)
    payload.price = String(payload.price)
  }
  return payload
}

// Turn an API record into form values (null -> '' so inputs stay controlled;
// lists such as barber_ids stay lists).
const toFormValues = (kind, record) => Object.fromEntries(
  Object.keys(FORMS[kind].empty).map((key) => {
    const value = record[key]
    if (Array.isArray(value)) return [key, [...value]]
    return [key, value == null ? '' : String(value)]
  }),
)

export function AdminTeamPage() {
  const navigate = useNavigate()
  const adminFetch = useAdminFetch()
  const [barbers, setBarbers] = useState([])
  const [services, setServices] = useState([])
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState({ type: '', text: '' })
  // { kind: 'barber' | 'service', id: number | null (null = new), values: {...} }
  const [editing, setEditing] = useState(null)
  const [formError, setFormError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  // The barber whose working hours / time off are open, if any.
  const [scheduleBarber, setScheduleBarber] = useState(null)
  const [loginBarber, setLoginBarber] = useState(null)
  const [accounts, setAccounts] = useState([])

  // Fetch both lists. Returns null after a 401 (useAdminFetch already redirects).
  const fetchLists = useCallback(async () => {
    const results = await Promise.all([
      adminFetch('/admin/barbers'),
      adminFetch('/admin/services'),
      adminFetch('/accounts'),
    ])
    if (results.some(({ response }) => response.status === 401)) return null
    if (results.some(({ response }) => !response.ok)) throw new Error('Load failed')
    const [barbersResult, servicesResult, accountsResult] = results
    return { barbers: barbersResult.data, services: servicesResult.data, accounts: accountsResult.data }
  }, [adminFetch])

  // Initial load. State is only set after the response arrives, and not at all
  // if the page was left in the meantime.
  useEffect(() => {
    let ignore = false
    fetchLists()
      .then((lists) => {
        if (ignore || !lists) return
        setBarbers(lists.barbers)
        setServices(lists.services)
        setAccounts(lists.accounts)
      })
      .catch(() => {
        if (!ignore) setLoadError(NETWORK_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [fetchLists])

  // Reload after a save or (de)activation.
  const loadAll = async () => {
    try {
      const lists = await fetchLists()
      if (!lists) return
      setBarbers(lists.barbers)
      setServices(lists.services)
      setAccounts(lists.accounts)
      setLoadError('')
    } catch {
      setLoadError(NETWORK_ERROR)
    }
  }

  const openSchedule = (barber) => {
    setEditing(null)
    setLoginBarber(null)
    setMessage({ type: '', text: '' })
    setScheduleBarber(barber)
  }

  const openLogin = (barber) => {
    setEditing(null)
    setScheduleBarber(null)
    setMessage({ type: '', text: '' })
    setLoginBarber(barber)
  }

  const accountFor = (barberId) => accounts.find((account) => account.barber_id === barberId)

  const startAdd = (kind) => {
    setScheduleBarber(null)
    setLoginBarber(null)
    const values = { ...FORMS[kind].empty }
    // A new service is offered by every active barber; untick the ones who don't.
    if (kind === 'service') values.barber_ids = barbers.filter((barber) => barber.active).map((barber) => barber.id)
    setEditing({ kind, id: null, values })
    setFormError('')
    setMessage({ type: '', text: '' })
  }

  const startEdit = (kind, record) => {
    setScheduleBarber(null)
    setEditing({ kind, id: record.id, values: toFormValues(kind, record) })
    setFormError('')
    setMessage({ type: '', text: '' })
  }

  const updateValue = (field, value) => {
    setEditing((current) => ({ ...current, values: { ...current.values, [field]: value } }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    const { kind, id, values } = editing
    const form = FORMS[kind]
    const isNew = id === null

    setIsSaving(true)
    setFormError('')
    try {
      const { response, data } = await adminFetch(isNew ? form.path : `${form.path}/${id}`, {
        method: isNew ? 'POST' : 'PATCH',
        body: JSON.stringify(toPayload(kind, values)),
      })
      if (response.status === 401) return
      if (!response.ok) {
        setFormError(getErrorMessage(data, `Could not save the ${form.label}.`))
        return
      }

      setEditing(null)
      setMessage({ type: 'success', text: `${data.name} ${isNew ? 'added' : 'saved'}.` })
      loadAll()
    } catch {
      setFormError(NETWORK_ERROR)
    } finally {
      setIsSaving(false)
    }
  }

  // Deactivate = soft delete: hidden from customers and not bookable, but old
  // appointments keep it and it can be activated again.
  const toggleActive = async (kind, record) => {
    if (record.active) {
      const consequence = kind === 'barber'
        ? 'Customers will no longer see or book them. Existing appointments are kept.'
        : 'Customers will no longer be able to book it. Existing appointments are kept.'
      if (!window.confirm(`Deactivate ${record.name}? ${consequence}`)) return
    }

    try {
      const { response, data } = await adminFetch(`${FORMS[kind].path}/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !record.active }),
      })
      if (response.status === 401) return
      if (!response.ok) {
        setMessage({ type: 'error', text: getErrorMessage(data, 'Could not update status.') })
        return
      }

      setMessage({ type: 'success', text: `${data.name} is now ${data.active ? 'active' : 'inactive'}.` })
      loadAll()
    } catch {
      setMessage({ type: 'error', text: NETWORK_ERROR })
    }
  }

  const handleLogout = () => {
    clearSession()
    navigate('/admin', { replace: true })
  }

  const renderForm = (kind) => {
    if (editing?.kind !== kind) return null
    const form = FORMS[kind]

    return (
      <form onSubmit={handleSave} className="admin-booking-form admin-manage-form">
        <h3>{editing.id === null ? `Add ${form.label}` : `Edit ${editing.values.name || form.label}`}</h3>

        {form.fields.map((field) => field.type === 'barbers' ? (
          <fieldset key={field.name} className="admin-manage-form__wide admin-offered-by">
            <legend>{field.label}</legend>
            {barbers
              // Inactive barbers only appear if they're already assigned, so they can be unticked.
              .filter((barber) => barber.active || editing.values.barber_ids.includes(barber.id))
              .map((barber) => (
                <label key={barber.id} className="admin-schedule__check">
                  <input
                    type="checkbox"
                    checked={editing.values.barber_ids.includes(barber.id)}
                    onChange={(event) => updateValue(
                      field.name,
                      event.target.checked
                        ? [...editing.values.barber_ids, barber.id]
                        : editing.values.barber_ids.filter((id) => id !== barber.id),
                    )}
                  />
                  {barber.name}{!barber.active && ' (inactive)'}
                </label>
              ))}
            {editing.values.barber_ids.length === 0 && (
              <small className="admin-schedule__hint">Nobody is ticked: customers can't book this service.</small>
            )}
          </fieldset>
        ) : (
          <label key={field.name} className={field.textarea ? 'admin-manage-form__wide' : undefined}>
            {field.label}{field.required && ' *'}
            {field.textarea ? (
              <textarea
                rows={3}
                value={editing.values[field.name]}
                onChange={(event) => updateValue(field.name, event.target.value)}
              />
            ) : (
              <input
                type={field.type || 'text'}
                required={field.required}
                maxLength={field.maxLength}
                min={field.min}
                max={field.max}
                step={field.step}
                placeholder={field.placeholder}
                value={editing.values[field.name]}
                onChange={(event) => updateValue(field.name, event.target.value)}
              />
            )}
          </label>
        ))}

        {formError && <p className="admin-status-message error admin-manage-form__wide" role="alert">{formError}</p>}

        <div className="admin-panel-actions admin-manage-form__wide">
          <button type="button" className="admin-secondary-button" onClick={() => setEditing(null)}>Cancel</button>
          <button type="submit" className="admin-primary-button" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    )
  }

  const renderRow = (kind, record, details) => (
    <li key={record.id} className={`admin-manage-row ${record.active ? '' : 'is-inactive'}`}>
      {kind === 'barber' && (
        <span className="admin-color-dot" style={{ background: record.color || DEFAULT_BARBER_COLOR }} aria-hidden="true" />
      )}
      <div className="admin-manage-row__info">
        <strong>{record.name}</strong>
        <span>{details}</span>
      </div>
      <span className={`admin-chip ${record.active ? '' : 'admin-chip--muted'}`}>{record.active ? 'Active' : 'Inactive'}</span>
      <div className="admin-manage-row__actions">
        {kind === 'barber' && (
          <>
            <button type="button" className="admin-secondary-button" onClick={() => openLogin(record)}>Login</button>
            <button type="button" className="admin-secondary-button" onClick={() => openSchedule(record)}>Hours &amp; time off</button>
          </>
        )}
        <button type="button" className="admin-secondary-button" onClick={() => startEdit(kind, record)}>Edit</button>
        <button type="button" className="admin-secondary-button" onClick={() => toggleActive(kind, record)}>
          {record.active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </li>
  )

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-brand">
            <div className="brand-mark">NS</div>
            <div>
              <p className="admin-eyebrow">Admin</p>
              <h1>Team &amp; services</h1>
            </div>
          </div>

          <div className="admin-toolbar">
            <Link to="/admin/appointments" className="admin-secondary-button">Calendar</Link>
            <Link to="/" className="admin-secondary-button">Customer page</Link>
            <button className="admin-secondary-button" onClick={handleLogout} type="button">Log out</button>
          </div>
        </header>

        {loadError && <p className="admin-status-message error" role="alert">{loadError}</p>}
        {message.text && <p className={`admin-status-message ${message.type}`} role="status">{message.text}</p>}

        <main className="admin-manage-grid">
          <section className="admin-panel">
            <div className="admin-panel__header">
              <div>
                <p className="admin-kicker">Team</p>
                <h2>Barbers</h2>
              </div>
              <button type="button" className="admin-primary-button" onClick={() => startAdd('barber')}>Add barber</button>
            </div>

            {renderForm('barber')}

            {scheduleBarber && (
              // key: switching to another barber starts a fresh editor with their data.
              <BarberSchedule
                key={scheduleBarber.id}
                barber={scheduleBarber}
                adminFetch={adminFetch}
                onClose={() => setScheduleBarber(null)}
              />
            )}

            {loginBarber && (
              <BarberLogin
                key={loginBarber.id}
                barber={loginBarber}
                account={accountFor(loginBarber.id)}
                adminFetch={adminFetch}
                onChanged={loadAll}
                onClose={() => setLoginBarber(null)}
              />
            )}

            <ul className="admin-manage-list">
              {barbers.map((barber) => renderRow(
                'barber',
                barber,
                [
                  barber.role || 'Barber',
                  barber.email,
                  barber.phone,
                  accountFor(barber.id) ? `login: ${accountFor(barber.id).username}` : 'no login',
                ].filter(Boolean).join(' · '),
              ))}
            </ul>
          </section>

          <section className="admin-panel">
            <div className="admin-panel__header">
              <div>
                <p className="admin-kicker">Menu</p>
                <h2>Services</h2>
              </div>
              <button type="button" className="admin-primary-button" onClick={() => startAdd('service')}>Add service</button>
            </div>

            {renderForm('service')}

            <ul className="admin-manage-list">
              {services.map((service) => {
                const offeredBy = barbers
                  .filter((barber) => barber.active && service.barber_ids.includes(barber.id))
                  .map((barber) => barber.name.split(' ')[0])
                const who = offeredBy.length ? `by ${offeredBy.join(', ')}` : 'not offered by any active barber'
                return renderRow('service', service, `${service.duration_minutes} min · ${formatPrice(service.price)} · ${who}`)
              })}
            </ul>
          </section>
        </main>
      </div>
    </div>
  )
}
