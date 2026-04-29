import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ChatProvider } from './context/ChatContext'
import { isLoggedIn, getUserRole } from './services/auth'
import Home from './pages/Home'
import Chat from './pages/Chat'
import Voice from './pages/Voice'
import Profile from './pages/Profile'
import Login from './pages/Login'
import TeacherApp from './teacher/TeacherApp'
import './index.css'

// Auth guard for student routes
function StudentRoute({ children }) {
  if (!isLoggedIn('student')) return <Navigate to="/login" replace />
  if (getUserRole('student') !== 'student') return <Navigate to="/login" replace />
  return children
}

// Auth guard for teacher routes
function TeacherRoute({ children }) {
  if (!isLoggedIn('teacher')) return <Navigate to="/teacher/login" replace />
  if (getUserRole('teacher') !== 'teacher') return <Navigate to="/teacher/login" replace />
  return children
}

function App() {
  return (
    <ChatProvider>
      <BrowserRouter>
        <Routes>
          {/* 登录页 */}
          <Route path="/login" element={<Login />} />

          {/* 学生端路由 */}
          <Route path="/" element={<StudentRoute><Home /></StudentRoute>} />
          <Route path="/chat" element={<StudentRoute><Chat /></StudentRoute>} />
          <Route path="/voice" element={<StudentRoute><Voice /></StudentRoute>} />
          <Route path="/profile" element={<StudentRoute><Profile /></StudentRoute>} />

          {/* 教师端路由 */}
          <Route path="/teacher/*" element={<TeacherApp />} />
        </Routes>
      </BrowserRouter>
    </ChatProvider>
  )
}

export default App
