import { Component } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { ProtectedRoute } from './components/ProtectedRoute.jsx'
import { AdminAppointmentsPage } from './pages/AdminAppointmentsPage.jsx'
import { AdminLoginPage } from './pages/AdminLoginPage.jsx'
import { CustomerPage } from './pages/CustomerPage.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('React error boundary caught an error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-error-boundary">
          <h2>Something went wrong</h2>
          <p>Please reload the page and try again.</p>
        </div>
      )
    }

    return this.props.children
  }
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<CustomerPage />} />
          <Route path="/admin" element={<AdminLoginPage />} />
          <Route
            path="/admin/appointments"
            element={
              <ProtectedRoute>
                <AdminAppointmentsPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
