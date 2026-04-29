import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api'
import { connectSocket, getSocket } from '../../services/websocket'

// Figma 风格图标 - 1px stroke
const Icons = {
  Chat: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  Message: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
    </svg>
  ),
  Users: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  Bell: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  ),
  ArrowRight: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  ),
  Warning: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  )
}

// 统计卡片
const StatCard = ({ icon, label, value, subLabel, trend, onClick }) => (
  <div onClick={onClick} className={`card p-3 ${onClick ? 'card-hover cursor-pointer' : ''}`}>
    <div className="flex items-start justify-between mb-2">
      <div className="w-7 h-7 bg-gray-100 rounded flex items-center justify-center text-gray-700">
        {icon}
      </div>
      {trend !== undefined && (
        <span className={`text-[10px] font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {trend >= 0 ? '+' : ''}{trend}%
        </span>
      )}
    </div>
    <div>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {subLabel && <p className="text-[10px] text-[#5551ff] mt-0.5">{subLabel}</p>}
    </div>
  </div>
)

// 风险分布
const RiskChart = ({ data }) => {
  const total = data.reduce((sum, item) => sum + item.count, 0) || 1

  return (
    <div className="card p-3">
      <h3 className="text-xs font-medium text-gray-900 mb-2">学生风险分布</h3>
      <div className="space-y-2">
        {data.map((item) => (
          <div key={item.level} className="flex items-center gap-2">
            <span className={`text-[10px] font-medium px-1 py-0.5 rounded w-7 text-center ${
              item.level === 'L1' ? 'badge-l1' :
              item.level === 'L2' ? 'badge-l2' :
              item.level === 'L3' ? 'badge-l3' : 'badge-l4'
            }`}>
              {item.level}
            </span>
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${item.color}`}
                style={{ width: `${(item.count / total) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-500 w-8 text-right">{item.count}人</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 最近会话
const RecentSession = ({ session, onClick }) => (
  <div onClick={onClick} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer transition-colors">
    <div className="relative">
      <div className={`
        w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium
        ${session.riskLevel === 'L1' ? 'bg-red-500' : ''}
        ${session.riskLevel === 'L2' ? 'bg-orange-500' : ''}
        ${session.riskLevel === 'L3' ? 'bg-amber-500' : ''}
        ${session.riskLevel === 'L4' ? 'bg-emerald-500' : ''}
      `}>
        {session.name.charAt(0)}
      </div>
      {session.unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[12px] h-3 px-0.5 bg-red-500 text-white text-[9px] font-medium rounded-full flex items-center justify-center">
          {session.unread}
        </span>
      )}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-gray-900">{session.name}</span>
        <span className="text-[10px] text-gray-400">{session.grade}</span>
      </div>
      <p className="text-[10px] text-gray-500 truncate">{session.message}</p>
    </div>
    <span className="text-[9px] text-gray-400">{session.time}</span>
  </div>
)

// 预警项
const AlertItem = ({ alert, onClick }) => (
  <div
    onClick={onClick}
    className={`p-2 rounded cursor-pointer transition-colors ${
      alert.level === 1 ? 'bg-red-50 hover:bg-red-100' : 'bg-orange-50 hover:bg-orange-100'
    }`}
  >
    <div className="flex items-start gap-1.5">
      <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
        alert.level === 1 ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'
      }`}>
        <Icons.Warning />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${
            alert.level === 1 ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'
          }`}>
            {alert.level === 1 ? '紧急' : '高危'}
          </span>
          <span className="text-xs font-medium text-gray-900">{alert.name}</span>
        </div>
        <p className="text-[10px] text-gray-600 mt-0.5 line-clamp-1">{alert.reason}</p>
        <p className="text-[9px] text-gray-400 mt-0.5">{alert.time}</p>
      </div>
    </div>
  </div>
)

// Default mock data
const defaultStats = {
  activeSessions: 0,
  todayMessages: 0,
  studentsCount: 0,
  alertsCount: 0
}

const defaultRiskData = [
  { level: 'L1', count: 0, color: 'bg-red-500' },
  { level: 'L2', count: 0, color: 'bg-orange-500' },
  { level: 'L3', count: 0, color: 'bg-amber-500' },
  { level: 'L4', count: 0, color: 'bg-emerald-500' },
]

const defaultRecentSessions = []

const defaultAlerts = []

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(defaultStats)
  const [riskData, setRiskData] = useState(defaultRiskData)
  const [recentSessions, setRecentSessions] = useState(defaultRecentSessions)
  const [alerts, setAlerts] = useState(defaultAlerts)

  const loadDashboard = useCallback(async () => {
    try {
      const res = await api.getDashboardStats()
      const data = res.data || res
      if (data.stats) {
        setStats({
          activeSessions: data.stats.active_sessions ?? data.stats.activeSessions ?? defaultStats.activeSessions,
          todayMessages: data.stats.today_messages ?? data.stats.todayMessages ?? defaultStats.todayMessages,
          studentsCount: data.stats.students_count ?? data.stats.studentsCount ?? defaultStats.studentsCount,
          alertsCount: data.stats.alerts_count ?? data.stats.alertsCount ?? defaultStats.alertsCount,
        })
      }
      if (data.risk_distribution) {
        setRiskData(data.risk_distribution.map(r => ({
          level: r.level,
          count: r.count,
          color: r.level === 'L1' ? 'bg-red-500' : r.level === 'L2' ? 'bg-orange-500' : r.level === 'L3' ? 'bg-amber-500' : 'bg-emerald-500',
        })))
      }
      if (data.recent_sessions) {
        setRecentSessions(data.recent_sessions.map(s => ({
          id: s.id || s._id,
          name: s.student_name || s.name,
          grade: s.grade || '',
          message: s.last_message || s.message || '',
          time: s.updated_at || s.time || '',
          unread: s.unread_count || s.unread || 0,
          riskLevel: s.risk_level || s.riskLevel || 'L4',
        })))
      }
      if (data.alerts) {
        setAlerts(data.alerts.map(a => ({
          id: a.id || a._id,
          level: a.level,
          name: a.student_name || a.name,
          reason: a.reason || '',
          time: a.created_at || a.time || '',
        })))
      }
    } catch (err) {
      console.log('[Dashboard] Using current data:', err.message)
    }
  }, [])

  // Fetch dashboard data from API + realtime session summary refresh.
  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    const socket = getSocket() || connectSocket()
    if (!socket) return

    const handleSessionChanged = () => loadDashboard()
    socket.on('student:message', handleSessionChanged)
    socket.on('teacher:message', handleSessionChanged)
    socket.on('session:mode_change', handleSessionChanged)
    socket.on('message:audio_updated', handleSessionChanged)

    const interval = setInterval(loadDashboard, 5000)
    return () => {
      socket.off('student:message', handleSessionChanged)
      socket.off('teacher:message', handleSessionChanged)
      socket.off('session:mode_change', handleSessionChanged)
      socket.off('message:audio_updated', handleSessionChanged)
      clearInterval(interval)
    }
  }, [loadDashboard])

  return (
    <div className="space-y-4 animate-fade-in">
      {/* 头部 */}
      <div>
        <h1 className="text-base font-semibold text-gray-900">欢迎回来，李老师</h1>
        <p className="text-xs text-gray-500 mt-0.5">今天是 {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Icons.Chat />}
          label="进行中会话"
          value={stats.activeSessions}
          subLabel="3个需要回复"
          onClick={() => navigate('/teacher/sessions')}
        />
        <StatCard
          icon={<Icons.Message />}
          label="今日消息"
          value={stats.todayMessages}
          trend={12}
        />
        <StatCard
          icon={<Icons.Users />}
          label="管理学生"
          value={stats.studentsCount}
          onClick={() => navigate('/teacher/students')}
        />
        <StatCard
          icon={<Icons.Bell />}
          label="待处理预警"
          value={stats.alertsCount}
          onClick={() => navigate('/teacher/alerts')}
        />
      </div>

      {/* 主内容 */}
      <div className="grid lg:grid-cols-3 gap-3">
        {/* 最近会话 */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between p-2.5 border-b border-gray-200">
            <h3 className="text-xs font-medium text-gray-900">最近会话</h3>
            <button
              onClick={() => navigate('/teacher/sessions')}
              className="text-[10px] text-[#5551ff] hover:text-[#4440e6] flex items-center gap-0.5 font-medium"
            >
              查看全部 <Icons.ArrowRight />
            </button>
          </div>
          <div className="p-1">
            {recentSessions.length === 0 ? (
              <div className="p-4 text-xs text-gray-400 text-center">暂无最近会话</div>
            ) : recentSessions.map((session) => (
              <RecentSession
                key={session.id}
                session={session}
                onClick={() => navigate(`/teacher/sessions/${session.id}`)}
              />
            ))}
          </div>
        </div>

        {/* 右侧 */}
        <div className="space-y-3">
          <RiskChart data={riskData} />

          {/* 预警 */}
          <div className="card">
            <div className="flex items-center justify-between p-2.5 border-b border-gray-200">
              <h3 className="text-xs font-medium text-gray-900">紧急预警</h3>
              <button
                onClick={() => navigate('/teacher/alerts')}
                className="text-[10px] text-[#5551ff] hover:text-[#4440e6] font-medium"
              >
                全部
              </button>
            </div>
            <div className="p-2 space-y-1.5">
              {alerts.length === 0 ? (
                <div className="p-3 text-xs text-gray-400 text-center">暂无紧急预警</div>
              ) : alerts.map((alert) => (
                <AlertItem
                  key={alert.id}
                  alert={alert}
                  onClick={() => navigate('/teacher/alerts')}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


