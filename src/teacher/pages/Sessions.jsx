import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../services/api'
import { joinSession, leaveSession, getSocket, connectSocket, emitTeacherIntervene } from '../../services/websocket'
import { AgentPanel } from './ChatPanel'

// 格式化时间
const formatTime = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

// Figma 风格图标 - 1px stroke
const Icons = {
  Search: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  Back: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  ),
  User: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  Sparkles: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  ),
  Send: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  ),
  Mic: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
    </svg>
  ),
  Volume: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z" />
    </svg>
  ),
  VoiceWave: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h2m2 0h2m2-4v8m2-6v4m2-8v12m2-10v8m2-6v4m2 0h2m2 0h2" />
    </svg>
  ),
  Eye: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Takeover: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  )
}

// 语音标识
const VoiceBadge = ({ isPlaying, onClick }) => (
  <button
    onClick={onClick}
    className={`
      inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] transition-colors
      ${isPlaying ? 'bg-[#5551ff]/10 text-[#5551ff]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}
    `}
  >
    <Icons.Volume />
    <span>语音</span>
  </button>
)

// 实时语音模式状态条
const VoiceModeBanner = ({ studentName, onTakeover }) => (
  <div className="flex items-center justify-between px-3 py-2 bg-[#5551ff]/5 border-b border-[#5551ff]/10">
    <div className="flex items-center gap-2">
      <div className="relative flex items-center justify-center">
        <span className="w-2 h-2 bg-[#5551ff] rounded-full" />
        <span className="absolute w-2 h-2 bg-[#5551ff] rounded-full animate-ping" />
      </div>
      <span className="text-xs text-[#5551ff] font-medium">{studentName} 正在与 AI 实时语音对话中</span>
      <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
        <Icons.Eye />
        监听模式
      </span>
    </div>
    <button onClick={onTakeover} className="flex items-center gap-1 text-[10px] font-medium text-[#5551ff] hover:bg-[#5551ff]/10 px-2 py-1 rounded transition-colors">
      <Icons.Takeover />
      接管对话
    </button>
  </div>
)

const mapBackendMessage = (m, currentSession = null) => ({
  id: m.id,
  type: m.sender_type === 'student' ? 'student' : m.sender_type === 'ai' ? 'ai' : 'teacher',
  studentName: m.student_name || currentSession?.studentName || '学生',
  text: m.content,
  time: formatTime(m.created_at),
  inputType: m.input_type || 'text',
  senderType: m.sender_type,
  contentSource: m.content_source || '',
  fromVoiceMode: m.input_type === 'voice' && m.sender_type === 'student',
})

const appendMessageOnce = (setMessages, message) => {
  if (!message?.id) return
  setMessages(prev => {
    if (prev.some(m => String(m.id) === String(message.id))) return prev
    return [...prev, message]
  })
}

const getAIMessageMeta = (message) => {
  const source = message.contentSource || ''
  if (source === 'teacher_accepted_ai_reply' || source === 'teacher_edited_ai_reply' || source === 'agent_teacher_guided') {
    return {
      label: source === 'teacher_edited_ai_reply' ? '教师编辑的 AI 建议' : '教师发送的 AI 建议',
      bubble: 'bg-[#5551ff] text-white border border-[#5551ff]',
      labelClass: 'text-[#5551ff]',
      teacherLike: true,
    }
  }
  if (source === 'guardian_proactive') {
    return {
      label: 'Guardian 自动介入',
      bubble: 'bg-amber-50 text-gray-800 border border-amber-200',
      labelClass: 'text-amber-600',
      teacherLike: false,
    }
  }
  if (source === 'voice_pipeline') {
    return {
      label: '语音自动回复',
      bubble: 'bg-[#5551ff]/5 text-gray-800 border border-[#5551ff]/15',
      labelClass: 'text-[#5551ff]',
      teacherLike: false,
    }
  }
  return {
    label: 'AI 自动回复',
    bubble: 'bg-[#5551ff]/5 text-gray-800 border border-[#5551ff]/15',
    labelClass: 'text-[#5551ff]',
    teacherLike: false,
  }
}

// 系统消息（模式切换通知）
const SystemMessage = ({ text, time }) => (
  <div className="flex justify-center animate-fade-in">
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-full">
      <span className="text-[10px] text-gray-500">{text}</span>
      {time && <span className="text-[10px] text-gray-400">{time}</span>}
    </div>
  </div>
)

// 学生消息
const StudentMessage = ({ message, isPlaying, onPlayClick }) => (
  <div className="flex items-start gap-2 max-w-[75%] animate-slide-in">
    <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium flex-shrink-0">
      {message.studentName?.charAt(0) || '学'}
    </div>
    <div className="flex flex-col gap-0.5">
      <div className="bg-white border border-gray-200 rounded rounded-tl-sm px-2.5 py-1.5">
        <p className="text-xs text-gray-800 leading-relaxed">{message.text}</p>
      </div>
      <div className="flex items-center gap-1.5 px-0.5">
        <span className="text-[10px] text-gray-400">{message.time}</span>
        {message.inputType === 'voice' && (
          <VoiceBadge isPlaying={isPlaying} onClick={onPlayClick} />
        )}
        {message.fromVoiceMode && (
          <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
            <Icons.VoiceWave />
            语音模式
          </span>
        )}
      </div>
    </div>
  </div>
)

// AI/自动回复消息。教师端按 content_source 区分“教师发送的AI建议”和自动介入。
const AIMessage = ({ message }) => (
  (() => {
    const meta = getAIMessageMeta(message)
    return (
      <div className="flex items-start gap-2 max-w-[75%] ml-auto flex-row-reverse animate-slide-in">
        <div className={`w-7 h-7 rounded-full ${meta.teacherLike ? 'bg-[#5551ff]/10 text-[#5551ff]' : 'bg-[#5551ff]/10'} flex items-center justify-center flex-shrink-0`}>
          <Icons.Sparkles />
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <div className={`${meta.bubble} rounded rounded-tr-sm px-2.5 py-1.5`}>
            <p className="text-xs leading-relaxed">{message.text}</p>
          </div>
          <div className="flex items-center gap-1.5 px-0.5">
            <span className={`text-[10px] ${meta.labelClass} flex items-center gap-0.5`}>
              <Icons.Sparkles /> {meta.label}
            </span>
            <span className="text-[10px] text-gray-400">{message.time}</span>
            {message.inputType === 'voice' && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                <Icons.VoiceWave />
              </span>
            )}
          </div>
        </div>
      </div>
    )
  })()
)

// 教师消息
const TeacherMessage = ({ message, isPlaying, onPlayClick }) => (
  <div className="flex items-start gap-2 max-w-[75%] ml-auto flex-row-reverse animate-slide-in">
    <div className="w-7 h-7 rounded-full bg-[#5551ff]/10 text-[#5551ff] flex items-center justify-center text-xs font-medium flex-shrink-0">
      李
    </div>
    <div className="flex flex-col gap-0.5 items-end">
      <div className="bg-[#5551ff] text-white rounded rounded-tr-sm px-2.5 py-1.5">
        <p className="text-xs leading-relaxed">{message.text}</p>
      </div>
      <div className="flex items-center gap-1.5 px-0.5">
        {message.senderType === 'ai' && (
          <span className="text-[10px] text-[#5551ff] flex items-center gap-0.5">
            <Icons.Sparkles /> AI生成
          </span>
        )}
        {message.edited && <span className="text-[10px] text-gray-400">已编辑</span>}
        <span className="text-[10px] text-gray-400">{message.time}</span>
        {message.inputType === 'voice' && (
          <VoiceBadge isPlaying={isPlaying} onClick={onPlayClick} />
        )}
      </div>
    </div>
  </div>
)

// Stage badge colors
const STAGE_COLORS = {
  listening: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', icon: '👂' },
  cognitive: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200', icon: '🧠' },
  action: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', icon: '🎯' },
  closing: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', icon: '🤝' },
}

const safeText = (value) => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join('；')
  try { return JSON.stringify(value) } catch { return String(value) }
}

// AI建议面板 - 显示协调器思考过程、活跃Agent、建议回复
const AISuggestionPanel = ({ suggestion, analysis, loading, onDirectSend, onEditSend, onRegenerate, voiceMode }) => {
  const safeAnalysis = analysis && typeof analysis === 'object' ? analysis : null
  const stageKey = typeof safeAnalysis?.stage === 'string' ? safeAnalysis.stage : 'listening'
  const stageColor = STAGE_COLORS[stageKey] || STAGE_COLORS.listening
  const suggestionText = safeText(suggestion)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-[#5551ff]/10 rounded flex items-center justify-center text-[#5551ff]">
            <Icons.Sparkles />
          </div>
          <span className="text-xs font-medium text-gray-900">AI Agent</span>
        </div>
        {safeAnalysis?.stage && (
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${stageColor.bg} ${stageColor.text}`}>
            {stageColor.icon} {safeText(safeAnalysis.stageName || safeAnalysis.stage)}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-thin">
        {voiceMode && (
          <div className="bg-[#5551ff]/5 border border-[#5551ff]/10 rounded p-2">
            <div className="flex items-center gap-1 mb-1">
              <Icons.Eye />
              <span className="text-[10px] font-medium text-[#5551ff]">监听模式</span>
            </div>
            <p className="text-[10px] text-gray-500">学生正在与AI语音对话，您可以查看对话内容并随时接管</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="flex gap-0.5">
                <span className="w-1 h-1 bg-[#5551ff] rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                <span className="w-1 h-1 bg-[#5551ff] rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                <span className="w-1 h-1 bg-[#5551ff] rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
              </div>
              <span>协调器分析中...</span>
            </div>
            <div className="bg-gray-50 rounded p-2 animate-pulse">
              <div className="h-2 bg-gray-200 rounded w-3/4 mb-1.5" />
              <div className="h-2 bg-gray-200 rounded w-1/2" />
            </div>
          </div>
        ) : (
          <>
            {/* 协调器思考过程 */}
            {safeAnalysis && (
              <div className={`border rounded p-2 ${stageColor.border} ${stageColor.bg}`}>
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="text-[10px] font-bold text-gray-600">协调器分析</span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-start gap-1">
                    <span className="text-[10px] text-gray-500 flex-shrink-0 w-14">当前阶段:</span>
                    <span className={`text-[10px] font-medium ${stageColor.text}`}>{stageColor.icon} {safeText(safeAnalysis.stageName || safeAnalysis.stage)}</span>
                  </div>
                  {safeAnalysis.emotion && (
                    <div className="flex items-start gap-1">
                      <span className="text-[10px] text-gray-500 flex-shrink-0 w-14">学生情绪:</span>
                      <span className="text-[10px] text-gray-700">{safeText(safeAnalysis.emotion)}</span>
                    </div>
                  )}
                  {safeAnalysis.reason && (
                    <div className="flex items-start gap-1">
                      <span className="text-[10px] text-gray-500 flex-shrink-0 w-14">判断依据:</span>
                      <span className="text-[10px] text-gray-700">{safeText(safeAnalysis.reason)}</span>
                    </div>
                  )}
                  {safeAnalysis.studentNeed && (
                    <div className="flex items-start gap-1">
                      <span className="text-[10px] text-gray-500 flex-shrink-0 w-14">学生需求:</span>
                      <span className="text-[10px] text-gray-700">{safeText(safeAnalysis.studentNeed)}</span>
                    </div>
                  )}
                  {safeAnalysis.responseStrategy && (
                    <div className="flex items-start gap-1">
                      <span className="text-[10px] text-gray-500 flex-shrink-0 w-14">回应策略:</span>
                      <span className="text-[10px] text-gray-700">{safeText(safeAnalysis.responseStrategy)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 建议回复 */}
            {suggestionText && (
              <div className="border border-gray-200 rounded p-2.5 hover:border-[#5551ff]/30 transition-colors">
                <div className="flex items-center gap-1 mb-1.5">
                  <Icons.Sparkles />
                  <span className="text-[10px] font-medium text-gray-600">建议回复</span>
                </div>
                <p className="text-xs text-gray-800 leading-relaxed mb-2.5 whitespace-pre-wrap">{suggestionText}</p>
                <div className="flex gap-1.5">
                  <button onClick={() => onDirectSend(suggestionText)} className="btn-primary text-[10px] px-2.5 py-1 flex items-center gap-1">
                    <Icons.Send />
                    直接发送
                  </button>
                  <button onClick={() => onEditSend(suggestionText)} className="btn-secondary text-[10px] px-2.5 py-1">
                    编辑后发送
                  </button>
                </div>
              </div>
            )}

            {/* 重新生成按钮 */}
            {(suggestionText || safeAnalysis) && (
              <button
                onClick={onRegenerate}
                className="w-full text-[10px] text-gray-500 hover:text-[#5551ff] hover:bg-[#5551ff]/5 py-1.5 rounded transition-colors flex items-center justify-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                重新分析
              </button>
            )}

            {/* 无建议时的空状态 */}
            {!suggestionText && !safeAnalysis && !loading && (
              <div className="text-center py-4">
                <p className="text-[10px] text-gray-400">等待学生消息后自动分析</p>
                <p className="text-[10px] text-gray-400 mt-0.5">或点击下方按钮手动触发</p>
                <button
                  onClick={onRegenerate}
                  className="mt-2 text-[10px] text-[#5551ff] hover:bg-[#5551ff]/5 px-3 py-1 rounded transition-colors"
                >
                  手动分析
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// 会话列表项
const SessionItem = ({ session, isActive, onClick }) => (
  <div
    onClick={onClick}
    className={`
      flex items-center gap-2 px-2.5 py-2.5 cursor-pointer transition-colors border-l-2
      ${isActive
        ? 'bg-[#5551ff]/5 border-[#5551ff]'
        : 'border-transparent hover:bg-gray-50'
      }
    `}
  >
    <div className="relative flex-shrink-0">
      <div className={`
        w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium
        ${session.riskLevel === 'L1' ? 'bg-red-500' : ''}
        ${session.riskLevel === 'L2' ? 'bg-orange-500' : ''}
        ${session.riskLevel === 'L3' ? 'bg-amber-500' : ''}
        ${session.riskLevel === 'L4' ? 'bg-emerald-500' : ''}
      `}>
        {session.studentName.charAt(0)}
      </div>
      {session.unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 bg-red-500 text-white text-[9px] font-medium rounded-full flex items-center justify-center">
          {session.unread}
        </span>
      )}
    </div>

    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1">
        <span className="font-medium text-xs text-gray-900 truncate">{session.studentName}</span>
        <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
          session.riskLevel === 'L1' ? 'badge-l1' :
          session.riskLevel === 'L2' ? 'badge-l2' :
          session.riskLevel === 'L3' ? 'badge-l3' : 'badge-l4'
        }`}>
          {session.riskLevel}
        </span>
        {session.isOnline && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />}
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        {session.voiceMode && (
          <span className="flex items-center gap-0.5 text-[9px] text-[#5551ff] bg-[#5551ff]/8 px-1 py-0.5 rounded font-medium">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h2m2 0h2m2-4v8m2-6v4m2-8v12m2-10v8m2-6v4m2 0h2m2 0h2" />
            </svg>
            AI语音中
          </span>
        )}
        <p className="text-[10px] text-gray-500 truncate">{session.lastMessage}</p>
      </div>
    </div>

    <span className="text-[9px] text-gray-400 flex-shrink-0">{session.time}</span>
  </div>
)

// 空状态
const EmptyChat = () => (
  <div className="h-full flex items-center justify-center text-center">
    <div>
      <div className="w-12 h-12 mx-auto mb-2 bg-gray-100 rounded-full flex items-center justify-center">
        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </div>
      <p className="text-xs font-medium text-gray-700">选择会话开始</p>
      <p className="text-[10px] text-gray-500 mt-0.5">从左侧列表选择学生</p>
    </div>
  </div>
)

export default function Sessions() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const chatRef = useRef(null)
  const lastAutoAnalyzedMessageIdRef = useRef(null)
  const [inputValue, setInputValue] = useState('')
  const [playingId, setPlayingId] = useState(null)
  const [showAI, setShowAI] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [showMobileList, setShowMobileList] = useState(!sessionId)

  const [sessions, setSessions] = useState([])

  const mapSession = useCallback((s) => ({
    id: String(s.id),
    studentName: s.student_name || s.studentName || '未知',
    grade: s.grade || '',
    lastMessage: s.last_message || s.lastMessage || '',
    time: s.last_time || s.time || '',
    unread: s.unread_count || s.unread || 0,
    riskLevel: s.risk_level || s.riskLevel || 'L4',
    isOnline: s.is_online || s.isOnline || false,
    voiceMode: s.voice_mode || s.voiceMode || false,
  }), [])

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.getSessionList()
      const data = res.data || res
      const list = data.list || data.sessions || (Array.isArray(data) ? data : [])
      setSessions(Array.isArray(list) ? list.map(mapSession) : [])
    } catch (err) {
      console.log('[Sessions] Load sessions failed:', err.message)
      setSessions([])
    }
  }, [mapSession])

  const clearSessionUnread = useCallback((sid) => {
    setSessions(prev => prev.map(s => (
      String(s.id) === String(sid) ? { ...s, unread: 0 } : s
    )))
  }, [])

  // Fetch session list from API
  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const [messages, setMessages] = useState([])

  // AI建议 (single suggestion + analysis from coordinator)
  const [suggestion, setSuggestion] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [analysis, setAnalysis] = useState(null)
  const [triggerMessage, setTriggerMessage] = useState('')
  const [proactiveSuggestion, setProactiveSuggestion] = useState(null)
  const [suggestionTraceId, setSuggestionTraceId] = useState(null)
  const [guardianSnapshot, setGuardianSnapshot] = useState(null)
  const [guardianProactive, setGuardianProactive] = useState(null)

  const currentSession = sessions.find(s => s.id === sessionId)

  // Load messages when sessionId changes
  useEffect(() => {
    if (!sessionId) {
      setShowAI(false)
      setAiEnabled(false)
      setSuggestion('')
      setSuggestions([])
      setAnalysis(null)
      setTriggerMessage('')
      setProactiveSuggestion(null)
      setSuggestionTraceId(null)
      setGuardianSnapshot(null)
      setGuardianProactive(null)
      setMessages([])
      return
    }
    // Clear AI state when switching sessions
    setSuggestion('')
    setSuggestions([])
    setAnalysis(null)
    setTriggerMessage('')
    setProactiveSuggestion(null)
    setSuggestionTraceId(null)
    setGuardianProactive(null)
    setShowAI(true)
    setAiEnabled(true)
    lastAutoAnalyzedMessageIdRef.current = null
    let cancelled = false

    async function loadMessages() {
      try {
        const res = await api.getMessageHistory(sessionId)
        if (cancelled) return
        const data = res.data || res
        const list = data.list || data.messages || (Array.isArray(data) ? data : [])
        const mappedMessages = list.map(m => mapBackendMessage(m, currentSession))
        setMessages(mappedMessages)
        api.markSessionRead(sessionId)
          .then(() => {
            clearSessionUnread(sessionId)
            loadSessions()
          })
          .catch(() => {})
      } catch (err) {
        console.log('[Sessions] Load messages fallback:', err.message)
      }
    }

    loadMessages()
    joinSession(sessionId)

    return () => {
      cancelled = true
      leaveSession(sessionId)
    }
  }, [sessionId])

  // Listen for realtime messages via WebSocket
  useEffect(() => {
    const socket = getSocket() || connectSocket()
    if (!socket) return

    const handleNewMessage = (msg) => {
      const isCurrentSession = sessionId && String(msg.session_id) === String(sessionId)
      if (!isCurrentSession) {
        loadSessions()
        return
      }
      setMessages(prev => {
        if (prev.some(m => String(m.id) === String(msg.id))) return prev
        return [...prev, mapBackendMessage({ ...msg, id: msg.id || Date.now() }, currentSession)]
      })
      if (msg.sender_type === 'student') {
        clearSessionUnread(sessionId)
        api.markSessionRead(sessionId)
          .then(loadSessions)
          .catch(() => {})
      } else {
        loadSessions()
      }
    }

    const handleSessionModeChange = (msg) => {
      if (sessionId && String(msg.session_id) === String(sessionId)) {
        loadSessions()
        if (msg.mode === 'agent') {
          setSuggestion('')
          setSuggestions([])
          setProactiveSuggestion(null)
        } else if (msg.mode === 'text' || msg.mode === 'push') {
          setGuardianProactive(null)
          setGuardianSnapshot(null)
        }
      }
    }

    const handleCoordinatorUpdate = (data) => {
      if (!sessionId || String(data.session_id) !== String(sessionId)) return
      setAnalysis(data)
      setTriggerMessage(data.reason || '')
      setShowAI(true)
    }

    const handleCoordinatorSuggestion = (data) => {
      if (!sessionId || String(data.session_id) !== String(sessionId)) return
      setProactiveSuggestion(data)
      setShowAI(true)
    }

    const handleGuardianUpdate = (data) => {
      if (!sessionId || String(data.session_id) !== String(sessionId)) return
      setGuardianSnapshot(data)
      setShowAI(true)
    }

    const handleGuardianProactive = (data) => {
      if (!sessionId || String(data.session_id) !== String(sessionId)) return
      if (data.autoSent) {
        setGuardianProactive({ ...data, status: 'auto_sent' })
        setTimeout(() => setGuardianProactive(null), 10000)
      } else {
        setGuardianProactive({ ...data, status: 'pending' })
      }
      setShowAI(true)
    }

    socket.on('student:message', handleNewMessage)
    socket.on('teacher:message', handleNewMessage)
    socket.on('session:mode_change', handleSessionModeChange)
    socket.on('coordinator:update', handleCoordinatorUpdate)
    socket.on('coordinator:suggestion', handleCoordinatorSuggestion)
    socket.on('guardian:update', handleGuardianUpdate)
    socket.on('guardian:proactive', handleGuardianProactive)
    return () => {
      socket.off('student:message', handleNewMessage)
      socket.off('teacher:message', handleNewMessage)
      socket.off('session:mode_change', handleSessionModeChange)
      socket.off('coordinator:update', handleCoordinatorUpdate)
      socket.off('coordinator:suggestion', handleCoordinatorSuggestion)
      socket.off('guardian:update', handleGuardianUpdate)
      socket.off('guardian:proactive', handleGuardianProactive)
    }
  }, [sessionId, currentSession?.id, currentSession?.studentName, loadSessions, clearSessionUnread])

  // Fetch AI suggestion using 4-stage Agent pipeline
  const fetchSuggestion = useCallback(async (options = {}) => {
    if (!sessionId) return
    setAiLoading(true)
    try {
      const res = await api.getAISuggestion(sessionId, null, options)
      const data = res.data || res
      if (data.suggestion) {
        setSuggestion(data.suggestion)
      }
      if (data.suggestions) {
        setSuggestions(data.suggestions)
      }
      if (data.analysis) {
        setAnalysis({
          ...data.analysis,
          speculativeHit: data.speculativeHit || false,
          speculativeSavedMs: data.speculativeSavedMs || 0,
        })
      }
      if (data.triggerMessage) setTriggerMessage(data.triggerMessage)
      if (data.suggestionTraceId) setSuggestionTraceId(data.suggestionTraceId)
    } catch {
      setSuggestion('')
      setSuggestions([])
      setAnalysis(null)
      setTriggerMessage('')
    } finally {
      setAiLoading(false)
    }
  }, [sessionId])

  // Auto-fetch AI suggestion for the active session when a new student message arrives.
  // The right panel can be visible before analysis; aiEnabled only pauses/resumes analysis.
  useEffect(() => {
    if (!aiEnabled) return
    const last = messages[messages.length - 1]
    if (last && last.type === 'student' && String(last.id) !== String(lastAutoAnalyzedMessageIdRef.current)) {
      lastAutoAnalyzedMessageIdRef.current = last.id
      setShowAI(true)
      fetchSuggestion({ triggerMessageId: last.id, ifNotAnalyzed: true })
    }
  }, [messages.length, aiEnabled, fetchSuggestion])
  const isVoiceMode = currentSession?.voiceMode

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  const handleSend = async (text = inputValue) => {
    if (!text.trim()) return
    const trimmed = text.trim()
    setInputValue('')
    try {
      const res = await api.teacherSendMessage(sessionId, trimmed, 'text')
      const data = res.data || res
      const saved = data.message
      if (saved) appendMessageOnce(setMessages, mapBackendMessage(saved, currentSession))
      if (isVoiceMode) {
        emitTeacherIntervene(sessionId, trimmed)
      }
    } catch (err) {
      console.log('[Sessions] Send message fallback:', err.message)
    }
  }

  // AI suggestion: direct send
  const handleDirectSend = async (text) => {
    if (!text?.trim()) return
    const trimmed = text.trim()
    try {
      const res = await api.saveAIReply(
        sessionId,
        trimmed,
        'text',
        analysis?.stage,
        analysis?.emotion,
        null,
        suggestionTraceId,
        suggestion || null,
        suggestions,
        'teacher_accepted_ai_reply'
      )
      const data = res.data || res
      const saved = data.message
      if (saved) appendMessageOnce(setMessages, mapBackendMessage(saved, currentSession))
      if (isVoiceMode) {
        emitTeacherIntervene(sessionId, trimmed)
      }
      setSuggestion('')
      setSuggestions([])
      setSuggestionTraceId(null)
    } catch (err) {
      console.log('[Sessions] AI direct send fallback:', err.message)
      // Fallback to teacher send
      try { await api.teacherSendMessage(sessionId, trimmed, 'text') } catch {}
    }
  }

  // AI suggestion: edit then send (paste into input)
  const handleEditSend = (text) => {
    setInputValue(text || '')
  }

  // Toggle AI enable
  const handleToggleAI = () => {
    if (!sessionId || !currentSession) return
    const newEnabled = !aiEnabled
    setAiEnabled(newEnabled)
    setShowAI(true)
    // If enabling and there are student messages, auto-fetch suggestion
    if (newEnabled && sessionId && currentSession) {
      const last = messages[messages.length - 1]
      if (last && last.type === 'student') {
        fetchSuggestion()
      }
    }
    if (!newEnabled) {
      setSuggestion('')
      setSuggestions([])
      setAnalysis(null)
      setTriggerMessage('')
      setProactiveSuggestion(null)
    }
  }

  const handleTakeover = async () => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, voiceMode: false, lastMessage: '老师已接管对话' } : s
    ))
    setMessages(prev => [...prev, {
      id: Date.now(),
      type: 'system',
      text: '李老师 接管了对话，AI语音模式已结束',
      time: formatTime(new Date())
    }])
    try {
      await api.updateSessionMode(sessionId, 'text')
    } catch (err) {
      console.log('[Sessions] Takeover fallback:', err.message)
    }
  }

  const handlePlayVoice = (id) => {
    setPlayingId(playingId === id ? null : id)
    if (playingId !== id) setTimeout(() => setPlayingId(null), 3000)
  }

  return (
    <div className="h-[calc(100vh-5.5rem)] flex gap-3">
      {/* 会话列表 */}
      <div className={`
        w-full lg:w-[280px] flex-shrink-0 card overflow-hidden flex flex-col
        ${sessionId && !showMobileList ? 'hidden lg:flex' : 'flex'}
      `}>
        <div className="p-2 border-b border-gray-200">
          <div className="relative">
            <input type="text" placeholder="搜索学生..." className="input pl-7 py-1.5 text-xs" />
            <div className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">
              <Icons.Search />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {sessions.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-gray-400">暂无会话</div>
          )}
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === sessionId}
              onClick={() => { navigate(`/teacher/sessions/${session.id}`); setShowMobileList(false) }}
            />
          ))}
        </div>
      </div>

      {/* 聊天区域 */}
      <div className={`
        flex-1 card overflow-hidden flex flex-col
        ${!sessionId || showMobileList ? 'hidden lg:flex' : 'flex'}
      `}>
        {sessionId && currentSession ? (
          <>
            {/* 头部 */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <button onClick={() => setShowMobileList(true)} className="lg:hidden p-1 text-gray-500">
                  <Icons.Back />
                </button>
                <div className={`
                  w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium
                  ${currentSession.riskLevel === 'L1' ? 'bg-red-500' : ''}
                  ${currentSession.riskLevel === 'L2' ? 'bg-orange-500' : ''}
                  ${currentSession.riskLevel === 'L3' ? 'bg-amber-500' : ''}
                  ${currentSession.riskLevel === 'L4' ? 'bg-emerald-500' : ''}
                `}>
                  {currentSession.studentName.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-xs text-gray-900">{currentSession.studentName}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                      currentSession.riskLevel === 'L1' ? 'badge-l1' :
                      currentSession.riskLevel === 'L2' ? 'badge-l2' :
                      currentSession.riskLevel === 'L3' ? 'badge-l3' : 'badge-l4'
                    }`}>{currentSession.riskLevel}</span>
                    {currentSession.isOnline && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />}
                  </div>
                  <p className="text-[10px] text-gray-500">{currentSession.grade}</p>
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => navigate(`/teacher/students/${currentSession.id}`)}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                  title="学生资料"
                >
                  <Icons.User />
                </button>
                <button
                  onClick={() => { if (aiEnabled) setShowAI(!showAI) }}
                  className={`p-1.5 rounded transition-colors ${aiEnabled && showAI ? 'bg-[#5551ff]/10 text-[#5551ff]' : 'text-gray-400 hover:bg-gray-100'}`}
                  title={aiEnabled ? (showAI ? '隐藏AI面板' : '显示AI面板') : 'AI未启用'}
                >
                  <Icons.Sparkles />
                </button>
              </div>
            </div>

            {/* AI语音模式状态条 */}
            {isVoiceMode && (
              <VoiceModeBanner
                studentName={currentSession.studentName}
                onTakeover={handleTakeover}
              />
            )}

            {/* 消息区域 */}
            <div className="flex-1 flex overflow-hidden">
              <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin bg-gray-50/50">
                {messages.map((msg) => {
                  if (msg.type === 'system') {
                    return <SystemMessage key={msg.id} text={msg.text} time={msg.time} />
                  }
                  if (msg.type === 'ai') {
                    return <AIMessage key={msg.id} message={msg} />
                  }
                  if (msg.type === 'student') {
                    return <StudentMessage key={msg.id} message={msg} isPlaying={playingId === msg.id} onPlayClick={() => handlePlayVoice(msg.id)} />
                  }
                  return <TeacherMessage key={msg.id} message={msg} isPlaying={playingId === msg.id} onPlayClick={() => handlePlayVoice(msg.id)} />
                })}

                {/* AI语音对话进行中指示 */}
                {isVoiceMode && (
                  <div className="flex justify-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#5551ff]/5 border border-[#5551ff]/10 rounded-full">
                      <div className="flex items-center gap-0.5">
                        <span className="w-1 h-3 bg-[#5551ff]/60 rounded-full animate-pulse" />
                        <span className="w-1 h-4 bg-[#5551ff]/80 rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                        <span className="w-1 h-2 bg-[#5551ff]/60 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                        <span className="w-1 h-5 bg-[#5551ff] rounded-full animate-pulse" style={{ animationDelay: '0.45s' }} />
                        <span className="w-1 h-3 bg-[#5551ff]/60 rounded-full animate-pulse" style={{ animationDelay: '0.6s' }} />
                      </div>
                      <span className="text-[10px] text-[#5551ff] font-medium">语音对话进行中...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* AI面板 */}
              {showAI && (
                <div className="hidden lg:flex w-80 border-l border-gray-200 bg-white flex-col flex-shrink-0">
                  <AgentPanel
                    analysis={analysis}
                    suggestion={suggestion}
                    suggestions={suggestions}
                    triggerMessage={triggerMessage}
                    loading={aiLoading}
                    onDirectSend={handleDirectSend}
                    onEditSend={handleEditSend}
                    onRegenerate={fetchSuggestion}
                    onReview={async (content) => {
                      const res = await api.reviewAISuggestion(sessionId, content)
                      return res.data || res
                    }}
                    onGuidedRegenerate={async (guidance) => {
                      setAiLoading(true)
                      try {
                        const currentDraft = suggestion || (suggestions?.[0]?.content) || null
                        const res = await api.regenerateWithGuidance(sessionId, guidance, currentDraft)
                        const data = res.data || res
                        if (data.suggestion) setSuggestion(data.suggestion)
                        if (data.suggestions) setSuggestions(data.suggestions)
                        if (data.analysis) setAnalysis(data.analysis)
                      } finally {
                        setAiLoading(false)
                      }
                    }}
                    proactiveSuggestion={proactiveSuggestion}
                    session={{
                      mode: isVoiceMode ? 'agent' : 'text',
                      student_id: currentSession?.studentId || currentSession?.student_id,
                    }}
                    sessionId={sessionId}
                    guardianSnapshot={guardianSnapshot}
                    guardianProactive={guardianProactive}
                    onGuardianSend={async (content) => {
                      try {
                        await api.post('/api/voice/guardian-send', { session_id: sessionId, content })
                        setGuardianProactive(prev => prev ? { ...prev, status: 'sent' } : null)
                        setTimeout(() => setGuardianProactive(null), 3000)
                      } catch (e) {
                        console.log('[Sessions] Guardian send failed:', e.message)
                      }
                    }}
                    onGuardianIgnore={() => {
                      setGuardianProactive(prev => prev ? { ...prev, status: 'ignored' } : null)
                      setTimeout(() => setGuardianProactive(null), 3000)
                    }}
                  />
                </div>
              )}
            </div>

            {/* 输入区域 */}
            <div className="px-3 py-2 border-t border-gray-200 bg-white">
              {isVoiceMode ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Icons.Eye />
                    <span>学生正在AI语音模式，您可观察对话或接管</span>
                  </div>
                  <button onClick={handleTakeover} className="btn-primary flex items-center gap-1 text-[10px]">
                    <Icons.Takeover />
                    接管对话
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-start gap-1.5">
                    <div className="flex-1 relative">
                      <textarea
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }}}
                        placeholder="输入回复..."
                        rows={1}
                        className="input resize-none pr-8"
                        style={{ minHeight: '32px', maxHeight: '80px' }}
                      />
                      <button className="absolute right-1.5 bottom-1.5 p-0.5 text-gray-400 hover:text-gray-600">
                        <Icons.Mic />
                      </button>
                    </div>
                    <button
                      onClick={() => handleSend()}
                      disabled={!inputValue.trim()}
                      className="btn-primary p-2 disabled:opacity-50"
                    >
                      <Icons.Send />
                    </button>
                  </div>
                  {/* 启用AI 按钮 */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleToggleAI}
                      className={`
                        flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors
                        ${aiEnabled
                          ? 'bg-[#5551ff]/10 text-[#5551ff] border border-[#5551ff]/20'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200'
                        }
                      `}
                    >
                      <Icons.Sparkles />
                      {aiEnabled ? 'AI 已启用' : '启用AI'}
                    </button>
                    {aiEnabled && analysis?.stageName && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${STAGE_COLORS[analysis?.stage]?.bg || 'bg-gray-100'} ${STAGE_COLORS[analysis?.stage]?.text || 'text-gray-500'}`}>
                        {STAGE_COLORS[analysis?.stage]?.icon} {safeText(analysis?.stageName || analysis?.stage)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <EmptyChat />
        )}
      </div>
    </div>
  )
}













