/**
 * HTTP API 请求封装
 * 统一处理请求头、Token、错误等
 *
 * 后端响应格式: { code: 0, message: 'success', data: {...} }
 * 所有接口返回值通过 data.data 获取实际数据
 */
import { getToken, logout, setAuthSession } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' }
    const token = getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  async request(method, path, body = null) {
    const options = {
      method,
      headers: this.getHeaders(),
    }
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body)
    }

    const res = await fetch(`${this.baseUrl}${path}`, options)

    if (res.status === 401) {
      const teacherPath = window.location.pathname.startsWith('/teacher')
      logout(teacherPath ? 'teacher' : 'student')
      window.location.href = teacherPath ? '/teacher/login' : '/login'
      throw new Error('未登录或登录已过期')
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '请求失败' }))
      throw new Error(err.message || `HTTP ${res.status}`)
    }

    return res.json()
  }

  get(path) { return this.request('GET', path) }
  post(path, body) { return this.request('POST', path, body) }
  put(path, body) { return this.request('PUT', path, body) }
  delete(path) { return this.request('DELETE', path) }

  // ==================== 认证接口 ====================

  // Fix #1: 后端期望 student_no 而非 studentId
  // Fix #3: 后端返回 { code:0, data: { token, user } }，需要从 data.data 中提取
  async studentLogin(studentNo, password) {
    const resp = await this.post('/api/auth/student/login', { student_no: studentNo, password })
    const token = resp.data?.token || resp.token
    const user = resp.data?.user || resp.user
    localStorage.removeItem('psy_session_id')
    setAuthSession('student', token, user)
    return { token, user }
  }

  // Fix #2: 后端期望 teacher_no 而非 username
  // Fix #3: 同上，需从 data.data 提取
  async teacherLogin(teacherNo, password) {
    const resp = await this.post('/api/auth/teacher/login', { teacher_no: teacherNo, password })
    const token = resp.data?.token || resp.token
    const user = resp.data?.user || resp.user
    setAuthSession('teacher', token, user)
    return { token, user }
  }

  // ==================== 会话接口 ====================

  createSession() {
    return this.post('/api/session/create')
  }

  getSessionList() {
    return this.get('/api/session/list')
  }

  getSession(id) {
    return this.get(`/api/session/${id}`)
  }

  updateSessionMode(id, mode) {
    return this.put(`/api/session/${id}/mode`, { mode })
  }

  endSession(id) {
    return this.put(`/api/session/${id}/end`)
  }

  // ==================== 消息接口 ====================

  // Fix #4: 后端期望 session_id / input_type (snake_case)
  sendMessage(sessionId, content, inputType = 'text', audioUrl = null) {
    const body = { session_id: sessionId, content, input_type: inputType }
    if (audioUrl) body.audio_url = audioUrl
    return this.post('/api/message/send', body)
  }

  // Upload audio file, return { audio_url }
  async uploadAudio(audioBlob) {
    const formData = new FormData()
    formData.append('file', audioBlob, 'recording.webm')

    const token = getToken()
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${this.baseUrl}/api/ai/upload-audio`, {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)
    const data = await res.json()
    return data.data?.audio_url || data.audio_url
  }

  // Fix #5: 后端期望 ?session_id= (snake_case)
  getMessageHistory(sessionId, page = 1, limit = 50) {
    return this.get(`/api/message/history?session_id=${sessionId}&page=${page}&limit=${limit}`)
  }

  // Fix #6: 后端确实有 GET /api/message/unread 端点
  getUnreadMessages() {
    return this.get('/api/message/unread')
  }

  // Fix #7: 后端批量标记已读用 PUT /api/message/read + body { session_id }
  // 单条标记已读仍用 PUT /api/message/:id/read
  markSessionRead(sessionId) {
    return this.put('/api/message/read', { session_id: sessionId })
  }

  markMessageRead(messageId) {
    return this.put(`/api/message/${messageId}/read`)
  }

  // ==================== AI辅助接口 ====================

  getAISuggestion(sessionId, messageContent = null, options = {}) {
    const body = { session_id: sessionId }
    if (messageContent) body.message_content = messageContent
    if (options.triggerMessageId) body.trigger_message_id = options.triggerMessageId
    if (options.ifNotAnalyzed) body.if_not_analyzed = true
    return this.post('/api/ai/suggest', body)
  }

  // AI review — cross-model validation (DeepSeek Expert reviews QWEN)
  reviewAISuggestion(sessionId, suggestionContent) {
    return this.post('/api/ai/review', { session_id: sessionId, suggestion_content: suggestionContent })
  }

  // v1.007-04: Teacher guided regeneration
  regenerateWithGuidance(sessionId, teacherGuidance, originalSuggestion = null) {
    const body = { session_id: sessionId, teacher_guidance: teacherGuidance }
    if (originalSuggestion) body.original_suggestion = originalSuggestion
    return this.post('/api/ai/regenerate', body)
  }

  // Coordinator analysis - proxy to backend (replaces direct ViVaAPI call)
  analyzeCoordinator(studentMessage, conversationHistory = []) {
    return this.post('/api/ai/analyze', {
      student_message: studentMessage,
      conversation_history: conversationHistory,
    })
  }

  // Save AI-generated reply to backend
  // v1.007: accepts suggestionTraceId + originalSuggestion + suggestionsArray for feedback
  saveAIReply(sessionId, content, inputType = 'text', stage = null, emotion = null, audioUrl = null, suggestionTraceId = null, originalSuggestion = null, suggestionsArray = null, contentSource = null) {
    const body = { session_id: sessionId, content, input_type: inputType, stage, emotion }
    if (audioUrl) body.audio_url = audioUrl
    if (suggestionTraceId) body.suggestion_trace_id = suggestionTraceId
    if (originalSuggestion) body.original_suggestion = originalSuggestion
    if (suggestionsArray) body.suggestions_array = suggestionsArray
    if (contentSource) body.content_source = contentSource
    return this.post('/api/ai/reply', body)
  }

  // TTS: returns audio Blob (binary), not JSON - cannot use standard this.post()
  async textToSpeech(text, voice = 'alloy') {
    const token = getToken()
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${this.baseUrl}/api/ai/tts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, voice }),
    })

    if (res.status === 401) {
      const teacherPath = window.location.pathname.startsWith('/teacher')
      logout(teacherPath ? 'teacher' : 'student')
      window.location.href = teacherPath ? '/teacher/login' : '/login'
      throw new Error('未登录或登录已过期')
    }

    if (!res.ok) {
      throw new Error(`TTS failed: HTTP ${res.status}`)
    }

    return res.blob()
  }

  // ASR: 语音识别 - 通过后端代理调用 DashScope
  async speechToText(audioBlob, language = 'zh') {
    const formData = new FormData()
    formData.append('file', audioBlob, 'recording.webm')
    formData.append('language', language)

    const token = getToken()
    const headers = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${this.baseUrl}/api/ai/asr`, {
      method: 'POST',
      headers,
      body: formData
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`ASR failed: HTTP ${res.status} ${errText}`)
    }
    const data = await res.json()
    return { data: { text: data.data?.text || data.text || '' } }
  }

  // ==================== 教师发送消息 ====================

  // Fix #8: 后端没有 /api/message/teacher-send，教师和学生共用 POST /api/message/send
  // 后端通过JWT中的role自动判断 sender_type
  teacherSendMessage(sessionId, content, inputType = 'text') {
    return this.post('/api/message/send', { session_id: sessionId, content, input_type: inputType })
  }

  // ==================== 预警接口 ====================

  getWarningList(status, level) {
    const params = new URLSearchParams()
    if (status && status !== 'all') params.append('status', status)
    if (level && level !== 'all') params.append('level', level)
    return this.get(`/api/warning/list?${params}`)
  }

  // Fix #9: 后端期望 { status, handle_result, handle_notes }，status 为 2/3/4
  handleWarning(id, status, handleResult, handleNotes) {
    return this.put(`/api/warning/${id}/handle`, {
      status,
      handle_result: handleResult,
      handle_notes: handleNotes
    })
  }

  getWarningStats() {
    return this.get('/api/warning/stats')
  }

  // ==================== 学生信息接口 ====================

  getStudentList(search, grade, page = 1, limit = 50) {
    const params = new URLSearchParams()
    if (search) params.append('search', search)
    if (grade && grade !== 'all') params.append('grade', grade)
    params.append('page', page)
    params.append('limit', limit)
    return this.get(`/api/student/list?${params}`)
  }

  getStudentDetail(studentId) {
    return this.get(`/api/student/${studentId}`)
  }

  addStudent(data) {
    return this.post('/api/student/add', data)
  }

  updateStudent(studentId, data) {
    return this.put(`/api/student/${studentId}`, data)
  }

  deleteStudent(studentId) {
    return this.delete(`/api/student/${studentId}`)
  }

  resetStudentPassword(studentId) {
    return this.post(`/api/student/${studentId}/reset-password`)
  }

  refreshGrades() {
    return this.post('/api/student/refresh-grades')
  }

  getStudentProfile(studentId) {
    return this.get(`/api/profile/student/${studentId}`)
  }

  // ==================== 情绪日记接口 ====================

  submitEmotionDiary(data) {
    return this.post('/api/diary/emotion', data)
  }

  getEmotionHistory(days = 30) {
    return this.get(`/api/diary/emotion/history?days=${days}`)
  }

  // ==================== 心理测评接口 ====================

  getAssessmentScales() {
    return this.get('/api/assessment/scales')
  }

  submitAssessment(scaleId, answers) {
    return this.post('/api/assessment/submit', { scale_id: scaleId, answers })
  }

  // ==================== 会话摘要接口 ====================

  getSessionSummaries(studentId) {
    return this.get(`/api/session/summaries?student_id=${studentId}`)
  }

  // Get student cross-session context (3-layer context panel)
  getStudentContext(studentId) {
    return this.get(`/api/student/${studentId}/context`)
  }

  // Manually trigger summary generation
  generateSummary(sessionId, type = 'rolling') {
    return this.post('/api/summary/generate', { session_id: sessionId, type })
  }

  // ==================== 报告接口 ====================

  generateReport(studentId, reportType, dateRange) {
    return this.post('/api/report/generate', { student_id: studentId, report_type: reportType, date_range: dateRange })
  }

  // ==================== Dashboard 统计 ====================

  getDashboardStats() {
    return this.get('/api/dashboard/stats')
  }

  getRuntimeStats(params = {}) {
    const query = new URLSearchParams()
    if (params.sessionId) query.set('session_id', params.sessionId)
    if (params.limit) query.set('limit', params.limit)
    const qs = query.toString()
    return this.get(`/api/dashboard/runtime-stats${qs ? `?${qs}` : ''}`)
  }
}

const api = new ApiClient(API_BASE)
export default api
export { API_BASE }
