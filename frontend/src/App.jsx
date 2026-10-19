import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { ProtectedRoute } from './components/ProtectedRoute.jsx'
import { AdminAppointmentsPage } from './pages/AdminAppointmentsPage.jsx'
import { AdminLoginPage } from './pages/AdminLoginPage.jsx'
import { CustomerPage } from './pages/CustomerPage.jsx'

function App() {
  return (
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
  )
}

export default App
