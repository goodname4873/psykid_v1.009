import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'
import { connectSocket, getSocket, joinSession, leaveSession } from '../services/websocket'

// Assets - 本地图片路径
const imgOwl = "/assets/owl-hero.png"
const imgWriteIcon = "/assets/icon-write.png"
const imgSpeakIcon = "/assets/icon-speak.png"
const imgConsultIcon = "/assets/icon-consult.png"
const imgMyIcon = "/assets/icon-my.png"

// Action Button Component with animations
const ActionButton = ({ icon, text, onClick, delay = 0, badge = 0 }) => {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  const badgeText = badge > 99 ? '99+' : String(badge)

  return (
    <button
      onClick={onClick}
      className={`
        bg-[#d8b14c] rounded-[20px] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)] overflow-visible
        cursor-pointer transition-all duration-300 relative
        hover:scale-105 hover:shadow-[0px_6px_8px_0px_rgba(0,0,0,0.3)]
        active:scale-95 active:translate-y-[2px]
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}
      `}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="bg-[#f8ce62] rounded-[20px] w-[160px] h-[160px] relative overflow-hidden group">
        {/* Inner cream container */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#faf8ec] rounded-[20px] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.13)] w-[140px] h-[140px] transition-transform duration-300 group-hover:scale-[1.02]">
          <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0px_8px_10px_0px_rgba(250,248,248,0.76),inset_0px_-4px_4px_0px_rgba(0,0,0,0.13)] pointer-events-none" />
        </div>

        {/* Icon with bounce animation on hover */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[22px] w-[96px] h-[96px] transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-1">
          <img src={icon} alt={text} className="w-full h-full object-cover" />
        </div>

        {/* Text */}
        <p className="absolute left-1/2 -translate-x-1/2 bottom-[20px] font-bold text-[20px] text-[#72482d] whitespace-nowrap transition-all duration-300 group-hover:text-[#5a3a24]">
          {text}
        </p>
      </div>

      {/* Unread badge */}
      {badge > 0 && (
        <span className="absolute -top-2 -right-2 z-10 min-w-[24px] h-[24px] px-[6px] flex items-center justify-center bg-[#ff4444] text-white text-[13px] font-bold rounded-full shadow-[0_2px_6px_rgba(255,68,68,0.5)] animate-badge-pop">
          {badgeText}
        </span>
      )}
    </button>
  )
}

// Bottom Navigation Component
const BottomNav = ({ activeTab, onTabChange }) => (
  <div className="absolute left-[31px] top-[728px] w-[346px] h-[82px] bg-white rounded-[160px] shadow-[0px_4px_10px_0px_rgba(204,158,44,0.53)] overflow-hidden animate-slide-up">
    <div className="absolute left-[10px] top-[10px] flex gap-[14px] items-center w-[319px]">
      {/* 咨询 Tab */}
      <button
        onClick={() => onTabChange('consult')}
        className={`w-[156px] h-[61px] rounded-[120px] relative cursor-pointer transition-all duration-300 hover:scale-[1.02] ${
          activeTab === 'consult' ? 'bg-[#f9ce64]' : 'bg-white hover:bg-[#fef9e8]'
        }`}
      >
        <div className="absolute left-[39px] top-[12px] flex gap-[9px] items-center">
          <div className="w-[36px] h-[36px]">
            <img src={imgConsultIcon} alt="咨询" className="w-full h-full object-cover" />
          </div>
          <p className="font-bold text-[20px] text-[#72482d]">咨询</p>
        </div>
        {activeTab === 'consult' && (
          <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0px_-4px_4px_0px_rgba(225,180,68,0.5),inset_0px_4px_4px_0px_#e1b444] pointer-events-none" />
        )}
      </button>

      {/* 我的 Tab */}
      <button
        onClick={() => onTabChange('my')}
        className={`w-[156px] h-[61px] rounded-[120px] relative cursor-pointer transition-all duration-300 hover:scale-[1.02] flex items-center justify-center ${
          activeTab === 'my' ? 'bg-[#f9ce64]' : 'bg-white hover:bg-[#fef9e8]'
        }`}
      >
        <div className="flex gap-[9px] items-center">
          <div className="w-[36px] h-[36px]">
            <img src={imgMyIcon} alt="我的" className="w-full h-full object-cover" />
          </div>
          <p className="font-bold text-[20px] text-[#72482d]">我的</p>
        </div>
        {activeTab === 'my' && (
          <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0px_-4px_4px_0px_rgba(225,180,68,0.5),inset_0px_4px_4px_0px_#e1b444] pointer-events-none" />
        )}
      </button>
    </div>
  </div>
)

// Home Page
export default function Home() {
  const navigate = useNavigate()
  const [owlLoaded, setOwlLoaded] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    // Trigger owl animation after mount
    const timer = setTimeout(() => setOwlLoaded(true), 100)
    return () => clearTimeout(timer)
  }, [])

  // Fetch unread count from backend, returns session_id if exists
  const fetchUnread = useCallback(() => {
    return api.getUnreadMessages()
      .then(resp => {
        setUnreadCount(resp.data?.total_unread ?? 0)
        return resp.data?.session_id || null
      })
      .catch(() => null)
  }, [])

  // Fetch unread count on mount + WebSocket real-time + polling fallback
  useEffect(() => {
    let joinedSid = null
    const handleNewMessage = () => fetchUnread()

    // 1) Start socket connection early
    connectSocket()

    // 2) Fetch initial count; if session exists, join room for real-time push
    fetchUnread().then(sid => {
      if (sid) {
        joinedSid = sid
        const socket = getSocket()
        if (socket) {
          joinSession(sid)
          socket.on('teacher:message', handleNewMessage)
        }
      }
    })

    // 3) Poll every 5s as reliable fallback
    const interval = setInterval(() => fetchUnread(), 5000)

    return () => {
      clearInterval(interval)
      if (joinedSid) leaveSession(joinedSid)
      const socket = getSocket()
      if (socket) socket.off('teacher:message', handleNewMessage)
    }
  }, [fetchUnread])

  const handleWriteClick = () => {
    navigate('/chat')
  }

  const handleSpeakClick = () => {
    navigate('/voice')
  }

  const handleTabChange = (tab) => {
    if (tab === 'my') {
      navigate('/profile')
    }
  }

  return (
    <div className="bg-[#fbf9ec] w-full min-h-screen flex justify-center items-start py-4">
      {/* iPhone 16 Pro Frame */}
      <div className="relative w-[402px] h-[874px] bg-[#fbf9ec] overflow-hidden flex-shrink-0">

        {/* Scroll Container */}
        <div className="absolute left-0 top-[13px] w-[402px] h-[696px] bg-[#fbf9ec] overflow-hidden">
          <div className="absolute left-[31px] top-[99px] w-[340px] h-[488px]">

            {/* Hero Card with Owl - 完全按照Figma设计稿 */}
            <div
              className={`
                absolute left-0 top-0 w-[340px] h-[226px] bg-[#fbf9ec]
                border-[10px] border-solid border-[#f8ce63] rounded-[70px]
                shadow-[0px_6px_10px_0px_rgba(129,113,86,0.4)] overflow-hidden
                flex items-start justify-center px-[20px] py-[30px]
                transition-all duration-700
                ${owlLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
              `}
            >
              {/* Owl container - 精确匹配Figma尺寸 */}
              <div className="w-[203px] h-[196px] relative shrink-0">
                <div className="absolute inset-0 overflow-hidden">
                  <img
                    src={imgOwl}
                    alt="Owl"
                    className={`
                      absolute w-full h-[104.83%] left-[0.22%] top-[16.29%]
                      max-w-none object-cover
                      ${owlLoaded ? 'animate-float' : ''}
                    `}
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons with staggered animation */}
            <div className="absolute left-0 top-[315px] flex gap-[12px]">
              <ActionButton
                icon={imgWriteIcon}
                text="我想写下来"
                onClick={handleWriteClick}
                delay={300}
                badge={unreadCount}
              />
              <ActionButton
                icon={imgSpeakIcon}
                text="我想说出来"
                onClick={handleSpeakClick}
                delay={450}
              />
            </div>
          </div>
        </div>

        {/* Bottom Navigation */}
        <BottomNav activeTab="consult" onTabChange={handleTabChange} />
      </div>
    </div>
  )
}
