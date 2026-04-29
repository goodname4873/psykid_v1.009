import { createContext, useContext, useState, useCallback } from 'react'

// 创建聊天上下文
const ChatContext = createContext(null)

// 消息类型
// inputType: 'text' | 'voice' - 区分文本输入还是语音输入
// type: 'ai' | 'user' - 区分AI还是用户

export function ChatProvider({ children }) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'ai',
      inputType: 'text',
      text: '你好！我是你的心理咨询伙伴，有什么想对我说的吗？',
      timestamp: Date.now(),
    }
  ])

  // sessionId always comes from backend via api.createSession(), not localStorage
  const [sessionId, setSessionId] = useState(null)
  const [mode, setMode] = useState('text') // 'text' | 'push' | 'agent'

  // Persist sessionId to localStorage
  const setSessionIdPersist = useCallback((sid) => {
    setSessionId(sid)
    if (sid) {
      localStorage.setItem('psy_session_id', String(sid))
    } else {
      localStorage.removeItem('psy_session_id')
    }
  }, [])

  // 添加消息
  const addMessage = useCallback((message) => {
    setMessages(prev => [...prev, {
      id: Date.now(),
      timestamp: Date.now(),
      sessionId,
      ...message
    }])
  }, [sessionId])

  // 添加用户文本消息
  const addUserTextMessage = useCallback((text) => {
    addMessage({
      type: 'user',
      inputType: 'text',
      text
    })
  }, [addMessage])

  // 添加用户语音消息
  const addUserVoiceMessage = useCallback((text, audioUrl) => {
    addMessage({
      type: 'user',
      inputType: 'voice',
      text,
      audioUrl
    })
  }, [addMessage])

  // 添加AI文本回复
  const addAIMessage = useCallback((text) => {
    addMessage({
      type: 'ai',
      inputType: 'text',
      text
    })
  }, [addMessage])

  // 添加AI语音回复（语音模式下使用）
  const addAIVoiceMessage = useCallback((text, audioUrl) => {
    addMessage({
      type: 'ai',
      inputType: 'voice',
      text,
      audioUrl
    })
  }, [addMessage])

  // 添加教师回复
  const addTeacherMessage = useCallback((text, audioUrl) => {
    addMessage({
      type: 'teacher',
      inputType: audioUrl ? 'voice' : 'text',
      text,
      audioUrl
    })
  }, [addMessage])

  // 加载历史消息（从API获取后批量设置）
  const loadMessages = useCallback((msgs) => {
    setMessages(msgs)
  }, [])

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([{
      id: 1,
      type: 'ai',
      inputType: 'text',
      text: '你好！我是你的心理咨询伙伴，有什么想对我说的吗？',
      timestamp: Date.now(),
    }])
  }, [])

  const value = {
    messages,
    setMessages,
    sessionId,
    setSessionId: setSessionIdPersist,
    mode,
    setMode,
    addMessage,
    addUserTextMessage,
    addUserVoiceMessage,
    addAIMessage,
    addAIVoiceMessage,
    addTeacherMessage,
    loadMessages,
    clearMessages
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}

// 自定义Hook
export function useChat() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}
