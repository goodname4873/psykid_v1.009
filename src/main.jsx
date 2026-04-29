import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[UI ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-800">
          <div className="mx-auto max-w-3xl rounded border border-red-200 bg-white p-4 shadow-sm">
            <div className="mb-2 font-semibold text-red-600">前端页面渲染异常</div>
            <div className="mb-3 text-slate-600">页面没有白屏，错误已拦截。请把下面错误发给开发排查。</div>
            <pre className="whitespace-pre-wrap rounded bg-red-50 p-3 text-xs text-red-700">
              {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
            </pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
