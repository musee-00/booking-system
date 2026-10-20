import { Navigate } from 'react-router-dom'
import { ADMIN_TOKEN_KEY } from '../api.js'

export function ProtectedRoute({ children }) {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY) || ''

  if (!token) {
    return <Navigate to="/admin" replace />
  }

  return children
}
