/**
 * JWT Token 和用户状态管理
 */

function getRoleFromPath() {
  return window.location.pathname.startsWith('/teacher') ? 'teacher' : 'student'
}

function tokenKey(role = getRoleFromPath()) {
  return role === 'teacher' ? 'teacher_token' : 'student_token'
}

function userKey(role = getRoleFromPath()) {
  return role === 'teacher' ? 'teacher_user' : 'student_user'
}

export function setAuthSession(role, token, user) {
  localStorage.setItem(tokenKey(role), token)
  localStorage.setItem(userKey(role), JSON.stringify(user))
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export function getToken(role = getRoleFromPath()) {
  return localStorage.getItem(tokenKey(role)) || localStorage.getItem('token')
}

export function getUser(role = getRoleFromPath()) {
  try {
    const raw = localStorage.getItem(userKey(role)) || localStorage.getItem('user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function isLoggedIn(role = getRoleFromPath()) {
  return !!getToken(role)
}

export function getUserRole(role = getRoleFromPath()) {
  const user = getUser(role)
  return user?.role || null
}

export function logout(role = getRoleFromPath()) {
  localStorage.removeItem(tokenKey(role))
  localStorage.removeItem(userKey(role))
  if (role === 'student') {
    localStorage.removeItem('psy_session_id')
  }
}

export function logoutAll() {
  for (const key of ['student_token', 'student_user', 'teacher_token', 'teacher_user', 'token', 'user']) {
    localStorage.removeItem(key)
  }
  localStorage.removeItem('psy_session_id')
}
