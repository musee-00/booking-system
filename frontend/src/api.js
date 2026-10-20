import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// Where the backend lives. Set VITE_API_URL at build time (e.g. in Vercel) to
// the deployed API's address; locally it falls back to the dev server.
// Vite only exposes env variables that start with VITE_ to the browser code.
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
export const API_BASE = `${API_ORIGIN}/api/v1`
export const ADMIN_TOKEN_KEY = 'booking-admin-token'
export const NETWORK_ERROR = "Can't reach the server. Check your connection and try again."
const SESSION_EXPIRED_MESSAGE = 'Your session has expired, please log in again'

export const fetchJson = async (url, options = {}) => {
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

// FastAPI sends `detail` as a string for our own errors (400/404/409), but as a
// list of field errors for validation failures (422). Never render the raw list.
export const getErrorMessage = (data, fallback) => {
  if (typeof data?.detail === 'string') return data.detail
  if (Array.isArray(data?.detail) && data.detail.length) {
    const fields = data.detail.map((error) => error.loc?.[error.loc.length - 1]).filter(Boolean)
    return `Please check: ${fields.join(', ')}.`
  }
  return fallback
}

// Returns a fetch function for admin-only endpoints. It sends the stored JWT,
// and on a 401 (token missing, expired or forged) it drops the token and sends
// the user back to the login page with a "session expired" message.
// useCallback keeps the same function between renders, so it's safe to use as
// an effect dependency without re-running the effect on every render.
export function useAdminFetch() {
  const navigate = useNavigate()

  return useCallback(async (path, options = {}) => {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY) || ''
    const result = await fetchJson(`${API_BASE}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    })

    if (result.response.status === 401) {
      localStorage.removeItem(ADMIN_TOKEN_KEY)
      navigate('/admin', { replace: true, state: { message: SESSION_EXPIRED_MESSAGE } })
    }

    return result
  }, [navigate])
}
