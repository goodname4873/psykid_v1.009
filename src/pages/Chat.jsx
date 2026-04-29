import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChat } from '../context/ChatContext'
import api from '../services/api'
import { connectSocket, getSocket, joinSession, leaveSession } from '../services/websocket'

// Assets - 本地图片路径
const imgArrow = "/assets/arrow.png"
const imgAvatar1 = "/assets/avatar-owl.png"
const imgGirl21 = "/assets/avatar-girl.png"
const imgIcon = "/assets/icon-phone.png"
const imgIcon1 = "/assets/icon-send.png"

// Format time
const formatTime = (date) => {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

// Typewriter Text Component for voice playback
const TypewriterText = ({ text, isPlaying }) => {
  const [displayedText, setDisplayedText] = useState('')
  const [charIndex, setCharIndex] = useState(0)

  useEffect(() => {
    if (isPlaying) {
      setDisplayedText('')
      setCharIndex(0)
    }
  }, [isPlaying, text])

  useEffect(() => {
    if (isPlaying && charIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(prev => prev + text[charIndex])
        setCharIndex(prev => prev + 1)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isPlaying, charIndex, text])

  if (!isPlaying) {
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

// Voice Badge Component - 语音消息标识，可播放（与Voice.jsx保持一致）
const VoiceBadge = ({ position = 'left', isPlaying, onClick }) => (
  <button
    onClick={onClick}
    className={`
      absolute bg-white border-2 border-[#60a5fa] rounded-full
      shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1),0px_1px_2px_0px_rgba(0,0,0,0.1)]
      w-[26px] h-[26px] flex items-center justify-center
      top-[-10px] ${position === 'left' ? 'left-[-8px]' : 'right-[-8px]'}
      transition-all duration-300 hover:scale-110 cursor-pointer
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
    {isPlaying && (
      <div className="absolute inset-[-4px] rounded-full border-2 border-[#60a5fa] animate-ping opacity-75" />
    )}
  </button>
)

// Bot Message Component（与Voice.jsx的AIChatMessage保持一致）
const BotMessage = ({ text, time, isNew, inputType, isPlaying, onPlayClick }) => (
  <div className={`relative flex items-start gap-[12px] transition-all duration-500 ${isNew ? 'animate-slide-up' : ''}`}>
    {/* Avatar */}
    <div className={`flex-shrink-0 w-[44px] h-[44px] ${isNew ? 'animate-bounce-in' : ''} ${isPlaying ? 'animate-bounce' : ''}`}>
      <img src={imgAvatar1} alt="咨询师" className="w-full h-full object-cover" />
    </div>

    {/* Message bubble */}
    <div className="flex flex-col items-start">
      <div className="relative flex-1 max-w-[220px]">
        <div
          className={`
            relative bg-[#faefb9] rounded-tr-[20px] rounded-br-[20px] rounded-bl-[20px]
            border-4 border-solid border-[#f6cb5b] shadow-[0px_4px_4px_0px_rgba(114,72,45,0.25)]
            px-[16px] py-[16px]
            transition-all duration-300
            ${isNew ? 'animate-pop' : ''}
            ${isPlaying ? 'shadow-[0px_4px_12px_0px_rgba(114,72,45,0.4)] scale-[1.02]' : ''}
          `}
        >
          <p className="font-bold text-[16px] leading-[22px] text-[#72482d] text-left">
            {(inputType === 'voice' || inputType === 'realtime_voice') ? (
              <TypewriterText text={text} isPlaying={isPlaying} />
            ) : (
              text
            )}
          </p>
        </div>
        {/* Voice badge for voice messages - 绝对定位在气泡左上角 */}
        {(inputType === 'voice' || inputType === 'realtime_voice') && (
          <VoiceBadge position="left" isPlaying={isPlaying} onClick={onPlayClick} />
        )}
      </div>

      {/* Time badge */}
      <div className={`mt-[11px] bg-[#8c5c37] rounded-[12px] h-[18px] px-[6px] flex items-center ${isNew ? 'animate-bounce-in' : ''}`}>
        <span className="font-bold text-[10px] leading-[22px] text-white whitespace-nowrap">
          {time}
        </span>
      </div>
    </div>
  </div>
)

// User Message Component（与Voice.jsx的UserChatMessage保持一致）
const UserMessage = ({ text, time, isNew, inputType, isPlaying, onPlayClick }) => (
  <div className={`relative flex items-start justify-end gap-[12px] transition-all duration-500 ${isNew ? 'animate-slide-up' : ''}`}>
    {/* Message bubble */}
    <div className="flex flex-col items-end">
      <div className="relative flex-1 max-w-[220px]">
        <div
          className={`
            relative bg-white rounded-tl-[20px] rounded-br-[20px] rounded-bl-[20px]
            border-4 border-solid border-[#f6cb5b] shadow-[0px_4px_4px_0px_rgba(114,72,45,0.25)]
            px-[16px] py-[16px]
            transition-all duration-300
            ${isNew ? 'animate-pop' : ''}
            ${isPlaying ? 'shadow-[0px_4px_12px_0px_rgba(114,72,45,0.4)] scale-[1.02]' : ''}
          `}
        >
          <p className="font-bold text-[16px] leading-[22px] text-[#72482d] text-left">
            {(inputType === 'voice' || inputType === 'realtime_voice') ? (
              <TypewriterText text={text} isPlaying={isPlaying} />
            ) : (
              text
            )}
          </p>
        </div>
        {/* Voice badge for voice messages - 绝对定位在气泡右上角 */}
        {(inputType === 'voice' || inputType === 'realtime_voice') && (
          <VoiceBadge position="right" isPlaying={isPlaying} onClick={onPlayClick} />
        )}
      </div>

      {/* Time badge */}
      <div className={`mt-[10px] bg-[#8c5c37] rounded-[12px] h-[18px] px-[6px] flex items-center ${isNew ? 'animate-bounce-in' : ''}`}>
        <span className="font-bold text-[10px] leading-[22px] text-white whitespace-nowrap">
          {time}
        </span>
      </div>
    </div>

    {/* Avatar */}
    <div className={`flex-shrink-0 w-[44px] h-[44px] ${isNew ? 'animate-bounce-in' : ''} ${isPlaying ? 'animate-bounce' : ''}`}>
      <img src={imgGirl21} alt="用户" className="w-full h-full object-cover" />
    </div>
  </div>
)

// Typing indicator
const TypingIndicator = () => (
  <div className="flex items-start gap-[12px] animate-slide-up">
    <div className="w-[44px] h-[44px] flex-shrink-0 animate-wiggle">
      <img src={imgAvatar1} alt="咨询师" className="w-full h-full object-cover" />
    </div>
    <div className="bg-[#faefb9] border-4 border-solid border-[#f6cb5b] rounded-[20px] shadow-[0px_4px_4px_0px_rgba(114,72,45,0.25)] px-5 py-4 flex items-center justify-center">
      <div className="flex gap-2">
        <span className="w-3 h-3 bg-[#8c5c37] rounded-full animate-typing" style={{ animationDelay: '0s' }}></span>
        <span className="w-3 h-3 bg-[#8c5c37] rounded-full animate-typing" style={{ animationDelay: '0.2s' }}></span>
        <span className="w-3 h-3 bg-[#8c5c37] rounded-full animate-typing" style={{ animationDelay: '0.4s' }}></span>
      </div>
    </div>
  </div>
)

// Chat Page
export default function Chat() {
  const navigate = useNavigate()
  const { messages, addMessage, addUserTextMessage, addAIMessage, addTeacherMessage, sessionId, setSessionId, loadMessages } = useChat()
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [newMessageId, setNewMessageId] = useState(null)
  const [playingMessageId, setPlayingMessageId] = useState(null)
  const chatContainerRef = useRef(null)

  // Initialize: get session from backend → connect socket → join room → load history → listen
  useEffect(() => {
    let cancelled = false
    let currentSid = null
    let chatMessageHandler = null
    let chatConnectHandler = null

    async function init() {
      try {
        // Always ask backend for the active session (returns existing or creates new)
        const res = await api.createSession()
        const sid = res.data?.session_id || res.data?.id || res.session_id || res.sessionId
        if (cancelled || !sid) return

        currentSid = sid
        setSessionId(sid)

        // Reset session mode to text (in case user came back from voice mode)
        api.updateSessionMode(sid, 'text').catch(() => {})

        // Connect WebSocket and join session room
        const socket = connectSocket()
        if (socket) {
          // Join room immediately if already connected
          if (socket.connected) {
            joinSession(sid)
          }
          // Also join on (re)connect
          chatConnectHandler = () => joinSession(sid)
          socket.on('connect', chatConnectHandler)

          // Listen for teacher/AI messages
          chatMessageHandler = (msg) => {
            if (String(msg.session_id) !== String(sid)) return
            setIsTyping(false)
            addMessage({
              type: msg.sender_type === 'teacher' ? 'teacher' : 'ai',
              inputType: msg.input_type || 'text',
              text: msg.content || msg.text,
              audioUrl: msg.audio_url,
            })
            setNewMessageId(Date.now())
            // Student is viewing chat, mark incoming message as read immediately
            api.markSessionRead(sid).catch(() => {})
          }
          socket.on('teacher:message', chatMessageHandler)
        }

        // Load message history from database
        const histRes = await api.getMessageHistory(sid)
        const msgs = histRes.data?.list || histRes.data || histRes.messages || []
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

        // Mark all messages in this session as read
        api.markSessionRead(sid).catch(() => {})
      } catch (err) {
        console.error('Chat init failed:', err)
      }
    }

    init()

    return () => {
      cancelled = true
      if (currentSid) leaveSession(currentSid)
      const socket = getSocket()
      if (socket) {
        // Only remove our own handlers, not all listeners for these events
        if (chatMessageHandler) socket.off('teacher:message', chatMessageHandler)
        if (chatConnectHandler) socket.off('connect', chatConnectHandler)
      }
    }
  }, [])

  // Auto scroll to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [messages, isTyping])

  // Reset animation flag
  useEffect(() => {
    if (newMessageId) {
      const timer = setTimeout(() => setNewMessageId(null), 600)
      return () => clearTimeout(timer)
    }
  }, [newMessageId])

  const handleSend = async () => {
    if (!inputValue.trim() || !sessionId) return

    const text = inputValue.trim()
    addUserTextMessage(text)
    setNewMessageId(Date.now())
    setInputValue('')
    setIsTyping(true)

    // Send message to backend -> backend saves + WebSocket pushes to teacher
    try {
      await api.sendMessage(sessionId, text, 'text')
    } catch (err) {
      console.error('[Chat] Send message failed:', err.message)
      setIsTyping(false)
      addMessage({ type: 'ai', inputType: 'text', text: '消息发送失败，请刷新页面重试' })
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleBack = () => {
    navigate('/')
  }

  // 切换到语音模式
  const handleSwitchToVoice = () => {
    navigate('/voice')
  }

  // Audio player ref for TTS playback
  const audioPlayerRef = useRef(null)

  // 播放语音消息 - 使用TTS真实播放
  const handlePlayVoice = useCallback(async (messageId) => {
    if (playingMessageId === messageId) {
      // Stop playing
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause()
        audioPlayerRef.current = null
      }
      setPlayingMessageId(null)
      return
    }

    setPlayingMessageId(messageId)
    const message = messages.find(m => m.id === messageId)
    if (!message) return

    if (message.audioUrl) {
      // Play original audio recording
      const src = message.audioUrl.startsWith('http') || message.audioUrl.startsWith('blob:')
        ? message.audioUrl
        : `http://localhost:3000${message.audioUrl}`
      const audio = new Audio(src)
      audioPlayerRef.current = audio
      audio.onended = () => {
        setPlayingMessageId(prev => prev === messageId ? null : prev)
        audioPlayerRef.current = null
      }
      audio.play().catch(() => {
        setPlayingMessageId(prev => prev === messageId ? null : prev)
      })
    } else if (message.text) {
      // No audio URL - generate TTS
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
        console.log('[Chat] TTS playback error:', err.message)
        setPlayingMessageId(prev => prev === messageId ? null : prev)
      }
    }
  }, [playingMessageId, messages])

  return (
    <div className="bg-[#fbf9ec] w-full min-h-screen flex justify-center items-start py-4">
      {/* iPhone 16 Pro Frame */}
      <div className="relative w-[405px] h-[874px] bg-[#fbf9ec] overflow-hidden flex-shrink-0">

        {/* Header - Top Bar */}
        <div className="absolute left-[14px] top-[48px] w-[374px] h-[70px]">
          <div className="bg-[#f6cb5b] h-[70px] w-[374px] rounded-[120px] shadow-[0px_7px_0px_0px_#cfa63b] relative overflow-hidden">
            {/* Back Button */}
            <div className="absolute left-[11px] top-[11px] w-[48px] h-[48px] flex items-center justify-center">
              <button
                onClick={handleBack}
                className="bg-[#f6cb5b] w-[48px] h-[48px] rounded-[120px] shadow-[0px_4px_0px_0px_#cfa63b] relative overflow-hidden cursor-pointer hover:brightness-105 active:translate-y-[2px] active:shadow-[0px_2px_0px_0px_#cfa63b] transition-all"
              >
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[26px] h-[26px]">
                  <img src={imgArrow} alt="返回" className="w-full h-full object-cover" />
                </div>
                <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0px_2px_0px_0px_rgba(255,249,249,0.25)] pointer-events-none" />
              </button>
            </div>

            {/* Title */}
            <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center justify-center">
              <p className="font-bold text-[20px] text-[#72482d] leading-normal">
                咨询对话
              </p>
            </div>
          </div>
        </div>

        {/* Main Chat Container */}
        <div
          ref={chatContainerRef}
          className="absolute left-[12px] top-[140px] w-[381px] h-[625px] bg-[#f5eedc] rounded-[40px] overflow-y-auto overflow-x-hidden scrollbar-hide"
        >
          {/* Inner shadow overlay */}
          <div className="absolute inset-0 rounded-[inherit] shadow-[inset_-2px_0px_0px_0px_rgba(237,227,198,0.75),inset_2px_0px_0px_0px_rgba(237,227,198,0.75),inset_0px_4px_6px_0px_#ede3c6] pointer-events-none z-10" />

          {/* Messages */}
          <div className="relative p-4 flex flex-col gap-4">
            {messages.map((message) => (
              message.type === 'user' ? (
                <UserMessage
                  key={message.id}
                  text={message.text}
                  time={message.time || formatTime(message.timestamp ? new Date(message.timestamp) : new Date())}
                  isNew={message.id === newMessageId}
                  inputType={message.inputType}
                  isPlaying={playingMessageId === message.id}
                  onPlayClick={() => handlePlayVoice(message.id)}
                />
              ) : (
                <BotMessage
                  key={message.id}
                  text={message.text}
                  time={message.time || formatTime(message.timestamp ? new Date(message.timestamp) : new Date())}
                  isNew={message.id === newMessageId}
                  inputType={message.inputType}
                  isPlaying={playingMessageId === message.id}
                  onPlayClick={() => handlePlayVoice(message.id)}
                />
              )
            ))}
            {isTyping && <TypingIndicator />}
            {/* Bottom padding for scroll */}
            <div className="h-4" />
          </div>
        </div>

        {/* Bottom Input Bar */}
        <div className="absolute left-[30px] top-[778px] w-[346px] h-[82px] bg-[#fbf9ec] rounded-[160px] shadow-[0px_4px_10px_0px_rgba(204,158,44,0.53)] overflow-hidden">
          {/* Input Field */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[226px] h-[61px] bg-[#fbf9ec] border-4 border-solid border-[#f6cb5b] rounded-[120px] overflow-hidden" style={{ marginLeft: '-50px' }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入你想说的话..."
              className="w-full h-full bg-transparent px-[22px] font-bold text-[16px] text-[#72482d] caret-[#72482d] placeholder:text-[rgba(114,72,45,0.3)] outline-none"
            />
            <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0px_2px_3px_0px_rgba(114,72,45,0.12)] pointer-events-none" />
          </div>

          {/* Buttons Container */}
          <div className="absolute left-[234px] top-[17px] w-[113px] h-[49px] overflow-hidden">
            {/* Phone Button - 切换到语音模式 */}
            <button
              className="absolute left-[8px] top-[2px] bg-[#a2dcbb] p-[10px] rounded-[120px] shadow-[0px_3px_0px_0px_#6fb98f] cursor-pointer hover:brightness-105 active:translate-y-[2px] active:shadow-[0px_1px_0px_0px_#6fb98f] transition-all"
              onClick={handleSwitchToVoice}
            >
              <div className="w-[22px] h-[22px]">
                <img src={imgIcon} alt="语音" className="w-full h-full object-cover" />
              </div>
            </button>

            {/* Send Button */}
            <button
              className="absolute left-[62px] top-[2px] bg-[#f6cb5b] p-[10px] rounded-[120px] shadow-[0px_3px_0px_0px_#deb958] cursor-pointer hover:brightness-105 active:translate-y-[2px] active:shadow-[0px_1px_0px_0px_#deb958] transition-all"
              onClick={handleSend}
            >
              <div className="w-[22px] h-[22px]">
                <img src={imgIcon1} alt="发送" className="w-full h-full object-cover" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
