import { Navigate } from 'react-router-dom'
import { getSession } from '../api.js'

// ownerOnly: barbers are sent to their calendar instead. This is only about
// what the UI shows; the API refuses owner-only actions for barbers anyway.
export function ProtectedRoute({ children, ownerOnly = false }) {
  const { token, isOwner } = getSession()

  if (!token) {
    return <Navigate to="/admin" replace />
  }
  if (ownerOnly && !isOwner) {
    return <Navigate to="/admin/appointments" replace />
  }

  return children
}
