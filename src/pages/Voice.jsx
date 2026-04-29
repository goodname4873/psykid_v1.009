import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChat } from '../context/ChatContext'
import api from '../services/api'
import { connectSocket, joinSession, leaveSession } from '../services/websocket'
import { getPromptConfig } from '../services/aiAgent'

// Assets - 本地图片路径
const imgImageOwl = "/assets/owl.png"
const imgAvatar1 = "/assets/avatar-owl.png"
const imgGirl21 = "/assets/avatar-girl.png"
const imgIconKeyboard = "/assets/icon-keyboard.svg"
const imgIconMic = "/assets/icon-mic.svg"
const imgIconClose = "/assets/icon-close.svg"
const imgIconSettings = "/assets/icon-settings.svg"

// ==================== Audio Helpers ====================

// Convert PCM16 Int16Array to WAV Blob
function createWavFromPcm16(pcm16, sampleRate = 16000) {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const dataSize = pcm16.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  // RIFF header
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46) // "RIFF"
  view.setUint32(4, 36 + dataSize, true)
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45) // "WAVE"
  view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20) // "fmt "
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61) // "data"
  view.setUint32(40, dataSize, true)
  // PCM data
  const pcmView = new Int16Array(buffer, 44)
  pcmView.set(pcm16)
  return new Blob([buffer], { type: 'audio/wav' })
}

// ==================== Common Components ====================

// Typewriter Text Component
// isAnimating: 是否显示打字动画 (typing或playing时都为true)
// shouldTriggerComplete: 只在真正的typing完成时触发回调 (playing时不触发)
const TypewriterText = ({ text, isAnimating, shouldTriggerComplete, onComplete }) => {
  const [displayedText, setDisplayedText] = useState('')
  const [charIndex, setCharIndex] = useState(0)

  useEffect(() => {
    if (isAnimating) {
      setDisplayedText('')
      setCharIndex(0)
    }
  }, [isAnimating, text])

  useEffect(() => {
    if (isAnimating && charIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(prev => prev + text[charIndex])
        setCharIndex(prev => prev + 1)
      }, 50)
      return () => clearTimeout(timer)
    } else if (isAnimating && charIndex >= text.length && shouldTriggerComplete && onComplete) {
      // 只在shouldTriggerComplete为true时触发回调（即agent typing，不是push playback）
      onComplete()
    }
  }, [isAnimating, charIndex, text, onComplete, shouldTriggerComplete])

  if (!isAnimating) {
    return <span>{text}</span>
  }

  return (
    <span>
      {displayedText}
      {charIndex < text.length && (
        <span className="inline-block w-[2px] h-[16px] bg-[#72482d] ml-[2px] animate-pulse" />
      )}
    </span>
  )
}

// Voice Badge Component - clickable in push mode, disabled in agent mode
const VoiceBadge = ({ position = 'left', isPlaying, onClick, disabled }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`
      absolute bg-white border-2 border-[#60a5fa] rounded-full
      shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1),0px_1px_2px_0px_rgba(0,0,0,0.1)]
      w-[26px] h-[26px] flex items-center justify-center
      top-[-10px] ${position === 'left' ? 'left-[-8px]' : 'right-[-8px]'}
      transition-all duration-300
      ${disabled ? 'opacity-50 cursor-default' : 'hover:scale-110 cursor-pointer'}
      ${isPlaying ? 'bg-[#60a5fa] scale-110' : ''}
    `}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 5.5V8.5C2.5 9 2.5 9.5 3 9.5H4.5L7 12V2L4.5 4.5H3C2.5 4.5 2.5 5 2.5 5.5Z"
        fill={isPlaying ? 'white' : '#60A5FA'}
      />
      <path
        d="M9.5 5.5C10 6 10 8 9.5 8.5"
        stroke={isPlaying ? 'white' : '#60A5FA'}
        strokeWidth="1.2"
        strokeLinecap="round"
        className={isPlaying ? 'animate-pulse' : ''}
      />
      <path
        d="M11 4C12 5.5 12 8.5 11 10"
        stroke={isPlaying ? 'white' : '#60A5FA'}
        strokeWidth="1.2"
        strokeLinecap="round"
        className={isPlaying ? 'animate-pulse' : ''}
      />
    </svg>
    {isPlaying && !disabled && (
      <div className="absolute inset-[-4px] rounded-full border-2 border-[#60a5fa] animate-ping opacity-75" />
    )}
  </button>
)

// AI Chat Message - 自适应高度
const AIChatMessage = ({ text, isTyping, isPlaying, onPlayClick, onTypingComplete, isNew, disabled, inputType, hasAudio }) => (
  <div className={`relative flex items-start gap-[12px] transition-all duration-500 ${isNew ? 'animate-slide-up' : ''}`}>
    {/* Avatar */}
    <div className={`flex-shrink-0 w-[44px] h-[44px] ${isTyping || isPlaying ? 'animate-bounce' : ''}`}>
      <img src={imgAvatar1} alt="AI" className="w-full h-full object-cover" />
    </div>
    {/* Message bubble */}
    <div className="relative flex-1 max-w-[280px]">
      <div className={`
        relative bg-[#faefb9] rounded-tr-[20px] rounded-br-[20px] rounded-bl-[20px]
        border-4 border-[#f6cb5b] shadow-[0px_4px_4px_0px_rgba(114,72,45,0.25)]
        px-[16px] py-[16px]
        transition-all duration-300
        ${isTyping || isPlaying ? 'shadow-[0px_4px_12px_0px_rgba(114,72,45,0.4)] scale-[1.02]' : ''}
      `}>
        <p className="font-bold text-[16px] leading-[22px] text-[#72482d]">
          <TypewriterText
            text={text}
            isAnimating={isTyping || isPlaying}
            shouldTriggerComplete={isTyping}
            onComplete={onTypingComplete}
          />
        </p>
      </div>
      {hasAudio && (inputType === 'voice' || inputType === 'realtime_voice') && (
        <VoiceBadge position="left" isPlaying={isPlaying} onClick={onPlayClick} disabled={disabled} />
      )}
    </div>
  </div>
)

// User Chat Message - 自适应高度
const UserChatMessage = ({ text, isTyping, isPlaying, onPlayClick, onTypingComplete, isNew, disabled, inputType, hasAudio }) => (
  <div className={`relative flex items-start justify-end gap-[12px] transition-all duration-500 ${isNew ? 'animate-slide-up' : ''}`}>
    {/* Message bubble */}
    <div className="relative flex-1 max-w-[280px]">
      <div className={`
        relative bg-white rounded-tl-[20px] rounded-br-[20px] rounded-bl-[20px]
        border-4 border-[#f6cb5b] shadow-[0px_4px_4px_0px_rgba(114,72,45,0.25)]
        px-[16px] py-[16px]
        transition-all duration-300
        ${isTyping || isPlaying ? 'shadow-[0px_4px_12px_0px_rgba(114,72,45,0.4)] scale-[1.02]' : ''}
      `}>
        <p className="font-bold text-[16px] leading-[22px] text-[#72482d]">
          <TypewriterText
            text={text}
            isAnimating={isTyping || isPlaying}
            shouldTriggerComplete={isTyping}
            onComplete={onTypingComplete}
          />
        </p>
      </div>
      {hasAudio && (inputType === 'voice' || inputType === 'realtime_voice') && (
        <VoiceBadge position="right" isPlaying={isPlaying} onClick={onPlayClick} disabled={disabled} />
      )}
    </div>
    {/* Avatar */}
    <div className={`flex-shrink-0 w-[44px] h-[44px] ${isTyping || isPlaying ? 'animate-bounce' : ''}`}>
      <img src={imgGirl21} alt="User" className="w-full h-full object-cover" />
    </div>
  </div>
)

// AI Thinking Indicator
const AIThinkingIndicator = () => (
  <div className="relative w-full h-[60px] animate-slide-up">
    <div className="absolute left-[14px] top-[-4px] w-[44px] h-[44px] animate-pulse">
      <img src={imgAvatar1} alt="AI" className="w-full h-full object-cover" />
    </div>
    <div className="absolute left-[70px] top-0 w-[100px] h-[50px]">
      <div className="relative bg-[#faefb9] rounded-tr-[20px] rounded-br-[20px] rounded-bl-[20px] border-4 border-[#f6cb5b] shadow-[0px_4px_4px_0px_rgba(114,72,45,0.25)] w-full h-full flex items-center justify-center gap-2">
        <span className="w-2 h-2 bg-[#72482d] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-[#72482d] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-[#72482d] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  </div>
)

// Mode Toggle Component
const ModeToggle = ({ activeMode, onModeChange }) => {
  const modes = [
    { key: 'push', label: '按键' },
    { key: 'agent', label: '实时' },
  ]
  const idx = modes.findIndex(m => m.key === activeMode)
  const btnW = 80
  const gap = 4
  const totalW = btnW * modes.length + gap * (modes.length - 1) + 8
  return (
    <div className="relative bg-[#f9ce64] h-[50px] rounded-[120px] shadow-[inset_0px_4px_4px_0px_rgba(114,72,45,0.1)]" style={{ width: totalW }}>
      <div
        className="absolute top-[4px] h-[42px] bg-white rounded-[120px] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] transition-all duration-300 ease-out"
        style={{ width: btnW, left: 4 + idx * (btnW + gap) }}
      />
      {modes.map((m, i) => (
        <button key={m.key} onClick={() => onModeChange(m.key)}
          className={`absolute top-[4px] h-[42px] flex items-center justify-center font-bold text-[13px] transition-colors duration-300 z-10 ${activeMode === m.key ? 'text-[#72482d]' : 'text-[rgba(114,72,45,0.6)]'}`}
          style={{ width: btnW, left: 4 + i * (btnW + gap) }}
        >{m.label}</button>
      ))}
    </div>
  )
}

// Coordinator Stage Indicator (shown during agent voice mode)
const CoordinatorBadge = ({ currentStage, analysis }) => {
  const stages = [
    { key: 'listening', label: '倾听' },
    { key: 'cognitive', label: '认知' },
    { key: 'action', label: '行动' },
    { key: 'closing', label: '结束' },
  ]
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1">
        {stages.map(s => (
          <span
            key={s.key}
            className={`text-[10px] px-2 py-0.5 rounded-full font-bold transition-all duration-300 ${
              currentStage === s.key
                ? 'bg-green-500 text-white scale-110'
                : 'bg-[#f5eedc] text-[rgba(114,72,45,0.4)]'
            }`}
          >
            {s.label}
          </span>
        ))}
      </div>
      {analysis && (
        <div className="flex items-center gap-1.5 text-[10px] text-[rgba(114,72,45,0.6)]">
          {analysis.emotion && (typeof analysis.emotion === 'string' ? analysis.emotion !== '未知' : analysis.emotion.primary && analysis.emotion.primary !== '未知') && (
            <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
              {typeof analysis.emotion === 'string' ? analysis.emotion : analysis.emotion.primary}
            </span>
          )}
          {(analysis.responseStrategy || analysis.guidance) && (
            <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded max-w-[200px] truncate">{analysis.responseStrategy || analysis.guidance}</span>
          )}
        </div>
      )}
    </div>
  )
}

// Header Button
const HeaderButton = ({ icon, onClick }) => (
  <button
    onClick={onClick}
    className="
      bg-white rounded-full shadow-[0px_3px_0px_0px_#e1b444] w-[40px] h-[40px]
      flex items-center justify-center cursor-pointer
      transition-all duration-200
      hover:brightness-105
      active:translate-y-[2px] active:shadow-[0px_1px_0px_0px_#e1b444]
    "
  >
    <img src={icon} alt="" className="w-[24px] h-[24px]" />
  </button>
)

// ==================== Push Mode Components ====================

// Control Button (keyboard)
const ControlButton = ({ icon, onClick }) => (
  <button
    onClick={onClick}
    className="
      bg-white rounded-full shadow-[0px_4px_0px_0px_#e1b444] w-[50px] h-[50px]
      flex items-center justify-center cursor-pointer relative
      transition-all duration-200
      hover:brightness-105
      active:translate-y-[2px] active:shadow-[0px_2px_0px_0px_#e1b444]
    "
  >
    <div className="absolute inset-0 rounded-full shadow-[inset_0px_2px_4px_0px_rgba(255,255,255,0.5)] pointer-events-none" />
    <img src={icon} alt="" className="w-[24px] h-[24px]" />
  </button>
)

// Main Push Button (microphone)
const PushButton = ({ isRecording, onPress, onRelease }) => (
  <button
    onMouseDown={onPress}
    onMouseUp={onRelease}
    onMouseLeave={onRelease}
    onTouchStart={onPress}
    onTouchEnd={onRelease}
    className={`
      relative w-[100px] h-[100px] rounded-[35px]
      flex items-center justify-center cursor-pointer
      transition-all duration-200
      ${isRecording
        ? 'bg-[#3b82f6] shadow-[0px_4px_0px_0px_#1d4ed8] translate-y-[4px]'
        : 'bg-[#60a5fa] shadow-[0px_8px_0px_0px_#2563eb] hover:brightness-110'
      }
    `}
  >
    <div className="absolute inset-0 rounded-[35px] shadow-[inset_0px_4px_6px_0px_rgba(255,255,255,0.4)] pointer-events-none" />
    <img
      src={imgIconMic}
      alt="Microphone"
      className={`w-[40px] h-[40px] transition-transform duration-200 ${isRecording ? 'scale-110' : ''}`}
    />
    {isRecording && (
      <>
        <div className="absolute inset-0 rounded-[35px] bg-white/20 animate-ping" />
        <div className="absolute inset-[-10px] rounded-[45px] border-4 border-[#60a5fa]/30 animate-pulse" />
      </>
    )}
  </button>
)

// ==================== Agent Mode Components ====================

// Voice Waveform Animation
const VoiceWaveform = ({ isListening }) => {
  const bars = [
    { height: 41, delay: 0 },
    { height: 20, delay: 100 },
    { height: 10, delay: 200 },
    { height: 15, delay: 300 },
    { height: 28, delay: 400 },
    { height: 18, delay: 500 },
    { height: 13, delay: 600 },
    { height: 10, delay: 700 },
  ]

  return (
    <div className="relative bg-[#f5eedc] border-2 border-[rgba(246,203,91,0.3)] rounded-[40px] w-[188px] h-[93px] shadow-[inset_0px_4px_6px_0px_rgba(114,72,45,0.1)] flex items-center justify-center gap-[8px] px-[32px]">
      {bars.map((bar, index) => (
        <div
          key={index}
          className={`
            w-[8px] bg-[#60a5fa] rounded-full transition-all duration-150
            ${isListening ? 'animate-waveform' : ''}
          `}
          style={{
            height: isListening ? `${bar.height}px` : '10px',
            animationDelay: `${bar.delay}ms`,
          }}
        />
      ))}
    </div>
  )
}

// Conversation phases
const PHASE = {
  LISTENING: 'listening',
  USER_SPEAKING: 'user_speaking',
  AI_THINKING: 'ai_thinking',
  AI_RESPONDING: 'ai_responding',
}

// ==================== Main Voice Page Component ====================

export default function Voice() {
  const navigate = useNavigate()
  const { messages, setMessages, sessionId, setSessionId, addMessage, addUserVoiceMessage, addAIVoiceMessage, addTeacherMessage, loadMessages, setMode } = useChat()
  const [activeMode, setActiveMode] = useState('push') // 'push' or 'agent'
  const [owlLoaded, setOwlLoaded] = useState(false)

  // Push mode state
  const [isRecording, setIsRecording] = useState(false)
  const [playingMessageId, setPlayingMessageId] = useState(null)
  const [isRecognizing, setIsRecognizing] = useState(false) // ASR in progress
  const [isWaitingReply, setIsWaitingReply] = useState(false) // Waiting for teacher reply
  const [currentStage, setCurrentStage] = useState('listening')
  const [toastMsg, setToastMsg] = useState(null) // Temporary error toast

  // Agent mode state
  const [phase, setPhase] = useState(PHASE.LISTENING)
  const [typingMessageId, setTypingMessageId] = useState(null)
  const [newMessageId, setNewMessageId] = useState(null)

  // v1.007-05: Phase timeout — if stuck on AI_THINKING/AI_RESPONDING > 30s, auto-reset
  useEffect(() => {
    if (phase === PHASE.AI_THINKING || phase === PHASE.AI_RESPONDING) {
      const t = setTimeout(() => {
        console.warn('[Agent] Phase stuck on', phase, 'for 30s, resetting to LISTENING')
        setPhase(PHASE.LISTENING)
      }, 30000)
      return () => clearTimeout(t)
    }
  }, [phase])

  // Audio recording refs
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const audioPlayerRef = useRef(null)
  const preAcquiredStreamRef = useRef(null) // Pre-acquired mic stream to avoid delay

  // Web Speech API fallback ref (backup ASR)
  const speechRecogRef = useRef(null)
  const speechResultRef = useRef('')

  const activeModeRef = useRef('push') // track mode for reconnect closure

  // Agent voice mode refs (v1.007)
  const agentPipelineWsRef = useRef(null)
  const agentAsrWsRef = useRef(null)
  const agentMicRef = useRef(null)
  const [agentConnected, setAgentConnected] = useState(false)
  const agentAudioContextRef = useRef(null)
  const agentAudioQueueRef = useRef([])
  const agentIsPlayingRef = useRef(false)
  const agentTtsBase64CacheRef = useRef([]) // v1.007-05: cache base64 strings for local replay
  const agentTtsActiveRef = useRef(false)   // v1.007-05: true while TTS session is active (for echo suppression)
  const agentTtsEndTimeRef = useRef(0)      // v1.007-05: when TTS session ended (echo tail guard)
  const agentTextDoneRef = useRef(false)    // v1.007-05: LLM text done, waiting for TTS to finish
  const agentStoppedRef = useRef(false) // prevent auto-reconnect after intentional disconnect
  const agentStudentPcmBufferRef = useRef([]) // Accumulated student PCM for upload

  // Coordinator analysis state (for UI display)
  const [coordinatorAnalysis, setCoordinatorAnalysis] = useState(null)

  // Conversation history for Agent
  const conversationHistoryRef = useRef([])

  // Ref for auto-scrolling
  const scrollContainerRef = useRef(null)

  // Initialize session and WebSocket
  useEffect(() => {
    const init = async () => {
      try {
        // v1.006: Preload prompt config from backend
        getPromptConfig().catch(() => {})

        // Create session if none exists
        if (!sessionId) {
          const res = await api.createSession()
          const sid = res.data?.session_id || res.data?.id || res.session_id || res.sessionId
          if (sid) setSessionId(sid)
        }
        // Update session mode
        if (sessionId) {
          await api.updateSessionMode(sessionId, activeMode).catch(() => {})
        }
        // Connect WebSocket
        const socket = connectSocket()
        if (socket && sessionId) {
          joinSession(sessionId)
        }
      } catch (err) {
        console.log('[Voice] Init with mock mode:', err.message)
      }
    }
    init()

    return () => {
      if (sessionId) leaveSession(sessionId)
    }
  }, [sessionId])

  // Load message history when sessionId is set or mode changes
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false

    async function loadHistory() {
      try {
        const res = await api.getMessageHistory(sessionId)
        const msgs = res.data?.list || res.data || res.messages || []
        if (!cancelled && msgs.length > 0) {
          const formatted = msgs.map(m => ({
            id: m.id || Date.now() + Math.random(),
            type: m.sender_type === 'student' ? 'user' : m.sender_type === 'teacher' ? 'teacher' : 'ai',
            inputType: m.input_type || m.inputType || 'text',
            text: m.content || m.text,
            audioUrl: m.audio_url || m.audioUrl,
            timestamp: m.timestamp || m.created_at,
          }))
          loadMessages(formatted)
        }
      } catch {
        // Keep default welcome message on failure
      }
    }

    loadHistory()
    return () => { cancelled = true }
  }, [sessionId, activeMode])

  // Listen for teacher replies via WebSocket (push mode - text only, no TTS)
  useEffect(() => {
    if (!sessionId) return
    const socket = connectSocket()
    if (!socket) return

    const handler = (msg) => {
      if (String(msg.session_id) !== String(sessionId)) return
      if (activeMode === 'agent') return // agent mode handles messages via pipeline WS

      if (activeMode === 'push') {
        setIsRecognizing(false)
        setIsWaitingReply(false)
      }

      const text = msg.content || msg.text
      // Use backend's input_type to determine message type
      // Teacher/AI text replies → no voice icon; voice messages → voice icon
      addMessage({
        type: msg.sender_type === 'teacher' ? 'teacher' : 'ai',
        inputType: msg.input_type || 'text',
        text,
        audioUrl: msg.audio_url,
      })
    }

    // Ensure we're in the session room (critical for receiving messages)
    const onConnect = () => joinSession(sessionId)
    // Teacher intervention during voice session
    const interventionHandler = (msg) => {
      if (String(msg.session_id) !== String(sessionId)) return
      const text = msg.content || msg.text
      if (text) {
        addMessage({ type: 'teacher', inputType: 'text', text })
      }
    }

    socket.on('teacher:message', handler)
    socket.on('teacher:intervene', interventionHandler)
    socket.on('connect', onConnect)
    if (socket.connected) joinSession(sessionId)

    return () => {
      socket.off('teacher:message', handler)
      socket.off('teacher:intervene', interventionHandler)
      socket.off('connect', onConnect)
    }
  }, [sessionId, activeMode, addMessage])

  // Sync mode to ChatContext + ref
  useEffect(() => {
    setMode(activeMode === 'push' ? 'push' : 'agent')
    activeModeRef.current = activeMode
  }, [activeMode, setMode])

  useEffect(() => {
    const timer = setTimeout(() => setOwlLoaded(true), 100)
    return () => clearTimeout(timer)
  }, [])

  // Auto scroll to bottom when new messages appear
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [messages])

  // Reset interaction state when switching modes (保留消息记录)
  useEffect(() => {
    if (activeMode === 'push') {
      setPhase(PHASE.LISTENING)
      setTypingMessageId(null)
      setNewMessageId(null)
      // Pre-acquire microphone stream to avoid delay on first button press
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
          // Only store if still in push mode (user might switch fast)
          if (preAcquiredStreamRef.current) {
            preAcquiredStreamRef.current.getTracks().forEach(t => t.stop())
          }
          preAcquiredStreamRef.current = stream
        }).catch(err => {
          console.log('[Voice] Pre-acquire mic failed:', err.message)
        })
      } else {
        console.warn('[Voice] mediaDevices unavailable - HTTPS required for non-localhost access')
      }
    } else {
      setIsRecording(false)
      setPlayingMessageId(null)
      setPhase(PHASE.LISTENING)
      // Release pre-acquired stream when leaving push mode
      if (preAcquiredStreamRef.current) {
        preAcquiredStreamRef.current.getTracks().forEach(t => t.stop())
        preAcquiredStreamRef.current = null
      }
    }
    // Update session mode on backend
    if (sessionId) {
      api.updateSessionMode(sessionId, activeMode).catch(() => {})
    }
  }, [activeMode, sessionId])

  // Cleanup pre-acquired stream on unmount
  useEffect(() => {
    return () => {
      if (preAcquiredStreamRef.current) {
        preAcquiredStreamRef.current.getTracks().forEach(t => t.stop())
        preAcquiredStreamRef.current = null
      }
    }
  }, [])

  // ==================== Push Mode Handlers ====================

  // Play voice message audio
  const handlePlayMessage = useCallback(async (messageId) => {
    // v1.007-05: Stop ALL audio (TTS streaming + manual replay) before playing new
    stopAllAudio()

    if (playingMessageId === messageId) {
      // Toggle off — was already playing this message
      setPlayingMessageId(null)
      return
    }

    setPlayingMessageId(messageId)
    const message = messages.find(m => m.id === messageId)
    if (!message) return

    const audioUrl = message.audioUrl || message.audio_url
    if (audioUrl) {
      // Play existing audio (student original recording or AI TTS WAV)
      const fullUrl = audioUrl.startsWith('/') ? window.location.origin + audioUrl : audioUrl
      const audio = new Audio(fullUrl)
      audioPlayerRef.current = audio
      audio.onended = () => {
        setPlayingMessageId(prev => prev === messageId ? null : prev)
        audioPlayerRef.current = null
      }
      audio.play().catch((e) => {
        console.warn('[Voice] Audio play error:', e)
        setPlayingMessageId(prev => prev === messageId ? null : prev)
      })
    } else if (activeMode === 'push' && message.text) {
      // Only push mode fallback to TTS for messages without audio
      try {
        const audioBlob = await api.textToSpeech(message.text)
        const audioUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(audioUrl)
        audioPlayerRef.current = audio
        audio.onended = () => {
          setPlayingMessageId(prev => prev === messageId ? null : prev)
          audioPlayerRef.current = null
        }
        audio.play().catch(() => {
          setPlayingMessageId(prev => prev === messageId ? null : prev)
        })
      } catch (err) {
        console.log('[Voice] TTS playback error:', err.message)
        setPlayingMessageId(prev => prev === messageId ? null : prev)
      }
    } else {
      setPlayingMessageId(prev => prev === messageId ? null : prev)
    }
  }, [playingMessageId, messages])

  // Start recording audio - uses pre-acquired stream for instant start
  const handleRecordStart = useCallback(async () => {
    setPlayingMessageId(null)
    audioChunksRef.current = []
    speechResultRef.current = ''

    try {
      // Use pre-acquired stream (instant) or fallback to getUserMedia
      let stream = preAcquiredStreamRef.current
      if (!stream || stream.getTracks().every(t => t.readyState === 'ended')) {
        if (!navigator.mediaDevices) {
          setToastMsg('麦克风不可用，请使用 HTTPS 或 localhost 访问')
          return
        }
        console.log('[Voice] Pre-acquired stream unavailable, acquiring new one')
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      // Start Web Speech API in parallel as fallback ASR
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition()
        recognition.lang = 'zh-CN'
        recognition.continuous = true
        recognition.interimResults = false
        recognition.onresult = (event) => {
          let text = ''
          for (let i = 0; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              text += event.results[i][0].transcript
            }
          }
          if (text) speechResultRef.current = text
        }
        recognition.onerror = (e) => console.log('[Voice] SpeechRecognition fallback error:', e.error)
        recognition.start()
        speechRecogRef.current = recognition
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error('[Voice] Microphone access denied:', err)
      setIsRecording(true)
    }
  }, [])

  // Stop recording and send to ASR -> backend -> teacher flow
  const handleRecordEnd = useCallback(async () => {
    if (!isRecording) return
    setIsRecording(false)

    // Stop Web Speech API fallback
    if (speechRecogRef.current) {
      try { speechRecogRef.current.stop() } catch (e) {}
      speechRecogRef.current = null
    }

    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      // Don't stop the stream tracks - keep the pre-acquired stream alive for reuse
      // Instead, re-acquire a fresh stream for next recording (non-blocking)
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia({ audio: true }).then(newStream => {
        if (preAcquiredStreamRef.current && preAcquiredStreamRef.current !== newStream) {
          preAcquiredStreamRef.current.getTracks().forEach(t => t.stop())
        }
        preAcquiredStreamRef.current = newStream
      }).catch(() => {})

      await new Promise(resolve => {
        recorder.onstop = resolve
      })

      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      const audioUrl = URL.createObjectURL(audioBlob)

      if (audioBlob.size < 1000) return

      setIsRecognizing(true)

      // Upload audio to backend for teacher to hear original recording
      let serverAudioUrl = null
      try {
        serverAudioUrl = await api.uploadAudio(audioBlob)
      } catch (err) {
        console.log('[Voice] Audio upload failed (non-fatal):', err.message)
      }

      // ASR: try DashScope first, fallback to Web Speech API result
      let text = ''
      try {
        const data = await api.speechToText(audioBlob)
        text = (data.data?.text || data.text || data.content || '').trim()
        if (text) console.log('[Voice] DashScope ASR success:', text)
      } catch (err) {
        console.log('[Voice] DashScope ASR failed:', err.message, '-> trying fallback')
      }

      // Fallback: use Web Speech API result if DashScope failed or returned empty
      if (!text && speechResultRef.current) {
        text = speechResultRef.current.trim()
        if (text) {
          console.log('[Voice] Using Web Speech API fallback:', text)
          setToastMsg('已使用备用语音识别')
          setTimeout(() => setToastMsg(null), 2000)
        }
      }

      if (text) {
        setIsRecognizing(false)
        setIsWaitingReply(true)
        addUserVoiceMessage(text, audioUrl)

        // Send to backend with audio_url -> WebSocket pushes to teacher with audio
        if (sessionId) {
          await api.sendMessage(sessionId, text, 'voice', serverAudioUrl).catch(err => {
            console.log('[Voice] Send message failed:', err.message)
            setIsWaitingReply(false)
          })
        } else {
          setIsWaitingReply(false)
        }
      } else {
        setToastMsg('语音识别失败，请重试')
        setTimeout(() => setToastMsg(null), 3000)
        setIsRecognizing(false)
      }
    } else {
      // No MediaRecorder available
      setToastMsg('当前浏览器不支持录音功能')
      setTimeout(() => setToastMsg(null), 3000)
    }
    mediaRecorderRef.current = null
  }, [isRecording, sessionId, addUserVoiceMessage])

  const isListening = phase === PHASE.LISTENING
  const isAIThinking = phase === PHASE.AI_THINKING

  // ==================== Agent Voice Mode (v1.007) ====================
  // Uses: /ws/dashscope-asr (ASR) + /ws/voice-pipeline (Agent→TTS)
  // Full Agent architecture: coordinator + memory + profile + trace

  const getAgentWsBase = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}`
  }

  // Initialize AudioContext on user gesture (required by browsers)
  const ensureAgentAudioContext = useCallback(() => {
    if (!agentAudioContextRef.current) {
      agentAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
    }
    // Resume if suspended (browser autoplay policy)
    if (agentAudioContextRef.current.state === 'suspended') {
      agentAudioContextRef.current.resume()
    }
    return agentAudioContextRef.current
  }, [])

  const agentPlayAudio = useCallback((base64Pcm) => {
    try {
      const ctx = ensureAgentAudioContext()
      if (!ctx || ctx.state === 'closed') return

      // Cache base64 for local replay (zero overhead during playback)
      agentTtsBase64CacheRef.current.push(base64Pcm)
      agentTtsActiveRef.current = true

      const binaryString = atob(base64Pcm)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i)
      const pcm16 = new Int16Array(bytes.buffer)
      const float32 = new Float32Array(pcm16.length)
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768
      const buffer = ctx.createBuffer(1, float32.length, 24000)
      buffer.getChannelData(0).set(float32)
      agentAudioQueueRef.current.push(buffer)

      const processQueue = () => {
        if (agentIsPlayingRef.current || agentAudioQueueRef.current.length === 0) {
          // v1.007-05: If queue empty, wait 300ms for next chunk before marking done
          if (!agentIsPlayingRef.current && agentAudioQueueRef.current.length === 0) {
            setTimeout(() => {
              if (agentAudioQueueRef.current.length > 0) {
                processQueue() // new chunk arrived, continue
              } else {
                // TTS stream truly ended
                agentTtsActiveRef.current = false
                agentTtsEndTimeRef.current = Date.now()
                // If text is done too, build WAV from cache
                if (agentTextDoneRef.current) {
                  buildLocalAudio()
                }
              }
            }, 300)
          }
          return
        }
        agentIsPlayingRef.current = true
        const buf = agentAudioQueueRef.current.shift()
        const source = ctx.createBufferSource()
        source.buffer = buf
        source.connect(ctx.destination)
        source.onended = () => {
          agentIsPlayingRef.current = false
          processQueue()
        }
        source.start()
      }
      processQueue()
    } catch (e) {
      console.warn('[Agent] Audio play error:', e.message)
    }
  }, [ensureAgentAudioContext])

  // v1.007-05: Stop all audio playback (TTS streaming + manual replay)
  const stopAllAudio = useCallback(() => {
    // Stop HTML5 Audio (manual replay)
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current = null
    }
    // Close AudioContext to stop TTS streaming (will be recreated on next play)
    if (agentAudioContextRef.current) {
      try { agentAudioContextRef.current.close() } catch {}
      agentAudioContextRef.current = null
    }
    agentAudioQueueRef.current = []
    agentIsPlayingRef.current = false
    agentTtsActiveRef.current = false
    agentTtsEndTimeRef.current = Date.now()
    setPlayingMessageId(null)
  }, [])

  // v1.007-05: Build WAV blob from cached base64 and attach to last AI message
  const buildLocalAudio = useCallback(() => {
    const chunks = agentTtsBase64CacheRef.current
    if (chunks.length === 0) return
    try {
      const decoded = chunks.map(b64 => {
        const bin = atob(b64)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        return arr
      })
      const totalLen = decoded.reduce((s, c) => s + c.length, 0)
      const merged = new Uint8Array(totalLen)
      let off = 0
      for (const c of decoded) { merged.set(c, off); off += c.length }
      // WAV header: PCM 16-bit mono 24kHz
      const hdr = new ArrayBuffer(44)
      const d = new DataView(hdr)
      const w = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)) }
      w(0, 'RIFF'); d.setUint32(4, 36 + merged.length, true)
      w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true)
      d.setUint16(20, 1, true); d.setUint16(22, 1, true)
      d.setUint32(24, 24000, true); d.setUint32(28, 48000, true)
      d.setUint16(32, 2, true); d.setUint16(34, 16, true)
      w(36, 'data'); d.setUint32(40, merged.length, true)
      const localUrl = URL.createObjectURL(new Blob([hdr, merged], { type: 'audio/wav' }))
      setMessages(prev => {
        const updated = [...prev]
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].type === 'ai' && !updated[i].audioUrl) {
            updated[i] = { ...updated[i], audioUrl: localUrl }
            break
          }
        }
        return updated
      })
    } catch (e) { console.warn('[Agent] Build local audio failed:', e) }
    agentTtsBase64CacheRef.current = []
    agentTextDoneRef.current = false
  }, [setMessages])

  const connectAgentMode = useCallback(() => {
    if (!sessionId) return
    // Force close any stale connections
    if (agentPipelineWsRef.current) {
      try { agentPipelineWsRef.current.close() } catch {}
      agentPipelineWsRef.current = null
    }
    if (agentAsrWsRef.current) {
      try { agentAsrWsRef.current.close() } catch {}
      agentAsrWsRef.current = null
    }
    if (agentMicRef.current) {
      agentMicRef.current.stop()
      agentMicRef.current = null
    }
    agentStoppedRef.current = false

    // Pre-create AudioContext on user gesture (required by browser autoplay policy)
    ensureAgentAudioContext()

    // 1. Connect voice pipeline
    const pipelineWs = new WebSocket(`${getAgentWsBase()}/ws/voice-pipeline`)
    agentPipelineWsRef.current = pipelineWs

    pipelineWs.onopen = () => {
      console.log('[Agent] Pipeline connected')
      pipelineWs.send(JSON.stringify({ type: 'start', sessionId }))
    }

    pipelineWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'ready':
            console.log('[Agent] Pipeline ready, connecting ASR...')
            setAgentConnected(true)
            connectAgentASR()
            break
          case 'thinking':
            setPhase(PHASE.AI_THINKING)
            // v1.007-05: Before clearing cache for new response, build WAV for previous one if pending
            // This handles fast-talking case where previous TTS hasn't finished playing yet
            if (agentTextDoneRef.current && agentTtsBase64CacheRef.current.length > 0) {
              buildLocalAudio()
            }
            agentTtsBase64CacheRef.current = []
            agentTextDoneRef.current = false
            break
          case 'analysis':
            setCoordinatorAnalysis(msg.data)
            break
          case 'speaking':
            setPhase(PHASE.AI_RESPONDING)
            break
          case 'tts_audio':
            try { agentPlayAudio(msg.data) } catch (e) { console.warn('[Agent] Audio play error:', e) }
            break
          case 'sentence':
            currentAiTranscriptRef.current += msg.text
            break
          case 'tts_sentence_end':
            break
          case 'tts_interrupt':
            // v1.007-05: Server says student spoke new message, stop old TTS
            stopAllAudio()
            break
          case 'response_done':
            if (msg.data?.fullContent) {
              addMessage({ type: 'ai', text: msg.data.fullContent, inputType: 'voice' })
              conversationHistoryRef.current.push({ role: 'assistant', content: msg.data.fullContent })
              currentAiTranscriptRef.current = ''
            }
            // Mark text done; WAV build happens when TTS queue drains (in processQueue 300ms timeout)
            agentTextDoneRef.current = true
            setPhase(PHASE.LISTENING)
            break
          case 'ai_audio_saved':
            // Server saved audio — update messages without local cache (e.g. loaded from history)
            if (msg.audio_url) {
              setMessages(prev => {
                const updated = [...prev]
                for (let i = updated.length - 1; i >= 0; i--) {
                  if (updated[i].type === 'ai' && !updated[i].audioUrl) {
                    updated[i] = { ...updated[i], audioUrl: msg.audio_url }
                    break
                  }
                }
                return updated
              })
            }
            break
          case 'error':
            console.error('[Agent] Pipeline error:', msg.message)
            setPhase(PHASE.LISTENING)
            break
        }
      } catch (e) {
        console.error('[Agent] Message handler error:', e)
      }
    }

    pipelineWs.onclose = () => {
      agentPipelineWsRef.current = null
      setAgentConnected(false)
      // Only reconnect if not intentionally stopped
      if (!agentStoppedRef.current && activeModeRef.current === 'agent') {
        console.log('[Agent] Pipeline disconnected, reconnecting in 2s...')
        setTimeout(() => {
          if (!agentStoppedRef.current && activeModeRef.current === 'agent' && !agentPipelineWsRef.current) {
            connectAgentMode()
          }
        }, 2000)
      }
    }

    pipelineWs.onerror = (err) => {
      console.error('[Agent] Pipeline WS error:', err)
    }
  }, [sessionId, agentPlayAudio, addMessage])

  const connectAgentASR = useCallback(() => {
    if (agentAsrWsRef.current) return

    const asrWs = new WebSocket(`${getAgentWsBase()}/ws/dashscope-asr`)
    agentAsrWsRef.current = asrWs

    asrWs.onopen = () => {
      console.log('[Agent] ASR connected')
      asrWs.send(JSON.stringify({ type: 'start', sampleRate: 16000 }))
    }

    asrWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'ready':
            console.log('[Agent] ASR ready, starting mic...')
            startAgentMic()
            break
          case 'partial':
            currentUserTranscriptRef.current = msg.text
            if (msg.text && agentPipelineWsRef.current?.readyState === WebSocket.OPEN) {
              agentPipelineWsRef.current.send(JSON.stringify({ type: 'asr_partial', text: msg.text }))
            }
            setPhase(PHASE.USER_SPEAKING)
            break
          case 'final': {
            const finalText = msg.text?.trim() || ''
            // Only filter technical empties. Short acknowledgements are valid
            // turn signals and are classified later by Context Gate.
            const isJunk = !finalText
              || /^[，。！？、；：""''（）\s.!?,;:]+$/.test(finalText)
            if (finalText && !isJunk) {
              currentUserTranscriptRef.current = finalText

              // Build WAV from buffered student PCM and upload async
              const pcmChunks = agentStudentPcmBufferRef.current
              agentStudentPcmBufferRef.current = []
              let localAudioUrl = null
              if (pcmChunks.length > 0) {
                const totalLen = pcmChunks.reduce((sum, c) => sum + c.length, 0)
                const merged = new Int16Array(totalLen)
                let off = 0
                for (const c of pcmChunks) { merged.set(c, off); off += c.length }
                const wavBlob = createWavFromPcm16(merged, 16000)
                localAudioUrl = URL.createObjectURL(wavBlob)

                // Upload to server for teacher to hear
                // api.uploadAudio returns a string URL directly, not an object
                api.uploadAudio(wavBlob).then(serverUrl => {
                  if (serverUrl && agentPipelineWsRef.current?.readyState === WebSocket.OPEN) {
                    agentPipelineWsRef.current.send(JSON.stringify({
                      type: 'student_audio_url',
                      audio_url: serverUrl,
                    }))
                  }
                }).catch((e) => console.warn('[Agent] Upload audio failed:', e))
              }

              addMessage({ type: 'user', text: finalText, inputType: 'voice', audioUrl: localAudioUrl })
              conversationHistoryRef.current.push({ role: 'user', content: finalText })
              if (agentPipelineWsRef.current?.readyState === WebSocket.OPEN) {
                agentPipelineWsRef.current.send(JSON.stringify({ type: 'asr_final', text: finalText }))
              }
              setPhase(PHASE.AI_THINKING)
            } else if (finalText) {
              // Clear PCM buffer on junk
              agentStudentPcmBufferRef.current = []
              console.log('[Agent] ASR junk filtered:', finalText)
              setPhase(PHASE.LISTENING)
            }
            break
          }
          case 'asr_unavailable':
            // v1.007-05: Server signals ASR upstream down
            console.warn('[Agent] ASR unavailable:', msg.message, 'recoverable:', msg.recoverable)
            setToastMsg({ type: msg.recoverable ? 'warning' : 'error', text: msg.message || 'ASR 暂不可用' })
            setTimeout(() => setToastMsg(null), 4000)
            if (msg.recoverable === false) {
              // Max retries exceeded — stop mic to avoid recording into void
              if (agentMicRef.current) { agentMicRef.current.stop(); agentMicRef.current = null }
            }
            break
          case 'error':
            console.error('[Agent] ASR error:', msg.message)
            break
        }
      } catch (e) {
        console.error('[Agent] ASR handler error:', e)
      }
    }

    asrWs.onclose = () => {
      agentAsrWsRef.current = null
      if (!agentStoppedRef.current && activeModeRef.current === 'agent') {
        console.log('[Agent] ASR disconnected, reconnecting in 2s...')
        setTimeout(() => {
          if (!agentStoppedRef.current && activeModeRef.current === 'agent' && !agentAsrWsRef.current && agentPipelineWsRef.current) {
            connectAgentASR()
          }
        }, 2000)
      }
    }
    asrWs.onerror = (err) => console.error('[Agent] ASR WS error:', err)
  }, [addMessage])

  const startAgentMic = useCallback(() => {
    if (agentMicRef.current) return
    if (!navigator.mediaDevices) {
      setToastMsg('麦克风不可用')
      return
    }

    navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    }).then(stream => {
      // Use browser's native sample rate, then downsample to 16kHz for DashScope
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const nativeSampleRate = audioContext.sampleRate
      console.log('[Agent] Mic native sample rate:', nativeSampleRate)
      const source = audioContext.createMediaStreamSource(stream)
      const bufferSize = 4096
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1)
      let isActive = true

      processor.onaudioprocess = (e) => {
        if (!isActive || !agentAsrWsRef.current || agentAsrWsRef.current.readyState !== WebSocket.OPEN) return
        // v1.007-05: Echo suppression — block ASR while TTS active + 1.5s tail guard
        if (agentTtsActiveRef.current || agentIsPlayingRef.current || agentAudioQueueRef.current.length > 0 || (Date.now() - agentTtsEndTimeRef.current) < 1500) return
        const inputData = e.inputBuffer.getChannelData(0)

        // Downsample from native rate to 16kHz
        const ratio = nativeSampleRate / 16000
        const outputLen = Math.floor(inputData.length / ratio)
        const pcm16 = new Int16Array(outputLen)
        for (let i = 0; i < outputLen; i++) {
          const srcIdx = Math.floor(i * ratio)
          const s = Math.max(-1, Math.min(1, inputData[srcIdx]))
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        // Send binary PCM 16kHz to ASR
        agentAsrWsRef.current.send(pcm16.buffer)
        // Buffer PCM for audio upload when ASR final arrives
        agentStudentPcmBufferRef.current.push(new Int16Array(pcm16))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      agentMicRef.current = {
        stop: () => {
          isActive = false
          processor.disconnect()
          audioContext.close()
          stream.getTracks().forEach(t => t.stop())
          agentMicRef.current = null
        }
      }
    }).catch(err => {
      console.error('[Agent] Mic error:', err)
      setToastMsg('麦克风访问失败')
    })
  }, [])

  const disconnectAgentMode = useCallback(() => {
    agentStoppedRef.current = true // prevent auto-reconnect
    if (agentMicRef.current) { agentMicRef.current.stop(); agentMicRef.current = null }
    try { if (agentAsrWsRef.current?.readyState === WebSocket.OPEN) agentAsrWsRef.current.send(JSON.stringify({ type: 'stop' })) } catch {}
    try { if (agentAsrWsRef.current) agentAsrWsRef.current.close() } catch {}
    agentAsrWsRef.current = null
    try { if (agentPipelineWsRef.current?.readyState === WebSocket.OPEN) agentPipelineWsRef.current.send(JSON.stringify({ type: 'stop' })) } catch {}
    try { if (agentPipelineWsRef.current) agentPipelineWsRef.current.close() } catch {}
    agentPipelineWsRef.current = null
    agentAudioQueueRef.current = []
    agentIsPlayingRef.current = false
    agentTtsBase64CacheRef.current = []
    agentTtsActiveRef.current = false
    agentTextDoneRef.current = false
    setAgentConnected(false)
    setPhase(PHASE.LISTENING)
  }, [])

  // Auto-connect/disconnect agent mode
  useEffect(() => {
    if (activeMode === 'agent') {
      connectAgentMode()
    } else {
      disconnectAgentMode()
    }
    return () => disconnectAgentMode()
  }, [activeMode, connectAgentMode, disconnectAgentMode])

  // Current transcript accumulators
  const currentUserTranscriptRef = useRef('')
  const currentAiTranscriptRef = useRef('')

  const handleUserTypingComplete = useCallback(() => {
    setTypingMessageId(null)
    setPhase(PHASE.AI_THINKING)
  }, [])

  const handleAITypingComplete = useCallback(() => {
    setTypingMessageId(null)
    setPhase(PHASE.LISTENING)
  }, [])

  // ==================== Common Handlers ====================

  // X按钮 - 退出语音模式，返回文本聊天
  const handleClose = () => {
    // Clean up agent connections before leaving
    disconnectAgentMode()
    if (sessionId) api.updateSessionMode(sessionId, 'text').catch(() => {})
    navigate('/chat')
  }

  const handleSettings = () => {
    alert('设置功能开发中...')
  }

  const handleKeyboard = () => {
    disconnectAgentMode()
    if (sessionId) api.updateSessionMode(sessionId, 'text').catch(() => {})
    navigate('/chat')
  }

  const getStatusText = () => {
    if (activeMode === 'push') {
      if (isRecording) return '正在聆听中...'
      if (isRecognizing) return '语音识别中...'
      if (isWaitingReply) return '等待老师回复...'
      if (playingMessageId) return '播放中...'
      return '按住说话'
    } else if (activeMode === 'agent') {
      if (!agentConnected) return '连接 Agent 语音服务中...'
      switch (phase) {
        case PHASE.LISTENING: return 'Agent 模式 - 正在聆听...'
        case PHASE.USER_SPEAKING: return '语音识别中...'
        case PHASE.AI_THINKING: return '小树洞思考中...'
        case PHASE.AI_RESPONDING: return '小树洞回复中...'
        default: return 'Agent 模式 - 聆听中...'
      }
    }
  }

  return (
    <div className="bg-[#fbf9ec] w-full min-h-screen flex justify-center items-start py-4">
      <div className="relative w-[402px] h-[874px] bg-[#fbf9ec] overflow-hidden flex-shrink-0">

        {/* Header */}
        <div className="absolute left-0 top-0 w-[402px] h-[114px]">
          <div className="absolute left-[24px] top-[53px]">
            <HeaderButton icon={imgIconClose} onClick={handleClose} />
          </div>
          <div className="absolute left-[101px] top-[48px]">
            <ModeToggle activeMode={activeMode} onModeChange={setActiveMode} />
          </div>
          <div className="absolute left-[338px] top-[53px]">
            <HeaderButton icon={imgIconSettings} onClick={handleSettings} />
          </div>
        </div>

        {/* Owl Hero - Fixed Position */}
        <div className="absolute left-[31px] top-[154px] w-[340px] h-[226px]">
          <div
            className={`
              w-full h-full bg-[#fbf9ec] rounded-[70px]
              flex items-center justify-center overflow-hidden
              transition-all duration-700
              ${owlLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
            `}
          >
            <img
              src={imgImageOwl}
              alt="Owl"
              className={`
                w-[180px] h-[180px] object-contain
                ${owlLoaded ? 'animate-float' : ''}
                ${activeMode === 'push' && playingMessageId ? 'animate-bounce' : ''}
                ${(activeMode === 'agent') && isListening ? 'animate-pulse' : ''}
                ${(activeMode === 'agent') && isAIThinking ? 'animate-wiggle' : ''}
              `}
            />
          </div>
        </div>

        {/* Coordinator Stage Badge (agent mode) */}
        {(activeMode === 'agent') && (
          <div className="absolute left-0 top-[370px] w-[402px] flex justify-center z-10">
            <CoordinatorBadge currentStage={currentStage} analysis={coordinatorAnalysis} />
          </div>
        )}

        {/* Chat Messages Container - Scrollable */}
        <div className={`absolute left-0 ${(activeMode === 'agent') ? 'top-[410px]' : 'top-[380px]'} bottom-[156px] w-[402px]`}>
          {/* 顶部渐变遮罩 - 让消息淡出而不是硬切 */}
          <div className="absolute top-0 left-0 right-0 h-[40px] bg-gradient-to-b from-[#fbf9ec] to-transparent z-10 pointer-events-none" />

          <div
            ref={scrollContainerRef}
            className="w-full h-full px-[16px] pt-[20px] pb-[80px] flex flex-col gap-[32px] overflow-y-auto scrollbar-hide"
          >
          {messages.map((msg) => {
              const isVoiceMode = activeMode === 'agent'
              const msgText = msg.text || msg.content || ''
              const msgType = msg.type || (msg.sender_type === 'student' ? 'user' : msg.sender_type === 'teacher' ? 'teacher' : 'ai')
              const msgInputType = msg.inputType || msg.input_type || 'text'
              const msgAudioUrl = msg.audioUrl || msg.audio_url || null
              return msgType === 'ai' || msgType === 'teacher' ? (
                <AIChatMessage
                  key={msg.id}
                  text={msgText}
                  inputType={msgInputType}
                  isTyping={isVoiceMode && typingMessageId === msg.id}
                  isPlaying={playingMessageId === msg.id}
                  onPlayClick={() => handlePlayMessage(msg.id)}
                  onTypingComplete={handleAITypingComplete}
                  isNew={isVoiceMode && newMessageId === msg.id}
                  disabled={false}
                  hasAudio={!!msgAudioUrl}
                />
              ) : (
                <UserChatMessage
                  key={msg.id}
                  text={msgText}
                  inputType={msgInputType}
                  isTyping={isVoiceMode && typingMessageId === msg.id}
                  isPlaying={playingMessageId === msg.id}
                  onPlayClick={() => handlePlayMessage(msg.id)}
                  onTypingComplete={handleUserTypingComplete}
                  isNew={isVoiceMode && newMessageId === msg.id}
                  disabled={false}
                  hasAudio={!!msgAudioUrl}
                />
              )
            })}

          {/* ASR Processing Indicator (push mode) */}
          {activeMode === 'push' && isRecognizing && (
            <div className="relative flex items-start justify-end gap-[12px] animate-slide-up">
              <div className="bg-white border-4 border-[#f6cb5b] rounded-[20px] shadow-[0px_4px_4px_0px_rgba(114,72,45,0.25)] px-5 py-4 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-[#60a5fa] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-[#60a5fa] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-[#60a5fa] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-[13px] text-[#72482d] font-bold">语音识别中</span>
              </div>
              <div className="flex-shrink-0 w-[44px] h-[44px] animate-pulse">
                <img src={imgGirl21} alt="User" className="w-full h-full object-cover" />
              </div>
            </div>
          )}
          {/* Waiting for teacher reply (push mode) */}
          {activeMode === 'push' && isWaitingReply && <AIThinkingIndicator />}
          {/* AI Thinking Indicator (agent mode) */}
          {activeMode === 'agent' && isAIThinking && <AIThinkingIndicator />}
          </div>
        </div>

        {/* Toast notification for errors */}
        {toastMsg && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-[170px] z-50 bg-red-500 text-white text-sm px-4 py-2 rounded-full shadow-lg animate-fade-in">
            {toastMsg}
          </div>
        )}

        {/* Bottom Control Area - Fixed at bottom */}
        <div className="absolute left-0 bottom-0 w-[402px] h-[156px]">
          {/* Gradient background */}
          <div className="absolute left-0 bottom-0 w-[402px] h-[140px] bg-gradient-to-t from-[rgba(246,203,91,0.2)] to-transparent" />

          {activeMode === 'push' ? (
            /* Push Mode Controls */
            <div className="absolute left-0 top-[14px] w-[402px] h-[100px]">
              <div className="absolute left-[77px] top-[25px]">
                <ControlButton icon={imgIconKeyboard} onClick={handleKeyboard} />
              </div>
              <div className="absolute left-[151px] top-0">
                <PushButton
                  isRecording={isRecording}
                  onPress={handleRecordStart}
                  onRelease={handleRecordEnd}
                />
              </div>
            </div>
          ) : activeMode === 'agent' ? (
            /* Agent Voice Mode Controls — mic is auto-started, show waveform */
            <div className="absolute left-0 top-[14px] w-[402px] h-[100px]">
              <div className="absolute left-[77px] top-[25px]">
                <ControlButton icon={imgIconKeyboard} onClick={handleKeyboard} />
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 top-0">
                <VoiceWaveform isListening={agentConnected || phase === PHASE.USER_SPEAKING} />
              </div>
            </div>
          ) : (
            /* Fallback */
            <div className="absolute left-0 top-[14px] w-[402px] h-[100px]">
              <div className="absolute left-[77px] top-[25px]">
                <ControlButton icon={imgIconKeyboard} onClick={handleKeyboard} />
              </div>
            </div>
          )}

          {/* Status Text */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-[20px]">
            {activeMode === 'push' && playingMessageId && !isRecording ? (
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1 h-3 bg-[#60a5fa] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-4 bg-[#60a5fa] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-3 bg-[#60a5fa] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <p className="text-[#72482d] font-bold text-[14px]">播放中...</p>
              </div>
            ) : (
              <p className={`font-bold text-[14px] text-[#72482d] ${(activeMode === 'push' && isRecording) || (activeMode === 'agent' && isListening) ? 'animate-pulse' : ''}`}>
                {getStatusText()}
              </p>
            )}
          </div>
        </div>


      </div>
    </div>
  )
}
