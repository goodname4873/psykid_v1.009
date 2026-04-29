import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../services/api'
import { joinSession, leaveSession, getSocket, connectSocket, emitTeacherIntervene } from '../../services/websocket'

const formatTime = (ts) => {
  const d = ts ? new Date(ts) : new Date()
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Icons
const Icons = {
  Back: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  ),
  Sparkles: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  ),
  ClipboardList: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
    </svg>
  ),
  ChevronDown: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  ),
  ChevronRight: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  ),
  Send: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  ),
  Edit: () => (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
    </svg>
  ),
  Refresh: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
    </svg>
  ),
}

// 4 stages definition
const STAGES = [
  { key: 'listening', label: '1.倾听', name: '倾听共情 Agent', desc: '极简共情，1句话，像朋友聊天' },
  { key: 'cognitive', label: '2.认知', name: '认知引导 Agent', desc: '温和提问，引导反思不合理信念' },
  { key: 'action',    label: '3.行动', name: '行动策略 Agent', desc: '详细具体的可行建议' },
  { key: 'closing',   label: '4.结束', name: '结束巩固 Agent', desc: '总结进展，温暖告别' },
]

// Agent names for chat bubble tags
const AGENT_NAMES = {
  listening: '倾听共情',
  cognitive: '认知引导',
  action: '行动策略',
  closing: '结束巩固',
}

function displayExpertModel(model) {
  const value = String(model || '').toLowerCase()
  if (!value) return 'DeepSeek Expert'
  if (value.includes('deepseek')) return 'DeepSeek V4 Pro'
  if (value.includes('qwen')) return 'Expert'
  return model
}

// Student message bubble - shows audio player for voice messages + AI analyze button
const StudentBubble = ({ msg, aiEnabled, onAnalyze }) => {
  const isVoice = msg.input_type === 'voice' || msg.inputType === 'voice'
  const isRealtimeVoice = msg.input_type === 'realtime_voice' || msg.inputType === 'realtime_voice'
  const isAnyVoice = isVoice || isRealtimeVoice
  const audioSrc = msg.audio_url || msg.audioUrl
  const msgContent = msg.content || msg.text

  return (
    <div className="flex items-start gap-2 max-w-[75%] animate-slide-in">
      <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium flex-shrink-0">
        {msg.senderName?.charAt(0) || '学'}
      </div>
      <div className="flex flex-col gap-0.5">
        {/* Realtime voice tag */}
        {isRealtimeVoice && (
          <span className="text-[10px] text-cyan-600 bg-cyan-50 border border-cyan-200 px-1.5 py-0.5 rounded w-fit">
            [实时语音]
          </span>
        )}
        {/* Audio player for voice messages */}
        {isAnyVoice && audioSrc && (
          <div className="bg-white border border-blue-200 rounded rounded-tl-sm px-2.5 py-1.5 mb-0.5">
            <div className="flex items-center gap-1.5 mb-1">
              <svg className="w-3 h-3 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-[10px] text-blue-500 font-medium">语音原声</span>
            </div>
            <audio controls preload="none" className="w-full h-7" style={{ minWidth: '180px' }}>
              <source src={`http://localhost:3000${audioSrc}`} />
            </audio>
          </div>
        )}
        {/* Text content (ASR result for voice, or plain text) */}
        <div className="bg-white border border-gray-200 rounded rounded-tl-sm px-2.5 py-1.5">
          {isAnyVoice && (
            <span className="text-[10px] text-gray-400 block mb-0.5">{isRealtimeVoice ? '[实时语音转文字]' : '[语音转文字]'}</span>
          )}
          <p className="text-xs text-gray-800 leading-relaxed">{msgContent}</p>
        </div>
        <div className="flex items-center gap-2 px-0.5">
          <span className="text-[10px] text-gray-400">{formatTime(msg.created_at || msg.timestamp)}</span>
          {/* AI Analyze button - shown on push voice messages when AI is enabled (NOT for realtime) */}
          {isVoice && !isRealtimeVoice && aiEnabled && msgContent && (
            <button
              onClick={() => onAnalyze(msgContent)}
              className="flex items-center gap-0.5 text-[10px] text-purple-500 hover:text-purple-700 hover:bg-purple-50 px-1.5 py-0.5 rounded transition-colors"
              title="使用AI分析这段语音内容"
            >
              <Icons.Sparkles />
              AI分析
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Teacher/AI message bubble - with agent tag, audio player for realtime voice
const TeacherBubble = ({ msg }) => {
  const isAI = msg.sender_type === 'ai' || msg.source === 'ai'
  const agentTag = isAI && msg.stage ? AGENT_NAMES[msg.stage] : null
  const isRealtimeVoice = msg.input_type === 'realtime_voice' || msg.inputType === 'realtime_voice'
  const audioSrc = msg.audio_url || msg.audioUrl
  const msgContent = msg.content || msg.text

  return (
    <div className="flex items-start gap-2 max-w-[75%] ml-auto flex-row-reverse animate-slide-in">
      <div className="w-7 h-7 rounded-full bg-[#5551ff]/10 text-[#5551ff] flex items-center justify-center text-xs font-medium flex-shrink-0">
        {isAI ? <Icons.Sparkles /> : '师'}
      </div>
      <div className="flex flex-col gap-0.5 items-end">
        {agentTag && (
          <span className="text-[10px] text-gray-500 px-0.5">{agentTag}</span>
        )}
        {/* Realtime voice tag */}
        {isRealtimeVoice && (
          <span className="text-[10px] text-cyan-600 bg-cyan-50 border border-cyan-200 px-1.5 py-0.5 rounded">
            [实时语音] AI
          </span>
        )}
        {/* Audio player for realtime voice AI messages */}
        {isRealtimeVoice && audioSrc && (
          <div className="bg-[#5551ff]/5 border border-[#5551ff]/20 rounded rounded-tr-sm px-2.5 py-1.5 mb-0.5">
            <div className="flex items-center gap-1.5 mb-1">
              <svg className="w-3 h-3 text-[#5551ff] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-[10px] text-[#5551ff] font-medium">AI语音原声</span>
            </div>
            <audio controls preload="none" className="w-full h-7" style={{ minWidth: '180px' }}>
              <source src={`http://localhost:3000${audioSrc}`} />
            </audio>
          </div>
        )}
        {/* Text content (subtitle for realtime voice, or plain text) */}
        <div className="bg-[#5551ff] text-white rounded rounded-tr-sm px-2.5 py-1.5">
          {isRealtimeVoice && (
            <span className="text-[10px] text-white/60 block mb-0.5">[语音字幕]</span>
          )}
          <p className="text-xs leading-relaxed">{msgContent}</p>
        </div>
        <div className="flex items-center gap-1.5 px-0.5">
          {isAI && !isRealtimeVoice && (
            <span className="text-[10px] text-[#5551ff] flex items-center gap-0.5"><Icons.Sparkles /> AI</span>
          )}
          <span className="text-[10px] text-gray-400">{formatTime(msg.created_at || msg.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}

// ========== Agent Control Panel (matches test/session_text.html) ==========
export const AgentPanel = ({ analysis, suggestion, suggestions, triggerMessage, loading, onDirectSend, onEditSend, onRegenerate, onReview, onGuidedRegenerate, proactiveSuggestion, session, sessionId, guardianSnapshot, guardianProactive, onGuardianSend, onGuardianIgnore }) => {
  const activeStage = analysis?.stage || 'listening'
  const [guardianAuto, setGuardianAuto] = useState(true)
  // v1.007-04: Review & teacher guidance state
  const [reviewResult, setReviewResult] = useState(null) // { pass, issues, suggestion, confidence }
  const [reviewLoading, setReviewLoading] = useState(false)
  const [guidanceInput, setGuidanceInput] = useState('')
  const [guidanceLoading, setGuidanceLoading] = useState(false)
  const [selectedSuggestionIndexes, setSelectedSuggestionIndexes] = useState([])

  // v1.005: Skill weight bars
  const skillWeights = analysis?.skillWeights || null
  const SKILL_LABELS = { empathy: '共情', cognitive: '引导', action: '行动', closing: '收尾' }
  const SKILL_COLORS = { empathy: 'bg-pink-400', cognitive: 'bg-blue-400', action: 'bg-green-400', closing: 'bg-amber-400' }

  // v1.005: Emotion display
  const emotion = analysis?.emotion
  const emotionObj = emotion && typeof emotion === 'object' ? emotion : null
  const emotionText = emotionObj ? emotionObj.primary : (typeof emotion === 'string' ? emotion : null)
  const emotionIntensity = emotionObj?.intensity
  const emotionTrend = emotionObj?.trend

  // v1.005: Build suggestion queue from suggestions array or fallback to single suggestion
  const suggestionQueue = suggestions && suggestions.length > 0
    ? suggestions
    : (suggestion ? [{ content: suggestion, delay: 0 }] : [])

  useEffect(() => {
    setSelectedSuggestionIndexes([])
  }, [suggestionQueue.map(item => item.content || '').join('\n---\n')])

  const selectedSuggestions = selectedSuggestionIndexes
    .map(i => suggestionQueue[i])
    .filter(Boolean)
  const mergedSuggestionText = selectedSuggestions
    .map(item => (item.content || '').trim())
    .filter(Boolean)
    .join('\n\n')
  const hasSelectedSuggestions = selectedSuggestionIndexes.length > 0
  const actionContentFor = (item) => hasSelectedSuggestions ? mergedSuggestionText : item.content
  const toggleSuggestionSelected = (index) => {
    setSelectedSuggestionIndexes(prev => (
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index].sort((a, b) => a - b)
    ))
  }
  const reviewContent = async (content) => {
    setReviewLoading(true)
    setReviewResult(null)
    try {
      const r = await onReview(content)
      setReviewResult(r)
    } catch (e) {
      setReviewResult({ pass: false, issues: ['审视请求失败: ' + e.message], suggestion: '', confidence: 0 })
    } finally {
      setReviewLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Panel header */}
      <div className="px-4 py-3 bg-gray-800 text-white text-sm font-semibold flex-shrink-0 flex items-center justify-between">
        <span>AI 协调面板</span>
        {analysis?.speculativeHit && (
          <span className="bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-full animate-pulse">
            ⚡ 投机命中 -{analysis.speculativeSavedMs ? Math.round(analysis.speculativeSavedMs / 1000) + 's' : ''}
          </span>
        )}
        {analysis && !analysis.speculativeHit && (
          <span className="bg-gray-600 text-gray-300 text-[10px] px-2 py-0.5 rounded-full">
            常规
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">

        {/* v1.005: Skill weights visualization (replaces 4-stage badges) */}
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <h3 className="text-xs text-gray-500 mb-2">本轮技能侧重</h3>
          {skillWeights ? (
            <div className="space-y-1.5">
              {Object.entries(skillWeights)
                .filter(([, v]) => v > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-8">{SKILL_LABELS[key] || key}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${SKILL_COLORS[key] || 'bg-gray-400'}`}
                        style={{ width: `${Math.round(value * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(value * 100)}%</span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              {STAGES.map(s => (
                <span key={s.key} className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${activeStage === s.key ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* v1.005: Emotion with intensity + trend */}
        {emotionText && (
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <h3 className="text-xs text-gray-500 mb-2">情绪状态</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full font-medium">
                {emotionText}
              </span>
              {emotionIntensity && (
                <div className="flex items-center gap-1.5">
                  <div className="w-20 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        emotionIntensity >= 7 ? 'bg-red-400' : emotionIntensity >= 4 ? 'bg-amber-400' : 'bg-green-400'
                      }`}
                      style={{ width: `${emotionIntensity * 10}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 font-medium">{emotionIntensity}/10</span>
                </div>
              )}
              {emotionTrend && (
                <span className={`text-sm ${emotionTrend === '↑' ? 'text-red-500' : emotionTrend === '↓' ? 'text-green-500' : 'text-gray-400'}`}>
                  {emotionTrend}
                </span>
              )}
            </div>
            {analysis?.confidence != null && analysis.confidence < 0.7 && (
              <p className="text-[10px] text-amber-500 mt-1.5">置信度 {Math.round(analysis.confidence * 100)}% - 建议偏向共情</p>
            )}
          </div>
        )}

        {/* Trigger message - what student said */}
        {triggerMessage && (
          <div className="bg-blue-50 rounded-lg p-3 shadow-sm border border-blue-100">
            <h3 className="text-xs text-blue-600 mb-1.5 font-medium">针对学生消息</h3>
            <p className="text-xs text-gray-800 leading-relaxed bg-white rounded px-2.5 py-2 border border-blue-100">
              "{triggerMessage}"
            </p>
          </div>
        )}

        {/* v1.005: Coordinator guidance (replaces old analysis reason) */}
        {analysis?.guidance && (
          <div className="bg-green-50 rounded-lg p-3 shadow-sm border border-green-100">
            <h3 className="text-xs text-green-600 mb-1.5 font-medium">协调器策略</h3>
            <p className="text-[11px] text-gray-700 leading-relaxed">{analysis.guidance}</p>
          </div>
        )}

        {/* v1.005: Proactive suggestion from silence monitor / scheduler */}
        {proactiveSuggestion && (
          <div className="bg-amber-50 rounded-lg p-3 shadow-sm border border-amber-200 animate-pulse">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-amber-500 text-sm">&#9888;</span>
              <h3 className="text-xs text-amber-700 font-medium">主动建议</h3>
            </div>
            <p className="text-[10px] text-gray-500 mb-1">{proactiveSuggestion.reason}</p>
            <p className="text-xs text-gray-800 leading-relaxed mb-2">"{proactiveSuggestion.content}"</p>
            <div className="flex gap-2">
              <button
                onClick={() => onDirectSend(proactiveSuggestion.content)}
                className="flex-1 text-[11px] px-2 py-1.5 bg-amber-500 text-white rounded hover:bg-amber-600"
              >
                发送
              </button>
              <button
                onClick={() => onEditSend(proactiveSuggestion.content)}
                className="flex-1 text-[11px] px-2 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                编辑
              </button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <div className="flex items-center gap-2 py-2">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              <span className="text-xs text-gray-500">协调器分析中...</span>
            </div>
          </div>
        )}

        {/* v1.005: Suggestion Queue (replaces single suggestion) */}
        {suggestionQueue.length > 0 && (
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-xs text-gray-500">建议回复序列</h3>
              {suggestionQueue.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">
                    {hasSelectedSuggestions ? `已选 ${selectedSuggestionIndexes.length} · 点击任意发送/审视将合并处理` : '可多选合并'}
                  </span>
                  {hasSelectedSuggestions && (
                    <button
                      onClick={() => setSelectedSuggestionIndexes([])}
                      className="text-[10px] text-gray-400 hover:text-gray-700"
                    >
                      清除
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {suggestionQueue.map((item, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-2.5 hover:border-blue-200 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    {suggestionQueue.length > 1 && (
                      <label className="mt-0.5 flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedSuggestionIndexes.includes(i)}
                          onChange={() => toggleSuggestionSelected(i)}
                          className="w-3.5 h-3.5 accent-blue-500"
                          aria-label={`选择第${i + 1}条建议`}
                        />
                      </label>
                    )}
                    <div className="flex-1">
                      <span className="text-[10px] text-gray-400 block mb-0.5">
                        #{i + 1} {item.delay ? `(${item.delay / 1000}秒后)` : '(立即)'}
                        {item.purpose && <span className="text-blue-400 ml-1">{item.purpose}</span>}
                      </span>
                      <p className="text-xs text-gray-800 leading-relaxed">{item.content}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <button
                      onClick={() => onDirectSend(actionContentFor(item))}
                      className="flex items-center gap-0.5 text-[10px] px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      <Icons.Send /> 发送
                    </button>
                    <button
                      onClick={() => onEditSend(actionContentFor(item))}
                      className="flex items-center gap-0.5 text-[10px] px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                    >
                      <Icons.Edit /> 编辑
                    </button>
                    <button
                      onClick={() => reviewContent(actionContentFor(item))}
                      disabled={reviewLoading}
                      className="flex items-center gap-0.5 text-[10px] px-2 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50"
                    >
                      {reviewLoading ? '审视中...' : '审视'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* v1.007-04: Review result display */}
        {reviewResult && (
          <div className={`rounded-lg p-3 shadow-sm border ${reviewResult.pass ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-sm">{reviewResult.pass ? '✅' : '❌'}</span>
              <span className={`text-xs font-semibold ${reviewResult.pass ? 'text-green-700' : 'text-red-700'}`}>
                {reviewResult.pass ? '审视通过' : '审视未通过'}
              </span>
              <span className="text-[10px] text-gray-400 ml-auto">
                置信度 {((reviewResult.confidence || 0) * 100).toFixed(0)}% | {displayExpertModel(reviewResult.model)}
              </span>
            </div>
            {reviewResult.issues && reviewResult.issues.length > 0 && (
              <div className="space-y-1 mb-2">
                {reviewResult.issues.map((issue, i) => (
                  <div key={i} className="text-[11px] text-red-700 flex items-start gap-1">
                    <span className="text-red-400 mt-0.5 shrink-0">•</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            )}
            {reviewResult.suggestion && !reviewResult.pass && (
              <div className="bg-white rounded p-2 border border-red-100">
                <div className="text-[10px] text-gray-500 mb-0.5">修正方向:</div>
                <div className="text-[11px] text-gray-700">{reviewResult.suggestion}</div>
              </div>
            )}
            {!reviewResult.pass && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    setGuidanceInput(reviewResult.suggestion || '')
                  }}
                  className="flex-1 text-[10px] px-2 py-1.5 bg-amber-500 text-white rounded hover:bg-amber-600"
                >
                  用修正方向重生成
                </button>
                <button onClick={() => setReviewResult(null)}
                  className="text-[10px] px-2 py-1.5 bg-gray-100 text-gray-500 rounded hover:bg-gray-200">
                  关闭
                </button>
              </div>
            )}
            {reviewResult.pass && (
              <button onClick={() => setReviewResult(null)}
                className="text-[10px] px-2 py-1 text-gray-400 hover:text-gray-600 mt-1">
                关闭
              </button>
            )}
          </div>
        )}

        {/* v1.007-04: Teacher guidance input for regeneration */}
        {(suggestionQueue.length > 0 || analysis) && (
          <div className="bg-white rounded-lg p-3 shadow-sm border border-blue-100">
            <div className="text-[10px] text-gray-500 mb-1.5">教师引导 — 告诉AI正确方向</div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={guidanceInput}
                onChange={(e) => setGuidanceInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && guidanceInput.trim() && !guidanceLoading) {
                    setGuidanceLoading(true)
                    onGuidedRegenerate(guidanceInput.trim()).finally(() => {
                      setGuidanceLoading(false)
                      setGuidanceInput('')
                      setReviewResult(null)
                    })
                  }
                }}
                placeholder="如：学生说的是背诵压力，不是做题技巧"
                className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-300"
              />
              <button
                onClick={() => {
                  if (!guidanceInput.trim() || guidanceLoading) return
                  setGuidanceLoading(true)
                  onGuidedRegenerate(guidanceInput.trim()).finally(() => {
                    setGuidanceLoading(false)
                    setGuidanceInput('')
                    setReviewResult(null)
                  })
                }}
                disabled={!guidanceInput.trim() || guidanceLoading}
                className="text-[10px] px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 whitespace-nowrap"
              >
                {guidanceLoading ? '生成中...' : '引导重生成'}
              </button>
            </div>
          </div>
        )}

        {/* Mirror cues */}
        {analysis?.mirrorCues && (
          <div className="bg-gray-50 rounded-lg p-2.5">
            <span className="text-[10px] text-gray-400">语言匹配: </span>
            <span className="text-[11px] text-gray-600">{analysis.mirrorCues}</span>
          </div>
        )}

        {/* Raw JSON (collapsed) */}
        {analysis && (
          <details className="text-[10px] text-gray-400 cursor-pointer">
            <summary>查看原始分析</summary>
            <pre className="text-[10px] bg-gray-50 p-2 rounded overflow-x-auto whitespace-pre-wrap text-gray-600 leading-relaxed mt-1">
              {JSON.stringify(analysis, null, 2)}
            </pre>
          </details>
        )}

        {/* Regenerate button */}
        {(suggestionQueue.length > 0 || analysis) && (
          <button
            onClick={onRegenerate}
            className="w-full text-[11px] text-gray-500 hover:text-blue-500 hover:bg-white py-2 rounded-lg transition-colors flex items-center justify-center gap-1"
          >
            <Icons.Refresh /> 重新分析
          </button>
        )}

        {/* Guardian 主动介入 — 需要教师操作 */}
        {guardianProactive && guardianProactive.status === 'pending' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3 shadow-md animate-pulse">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-lg">🚨</span>
              <span className="text-xs font-bold text-red-800">Guardian 建议主动介入</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${guardianProactive.urgency === 'high' ? 'bg-red-500 text-white' : 'bg-orange-200 text-orange-800'}`}>
                {guardianProactive.urgency === 'high' ? '紧急' : '建议'}
              </span>
            </div>
            <div className="text-[10px] text-red-600 mb-2">原因：{guardianProactive.reason}</div>
            <div className="bg-white p-2 rounded border border-red-200 text-sm text-gray-800 mb-2">
              {guardianProactive.content}
            </div>
            <div className="flex gap-2">
              <button onClick={() => onGuardianSend(guardianProactive.content)}
                className="flex-1 px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded hover:bg-red-600 transition">
                发送给学生
              </button>
              <button onClick={() => {
                const edited = prompt('修改后发送：', guardianProactive.content)
                if (edited) onGuardianSend(edited)
              }}
                className="px-3 py-1.5 bg-orange-100 text-orange-700 text-xs font-bold rounded hover:bg-orange-200 transition">
                修改
              </button>
              <button onClick={onGuardianIgnore}
                className="px-3 py-1.5 bg-gray-100 text-gray-500 text-xs rounded hover:bg-gray-200 transition">
                忽略
              </button>
            </div>
          </div>
        )}

        {/* Guardian 自动发送通知（语音模式）+ 暂停开关 */}
        {guardianProactive && guardianProactive.status === 'auto_sent' && (
          <div className="bg-green-50 border border-green-300 rounded-lg p-3 text-[11px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-green-700 font-medium">⚡ Guardian 已自动发送</span>
            </div>
            <div className="bg-white p-1.5 rounded border border-green-200 text-gray-700 mb-2">
              {guardianProactive.content}
            </div>
            <div className="text-[10px] text-gray-500">原因：{guardianProactive.reason}</div>
          </div>
        )}

        {/* Guardian 发送结果 */}
        {guardianProactive && guardianProactive.status === 'sent' && (
          <div className="bg-green-50 border border-green-300 rounded-lg p-2 text-[11px] text-green-700">
            ✅ 已发送给学生
          </div>
        )}
        {guardianProactive && guardianProactive.status === 'ignored' && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-[11px] text-gray-400">
            已忽略
          </div>
        )}

        {/* Guardian Daemon Panel (v1.007) */}
        {guardianSnapshot && (
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg p-3 shadow-sm border border-purple-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">🛡️</span>
                <h3 className="text-xs font-semibold text-purple-900">Guardian 守护进程</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full">
                  #{guardianSnapshot.tickCount || 0}
                </span>
              </div>
            </div>

            {/* 语音模式自动介入开关 */}
            {(session?.mode === 'agent') && (
              <div className="flex items-center justify-between mb-2 bg-white rounded px-2 py-1.5 border border-purple-100">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-600">语音自动介入</span>
                  <span className={`text-[9px] ${guardianAuto ? 'text-green-600' : 'text-red-500'}`}>
                    {guardianAuto ? '🟢 开' : '🔴 停'}
                  </span>
                </div>
                <button
                  onClick={async () => {
                    const newAuto = !guardianAuto
                    setGuardianAuto(newAuto)
                    try { await api.post('/api/voice/guardian-toggle', { session_id: sessionId, auto: newAuto }) } catch {}
                  }}
                  className={`relative w-8 h-4 rounded-full transition ${guardianAuto ? 'bg-green-400' : 'bg-gray-300'}`}
                >
                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${guardianAuto ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            )}

            {/* 态势分析 */}
            {guardianSnapshot.situation && (
              <div className="mb-2 text-[11px] space-y-1">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-gray-500">情绪:</span>
                  <span className="text-purple-700 font-medium">{guardianSnapshot.situation.emotionTrend || '-'}</span>
                  <span className="text-gray-400">{guardianSnapshot.situation.emotionIntensity || 0}/10</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">深度:</span>
                  <span className="text-blue-700">{guardianSnapshot.situation.topicDepth || '-'}</span>
                </div>
                {guardianSnapshot.situation.stuckIndicator > 0.3 && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">兜圈:</span>
                    <span className="text-orange-600 font-medium">{(guardianSnapshot.situation.stuckIndicator * 100).toFixed(0)}% ⚠️</span>
                  </div>
                )}
                {guardianSnapshot.situation.nextStepHint && (
                  <div className="mt-1 p-1.5 bg-white rounded text-[10px] text-gray-700 border border-purple-100">
                    💭 {guardianSnapshot.situation.nextStepHint}
                  </div>
                )}
              </div>
            )}

            {/* 预存分支 */}
            {guardianSnapshot.preparedBranches && guardianSnapshot.preparedBranches.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] text-gray-500 mb-1">📦 已预存回复 ({guardianSnapshot.preparedBranches.length})</div>
                <div className="space-y-1">
                  {guardianSnapshot.preparedBranches.map((b, i) => (
                    <div key={b.id} className="text-[10px] bg-white px-1.5 py-1 rounded border border-purple-100 flex items-center justify-between">
                      <span className="text-gray-700 truncate flex-1">{i+1}. {b.condition}</span>
                      {b.ready && <span className="text-green-500 ml-1">✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 命中统计 */}
            {guardianSnapshot.hitStats && guardianSnapshot.hitStats.totalChecks > 0 && (
              <div className="pt-2 border-t border-purple-100">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-gray-500">命中率</span>
                  <span className="font-semibold text-purple-700">
                    {(guardianSnapshot.hitStats.hitRate * 100).toFixed(0)}% ({guardianSnapshot.hitStats.hits}/{guardianSnapshot.hitStats.totalChecks})
                  </span>
                </div>
                {guardianSnapshot.hitStats.recent10 && guardianSnapshot.hitStats.recent10.length > 0 && (
                  <div className="flex gap-0.5 mb-1">
                    {guardianSnapshot.hitStats.recent10.map((h, i) => (
                      <div key={i} className={`h-1.5 flex-1 rounded-full ${h ? 'bg-green-400' : 'bg-gray-200'}`} />
                    ))}
                  </div>
                )}
                {guardianSnapshot.hitStats.avgSavedMs > 0 && (
                  <div className="text-[9px] text-gray-500">
                    平均省 {(guardianSnapshot.hitStats.avgSavedMs / 1000).toFixed(1)}s
                  </div>
                )}
              </div>
            )}

            {/* 运行统计口径 */}
            {guardianSnapshot.traceStats && guardianSnapshot.traceStats.total > 0 && (
              <div className="pt-2 border-t border-purple-100 mt-2 text-[10px] text-gray-600">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-gray-500">近{guardianSnapshot.traceStats.total}轮统计</span>
                  <span className="text-purple-700 font-medium">
                    跳过主管道 {guardianSnapshot.traceStats.generatorSkipped.count}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span>秒接 {guardianSnapshot.traceStats.directContinuation.count}</span>
                  <span>快路 {guardianSnapshot.traceStats.guardianFastPath.count}</span>
                  <span>候选 {guardianSnapshot.traceStats.guardianCandidate.count}</span>
                  <span>缺话题 {guardianSnapshot.traceStats.missingExpectedTopic}</span>
                </div>
              </div>
            )}

            {/* 主动介入历史 */}
            {guardianSnapshot.recentProactive && guardianSnapshot.recentProactive.length > 0 && (
              <div className="pt-2 border-t border-purple-100 mt-2">
                <div className="text-[10px] text-gray-500 mb-1">📋 介入记录</div>
                {guardianSnapshot.recentProactive.map((p, i) => (
                  <div key={i} className="text-[10px] text-gray-600 mb-0.5">
                    {p.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!loading && !analysis && suggestionQueue.length === 0 && !guardianSnapshot && (
          <div className="text-center py-6 text-xs text-gray-400">等待对话开始...</div>
        )}
      </div>
    </div>
  )
}

// ========== Student Context Panel (left side, cross-session context) ==========
const StudentContextPanel = ({ studentId }) => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState(new Set())

  useEffect(() => {
    if (!studentId) return
    setLoading(true)
    api.getStudentContext(studentId)
      .then(res => setData(res.data || res))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [studentId])

  const toggleSession = (id) => {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-400 px-4 text-center">
        加载学生档案失败
      </div>
    )
  }

  const { student, session_count, unresolved_items, final_summaries, rolling_checkpoints, profile, session_thread } = data

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="px-4 py-3 bg-gray-800 text-white text-sm font-semibold flex-shrink-0">
        学生档案
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
        {/* Basic info */}
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium">
              {student.name?.charAt(0) || '?'}
            </div>
            <div>
              <p className="text-xs font-medium text-gray-900">{student.name}</p>
              <p className="text-[10px] text-gray-500">{student.grade} {student.class_name} | {student.student_no}</p>
            </div>
          </div>
          <div className="text-[10px] text-gray-500">
            咨询次数: <span className="text-gray-800 font-medium">{session_count}</span>
          </div>
        </div>

        {/* v1.005: Student counseling profile */}
        {profile && (
          <div className="bg-indigo-50 rounded-lg p-3 shadow-sm border border-indigo-200">
            <h3 className="text-xs text-indigo-700 font-medium mb-2">咨询画像</h3>
            <div className="space-y-1.5">
              {profile.communication_style && (
                <div className="text-[11px]"><span className="text-gray-500">沟通风格: </span><span className="text-gray-800">{profile.communication_style}</span></div>
              )}
              {profile.emotion_baseline && (
                <div className="text-[11px]"><span className="text-gray-500">情绪基线: </span><span className="text-gray-800">{profile.emotion_baseline}</span></div>
              )}
              {profile.core_issues && profile.core_issues.length > 0 && (
                <div>
                  <span className="text-[10px] text-gray-500">核心议题: </span>
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    {profile.core_issues.map((issue, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">{issue}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile.effective_methods && profile.effective_methods.length > 0 && (
                <div>
                  <span className="text-[10px] text-gray-500">有效方法: </span>
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    {profile.effective_methods.map((m, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 rounded">{m}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile.avoid_topics && profile.avoid_topics.length > 0 && (
                <div>
                  <span className="text-[10px] text-red-500">注意回避: </span>
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    {profile.avoid_topics.map((t, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 rounded">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {profile.risk_history && profile.risk_history.length > 0 && (
                <div className="mt-1 pt-1 border-t border-indigo-100">
                  <span className="text-[10px] text-red-500 font-medium">风险记录:</span>
                  {profile.risk_history.map((r, i) => (
                    <p key={i} className="text-[10px] text-gray-600 ml-2">
                      <span className="text-gray-400">{r.date}</span> <span className={r.level === 'L1' ? 'text-red-600 font-medium' : 'text-amber-600'}>[{r.level}]</span> "{r.quote}"
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* v1.005: Current session thread (structured tracking) */}
        {session_thread && (
          <div className="bg-cyan-50 rounded-lg p-3 shadow-sm border border-cyan-200">
            <h3 className="text-xs text-cyan-700 font-medium mb-2">本次对话线索</h3>
            <div className="space-y-1.5">
              {session_thread.key_events && session_thread.key_events.length > 0 && (
                <div>
                  <span className="text-[10px] text-gray-500">关键事件: </span>
                  {session_thread.key_events.map((e, i) => (
                    <span key={i} className="text-[10px] text-gray-700">{i > 0 ? '、' : ''}{e}</span>
                  ))}
                </div>
              )}
              {session_thread.emotion_shifts && session_thread.emotion_shifts.length > 0 && (
                <div>
                  <span className="text-[10px] text-gray-500">情绪变化: </span>
                  {session_thread.emotion_shifts.map((s, i) => (
                    <p key={i} className="text-[10px] text-gray-700 ml-2">{s}</p>
                  ))}
                </div>
              )}
              {session_thread.student_quotes && session_thread.student_quotes.length > 0 && (
                <div>
                  <span className="text-[10px] text-gray-500">学生原话:</span>
                  {session_thread.student_quotes.map((q, i) => (
                    <p key={i} className="text-[10px] text-gray-600 italic ml-2 border-l-2 border-cyan-200 pl-1.5">"{q}"</p>
                  ))}
                </div>
              )}
              {session_thread.strategies_tried && session_thread.strategies_tried.length > 0 && (
                <div>
                  <span className="text-[10px] text-gray-500">已尝试策略:</span>
                  {session_thread.strategies_tried.map((s, i) => (
                    <p key={i} className="text-[10px] text-gray-700 ml-2">
                      {typeof s === 'object' ? `${s.method} → ${s.result}` : s}
                    </p>
                  ))}
                </div>
              )}
              {session_thread.unresolved && session_thread.unresolved.length > 0 && (
                <div>
                  <span className="text-[10px] text-amber-600">未解决:</span>
                  {session_thread.unresolved.map((u, i) => (
                    <p key={i} className="text-[10px] text-gray-700 ml-2">- {u}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Unresolved items (aggregated across sessions) */}
        {unresolved_items && unresolved_items.length > 0 && (
          <div className="bg-amber-50 rounded-lg p-3 shadow-sm border border-amber-200">
            <h3 className="text-xs text-amber-700 font-medium mb-2">待关注事项</h3>
            <ul className="space-y-1">
              {unresolved_items.map((item, i) => (
                <li key={i} className="text-[11px] text-gray-700 flex items-start gap-1.5">
                  <span className="text-amber-500 mt-0.5 flex-shrink-0">&#9679;</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Current session rolling checkpoints timeline */}
        {rolling_checkpoints && rolling_checkpoints.length > 0 && (
          <div className="bg-white rounded-lg p-3 shadow-sm">
            <h3 className="text-xs text-blue-600 font-medium mb-2">当前会话进展</h3>
            <div className="space-y-2">
              {rolling_checkpoints.map((cp, i) => (
                <div key={cp.id} className="relative pl-4 border-l-2 border-blue-200">
                  <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-blue-400" />
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-medium text-blue-500">第{cp.trigger_turn}轮</span>
                    <span className="text-[10px] text-gray-400">
                      {cp.created_at ? new Date(cp.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-700 leading-relaxed">{cp.raw_summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Historical session summaries */}
        <div className="bg-white rounded-lg p-3 shadow-sm">
          <h3 className="text-xs text-gray-500 mb-2">历次咨询摘要</h3>
          {(!final_summaries || final_summaries.length === 0) ? (
            <p className="text-[11px] text-gray-400">首次咨询，暂无历史记录</p>
          ) : (
            <div className="space-y-2">
              {final_summaries.map((s) => {
                const isExpanded = expandedSessions.has(s.id)
                const date = s.start_time || s.created_at
                const dateStr = date ? new Date(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : ''

                return (
                  <div key={s.id} className="border border-gray-100 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSession(s.id)}
                      className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? <Icons.ChevronDown /> : <Icons.ChevronRight />}
                        <span className="text-[11px] text-gray-600">{dateStr}</span>
                        {s.topics_discussed && s.topics_discussed.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {s.topics_discussed.slice(0, 2).map((t, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-2.5 pb-2.5 space-y-2">
                        {/* Session flow */}
                        {s.session_flow && (
                          <p className="text-[11px] text-gray-700 leading-relaxed">{s.session_flow}</p>
                        )}

                        {/* Student expressions */}
                        {s.student_expressions && s.student_expressions.length > 0 && (
                          <div>
                            <span className="text-[10px] text-gray-400 block mb-0.5">学生原话</span>
                            {s.student_expressions.map((expr, i) => (
                              <p key={i} className="text-[10px] text-gray-600 italic pl-2 border-l-2 border-gray-200 mb-0.5">
                                "{expr}"
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Approaches tried */}
                        {s.approaches_tried && s.approaches_tried.length > 0 && (
                          <div>
                            <span className="text-[10px] text-gray-400 block mb-0.5">使用方法</span>
                            <div className="flex gap-1 flex-wrap">
                              {s.approaches_tried.map((a, i) => (
                                <span key={i} className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 rounded">
                                  {a}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Unresolved items */}
                        {s.unresolved_items && s.unresolved_items.length > 0 && (
                          <div>
                            <span className="text-[10px] text-amber-600 block mb-0.5">未解决</span>
                            {s.unresolved_items.map((u, i) => (
                              <p key={i} className="text-[10px] text-gray-600 pl-2">- {u}</p>
                            ))}
                          </div>
                        )}

                        {/* Rolling checkpoints detail timeline */}
                        {s.rolling_checkpoints && s.rolling_checkpoints.length > 0 && (
                          <div className="mt-1 pt-1 border-t border-gray-100">
                            <span className="text-[10px] text-blue-500 font-medium block mb-1">对话详情</span>
                            <div className="space-y-1.5">
                              {s.rolling_checkpoints.map((cp) => (
                                <div key={cp.id} className="relative pl-3 border-l-2 border-blue-100">
                                  <div className="absolute -left-[4px] top-1 w-1.5 h-1.5 rounded-full bg-blue-300" />
                                  <span className="text-[10px] text-blue-400 font-medium">第{cp.trigger_turn}轮</span>
                                  <p className="text-[10px] text-gray-600 leading-relaxed">{cp.raw_summary}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <p className="text-[10px] text-gray-400">共{s.trigger_turn || '?'}轮对话</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChatPanel() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const chatRef = useRef(null)
  // Track locally-sent message IDs to prevent WebSocket duplicate
  const sentMsgIds = useRef(new Set())
  const lastAutoAnalyzedMessageIdRef = useRef(null)

  const [messages, setMessages] = useState([])
  const [session, setSession] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Context panel state
  const [contextPanelOpen, setContextPanelOpen] = useState(false)

  // AI state
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const [suggestions, setSuggestions] = useState([]) // v1.005: suggestion queue
  const [analysis, setAnalysis] = useState(null)
  const [triggerMessage, setTriggerMessage] = useState('')
  const [proactiveSuggestion, setProactiveSuggestion] = useState(null) // v1.005: from silence monitor
  const [suggestionTraceId, setSuggestionTraceId] = useState(null) // v1.006: for intervention feedback
  const [guardianSnapshot, setGuardianSnapshot] = useState(null) // v1.007: Guardian daemon state
  const [guardianProactive, setGuardianProactive] = useState(null) // v1.007: pending proactive suggestion

  // Load session and messages
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false

    // Clear AI state when switching sessions
    setSuggestion('')
    setSuggestions([])
    setAnalysis(null)
    setTriggerMessage('')
    setSuggestionTraceId(null)
    lastAutoAnalyzedMessageIdRef.current = null

    async function load() {
      try {
        const [sessionData, msgData] = await Promise.all([
          api.getSession(sessionId),
          api.getMessageHistory(sessionId),
        ])
        if (cancelled) return
        setSession(sessionData.data || sessionData)
        const msgList = msgData.data?.list || msgData.data || msgData.messages || []
        setMessages(Array.isArray(msgList) ? msgList : [])
        setLoadError('')
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      }
    }

    load()
    joinSession(sessionId)

    return () => {
      cancelled = true
      leaveSession(sessionId)
    }
  }, [sessionId])

  // Listen for realtime new messages via WebSocket
  useEffect(() => {
    const socket = getSocket() || connectSocket()
    if (!socket) return

    const ensureJoined = () => joinSession(sessionId)
    ensureJoined()
    socket.on('connect', ensureJoined)

    const handler = (msg) => {
      if (String(msg.session_id) !== String(sessionId)) return
      // Skip if this message was sent locally (prevent duplicate)
      const msgId = msg.id || msg.message_id
      if (msgId && sentMsgIds.current.has(String(msgId))) {
        return
      }
      setMessages(prev => {
        if (msgId && prev.some(m => String(m.id) === String(msgId))) return prev
        return [...prev, msg]
      })
    }

    // Listen for coordinator analysis updates from student's voice session
    const coordHandler = (data) => {
      if (String(data.session_id) !== String(sessionId)) return
      setAnalysis(data)
      setTriggerMessage(data.reason || '')
    }

    // v1.005: Listen for proactive suggestions (silence nudge, follow-up, etc.)
    const suggestionHandler = (data) => {
      if (String(data.session_id) !== String(sessionId)) return
      setProactiveSuggestion(data)
    }

    // Listen for mode changes (student switches to/from Agent voice)
    // v1.007-04: Clear stale state on mode switch
    const modeHandler = (data) => {
      if (String(data.session_id) === String(sessionId)) {
        setSession(prev => prev ? { ...prev, mode: data.mode } : prev)
        if (data.mode === 'agent') {
          // Entering voice: clear text-mode suggestions (they're stale)
          setSuggestion('')
          setSuggestions([])
          setProactiveSuggestion(null)
        } else if (data.mode === 'text' || data.mode === 'push') {
          // Leaving voice: clear guardian proactive + snapshot (session detached)
          setGuardianProactive(null)
          setGuardianSnapshot(null)
        }
      }
    }

    // v1.007: Guardian daemon updates
    const guardianHandler = (data) => {
      if (String(data.session_id) !== String(sessionId)) return
      setGuardianSnapshot(data)
    }

    // v1.007: Guardian proactive intervention
    const guardianProactiveHandler = (data) => {
      console.log('[Guardian-Proactive] Received:', data, 'current sessionId:', sessionId)
      if (String(data.session_id) !== String(sessionId)) {
        console.log('[Guardian-Proactive] Session mismatch, ignored')
        return
      }
      if (data.autoSent) {
        // Voice mode: already sent automatically, just show notification
        setGuardianProactive({ ...data, status: 'auto_sent' })
        setTimeout(() => setGuardianProactive(null), 10000) // clear after 10s
      } else {
        // Text mode: waiting for teacher action
        setGuardianProactive({ ...data, status: 'pending' })
        console.log('[Guardian-Proactive] Set as pending, should show red card')
      }
    }

    socket.on('student:message', handler)
    socket.on('teacher:message', handler)
    socket.on('coordinator:update', coordHandler)
    socket.on('coordinator:suggestion', suggestionHandler)
    socket.on('session:mode_change', modeHandler)
    socket.on('guardian:update', guardianHandler)
    socket.on('guardian:proactive', guardianProactiveHandler)
    return () => {
      socket.off('connect', ensureJoined)
      socket.off('student:message', handler)
      socket.off('teacher:message', handler)
      socket.off('coordinator:update', coordHandler)
      socket.off('coordinator:suggestion', suggestionHandler)
      socket.off('session:mode_change', modeHandler)
      socket.off('guardian:update', guardianHandler)
      socket.off('guardian:proactive', guardianProactiveHandler)
    }
  }, [sessionId])

  // Auto scroll
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  // Fetch AI suggestion using 4-stage Agent pipeline
  // messageContent: optional, if provided analyze that specific message instead of last student msg
  const fetchSuggestion = useCallback(async (messageContent = null, options = {}) => {
    if (!sessionId) return
    setAiLoading(true)
    setProactiveSuggestion(null) // Clear proactive when manually fetching
    try {
      const res = await api.getAISuggestion(sessionId, messageContent, options)
      const data = res.data || res
      if (data.suggestion) setSuggestion(data.suggestion)
      if (data.suggestions) setSuggestions(data.suggestions) // v1.005
      if (data.analysis) setAnalysis({
        ...data.analysis,
        speculativeHit: data.speculativeHit || false,
        speculativeSavedMs: data.speculativeSavedMs || 0,
      })
      if (data.triggerMessage) setTriggerMessage(data.triggerMessage)
      if (data.suggestionTraceId) setSuggestionTraceId(data.suggestionTraceId) // v1.006
    } catch {
      setSuggestion('')
      setSuggestions([])
      setAnalysis(null)
      setTriggerMessage('')
    } finally {
      setAiLoading(false)
    }
  }, [sessionId])

  // Auto-enable AI panel for voice sessions
  useEffect(() => {
    if (session?.mode === 'agent' && !aiEnabled) {
      setAiEnabled(true)
    }
  }, [session?.mode])

  // Auto-fetch AI suggestion when AI is enabled and last message is from student
  // Skip auto-trigger for voice messages (teacher manually picks which voice msg to analyze)
  // Skip in realtime mode (coordinator updates come via socket, not manual trigger)
  useEffect(() => {
    if (!aiEnabled) return
    if (session?.mode === 'agent') return
    const last = messages[messages.length - 1]
    if (last && (last.sender_type === 'student' || last.type === 'user')) {
      const lastId = last.id || last.message_id
      if (lastId && String(lastId) === String(lastAutoAnalyzedMessageIdRef.current)) return
      const isVoice = last.input_type === 'voice' || last.inputType === 'voice'
      const isRealtimeVoice = last.input_type === 'realtime_voice' || last.inputType === 'realtime_voice'
      if (!isVoice && !isRealtimeVoice) {
        if (lastId) lastAutoAnalyzedMessageIdRef.current = lastId
        fetchSuggestion(null, { triggerMessageId: lastId, ifNotAnalyzed: true })
      }
    }
  }, [messages.length, aiEnabled, session?.mode, fetchSuggestion])

  // Teacher manual send - message appears via WebSocket event (no local add to avoid race condition duplicates)
  async function handleSend(text, inputType = 'text') {
    if (!text?.trim()) return
    setSending(true)
    try {
      await api.teacherSendMessage(sessionId, text.trim(), inputType)
      // Also send as intervention if voice session (ensures student sees it immediately)
      if (session?.mode === 'agent') {
        emitTeacherIntervene(sessionId, text.trim())
      }
      setInputValue('')
    } catch (err) {
      alert('发送失败: ' + err.message)
    } finally {
      setSending(false)
    }
  }

  // AI direct send - message appears via WebSocket event (no local add to avoid race condition duplicates)
  // v1.006: passes trace info for intervention feedback recording
  async function handleDirectSend(text) {
    if (!text?.trim()) return
    setSending(true)
    try {
      const originalSug = suggestion || null
      await api.saveAIReply(sessionId, text.trim(), 'text', analysis?.stage, analysis?.emotion, null, suggestionTraceId, originalSug, suggestions)
      setSuggestion('')
      setSuggestionTraceId(null)
    } catch (err) {
      // Fallback to teacher send
      try {
        await api.teacherSendMessage(sessionId, text.trim(), 'text')
      } catch {}
    } finally {
      setSending(false)
    }
  }

  // AI edit then send (paste into input)
  function handleEditSend(text) {
    setInputValue(text || '')
  }

  // Toggle AI
  function handleToggleAI() {
    const newEnabled = !aiEnabled
    setAiEnabled(newEnabled)
    if (newEnabled && sessionId) {
      const last = messages[messages.length - 1]
      if (last && (last.sender_type === 'student' || last.type === 'user')) {
        fetchSuggestion()
      }
    }
    if (!newEnabled) {
      setSuggestion('')
      setSuggestions([])
      setAnalysis(null)
      setProactiveSuggestion(null)
    }
  }

  const studentName = session?.studentName || session?.student_name || '学生'

  return (
    <div className="h-[calc(100vh-5.5rem)] flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white rounded-t">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/teacher/sessions')} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
            <Icons.Back />
          </button>
          <div>
            <span className="font-medium text-xs text-gray-900">{studentName}</span>
            <span className={`text-[10px] ml-1.5 ${session?.mode === 'agent' ? 'text-cyan-600 font-medium' : 'text-gray-500'}`}>
              {session?.mode === 'agent' ? 'Agent语音(自动)' : '文本咨询'}
            </span>
            {session?.mode === 'agent' && analysis?.stage && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 ml-1">
                {AGENT_NAMES[analysis.stage] || analysis.stage}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setContextPanelOpen(!contextPanelOpen)}
            className={`p-1.5 rounded transition-colors ${contextPanelOpen ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100'}`}
            title={contextPanelOpen ? '关闭学生档案' : '查看学生档案'}
          >
            <Icons.ClipboardList />
          </button>
          <button
            onClick={handleToggleAI}
            className={`p-1.5 rounded transition-colors ${aiEnabled ? 'bg-[#5551ff]/10 text-[#5551ff]' : 'text-gray-400 hover:bg-gray-100'}`}
            title={aiEnabled ? 'AI 已启用 (点击关闭)' : '点击启用AI'}
          >
            <Icons.Sparkles />
          </button>
        </div>
      </div>

      {loadError && (
        <div className="px-3 py-2 bg-red-50 text-xs text-red-600">{loadError}</div>
      )}

      {/* Main content: context panel + messages + Agent panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Student context panel (left side, togglable) */}
        {contextPanelOpen && session?.student_id && (
          <div className="hidden lg:flex w-72 border-r border-gray-200 flex-col flex-shrink-0">
            <StudentContextPanel studentId={session.student_id} />
          </div>
        )}

        {/* Messages area */}
        <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin bg-gray-50/50">
          {messages.map((msg, i) => {
            const isStudent = msg.sender_type === 'student' || msg.type === 'user'
            return isStudent
              ? <StudentBubble key={msg.id || i} msg={msg} aiEnabled={aiEnabled} onAnalyze={fetchSuggestion} />
              : <TeacherBubble key={msg.id || i} msg={msg} />
          })}

          {messages.length === 0 && !loadError && (
            <div className="text-center py-10 text-xs text-gray-400">暂无消息</div>
          )}
        </div>

        {/* Agent control panel (right side, only when AI enabled) */}
        {aiEnabled && (
          <div className="hidden lg:flex w-80 border-l border-gray-200 flex-col flex-shrink-0">
            <AgentPanel
              analysis={analysis}
              suggestion={suggestion}
              suggestions={suggestions}
              triggerMessage={triggerMessage}
              loading={aiLoading}
              onDirectSend={handleDirectSend}
              onEditSend={handleEditSend}
              onRegenerate={fetchSuggestion}
              onReview={async (content) => {
                const res = await api.reviewAISuggestion(sessionId, content)
                return res.data || res
              }}
              onGuidedRegenerate={async (guidance) => {
                setAiLoading(true)
                try {
                  // v1.007-05: pass the current AI draft so Expert knows what teacher was correcting
                  const currentDraft = suggestion || (suggestions?.[0]?.content) || null
                  const res = await api.regenerateWithGuidance(sessionId, guidance, currentDraft)
                  const data = res.data || res
                  if (data.suggestion) setSuggestion(data.suggestion)
                  if (data.suggestions) setSuggestions(data.suggestions)
                  if (data.analysis) setAnalysis(data.analysis)
                } catch (e) { console.error('Guided regenerate failed:', e) }
                finally { setAiLoading(false) }
              }}
              proactiveSuggestion={proactiveSuggestion}
              session={session}
              sessionId={sessionId}
              guardianSnapshot={guardianSnapshot}
              guardianProactive={guardianProactive}
              onGuardianSend={async (content) => {
                try {
                  await api.post('/api/voice/guardian-send', { session_id: sessionId, content })
                  setGuardianProactive(prev => prev ? { ...prev, status: 'sent' } : null)
                  setTimeout(() => setGuardianProactive(null), 3000)
                } catch (e) { console.error('Guardian send failed:', e) }
              }}
              onGuardianIgnore={() => {
                setGuardianProactive(prev => prev ? { ...prev, status: 'ignored' } : null)
                setTimeout(() => setGuardianProactive(null), 3000)
              }}
            />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-3 py-2 border-t border-gray-200 bg-white rounded-b">
        <div className="space-y-1.5">
          <div className="flex items-start gap-1.5">
            <div className="flex-1 relative">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend(inputValue)
                  }
                }}
                placeholder={session?.mode === 'agent' ? '输入文字介入语音会话...' : '输入回复...'}
                rows={1}
                className="input resize-none pr-8"
                style={{ minHeight: '32px', maxHeight: '80px' }}
              />
            </div>
            <button
              onClick={() => handleSend(inputValue)}
              disabled={!inputValue.trim() || sending}
              className="btn-primary p-2 disabled:opacity-50"
            >
              <Icons.Send />
            </button>
          </div>
          {/* Enable AI button */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleAI}
              className={`
                flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors
                ${aiEnabled
                  ? 'bg-[#5551ff]/10 text-[#5551ff] border border-[#5551ff]/20'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200'
                }
              `}
            >
              <Icons.Sparkles />
              {aiEnabled ? 'AI 已启用' : '启用AI'}
            </button>
            {aiEnabled && analysis?.stageName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                {analysis.stageName}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

