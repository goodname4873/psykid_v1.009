import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useChat } from '../context/ChatContext'

const imgOwl = "/assets/owl-hero.png"
const imgArrow = "/assets/arrow.png"
const imgTreeHollow = "/assets/tree-hollow.png"

export default function Login() {
  const navigate = useNavigate()
  const { clearMessages, setSessionId } = useChat()
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [shaking, setShaking] = useState(false)

  // Clear previous user's chat data when login page loads
  useEffect(() => {
    clearMessages()
    setSessionId(null)
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!studentId.trim() || !password.trim()) {
      setError('请输入学号和密码')
      setShaking(true)
      setTimeout(() => setShaking(false), 400)
      return
    }
    setError('')
    setLoading(true)
    try {
      await api.studentLogin(studentId.trim(), password)
      navigate('/')
    } catch (err) {
      setError(err.message || '登录失败，请重试')
      setShaking(true)
      setTimeout(() => setShaking(false), 400)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-[#fbf9ec] w-full min-h-screen flex justify-center items-start p-4">
      <div className="w-full max-w-[402px] flex flex-col items-center pt-3 pb-8">

        {/* Header */}
        <div className="w-full flex justify-start px-2 mb-1.5">
          <button
            onClick={() => navigate(-1)}
            className="w-[44px] h-[44px] bg-[#f6cb5b] rounded-[120px] shadow-[0_3px_0_0_#cfa63b] relative overflow-hidden cursor-pointer hover:brightness-105 active:translate-y-[2px] active:shadow-[0_1px_0_0_#cfa63b] transition-all border-none flex items-center justify-center"
          >
            <img src={imgArrow} alt="返回" className="w-[22px] h-[22px] object-cover" />
            <div className="absolute inset-0 rounded-[inherit] shadow-[inset_0_2px_0_0_rgba(255,249,249,0.25)] pointer-events-none" />
          </button>
        </div>

        {/* Tree hollow + Owl */}
        <div className="relative w-[160px] h-[170px] mb-1.5 animate-bounce-in">
          {/* Cartoon ellipse shadow */}
          <div className="absolute bottom-[10px] left-1/2 -translate-x-1/2 w-[150px] h-[14px] bg-[#c9a476] rounded-full z-0" />
          {/* Owl behind - head visible through hollow */}
          <img
            src={imgOwl}
            alt="心语树洞"
            className="absolute z-[1] w-[90px] h-[90px] rounded-full object-cover object-top animate-float"
            style={{ left: '50%', top: '59%', marginLeft: '-45px', marginTop: '-45px' }}
          />
          {/* Tree hollow PNG on top */}
          <img
            src={imgTreeHollow}
            alt=""
            className="absolute inset-0 z-[2] w-full h-full object-contain pointer-events-none"
          />
        </div>

        {/* Brand */}
        <h1 className="text-[26px] font-extrabold text-[#72482d] mb-0.5 tracking-wider animate-slide-up"
          style={{ animationDelay: '0.25s', animationFillMode: 'both' }}>
          心语树洞
        </h1>
        <p className="text-[13px] font-bold text-[#72482d]/40 mb-3.5 animate-slide-up"
          style={{ animationDelay: '0.25s', animationFillMode: 'both' }}>
          你的心理咨询伙伴
        </p>

        {/* Card */}
        <div className="w-full max-w-[340px] bg-white rounded-3xl px-[22px] py-[22px] animate-slide-up"
          style={{ boxShadow: '0 4px 20px rgba(114,72,45,0.1)', animationDelay: '0.4s', animationFillMode: 'both' }}>
          <p className="text-[17px] font-extrabold text-[#72482d] text-center mb-0.5">嗨，欢迎回来！</p>
          <p className="text-[12px] text-[#72482d]/40 text-center mb-[18px]">今天想聊点什么？</p>

          <form onSubmit={handleLogin} className={shaking ? 'animate-wiggle' : ''}>
            <div className="relative mb-3">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] opacity-40 pointer-events-none">🎓</span>
              <input type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)}
                placeholder="请输入学号" autoComplete="off"
                className="w-full h-[46px] bg-white border-[3px] border-[#f6cb5b] rounded-[14px] pl-10 pr-3.5 text-[14px] font-bold text-[#72482d] placeholder:text-[#72482d]/30 placeholder:font-semibold outline-none transition-all focus:border-[#e5b84a] focus:shadow-[0_0_0_3px_rgba(246,203,91,0.25)]" />
            </div>
            <div className="relative mb-3">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] opacity-40 pointer-events-none">🔒</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full h-[46px] bg-white border-[3px] border-[#f6cb5b] rounded-[14px] pl-10 pr-3.5 text-[14px] font-bold text-[#72482d] placeholder:text-[#72482d]/30 placeholder:font-semibold outline-none transition-all focus:border-[#e5b84a] focus:shadow-[0_0_0_3px_rgba(246,203,91,0.25)]" />
            </div>
            <div className="min-h-[16px] mb-1.5">
              {error && <p className="text-center text-[12px] font-bold text-red-500">{error}</p>}
            </div>
            <button type="submit" disabled={loading}
              className="w-full h-[46px] bg-[#f6cb5b] rounded-[14px] shadow-[0_5px_0_0_#cfa63b] font-extrabold text-[16px] text-[#72482d] tracking-wide cursor-pointer transition-all border-none hover:brightness-105 active:translate-y-[3px] active:shadow-[0_2px_0_0_#cfa63b] disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? '登录中...' : '开始咨询'}
            </button>
          </form>
        </div>

        <button onClick={() => navigate('/teacher/login')}
          className="mt-3.5 text-[12px] font-bold text-[#72482d]/35 bg-transparent border-none cursor-pointer transition-colors hover:text-[#72482d]/60 animate-slide-up"
          style={{ animationDelay: '0.6s', animationFillMode: 'both' }}>
          教师端入口 &rarr;
        </button>
      </div>
    </div>
  )
}
