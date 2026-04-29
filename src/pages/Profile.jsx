import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from '../services/api'
import { getUser, logout } from '../services/auth'
import { useChat } from '../context/ChatContext'

// Assets - 本地图片路径
const imgAvatar = "/assets/avatar-owl.png"
const imgConsultIcon = "/assets/icon-consult.png"
const imgMyIcon = "/assets/icon-my.png"

// 统计卡片组件
const StatCard = ({ icon, value, label, color, delay = 0 }) => {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={`
        flex-1 bg-white border-2 border-[#e5e5e5] rounded-[20px] shadow-[0px_4px_0px_0px_#e5e5e5]
        flex flex-col items-center justify-center py-[14px] gap-[4px]
        transition-all duration-500
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
      `}
    >
      <div className={`w-[24px] h-[24px] flex items-center justify-center text-[${color}]`}>
        {icon}
      </div>
      <p className="font-bold text-[18px] text-[#4b3425]">{value}</p>
      <p className="font-bold text-[12px] text-[#afafaf]">{label}</p>
    </div>
  )
}

// 菜单项组件
const MenuItem = ({ icon, iconBg, label, onClick, delay = 0 }) => {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <button
      onClick={onClick}
      className={`
        w-full bg-white border-2 border-[#e5e5e5] rounded-[20px] shadow-[0px_4px_0px_0px_#e5e5e5]
        flex items-center justify-between px-[18px] py-[18px]
        cursor-pointer transition-all duration-300
        hover:scale-[1.02] hover:shadow-[0px_6px_0px_0px_#e5e5e5]
        active:scale-[0.98] active:translate-y-[2px] active:shadow-[0px_2px_0px_0px_#e5e5e5]
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
      `}
    >
      <div className="flex items-center gap-[16px]">
        <div
          className="w-[40px] h-[40px] rounded-[12px] flex items-center justify-center"
          style={{ backgroundColor: iconBg }}
        >
          {icon}
        </div>
        <p className="font-bold text-[18px] text-[#4b3425]">{label}</p>
      </div>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M9 18L15 12L9 6" stroke="#afafaf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  )
}

// 底部导航组件
const BottomNav = ({ activeTab, onTabChange }) => (
  <div className="absolute left-[28px] top-[762px] w-[346px] h-[82px] bg-white rounded-[160px] shadow-[0px_4px_10px_0px_rgba(204,158,44,0.53)] overflow-hidden animate-slide-up">
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

// 个人中心页面
export default function Profile() {
  const navigate = useNavigate()
  const { clearMessages, setSessionId } = useChat()
  const [headerVisible, setHeaderVisible] = useState(false)
  const [userInfo, setUserInfo] = useState(null)
  const [stats, setStats] = useState({ streak: 12, gems: 450, exp: 1200 })
  const [sessionCount, setSessionCount] = useState(0)

  // Load user info from localStorage and API
  useEffect(() => {
    const user = getUser('student')
    if (user) {
      setUserInfo(user)
    }

    // Load session count from API
    const loadProfile = async () => {
      try {
        // Note: /api/profile/student/:id does not exist; profile data comes from localStorage
        // Also load session count
        const sessions = await api.getSessionList()
        const list = sessions.sessions || sessions.list || sessions
        if (Array.isArray(list)) {
          setSessionCount(list.length)
        }
      } catch (err) {
        console.log('[Profile] Using local data:', err.message)
      }
    }
    loadProfile()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setHeaderVisible(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const handleTabChange = (tab) => {
    if (tab === 'consult') {
      navigate('/')
    }
  }

  const handleSettings = () => {
    alert('设置功能开发中...')
  }

  const handleEdit = () => {
    alert('编辑个人资料功能开发中...')
  }

  const handleLogout = () => {
    clearMessages()
    setSessionId(null)
    logout('student')
    navigate('/login')
  }

  const displayName = userInfo?.name || userInfo?.studentName || '小语同学'
  const displayId = userInfo?.studentId || userInfo?.id || '8829103'

  // 图标SVG组件
  const FireIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C12 2 9 6 9 10C9 12 10 14 12 14C14 14 15 12 15 10C15 6 12 2 12 2Z" fill="#FF9600"/>
      <path d="M12 22C8 22 5 19 5 15C5 11 8 8 12 8C16 8 19 11 19 15C19 19 16 22 12 22Z" fill="#FF9600"/>
      <path d="M12 18C10 18 9 17 9 15C9 13 10 12 12 12C14 12 15 13 15 15C15 17 14 18 12 18Z" fill="#FFD700"/>
    </svg>
  )

  const GemIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M6 3H18L22 9L12 21L2 9L6 3Z" fill="#1CB0F6"/>
      <path d="M6 3L12 21L18 3" stroke="#0EA5E9" strokeWidth="1"/>
      <path d="M2 9H22" stroke="#0EA5E9" strokeWidth="1"/>
      <path d="M12 3V9" stroke="#0EA5E9" strokeWidth="1"/>
    </svg>
  )

  const LightningIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M13 2L4 14H11L10 22L20 10H13L13 2Z" fill="#FFC800"/>
    </svg>
  )

  const ChatIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" fill="white" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const HeartIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M20.84 4.61C20.3292 4.099 19.7228 3.69364 19.0554 3.41708C18.3879 3.14052 17.6725 2.99817 16.95 2.99817C16.2275 2.99817 15.5121 3.14052 14.8446 3.41708C14.1772 3.69364 13.5708 4.099 13.06 4.61L12 5.67L10.94 4.61C9.9083 3.57831 8.50903 2.99871 7.05 2.99871C5.59096 2.99871 4.19169 3.57831 3.16 4.61C2.1283 5.64169 1.54871 7.04097 1.54871 8.5C1.54871 9.95903 2.1283 11.3583 3.16 12.39L4.22 13.45L12 21.23L19.78 13.45L20.84 12.39C21.351 11.8792 21.7563 11.2728 22.0329 10.6054C22.3095 9.93789 22.4518 9.22249 22.4518 8.5C22.4518 7.77751 22.3095 7.0621 22.0329 6.39464C21.7563 5.72718 21.351 5.12075 20.84 4.61Z" fill="white" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const ClipboardIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M16 4H18C18.5304 4 19.0391 4.21071 19.4142 4.58579C19.7893 4.96086 20 5.46957 20 6V20C20 20.5304 19.7893 21.0391 19.4142 21.4142C19.0391 21.7893 18.5304 22 18 22H6C5.46957 22 4.96086 21.7893 4.58579 21.4142C4.21071 21.0391 4 20.5304 4 20V6C4 5.46957 4.21071 4.96086 4.58579 4.58579C4.96086 4.21071 5.46957 4 6 4H8" fill="white"/>
      <path d="M15 2H9C8.44772 2 8 2.44772 8 3V5C8 5.55228 8.44772 6 9 6H15C15.5523 6 16 5.55228 16 5V3C16 2.44772 15.5523 2 15 2Z" fill="white" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const ShieldIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" fill="white" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const SettingsIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="#afafaf" strokeWidth="2"/>
      <path d="M12 1V3M12 21V23M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M1 12H3M21 12H23M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" stroke="#afafaf" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )

  return (
    <div className="bg-[#fbf9ec] w-full min-h-screen flex justify-center items-start py-4">
      {/* iPhone 16 Pro Frame */}
      <div className="relative w-[402px] h-[874px] bg-[#fbf9ec] overflow-hidden flex-shrink-0">

        {/* Header */}
        <div
          className={`
            absolute left-0 top-0 w-full h-[112px] px-[24px] flex items-center justify-between
            transition-all duration-500
            ${headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}
          `}
        >
          <h1 className="font-bold text-[24px] text-[#4b3425]">个人中心</h1>
          <button
            onClick={handleSettings}
            className="w-[40px] h-[40px] bg-white border-2 border-[#e5e5e5] rounded-[12px] shadow-[0px_3px_0px_0px_#e5e5e5]
              flex items-center justify-center cursor-pointer
              transition-all duration-200
              hover:scale-105
              active:translate-y-[2px] active:shadow-[0px_1px_0px_0px_#e5e5e5]"
          >
            <SettingsIcon />
          </button>
        </div>

        {/* Main Content */}
        <div className="absolute left-0 top-[112px] w-full h-[650px] px-[24px] overflow-y-auto scrollbar-hide">
          <div className="flex flex-col gap-[24px]">

            {/* 用户信息区域 */}
            <div
              className={`
                flex items-center gap-[16px]
                transition-all duration-500 delay-100
                ${headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
              `}
            >
              {/* 头像 */}
              <div className="w-[80px] h-[80px] bg-[#fcfbe8] border-[3px] border-[#f6cb5b] rounded-full shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] overflow-hidden flex-shrink-0">
                <img src={imgAvatar} alt="头像" className="w-full h-full object-cover" />
              </div>

              {/* 用户名和ID */}
              <div className="flex-1">
                <p className="font-black text-[24px] text-[#4b3425]">{displayName}</p>
                <p className="font-bold text-[14px] text-[#afafaf]">ID: {displayId}</p>
              </div>

              {/* 编辑按钮 */}
              <button
                onClick={handleEdit}
                className="w-[56px] h-[40px] bg-white border-2 border-[#e5e5e5] rounded-[12px] shadow-[0px_3px_0px_0px_#e5e5e5]
                  font-bold text-[14px] text-[#afafaf]
                  cursor-pointer transition-all duration-200
                  hover:scale-105
                  active:translate-y-[2px] active:shadow-[0px_1px_0px_0px_#e5e5e5]"
              >
                编辑
              </button>
            </div>

            {/* 统计卡片 */}
            <div className="flex gap-[12px]">
              <StatCard
                icon={<FireIcon />}
                value={String(stats.streak)}
                label="连续打卡"
                color="#FF9600"
                delay={200}
              />
              <StatCard
                icon={<GemIcon />}
                value={String(stats.gems)}
                label="宝石"
                color="#1CB0F6"
                delay={300}
              />
              <StatCard
                icon={<LightningIcon />}
                value={String(stats.exp)}
                label="经验值"
                color="#FFC800"
                delay={400}
              />
            </div>

            {/* 升级Plus卡片 */}
            <div
              className={`
                w-full h-[96px] bg-[#1cb0f6] rounded-[20px] shadow-[0px_4px_0px_0px_#1899d6]
                relative overflow-hidden cursor-pointer
                transition-all duration-500 delay-300
                hover:scale-[1.02] hover:shadow-[0px_6px_0px_0px_#1899d6]
                active:scale-[0.98] active:translate-y-[2px]
                ${headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
              `}
              onClick={() => alert('升级Plus功能开发中...')}
            >
              {/* 图标背景 */}
              <div className="absolute right-[24px] top-[16px] w-[64px] h-[64px] bg-[rgba(255,255,255,0.2)] rounded-full flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" fill="white" stroke="white" strokeWidth="2"/>
                </svg>
              </div>

              {/* 文字内容 */}
              <div className="absolute left-[16px] top-[22px]">
                <p className="font-black text-[18px] text-white">升级到 Plus</p>
                <p className="font-bold text-[14px] text-[rgba(255,255,255,0.8)]">无限制对话，无限红心</p>
              </div>
            </div>

            {/* 菜单列表 - 心理咨询相关功能 */}
            <div className="flex flex-col gap-[12px]">
              <MenuItem
                icon={<ChatIcon />}
                iconBg="#58cc02"
                label={`咨询记录${sessionCount > 0 ? ` (${sessionCount})` : ''}`}
                onClick={() => alert('咨询记录功能开发中...')}
                delay={500}
              />
              <MenuItem
                icon={<HeartIcon />}
                iconBg="#ff4b4b"
                label="情绪日记"
                onClick={() => alert('情绪日记功能开发中...')}
                delay={600}
              />
              <MenuItem
                icon={<ClipboardIcon />}
                iconBg="#ff9600"
                label="心理测评"
                onClick={() => alert('心理测评功能开发中...')}
                delay={700}
              />
              <MenuItem
                icon={<ShieldIcon />}
                iconBg="#ce82ff"
                label="隐私保护"
                onClick={() => alert('隐私保护功能开发中...')}
                delay={800}
              />
            </div>

            {/* 退出登录 */}
            <button
              onClick={handleLogout}
              className="w-full bg-white border-2 border-[#e5e5e5] rounded-[20px] shadow-[0px_4px_0px_0px_#e5e5e5]
                flex items-center justify-center px-[18px] py-[16px]
                cursor-pointer transition-all duration-300
                hover:scale-[1.02] hover:shadow-[0px_6px_0px_0px_#e5e5e5]
                active:scale-[0.98] active:translate-y-[2px] active:shadow-[0px_2px_0px_0px_#e5e5e5]"
            >
              <p className="font-bold text-[16px] text-[#ff4b4b]">退出登录</p>
            </button>

            {/* 底部留白 */}
            <div className="h-[120px]" />
          </div>
        </div>

        {/* Bottom Navigation */}
        <BottomNav activeTab="my" onTabChange={handleTabChange} />
      </div>
    </div>
  )
}
