/**
 * Continuation Memory Resolver - v1.008
 *
 * Code-level controller for "continue last time / yesterday / earlier" turns.
 * The model may phrase the final response, but it does not decide whether the
 * system has memory. This resolver does that deterministically from four layers:
 *
 * L1 recent messages, L2 current-session memory, L3 cross-session memory,
 * L4 student profile as weak prior only.
 */

const { getDb } = require('../../models/db');

const CONTINUATION_RE = /(继续|接着|上次|上回|上一次|之前|前面|刚才|刚刚|那个|老话题|昨天|昨晚|前天|前几天|上周|上星期|上个月|上轮|上节|上回聊|之前聊|接着聊|继续聊|查一查|查查|再查|你忘了|忘了吗|记得吗|记不记得)/;
const RECENT_RE = /(刚才|刚刚|前面|上轮|上节|接着)/;
const CROSS_TIME_RE = /(昨天|昨晚|前天|前几天|上周|上星期|上个月|上次|上回|上一次|之前)/;
const MEMORY_ANCHOR_RE = /(昨天|昨晚|前天|前几天|上周|上星期|上个月|上次|上回|上一次|之前|老话题|这几天|这段时间|这阵子|前几次|查一查|查查|再查|你忘了|忘了吗|记得吗|记不记得|有没有.*讲过|讲过.*吗|聊过.*吗)/;
const RECENT_CONTEXT_ANCHOR_RE = /(刚才|刚刚|前面|上轮|上节|上一句|上句话|你刚说|你刚才说)/;
const EXPAND_VERB_RE = /(继续|接着|往下|展开|多说|多讲|详细说|细说|具体说|说下去|讲下去|接着说|接着讲|继续说|继续讲|继续聊|然后呢|后面呢|还有呢|举个例|举例子|比如呢|再说点|再讲点)/;
const OBJECT_AFTER_SPEAK_RE = /(继续|接着)(说|讲|聊).{2,}/;
const LOCAL_CONTEXT_WINDOW_MS = 5 * 60 * 1000;

function safeParseJSON(str, fallback = []) {
  if (!str) return fallback;
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTopic(topic) {
  const value = String(topic || '').trim();
  return value.length >= 2 ? value : null;
}

function topicLabel(topic) {
  const value = String(topic || '');
  if (value.includes('古文') || value.includes('文言文') || value.includes('桃花源记')) {
    return '桃花源记/文言文背诵';
  }
  if (value.includes('政治') || value.includes('历史')) {
    return '政治历史那些阶段概念';
  }
  if (value.includes('数学')) {
    return '数学卡题';
  }
  if (value.includes('体育') || value.includes('实心球') || value.includes('踩线')) {
    return '体育中考临场表现';
  }
  if (value.includes('考试') || value.includes('中考')) {
    return '考试紧张和临场发挥';
  }
  return value;
}

function formatTopicLabels(candidates) {
  const labels = [...new Set(candidates.map(c => topicLabel(c.topic)).filter(Boolean))].slice(0, 4);
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return `${labels[0]}，还有${labels[1]}`;
  return `${labels.slice(0, -1).join('、')}，还有${labels[labels.length - 1]}`;
}

function detectContinuationIntent(text) {
  const value = String(text || '').trim();
  if (!value || !CONTINUATION_RE.test(value)) {
    return { intent: false, scope: 'none' };
  }
  if (RECENT_RE.test(value)) return { intent: true, scope: 'recent' };
  if (CROSS_TIME_RE.test(value)) return { intent: true, scope: 'cross_session' };
  return { intent: true, scope: 'general' };
}

function getImmediateContext(sessionId) {
  if (!sessionId) return { hasRecentAi: false, lastAiMsAgo: Infinity, lastAiText: '' };
  try {
    const rows = getDb().prepare(`
      SELECT sender_type, content, created_at
      FROM t_message
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT 8
    `).all(sessionId);
    const lastAi = rows.find(row => row.sender_type === 'ai');
    if (!lastAi) return { hasRecentAi: false, lastAiMsAgo: Infinity, lastAiText: '' };
    const createdAt = new Date(lastAi.created_at).getTime();
    const lastAiMsAgo = Number.isFinite(createdAt) ? Date.now() - createdAt : Infinity;
    return {
      hasRecentAi: lastAiMsAgo <= LOCAL_CONTEXT_WINDOW_MS,
      lastAiMsAgo,
      lastAiText: lastAi.content || '',
    };
  } catch {
    return { hasRecentAi: false, lastAiMsAgo: Infinity, lastAiText: '' };
  }
}

function classifyContinuationRequest(text, sessionId) {
  const value = String(text || '').trim();
  if (!value) return { type: 'none', reason: 'empty' };

  const explicitTopic = inferTopic(value);
  if (explicitTopic) {
    return { type: 'memory', reason: 'explicit_topic', explicitTopic };
  }
  if (MEMORY_ANCHOR_RE.test(value)) {
    return { type: 'memory', reason: 'memory_anchor' };
  }

  const context = getImmediateContext(sessionId);
  const asksToExpand = EXPAND_VERB_RE.test(value);
  const hasRecentAnchor = RECENT_CONTEXT_ANCHOR_RE.test(value);
  const hasObjectAfterSpeak = OBJECT_AFTER_SPEAK_RE.test(value);
  const shortCommand = value.length <= 18;

  if (asksToExpand && shortCommand && !hasObjectAfterSpeak) {
    return { type: 'local_expand', reason: context.hasRecentAi ? 'recent_ai_expand' : 'bare_expand_command', context };
  }
  if (context.hasRecentAi && asksToExpand && hasRecentAnchor) {
    return { type: 'local_expand', reason: 'recent_ai_expand', context };
  }
  if (context.hasRecentAi && hasRecentAnchor && asksToExpand) {
    return { type: 'local_expand', reason: 'recent_anchor_expand', context };
  }

  return { type: 'unknown', reason: asksToExpand ? 'expand_without_context' : 'no_expand_signal', context };
}

function isLocalExpansionRequest(text, sessionId = null) {
  return classifyContinuationRequest(text, sessionId).type === 'local_expand';
}

function inferTopic(text) {
  const value = String(text || '');
  if (!value) return null;

  if (/桃花源记|古文|文言文|小剧场|背诵|朗读|课文/.test(value)) {
    return '语文-古文背诵（桃花源记/小剧场）';
  }
  if (/三大改造|新民主主义|社会主义|1949|1956|改革开放|政治|历史/.test(value)) {
    return '政治历史-阶段概念辨析';
  }
  if (/数学|函数|几何|第22题|第二问|解题|错题/.test(value)) {
    return '数学-解题卡点';
  }
  if (/体育|实心球|踩线/.test(value)) {
    return '体育中考-临场规则与表现';
  }
  if (/考试|中考|二检|排名|月考/.test(value)) {
    return '考试焦虑与临场表现';
  }

  const heading = value.match(/【([^】]{2,32})】/);
  return heading ? heading[1].trim() : null;
}

function sourceWeight(source, scope) {
  const weights = {
    recent: {
      l1_recent: 10,
      l2_rolling: 7,
      l2_thread: 6,
      l2_fragment: 6,
      l3_final: 2,
      l3_fragment: 2,
      l4_profile: 0.5,
    },
    cross_session: {
      l1_recent: 2,
      l2_rolling: 9,
      l2_thread: 8,
      l2_fragment: 8,
      l3_final: 8,
      l3_fragment: 8,
      l4_profile: 1,
    },
    general: {
      l1_recent: 7,
      l2_rolling: 8,
      l2_thread: 7,
      l2_fragment: 7,
      l3_final: 5,
      l3_fragment: 5,
      l4_profile: 1,
    },
  };
  return weights[scope]?.[source] || weights.general[source] || 0;
}

function pushCandidate(candidates, { topic, evidence, source, score }) {
  const normalized = normalizeTopic(topic);
  if (!normalized || score <= 0) return;

  const existing = candidates.get(normalized) || {
    topic: normalized,
    evidence: [],
    sources: new Set(),
    sourceScores: new Map(),
  };

  existing.sources.add(source);
  existing.sourceScores.set(source, Math.max(existing.sourceScores.get(source) || 0, score));

  const cleanEvidence = String(evidence || '').replace(/\s+/g, ' ').trim();
  if (cleanEvidence && !existing.evidence.includes(cleanEvidence)) {
    existing.evidence.push(cleanEvidence.slice(0, 180));
  }

  candidates.set(normalized, existing);
}

function addTextCandidate(candidates, text, source, score) {
  const topic = inferTopic(text);
  if (!topic) return;
  pushCandidate(candidates, { topic, evidence: text, source, score });
}

function getRecentMessages(db, sessionId) {
  return db.prepare(`
    SELECT sender_type, content, created_at
    FROM t_message
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT 24
  `).all(sessionId);
}

function addRecentMessages(candidates, db, sessionId, scope) {
  const rows = getRecentMessages(db, sessionId);
  rows.forEach((row, idx) => {
    const rolePenalty = row.sender_type === 'student' ? 0 : 0.5;
    const score = Math.max(sourceWeight('l1_recent', scope) - idx * 0.35 - rolePenalty, 0);
    addTextCandidate(candidates, row.content, 'l1_recent', score);
  });
}

function addCurrentSessionMemory(candidates, db, sessionId, studentId, scope) {
  const rolling = db.prepare(`
    SELECT raw_summary
    FROM t_session_summary
    WHERE session_id = ? AND summary_type = 'rolling'
    ORDER BY id DESC
    LIMIT 8
  `).all(sessionId);
  rolling.forEach((row, idx) => {
    addTextCandidate(candidates, row.raw_summary, 'l2_rolling', Math.max(sourceWeight('l2_rolling', scope) - idx * 0.5, 0));
  });

  const thread = db.prepare(`
    SELECT key_events, unresolved, strategies_tried, student_quotes
    FROM t_session_thread
    WHERE session_id = ?
  `).get(sessionId);
  for (const field of ['key_events', 'unresolved', 'student_quotes']) {
    for (const item of safeParseJSON(thread?.[field], [])) {
      addTextCandidate(candidates, item, 'l2_thread', sourceWeight('l2_thread', scope));
    }
  }
  for (const item of safeParseJSON(thread?.strategies_tried, [])) {
    const text = typeof item === 'string' ? item : `${item.method || ''} ${item.result || ''}`;
    addTextCandidate(candidates, text, 'l2_thread', sourceWeight('l2_thread', scope));
  }

  const fragments = db.prepare(`
    SELECT text
    FROM t_memory_fragment
    WHERE student_id = ? AND session_id = ?
      AND (status IS NULL OR status IN ('active', 'published'))
      AND (style_contamination_risk IS NULL OR style_contamination_risk != 'high')
    ORDER BY importance DESC, id DESC
    LIMIT 20
  `).all(studentId, sessionId);
  fragments.forEach((row, idx) => {
    addTextCandidate(candidates, row.text, 'l2_fragment', Math.max(sourceWeight('l2_fragment', scope) - idx * 0.2, 0));
  });
}

function addCrossSessionMemory(candidates, db, sessionId, studentId, scope) {
  const finals = db.prepare(`
    SELECT raw_summary
    FROM t_session_summary
    WHERE student_id = ? AND session_id != ? AND summary_type = 'final'
    ORDER BY created_at DESC, id DESC
    LIMIT 6
  `).all(studentId, sessionId);
  finals.forEach((row, idx) => {
    addTextCandidate(candidates, row.raw_summary, 'l3_final', Math.max(sourceWeight('l3_final', scope) - idx * 0.4, 0));
  });

  const fragments = db.prepare(`
    SELECT text
    FROM t_memory_fragment
    WHERE student_id = ? AND (session_id IS NULL OR session_id != ?)
      AND fragment_type IN ('final_summary', 'thread_event', 'student_quote', 'rolling_summary')
      AND (status IS NULL OR status IN ('active', 'published'))
      AND (style_contamination_risk IS NULL OR style_contamination_risk != 'high')
    ORDER BY importance DESC, id DESC
    LIMIT 20
  `).all(studentId, sessionId);
  fragments.forEach((row, idx) => {
    addTextCandidate(candidates, row.text, 'l3_fragment', Math.max(sourceWeight('l3_fragment', scope) - idx * 0.2, 0));
  });
}

function addProfilePrior(candidates, db, studentId, scope) {
  const profile = db.prepare(`
    SELECT primary_concerns, effective_strategies, sensitive_topics
    FROM t_student_profile
    WHERE student_id = ?
  `).get(studentId);
  for (const field of ['primary_concerns', 'effective_strategies', 'sensitive_topics']) {
    for (const item of safeParseJSON(profile?.[field], [])) {
      addTextCandidate(candidates, item, 'l4_profile', sourceWeight('l4_profile', scope));
    }
  }
}

function collectCandidates({ sessionId, studentId, scope }) {
  const db = getDb();
  const candidates = new Map();

  addRecentMessages(candidates, db, sessionId, scope);
  addCurrentSessionMemory(candidates, db, sessionId, studentId, scope);
  addCrossSessionMemory(candidates, db, sessionId, studentId, scope);
  addProfilePrior(candidates, db, studentId, scope);

  return [...candidates.values()]
    .map(c => {
      const sourceEntries = [...c.sourceScores.entries()];
      const baseScore = sourceEntries.reduce((sum, [, score]) => sum + score, 0);
      const factualScore = sourceEntries
        .filter(([source]) => source !== 'l4_profile')
        .reduce((sum, [, score]) => sum + score, 0);
      const reinforcement = Math.min(Math.max(c.evidence.length - 1, 0) * 0.4, 1.2);
      return {
        topic: c.topic,
        score: Math.round((baseScore + reinforcement) * 10) / 10,
        factualScore: Math.round((factualScore + reinforcement) * 10) / 10,
        sources: [...c.sources],
        evidence: c.evidence.slice(0, 2),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function buildPlan({ latestMessage, sessionId, studentId }) {
  const requestKind = classifyContinuationRequest(latestMessage, sessionId);
  if (requestKind.type === 'local_expand') {
    return {
      intent: false,
      action: 'local_expand',
      scope: 'current_turn',
      reason: requestKind.reason,
      candidates: [],
    };
  }

  const intent = detectContinuationIntent(latestMessage);
  if (!intent.intent) {
    return { intent: false, action: 'none', scope: intent.scope, candidates: [] };
  }

  const explicitTopic = inferTopic(latestMessage);
  if (explicitTopic) {
    return {
      intent: true,
      action: 'lock',
      scope: intent.scope,
      topic: explicitTopic,
      evidence: [latestMessage],
      candidates: [{
        topic: explicitTopic,
        score: 99,
        factualScore: 99,
        sources: ['explicit_message'],
        evidence: [String(latestMessage || '').slice(0, 180)],
      }],
    };
  }

  const candidates = collectCandidates({ sessionId, studentId, scope: intent.scope });
  const factualCandidates = candidates.filter(c => c.factualScore >= 4);
  if (factualCandidates.length === 0) {
    return { intent: true, action: 'no_memory', scope: intent.scope, candidates };
  }

  const top = factualCandidates[0];
  const runnerUp = factualCandidates[1];
  const dominant = !runnerUp || top.score >= runnerUp.score + 3 || top.score >= runnerUp.score * 1.35;
  if (dominant) {
    return {
      intent: true,
      action: 'lock',
      scope: intent.scope,
      topic: top.topic,
      evidence: top.evidence,
      candidates,
    };
  }

  return { intent: true, action: 'clarify', scope: intent.scope, candidates: factualCandidates.slice(0, 4) };
}

function buildControlHint(plan) {
  if (!plan?.intent || plan.action !== 'lock') return '';
  const evidence = (plan.evidence || []).join(' / ');
  return [
    '',
    '',
    '【续聊控制】',
    `系统已根据四层记忆检索锁定学生想延续的话题：${plan.topic}`,
    evidence ? `证据：${evidence}` : '',
    '请直接承接这个话题继续；可以轻轻确认，但不要说“我没有记忆”，也不要要求学生从头提醒。',
  ].filter(Boolean).join('\n');
}

function buildDirectReply(plan) {
  if (!plan?.intent) return null;
  if (plan.action === 'clarify') {
    const topicText = formatTopicLabels(plan.candidates);
    return `我翻到几个像是能接上的地方：${topicText}。你刚说想接着聊，更像是哪一块？`;
  }
  if (plan.action === 'no_memory') {
    return '我这边没翻到足够明确的一段，可能是关键词太少了。你给我一个科目、题目或者人名，我马上接上。';
  }
  return null;
}

module.exports = {
  buildPlan,
  buildControlHint,
  buildDirectReply,
  classifyContinuationRequest,
  detectContinuationIntent,
  isLocalExpansionRequest,
  inferTopic,
};


