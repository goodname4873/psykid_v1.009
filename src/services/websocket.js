/**
 * Socket.io 客户端封装
 * 处理实时消息推送
 *
 * 后端事件名:
 *   student:message - 学生发送消息
 *   teacher:message - 教师发送消息
 *   warning_alert   - 预警通知
 *   message:read    - 消息已读
 *   user_joined     - 用户加入会话
 *   user_left       - 用户离开会话
 *   user_typing     - 用户正在输入
 *   teacher:online  - 教师上下线
 */
import { io } from 'socket.io-client'
import { API_BASE } from './api'
import { getToken } from './auth'

let socket = null
let socketToken = null

export function connectSocket() {
  const token = getToken()
  if (!token) return null
  if (socket && socketToken !== token) {
    socket.disconnect()
    socket = null
  }
  if (socket && socket.connected) return socket

  socket = io(API_BASE, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  })
  socketToken = token

  socket.on('connect', () => {
    console.log('[WS] connected:', socket.id)
  })

  socket.on('disconnect', (reason) => {
    console.log('[WS] disconnected:', reason)
  })

  socket.on('connect_error', (err) => {
    console.error('[WS] connect error:', err.message)
  })

  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
    socketToken = null
  }
}

// 监听学生消息（教师端使用）
export function onStudentMessage(callback) {
  const s = getSocket()
  if (s) s.on('student:message', callback)
}

// 监听教师消息（学生端使用）
export function onTeacherMessage(callback) {
  const s = getSocket()
  if (s) s.on('teacher:message', callback)
}

// 监听消息已读事件
export function onMessageRead(callback) {
  const s = getSocket()
  if (s) s.on('message:read', callback)
}

// 监听预警通知（教师端使用）
export function onWarningAlert(callback) {
  const s = getSocket()
  if (s) s.on('warning_alert', callback)
}

// 监听教师在线状态
export function onTeacherOnline(callback) {
  const s = getSocket()
  if (s) s.on('teacher:online', callback)
}

// 监听用户加入/离开会话
export function onUserJoined(callback) {
  const s = getSocket()
  if (s) s.on('user_joined', callback)
}

export function onUserLeft(callback) {
  const s = getSocket()
  if (s) s.on('user_left', callback)
}

// 监听输入状态
export function onUserTyping(callback) {
  const s = getSocket()
  if (s) s.on('user_typing', callback)
}

// Fix #10: 后端 join_session 期望直接传 sessionId 值，不是包裹在对象中
export function joinSession(sessionId) {
  const s = getSocket()
  if (s) s.emit('join_session', sessionId)
}

export function leaveSession(sessionId) {
  const s = getSocket()
  if (s) s.emit('leave_session', sessionId)
}

// 发送输入状态
export function emitTyping(sessionId, isTyping) {
  const s = getSocket()
  if (s) s.emit('typing', { session_id: sessionId, is_typing: isTyping })
}

// 发送协调器分析结果（学生端 → 教师端）
export function emitCoordinatorUpdate(sessionId, analysis) {
  const s = getSocket()
  if (s) s.emit('coordinator:update', { session_id: sessionId, ...analysis })
}

// 教师语音会话介入
export function emitTeacherIntervene(sessionId, text) {
  const s = getSocket()
  if (s) s.emit('teacher:intervene', { session_id: sessionId, content: text })
}
