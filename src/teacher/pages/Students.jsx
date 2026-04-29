import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../services/api'

// Icons
const Icons = {
  Back: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  ),
  Plus: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
    </svg>
  ),
  Search: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  Edit: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
    </svg>
  ),
  Trash: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  ),
  Key: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  ),
  Close: () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Refresh: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
    </svg>
  ),
}

// Risk level config
const riskConfig = {
  L1: { label: '重点关注', color: 'bg-red-100 text-red-700', bg: 'bg-red-500' },
  L2: { label: '持续关注', color: 'bg-orange-100 text-orange-700', bg: 'bg-orange-500' },
  L3: { label: '定期观察', color: 'bg-amber-100 text-amber-700', bg: 'bg-amber-500' },
  L4: { label: '正常状态', color: 'bg-emerald-100 text-emerald-700', bg: 'bg-emerald-500' },
}

// Grade options
const GRADE_OPTIONS = [
  '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '初一', '初二', '初三',
  '高一', '高二', '高三',
  '大一', '大二', '大三', '大四',
]

// ============================================================
// Add/Edit Student Modal
// ============================================================
function StudentFormModal({ visible, student, onClose, onSaved }) {
  const isEdit = !!student
  const [form, setForm] = useState({
    student_no: '', name: '', gender: null, grade: '', class_name: '', phone: '', notes: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successInfo, setSuccessInfo] = useState(null)

  useEffect(() => {
    if (visible) {
      setError('')
      setSuccessInfo(null)
      if (student) {
        setForm({
          student_no: student.student_no || '',
          name: student.name || '',
          gender: student.gender,
          grade: student.grade || '',
          class_name: student.class_name || '',
          phone: student.phone || '',
          notes: student.notes || '',
        })
      } else {
        setForm({ student_no: '', name: '', gender: null, grade: '', class_name: '', phone: '', notes: '' })
      }
    }
  }, [visible, student])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccessInfo(null)

    try {
      if (isEdit) {
        await api.updateStudent(student.id, {
          name: form.name,
          gender: form.gender,
          grade: form.grade,
          class_name: form.class_name,
          phone: form.phone,
          notes: form.notes,
        })
        onSaved()
        onClose()
      } else {
        const resp = await api.addStudent(form)
        const data = resp.data || resp
        setSuccessInfo({
          student_no: data.student_no,
          name: data.name,
          initial_password: data.initial_password,
        })
        onSaved()
      }
    } catch (err) {
      setError(err.message || '操作失败')
    } finally {
      setSaving(false)
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-800">{isEdit ? '编辑学生' : '添加学生'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400">
            <Icons.Close />
          </button>
        </div>

        {/* Success info */}
        {successInfo && (
          <div className="mx-6 mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
            <p className="text-sm font-medium text-emerald-800">添加成功!</p>
            <div className="mt-2 text-sm text-emerald-700 space-y-1">
              <p>学籍号: <span className="font-mono font-semibold">{successInfo.student_no}</span></p>
              <p>姓名: {successInfo.name}</p>
              <p>初始密码: <span className="font-mono font-semibold text-red-600">{successInfo.initial_password}</span></p>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => { setSuccessInfo(null); setForm({ student_no: '', name: '', gender: null, grade: '', class_name: '', phone: '', notes: '' }) }} className="btn-primary text-sm py-1.5 px-3">继续添加</button>
              <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-3">关闭</button>
            </div>
          </div>
        )}

        {/* Form */}
        {!successInfo && (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
            )}

            {/* Student No */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                学籍号 <span className="text-red-500">*</span>
                <span className="text-xs text-gray-400 ml-1">S + 身份证号</span>
              </label>
              <input
                type="text"
                value={form.student_no}
                onChange={e => setForm({ ...form, student_no: e.target.value })}
                placeholder="例: S440305200801011234"
                className="input"
                disabled={isEdit}
                required
              />
              {!isEdit && form.student_no.length >= 7 && (
                <p className="text-xs text-gray-400 mt-1">初始密码: <span className="font-mono text-gray-600">{form.student_no.slice(-6)}</span></p>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                姓名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="学生姓名"
                className="input"
                required
              />
            </div>

            {/* Gender + Grade row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">性别</label>
                <select
                  value={form.gender ?? ''}
                  onChange={e => setForm({ ...form, gender: e.target.value === '' ? null : parseInt(e.target.value) })}
                  className="input"
                >
                  <option value="">未设置</option>
                  <option value="1">男</option>
                  <option value="0">女</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  年级 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.grade}
                  onChange={e => setForm({ ...form, grade: e.target.value })}
                  className="input"
                  required
                >
                  <option value="">请选择</option>
                  {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            {/* Class + Phone row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">班级</label>
                <input
                  type="text"
                  value={form.class_name}
                  onChange={e => setForm({ ...form, class_name: e.target.value })}
                  placeholder="例: 3班"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">联系电话</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="选填"
                  className="input"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
              <textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="选填"
                className="input resize-none"
                rows={2}
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary">取消</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? '保存中...' : isEdit ? '保存' : '添加'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Confirm Dialog
// ============================================================
function ConfirmDialog({ visible, title, message, confirmText, danger, onConfirm, onCancel }) {
  if (!visible) return null
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl w-full max-w-sm shadow-xl p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        <p className="text-sm text-gray-600 mt-2">{message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="btn-secondary">取消</button>
          <button onClick={onConfirm} className={danger ? 'bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors' : 'btn-primary'}>
            {confirmText || '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Student Card
// ============================================================
const StudentCard = ({ student, onClick, onEdit, onDelete, onResetPwd }) => {
  const risk = riskConfig[student.current_risk_level] || riskConfig.L4

  return (
    <div className="card card-hover p-4">
      <div className="flex items-start gap-3 cursor-pointer" onClick={onClick}>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white text-lg font-medium flex-shrink-0 ${risk.bg}`}>
          {student.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-800">{student.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${risk.color}`}>
              {student.current_risk_level || 'L4'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {student.grade}{student.class_name ? ` · ${student.class_name}` : ''}
          </p>
          {student.enrollment_grade && student.enrollment_grade !== student.grade && (
            <p className="text-xs text-gray-400 mt-0.5">入学: {student.enrollment_grade} ({student.enrollment_year})</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
            <span className="font-mono">{student.student_no}</span>
            <span>咨询 {student.session_count || 0} 次</span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1 mt-3 pt-3 border-t border-gray-100">
        <button onClick={onEdit} className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50 transition-colors">
          <Icons.Edit /> 编辑
        </button>
        <button onClick={onResetPwd} className="flex items-center gap-1 text-xs text-gray-500 hover:text-amber-600 px-2 py-1 rounded hover:bg-amber-50 transition-colors">
          <Icons.Key /> 重置密码
        </button>
        <button onClick={onDelete} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors ml-auto">
          <Icons.Trash /> 删除
        </button>
      </div>
    </div>
  )
}

// ============================================================
// Student Detail Page
// ============================================================
// Session list for student detail page
const SessionList = ({ studentId, sessionCount }) => {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (!studentId) return
    setLoading(true)
    api.getStudentContext(studentId)
      .then(res => {
        const data = res.data || res
        setSessions(data.final_summaries || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [studentId])

  if (loading) return <div className="card p-5 text-center text-gray-400">加载中...</div>

  if (sessions.length === 0) {
    return <div className="card p-5 text-sm text-gray-400">暂无咨询记录</div>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">共 {sessionCount} 次咨询</p>
      {sessions.map((s) => {
        const date = s.start_time || s.created_at
        const dateStr = date ? new Date(date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }) : ''
        const topics = s.topics_discussed || []
        const unresolved = s.unresolved_items || []
        const approaches = s.approaches_tried || []
        return (
          <div key={s.id} className="card p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/teacher/sessions/${s.session_id}`)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-800">{dateStr}</span>
              <span className="text-xs text-gray-400">第{s.trigger_turn || '?'}轮</span>
            </div>
            {s.session_flow && (
              <p className="text-xs text-gray-600 leading-relaxed mb-2">{s.session_flow}</p>
            )}
            {topics.length > 0 && (
              <div className="flex gap-1 flex-wrap mb-2">
                {topics.map((t, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded">{t}</span>
                ))}
              </div>
            )}
            {approaches.length > 0 && (
              <div className="flex gap-1 flex-wrap mb-2">
                {approaches.map((a, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 bg-green-50 text-green-600 rounded">{a}</span>
                ))}
              </div>
            )}
            {unresolved.length > 0 && (
              <div className="mt-1">
                <span className="text-[10px] text-amber-600">未解决: </span>
                {unresolved.map((u, i) => (
                  <span key={i} className="text-[10px] text-gray-500">{i > 0 ? '、' : ''}{u}</span>
                ))}
              </div>
            )}
            {s.student_expressions && s.student_expressions.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                {s.student_expressions.slice(0, 3).map((expr, i) => (
                  <p key={i} className="text-[10px] text-gray-500 italic">"{expr}"</p>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const StudentDetail = ({ studentId, onBack }) => {
  const navigate = useNavigate()
  const [student, setStudent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('profile')

  useEffect(() => {
    loadStudent()
  }, [studentId])

  const loadStudent = async () => {
    setLoading(true)
    try {
      const resp = await api.getStudentDetail(studentId)
      setStudent(resp.data)
    } catch (err) {
      console.error('Load student error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400">加载中...</div>
  }
  if (!student) {
    return <div className="text-center py-20 text-gray-500">学生不存在</div>
  }

  const risk = riskConfig[student.profile?.current_risk_level] || riskConfig.L4

  const tabs = [
    { id: 'profile', label: '基本信息' },
    { id: 'sessions', label: '咨询记录' },
  ]

  return (
    <div className="animate-slide-in">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
          <Icons.Back />
        </button>
        <h2 className="text-lg font-semibold text-gray-800">学生详情</h2>
      </div>

      {/* Info card */}
      <div className="card p-5 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className={`w-16 h-16 rounded-lg flex items-center justify-center text-white text-2xl font-medium flex-shrink-0 ${risk.bg}`}>
            {student.name.charAt(0)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xl font-semibold text-gray-800">{student.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${risk.color}`}>
                {risk.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {student.grade}{student.class_name ? ` · ${student.class_name}` : ''}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 text-sm">
              <div>
                <span className="text-xs text-gray-400">学籍号</span>
                <p className="font-mono text-gray-800">{student.student_no}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">入学年级</span>
                <p className="text-gray-800">{student.enrollment_grade || '-'} ({student.enrollment_year || '-'})</p>
              </div>
              {student.calculated_grade && student.calculated_grade !== student.grade && (
                <div>
                  <span className="text-xs text-gray-400">推算年级</span>
                  <p className="text-gray-800">{student.calculated_grade}</p>
                </div>
              )}
              <div>
                <span className="text-xs text-gray-400">咨询次数</span>
                <p className="font-medium text-gray-800">{student.session_stats?.total_sessions || 0} 次</p>
              </div>
              {student.added_by_name && (
                <div>
                  <span className="text-xs text-gray-400">添加人</span>
                  <p className="text-gray-800">{student.added_by_name}</p>
                </div>
              )}
              {student.notes && (
                <div className="sm:col-span-2">
                  <span className="text-xs text-gray-400">备注</span>
                  <p className="text-gray-800">{student.notes}</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate(`/teacher/sessions`)} className="btn-primary">发起咨询</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              activeTab === tab.id ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <div className="card p-5 space-y-4">
          {student.profile && (student.profile.communication_style || student.profile.primary_concerns || student.profile.effective_strategies) ? (
            <>
              {student.profile.communication_style && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 mb-1">沟通风格</h4>
                  <p className="text-sm text-gray-800">{student.profile.communication_style}</p>
                </div>
              )}
              {student.profile.emotional_pattern && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 mb-1">情绪基线</h4>
                  <p className="text-sm text-gray-800">{student.profile.emotional_pattern}</p>
                </div>
              )}
              {student.profile.primary_concerns && (() => {
                try {
                  const items = JSON.parse(student.profile.primary_concerns);
                  if (items.length === 0) return null;
                  return (
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 mb-1.5">核心议题</h4>
                      <div className="flex gap-1.5 flex-wrap">
                        {items.map((item, i) => (
                          <span key={i} className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg">{item}</span>
                        ))}
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}
              {student.profile.effective_strategies && (() => {
                try {
                  const items = JSON.parse(student.profile.effective_strategies);
                  if (items.length === 0) return null;
                  return (
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 mb-1.5">有效方法</h4>
                      <div className="flex gap-1.5 flex-wrap">
                        {items.map((item, i) => (
                          <span key={i} className="text-xs px-2.5 py-1 bg-green-50 text-green-700 rounded-lg">{item}</span>
                        ))}
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}
              {student.profile.sensitive_topics && (() => {
                try {
                  const items = JSON.parse(student.profile.sensitive_topics);
                  if (items.length === 0) return null;
                  return (
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 mb-1.5">注意回避</h4>
                      <div className="flex gap-1.5 flex-wrap">
                        {items.map((item, i) => (
                          <span key={i} className="text-xs px-2.5 py-1 bg-red-50 text-red-600 rounded-lg">{item}</span>
                        ))}
                      </div>
                    </div>
                  );
                } catch { return null; }
              })()}
              {student.profile.coping_style && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 mb-1">应对风格</h4>
                  <p className="text-sm text-gray-800">{student.profile.coping_style}</p>
                </div>
              )}
              {student.profile.risk_notes && (
                <div className="border-t pt-3 mt-3">
                  <h4 className="text-xs font-medium text-red-500 mb-1.5">风险记录</h4>
                  {student.profile.risk_notes.split('\n').filter(Boolean).map((line, i) => (
                    <p key={i} className="text-xs text-gray-600 mb-0.5">{line}</p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">画像数据将在咨询结束后自动生成。</p>
          )}
        </div>
      )}

      {activeTab === 'sessions' && (
        <SessionList studentId={studentId} sessionCount={student.session_stats?.total_sessions || 0} />
      )}
    </div>
  )
}

// ============================================================
// Main Students Page
// ============================================================
export default function Students() {
  const { studentId } = useParams()
  const navigate = useNavigate()

  const [students, setStudents] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterGrade, setFilterGrade] = useState('all')

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingStudent, setEditingStudent] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [toast, setToast] = useState(null)

  const loadStudents = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await api.getStudentList(searchQuery, filterGrade)
      const data = resp.data || resp
      setStudents(data.list || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error('Load students error:', err)
    } finally {
      setLoading(false)
    }
  }, [searchQuery, filterGrade])

  useEffect(() => {
    loadStudents()
  }, [loadStudents])

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleDelete = (student) => {
    setConfirmAction({
      title: '删除学生',
      message: `确定要删除 ${student.name}（${student.student_no}）吗？删除后该学生将无法登录。`,
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteStudent(student.id)
          showToast(`${student.name} 已删除`)
          loadStudents()
        } catch (err) {
          showToast(err.message, 'error')
        }
        setConfirmAction(null)
      }
    })
  }

  const handleResetPassword = (student) => {
    setConfirmAction({
      title: '重置密码',
      message: `确定要将 ${student.name} 的密码重置为学籍号后6位吗？`,
      confirmText: '重置',
      danger: false,
      onConfirm: async () => {
        try {
          const resp = await api.resetStudentPassword(student.id)
          const pwd = resp.data?.initial_password || '******'
          showToast(`密码已重置为: ${pwd}`)
        } catch (err) {
          showToast(err.message, 'error')
        }
        setConfirmAction(null)
      }
    })
  }

  const handleRefreshGrades = async () => {
    try {
      const resp = await api.refreshGrades()
      const count = resp.data?.updated || 0
      showToast(`已更新 ${count} 名学生的年级`)
      loadStudents()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  // Unique grades from current data for filter
  const gradeSet = [...new Set(students.map(s => s.grade).filter(Boolean))]

  // If viewing student detail
  if (studentId) {
    return <StudentDetail studentId={studentId} onBack={() => navigate('/teacher/students')} />
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">学生管理</h1>
          <p className="text-sm text-gray-500 mt-0.5">共 {total} 名学生</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRefreshGrades} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Icons.Refresh />
            <span>刷新年级</span>
          </button>
          <button onClick={() => { setEditingStudent(null); setShowAddModal(true) }} className="btn-primary flex items-center gap-1.5">
            <Icons.Plus />
            <span>添加学生</span>
          </button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索学生姓名、学籍号..."
            className="input pl-9"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Icons.Search />
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2 sm:pb-0">
          <button
            onClick={() => setFilterGrade('all')}
            className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filterGrade === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            全部
          </button>
          {gradeSet.map(g => (
            <button
              key={g}
              onClick={() => setFilterGrade(g)}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                filterGrade === g ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Student list */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">加载中...</div>
      ) : students.length === 0 ? (
        <div className="text-center py-10">
          <div className="w-12 h-12 mx-auto bg-gray-100 rounded-lg flex items-center justify-center mb-3 text-gray-400">
            <Icons.Search />
          </div>
          <p className="text-sm text-gray-500">
            {searchQuery ? '没有找到匹配的学生' : '暂无学生，点击"添加学生"开始'}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {students.map(student => (
            <StudentCard
              key={student.id}
              student={student}
              onClick={() => navigate(`/teacher/students/${student.id}`)}
              onEdit={() => { setEditingStudent(student); setShowAddModal(true) }}
              onDelete={() => handleDelete(student)}
              onResetPwd={() => handleResetPassword(student)}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <StudentFormModal
        visible={showAddModal}
        student={editingStudent}
        onClose={() => { setShowAddModal(false); setEditingStudent(null) }}
        onSaved={loadStudents}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        visible={!!confirmAction}
        title={confirmAction?.title}
        message={confirmAction?.message}
        confirmText={confirmAction?.confirmText}
        danger={confirmAction?.danger}
        onConfirm={confirmAction?.onConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
