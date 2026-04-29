import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api'
import { connectSocket, onWarningAlert } from '../../services/websocket'

// 图标
const Icons = {
  Warning: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  ),
  Bell: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  ),
  Clock: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Check: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Close: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// 预警等级配置
const alertConfig = {
  1: { label: '紧急', color: 'bg-red-500', bgLight: 'bg-red-50', border: 'border-red-200', text: 'text-red-600' },
  2: { label: '高危', color: 'bg-orange-500', bgLight: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600' },
  3: { label: '关注', color: 'bg-amber-500', bgLight: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600' },
}

// 预警卡片
const AlertCard = ({ alert, onHandle, onView }) => {
  const config = alertConfig[alert.level]

  return (
    <div className={`
      card p-4 border-l-4 ${config.border} ${alert.status === 'pending' ? config.bgLight : 'bg-white'}
      transition-colors
    `}>
      <div className="flex items-start gap-3">
        {/* 等级标识 */}
        <div className={`
          w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${config.color} text-white
        `}>
          {alert.level === 1 ? <Icons.Warning /> : <Icons.Bell />}
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${config.color} text-white`}>
              {config.label}
            </span>
            <span className="font-medium text-gray-800">{alert.studentName}</span>
            <span className="text-sm text-gray-500">{alert.grade}</span>
            {alert.status === 'pending' && (
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
            )}
          </div>

          <p className="text-sm text-gray-600 mt-1.5">{alert.reason}</p>

          {alert.keywords && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {alert.keywords.map((keyword, index) => (
                <span key={index} className="text-xs bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded">
                  "{keyword}"
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            <span>{alert.time}</span>
            {alert.handler && (
              <span>处理人: {alert.handler}</span>
            )}
          </div>
        </div>

        {/* 状态和操作 */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`
            px-2 py-0.5 text-xs font-medium rounded border
            ${alert.status === 'pending' ? 'bg-red-50 text-red-600 border-red-100' : ''}
            ${alert.status === 'processing' ? 'bg-amber-50 text-amber-600 border-amber-100' : ''}
            ${alert.status === 'resolved' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : ''}
          `}>
            {alert.status === 'pending' ? '待处理' : ''}
            {alert.status === 'processing' ? '处理中' : ''}
            {alert.status === 'resolved' ? '已处理' : ''}
          </span>

          <div className="flex gap-2 mt-1">
            <button
              onClick={() => onView(alert)}
              className="btn-secondary text-xs px-2.5 py-1"
            >
              查看详情
            </button>
            {alert.status === 'pending' && (
              <button
                onClick={() => onHandle(alert)}
                className="btn-primary text-xs px-2.5 py-1"
              >
                立即处理
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// 处理弹窗
const HandleModal = ({ alert, onClose, onSubmit }) => {
  const [notes, setNotes] = useState('')
  const [action, setAction] = useState('contact')

  if (!alert) return null

  const actions = [
    { id: 'contact', label: '联系学生', desc: '通过平台发起咨询' },
    { id: 'parent', label: '通知家长', desc: '电话或短信通知' },
    { id: 'refer', label: '转介处理', desc: '转介至专业机构' },
    { id: 'monitor', label: '持续观察', desc: '标记后续跟进' },
  ]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-lg w-full max-w-md border border-gray-200 animate-slide-in">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-800">处理预警</h3>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
              <Icons.Close />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* 预警信息 */}
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 text-xs font-medium rounded text-white ${alertConfig[alert.level].color}`}>
                {alertConfig[alert.level].label}
              </span>
              <span className="text-sm font-medium text-gray-800">{alert.studentName}</span>
            </div>
            <p className="text-sm text-gray-600 mt-1.5">{alert.reason}</p>
          </div>

          {/* 处理方式 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">处理方式</label>
            <div className="grid grid-cols-2 gap-2">
              {actions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setAction(item.id)}
                  className={`
                    p-3 rounded-lg border text-left transition-colors
                    ${action === item.id
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                    }
                  `}
                >
                  <p className={`text-sm font-medium ${action === item.id ? 'text-indigo-600' : 'text-gray-800'}`}>
                    {item.label}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 处理备注 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">处理备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="请填写处理情况说明..."
              rows={3}
              className="input resize-none"
            />
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            取消
          </button>
          <button
            onClick={() => onSubmit({ action, notes })}
            className="btn-primary flex-1"
          >
            确认处理
          </button>
        </div>
      </div>
    </div>
  )
}

// Mock data as fallback
const mockAlerts = [
  {
    id: 1,
    level: 1,
    studentName: '赵同学',
    studentId: '4',
    grade: '高二(2)班',
    reason: '检测到危机关键词，消息内容包含自伤倾向表达',
    keywords: ['不想活了', '好累'],
    time: '10分钟前',
    status: 'pending',
  },
  {
    id: 2,
    level: 2,
    studentName: '张同学',
    studentId: '1',
    grade: '高二(3)班',
    reason: '情绪持续低落，风险等级从L3升至L2，需要密切关注',
    time: '2小时前',
    status: 'pending',
  },
  {
    id: 3,
    level: 2,
    studentName: '陈同学',
    studentId: '6',
    grade: '高三(2)班',
    reason: '连续3天情绪日记显示焦虑程度上升',
    time: '5小时前',
    status: 'processing',
    handler: '李老师',
  },
  {
    id: 4,
    level: 3,
    studentName: '王同学',
    studentId: '3',
    grade: '高三(1)班',
    reason: '最近一周咨询频率增加，主诉家庭矛盾',
    time: '1天前',
    status: 'resolved',
    handler: '李老师',
  },
  {
    id: 5,
    level: 1,
    studentName: '周同学',
    studentId: '7',
    grade: '高一(4)班',
    reason: '心理测评结果显示重度抑郁倾向',
    keywords: ['PHQ-9得分22分'],
    time: '2天前',
    status: 'resolved',
    handler: '李老师',
  },
]

export default function Alerts() {
  const navigate = useNavigate()
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterLevel, setFilterLevel] = useState('all')
  const [handleAlert, setHandleAlert] = useState(null)
  const [alerts, setAlerts] = useState(mockAlerts)
  const [loading, setLoading] = useState(false)

  // Fetch warning list from API
  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    try {
      // Backend expects numeric status: 1=pending, 2=processing, 3=resolved
      const statusNumMap = { pending: '1', processing: '2', resolved: '3' }
      const apiStatus = statusNumMap[filterStatus] || filterStatus
      const res = await api.getWarningList(apiStatus, filterLevel)
      const data = res.data || res
      const list = data.warnings || data.list || data
      if (Array.isArray(list) && list.length > 0) {
        setAlerts(list.map(w => ({
          id: w.id || w._id,
          level: w.level,
          studentName: w.student_name || w.studentName,
          studentId: w.student_id || w.studentId,
          grade: w.grade || w.class_name || '',
          reason: w.reason || w.description || '',
          keywords: w.keywords || [],
          time: w.created_at || w.time || '',
          status: typeof w.status === 'number'
            ? { 1: 'pending', 2: 'processing', 3: 'resolved', 4: 'closed' }[w.status] || 'pending'
            : w.status,
          handler: w.handler || w.handler_name || '',
        })))
      }
    } catch (err) {
      console.log('[Alerts] Using mock data:', err.message)
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterLevel])

  // Load alerts on mount and when filters change
  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  // Listen for real-time warning alerts via WebSocket
  useEffect(() => {
    const socket = connectSocket()
    if (socket) {
      onWarningAlert((newAlert) => {
        setAlerts(prev => {
          const exists = prev.some(a => a.id === (newAlert.id || newAlert._id))
          if (exists) return prev
          return [{
            id: newAlert.id || newAlert._id,
            level: newAlert.level,
            studentName: newAlert.student_name || newAlert.studentName,
            studentId: newAlert.student_id || newAlert.studentId,
            grade: newAlert.grade || '',
            reason: newAlert.reason || '',
            keywords: newAlert.keywords || [],
            time: newAlert.created_at || '刚刚',
            status: 'pending',
          }, ...prev]
        })
      })
    }
  }, [])

  const filteredAlerts = alerts.filter(alert => {
    const matchStatus = filterStatus === 'all' || alert.status === filterStatus
    const matchLevel = filterLevel === 'all' || alert.level === parseInt(filterLevel)
    return matchStatus && matchLevel
  })

  const pendingCount = alerts.filter(a => a.status === 'pending').length
  const urgentCount = alerts.filter(a => a.level === 1 && a.status === 'pending').length

  const handleSubmit = async ({ action, notes }) => {
    // 后端期望 status 为数字: 2=处理中, 3=已处理, 4=已关闭
    // 弹窗 action: contact=联系学生, parent=通知家长, refer=转介处理, monitor=持续观察
    const statusMap = { contact: 2, parent: 2, refer: 3, monitor: 2 }
    const statusCode = statusMap[action] || 2
    const actionLabels = { contact: '联系学生', parent: '通知家长', refer: '转介处理', monitor: '持续观察' }
    const handleResult = actionLabels[action] || action
    try {
      await api.handleWarning(handleAlert.id, statusCode, handleResult, notes)
    } catch (err) {
      console.log('[Alerts] Handle warning fallback:', err.message)
    }
    // Optimistic update
    const statusTextMap = { 2: 'processing', 3: 'resolved', 4: 'closed' }
    setAlerts(prev => prev.map(a =>
      a.id === handleAlert.id
        ? { ...a, status: statusTextMap[statusCode] || 'processing', handler: '李老师' }
        : a
    ))
    setHandleAlert(null)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* 头部统计 */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card p-4 border-l-4 border-red-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">紧急预警</p>
              <p className="text-2xl font-semibold text-red-600 mt-1">{urgentCount}</p>
            </div>
            <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center text-red-500">
              <Icons.Warning />
            </div>
          </div>
        </div>

        <div className="card p-4 border-l-4 border-orange-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">待处理</p>
              <p className="text-2xl font-semibold text-orange-600 mt-1">{pendingCount}</p>
            </div>
            <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center text-orange-500">
              <Icons.Clock />
            </div>
          </div>
        </div>

        <div className="card p-4 border-l-4 border-emerald-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">今日已处理</p>
              <p className="text-2xl font-semibold text-emerald-600 mt-1">
                {alerts.filter(a => a.status === 'resolved').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-500">
              <Icons.Check />
            </div>
          </div>
        </div>
      </div>

      {/* 筛选器 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1.5 overflow-x-auto pb-2 sm:pb-0">
          {[
            { id: 'all', label: '全部' },
            { id: 'pending', label: '待处理' },
            { id: 'processing', label: '处理中' },
            { id: 'resolved', label: '已处理' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilterStatus(item.id)}
              className={`
                px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
                ${filterStatus === item.id
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }
              `}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          {[
            { id: 'all', label: '全部等级' },
            { id: '1', label: '紧急' },
            { id: '2', label: '高危' },
            { id: '3', label: '关注' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilterLevel(item.id)}
              className={`
                px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
                ${filterLevel === item.id
                  ? item.id === '1' ? 'bg-red-500 text-white' :
                    item.id === '2' ? 'bg-orange-500 text-white' :
                    item.id === '3' ? 'bg-amber-500 text-white' :
                    'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }
              `}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 预警列表 */}
      <div className="space-y-3">
        {filteredAlerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onHandle={(a) => setHandleAlert(a)}
            onView={(a) => navigate(`/teacher/students/${a.studentId}`)}
          />
        ))}

        {filteredAlerts.length === 0 && (
          <div className="text-center py-10">
            <div className="w-12 h-12 mx-auto bg-emerald-50 rounded-lg flex items-center justify-center mb-3 text-emerald-500">
              <Icons.Check />
            </div>
            <h3 className="text-sm font-medium text-gray-700">暂无预警</h3>
            <p className="text-xs text-gray-500 mt-0.5">当前筛选条件下没有预警记录</p>
          </div>
        )}
      </div>

      {/* 处理弹窗 */}
      <HandleModal
        alert={handleAlert}
        onClose={() => setHandleAlert(null)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
