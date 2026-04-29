import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api'

export default function TeacherLogin() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码')
      return
    }
    setError('')
    setLoading(true)
    try {
      await api.teacherLogin(username.trim(), password)
      navigate('/teacher')
    } catch (err) {
      setError(err.message || '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-[#5551ff] rounded-lg flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">心理咨询后台</h1>
          <p className="text-xs text-gray-500 mt-1">教师端管理系统</p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded border border-gray-200 p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded text-sm placeholder:text-gray-400 focus:outline-none focus:border-[#5551ff] focus:ring-1 focus:ring-[#5551ff] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded text-sm placeholder:text-gray-400 focus:outline-none focus:border-[#5551ff] focus:ring-1 focus:ring-[#5551ff] transition-colors"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#5551ff] text-white px-3 py-2 rounded text-sm font-medium transition-colors hover:bg-[#4440e6] active:bg-[#3632cc] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
        </div>

        {/* Student link */}
        <div className="text-center mt-4">
          <button
            onClick={() => navigate('/login')}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            &larr; 返回学生端
          </button>
        </div>
      </div>
    </div>
  )
}
