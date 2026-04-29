import { Routes, Route, Navigate } from 'react-router-dom'
import { isLoggedIn, getUserRole } from '../services/auth'
import TeacherLayout from './layouts/TeacherLayout'
import Dashboard from './pages/Dashboard'
import Sessions from './pages/Sessions'
import Students from './pages/Students'
import Alerts from './pages/Alerts'
import TeacherLogin from './pages/Login'
import '../teacher/index.css'

function TeacherGuard({ children }) {
  if (!isLoggedIn('teacher')) return <Navigate to="/teacher/login" replace />
  if (getUserRole('teacher') !== 'teacher') return <Navigate to="/teacher/login" replace />
  return children
}

export default function TeacherApp() {
  return (
    <Routes>
      <Route path="login" element={<TeacherLogin />} />
      <Route path="/" element={<TeacherGuard><TeacherLayout /></TeacherGuard>}>
        <Route index element={<Dashboard />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="sessions/:sessionId" element={<Sessions />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:studentId" element={<Students />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="*" element={<Navigate to="/teacher" replace />} />
      </Route>
    </Routes>
  )
}



