import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { connectSocket, disconnectSocket } from '../../services/websocket'

// Figma 风格图标 - 1px stroke
const Icons = {
  Dashboard: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  Chat: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  Users: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  Alert: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  Menu: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  ChevronLeft: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  ),
  ChevronRight: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  ),
  Close: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// 导航配置
const navItems = [
  { path: '/teacher', icon: Icons.Dashboard, label: '工作台', exact: true },
  { path: '/teacher/sessions', icon: Icons.Chat, label: '咨询会话' },
  { path: '/teacher/students', icon: Icons.Users, label: '学生管理' },
  { path: '/teacher/alerts', icon: Icons.Alert, label: '预警中心', danger: true },
]

// 侧边栏导航项
const NavItem = ({ item, collapsed, onClick }) => {
  const location = useLocation()
  const isActive = item.exact
    ? location.pathname === item.path
    : location.pathname.startsWith(item.path)

  return (
    <NavLink
      to={item.path}
      onClick={onClick}
      className={`
        flex items-center gap-2 rounded transition-colors relative text-xs font-medium
        ${collapsed ? 'px-2 py-2 justify-center' : 'px-2 py-1.5'}
        ${isActive
          ? 'bg-[#5551ff]/10 text-[#5551ff]'
          : 'text-gray-700 hover:bg-gray-100'
        }
      `}
    >
      <div className="flex-shrink-0">
        <item.icon />
      </div>
      {!collapsed && (
        <>
          <span>{item.label}</span>
          {item.badge && (
            <span className={`
              ml-auto px-1 py-0.5 text-[10px] font-medium rounded
              ${item.danger
                ? 'bg-red-100 text-red-600'
                : isActive
                  ? 'bg-[#5551ff]/20 text-[#5551ff]'
                  : 'bg-gray-100 text-gray-600'
              }
            `}>
              {item.badge}
            </span>
          )}
        </>
      )}
      {collapsed && item.badge && (
        <span className={`
          absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 text-[9px] font-medium rounded-full
          flex items-center justify-center
          ${item.danger ? 'bg-red-500 text-white' : 'bg-[#5551ff] text-white'}
        `}>
          {item.badge}
        </span>
      )}
    </NavLink>
  )
}

// 移动端底部导航
const MobileNav = () => {
  const location = useLocation()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-1.5 lg:hidden z-50">
      <div className="flex items-center justify-around max-w-md mx-auto">
        {navItems.map((item) => {
          const isActive = item.exact
            ? location.pathname === item.path
            : location.pathname.startsWith(item.path)

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`
                flex flex-col items-center gap-0.5 px-3 py-1 rounded transition-colors relative
                ${isActive ? 'text-[#5551ff]' : 'text-gray-500'}
              `}
            >
              <div className="relative">
                <item.icon />
                {item.badge && (
                  <span className={`
                    absolute -top-1 -right-1 min-w-[12px] h-3 px-0.5 text-[9px] font-medium rounded-full
                    flex items-center justify-center
                    ${item.danger ? 'bg-red-500 text-white' : 'bg-[#5551ff] text-white'}
                  `}>
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px]">{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}

// 主布局
export default function TeacherLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const [hovered, setHovered] = useState(false)

  // Initialize WebSocket connection for all teacher pages
  useEffect(() => {
    connectSocket()
    return () => disconnectSocket()
  }, [])

  const isExpanded = !collapsed || hovered

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 - 桌面端 */}
      <aside
        className={`
          fixed top-0 left-0 h-full bg-white border-r border-gray-200 z-50
          transition-all duration-150 hidden lg:flex lg:flex-col
          ${isExpanded ? 'w-48' : 'w-12'}
        `}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Logo */}
        <div className={`h-12 flex items-center border-b border-gray-200 ${isExpanded ? 'px-3' : 'justify-center'}`}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#5551ff] rounded flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
              </svg>
            </div>
            {isExpanded && (
              <span className="font-medium text-sm text-gray-900 whitespace-nowrap">心理咨询</span>
            )}
          </div>
        </div>

        {/* 导航 */}
        <nav className={`flex-1 py-2 space-y-0.5 ${isExpanded ? 'px-2' : 'px-1.5'}`}>
          {navItems.map((item) => (
            <NavItem key={item.path} item={item} collapsed={!isExpanded} />
          ))}
        </nav>

        {/* 底部收起按钮 */}
        <div className={`border-t border-gray-200 ${isExpanded ? 'p-2' : 'p-1.5'}`}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`
              w-full flex items-center gap-1.5 text-gray-500 hover:bg-gray-100 rounded transition-colors text-xs
              ${isExpanded ? 'px-2 py-1.5 justify-between' : 'p-1.5 justify-center'}
            `}
            title={collapsed ? '固定展开' : '自动收起'}
          >
            {isExpanded && <span>{collapsed ? '固定展开' : '自动收起'}</span>}
            <div className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}>
              <Icons.ChevronRight />
            </div>
          </button>
        </div>
      </aside>

      {/* 侧边栏 - 移动端 */}
      <aside className={`
        fixed top-0 left-0 h-full w-56 bg-white border-r border-gray-200 z-50
        transition-transform duration-150 lg:hidden
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-11 flex items-center justify-between px-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#5551ff] rounded flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
              </svg>
            </div>
            <span className="font-medium text-sm text-gray-900">心理咨询</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
            <Icons.Close />
          </button>
        </div>
        <nav className="p-2 space-y-0.5">
          {navItems.map((item) => (
            <NavItem key={item.path} item={item} onClick={() => setSidebarOpen(false)} />
          ))}
        </nav>
      </aside>

      {/* 主内容区 */}
      <main className="transition-all duration-150 pb-14 lg:pb-0 lg:ml-12">
        {/* 顶部栏 */}
        <header className="sticky top-0 h-11 bg-white border-b border-gray-200 flex items-center justify-between px-3 lg:px-4 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-gray-600 hover:bg-gray-100 rounded lg:hidden"
          >
            <Icons.Menu />
          </button>

          <div className="flex-1" />

          {/* 右侧操作 */}
          <div className="flex items-center gap-2">
            <button className="relative p-1 text-gray-500 hover:bg-gray-100 rounded">
              <Icons.Alert />
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
            </button>
            <div className="flex items-center gap-1.5 pl-2 border-l border-gray-200">
              <div className="w-6 h-6 bg-[#5551ff]/10 text-[#5551ff] rounded-full flex items-center justify-center">
                <span className="text-xs font-medium">李</span>
              </div>
              <span className="text-xs font-medium text-gray-900 hidden sm:block">李老师</span>
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <div className="p-3 lg:p-4">
          <Outlet />
        </div>
      </main>

      {/* 移动端底部导航 */}
      <MobileNav />
    </div>
  )
}

