/**
 * Context Assembler - v1.006
 *
 * Assembles structured context for a suggestion turn.
 * Replaces the inline context gathering scattered across ai.js routes.
 *
 * Responsibilities:
 * - Load recent messages, rolling summaries, cross-session finals
 * - Load session thread and student profile
 * - Output structured context object (not a prompt string)
 * - Estimate token usage
 *
 * Does NOT: generate prompts, call LLM, write traces
 */

const { getDb } = require('../../models/db');
const config = require('./counseling-config');
const { retrieveRelevantMemory, renderFragmentsAsContext } = require('./memory-retrieval');

/**
 * Assemble all context needed for a suggestion turn.
 *
 * v1.006: Uses fragment retrieval when available, falls back to legacy full-injection.
 *
 * @param {Object} params
 * @param {number} params.sessionId
 * @param {number} params.studentId
 * @param {string} [params.latestMessage] - Override for the latest student message
 * @returns {Object} Structured context
 */
function assembleSuggestionContext({ sessionId, studentId, latestMessage }) {
  const db = getDb();

  // --- Recent messages (Layer 1, always direct query) ---
  const recentMessages = getRecentMessages(db, sessionId, config.recentMessageLimit);

  // --- Determine latest student message ---
  let studentMessage = latestMessage;
  if (!studentMessage) {
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      if (recentMessages[i].sender_type === 'student') {
        studentMessage = recentMessages[i].content;
        break;
      }
    }
  }

  // --- Try fragment-based retrieval (v1.006) ---
  const { fragments, usedFragmentIds } = retrieveRelevantMemory({
    studentId, sessionId, latestMessage: studentMessage, limit: config.fragmentRetrievalLimit,
  });
  const useFragments = fragments.length > 0;

  // --- Session memory (Layer 2): thread + rolling summaries ---
  const sessionThread = getSessionThread(db, sessionId);
  const rollingCheckpoints = getRollingCheckpoints(db, sessionId);

  // --- Cross-session memory (Layer 3): final summaries ---
  const crossSessionSummaries = getCrossSessionSummaries(db, studentId, sessionId, 3);

  // --- Student profile (Layer 4) ---
  const profile = getStudentProfile(db, studentId);

  // --- Session info ---
  const session = db.prepare(`
    SELECT cs.*, s.name as student_name, s.grade, s.class_name
    FROM t_consult_session cs
    LEFT JOIN t_student s ON cs.student_id = s.id
    WHERE cs.id = ?
  `).get(sessionId);

  const studentInfo = session
    ? `${session.student_name || ''}，${session.grade || ''}${session.class_name || ''}`
    : '';

  // --- Build contextText ---
  // v1.006: Use fragment-based context when fragments exist, otherwise legacy full-injection
  let contextText;
  if (useFragments) {
    // Fragment-based: rendered fragments + recent messages
    const fragmentContext = renderFragmentsAsContext(fragments);
    const recentText = '== 最近对话 ==\n' + recentMessages.map(m => {
      const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
      return `${role}: ${m.content}`;
    }).join('\n');
    contextText = fragmentContext ? `${fragmentContext}\n\n${recentText}` : recentText;
  } else {
    // Legacy full-injection fallback
    contextText = buildContextText({
      profile, crossSessionSummaries, sessionThread, rollingCheckpoints, recentMessages,
    });
  }

  // --- Trace payload (records what was used) ---
  const tracePayload = {
    recentMessageIds: recentMessages.map(m => m.id),
    usedRollingIds: rollingCheckpoints.map(c => c.id),
    usedFinalIds: crossSessionSummaries.map(s => s.id),
    usedThreadFields: sessionThread ? Object.keys(sessionThread).filter(k => sessionThread[k]) : [],
    usedProfileFields: profile ? Object.keys(profile).filter(k => profile[k] && k !== 'id' && k !== 'student_id') : [],
    usedMemoryFragmentIds: usedFragmentIds,
    retrievalMode: useFragments ? 'fragment' : 'legacy',
  };

  // --- Rough token estimate (1 Chinese char ≈ 1.5 tokens) ---
  const tokenEstimate = Math.ceil(contextText.length * 1.5);

  return {
    session,
    studentInfo,
    studentMessage,
    recentMessages,
    sessionThread,
    rollingCheckpoints,
    crossSessionSummaries,
    profile,
    contextText,
    tracePayload,
    tokenEstimate,
    recentCount: recentMessages.length,
    crossSessionCount: crossSessionSummaries.length,
    hasRolling: rollingCheckpoints.length > 0,
  };
}

// ==================== Data fetchers ====================

function getRecentMessages(db, sessionId, limit = 8) {
  const msgs = db.prepare(`
    SELECT id, sender_type, content, created_at FROM t_message
    WHERE session_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(sessionId, limit);
  msgs.reverse(); // chronological order
  return msgs;
}

function getSessionThread(db, sessionId) {
  try {
    return db.prepare('SELECT * FROM t_session_thread WHERE session_id = ?').get(sessionId) || null;
  } catch (e) {
    return null;
  }
}

function getRollingCheckpoints(db, sessionId) {
  return db.prepare(`
    SELECT id, raw_summary, trigger_turn FROM t_session_summary
    WHERE session_id = ? AND summary_type = 'rolling'
    ORDER BY id ASC
  `).all(sessionId);
}

function getCrossSessionSummaries(db, studentId, currentSessionId, limit = 3) {
  const summaries = db.prepare(`
    SELECT id, raw_summary, created_at FROM t_session_summary
    WHERE student_id = ? AND summary_type = 'final'
    AND session_id != ?
    ORDER BY created_at DESC LIMIT ?
  `).all(studentId, currentSessionId, limit);
  summaries.reverse();
  return summaries;
}

function getStudentProfile(db, studentId) {
  try {
    return db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId) || null;
  } catch (e) {
    return null;
  }
}

// ==================== Context text builder (legacy compat) ====================

function buildContextText({ profile, crossSessionSummaries, sessionThread, rollingCheckpoints, recentMessages }) {
  const parts = [];

  // Layer 4: Profile
  if (profile) {
    const pp = ['== 学生画像 =='];
    if (profile.communication_style) pp.push(`沟通风格: ${profile.communication_style}`);
    if (profile.primary_concerns) {
      const issues = safeParseJSON(profile.primary_concerns, []);
      if (issues.length) pp.push(`核心议题: ${issues.join('、')}`);
    }
    if (profile.effective_strategies) {
      const methods = safeParseJSON(profile.effective_strategies, []);
      if (methods.length) pp.push(`有效方法: ${methods.join('、')}`);
    }
    if (profile.sensitive_topics) {
      const avoids = safeParseJSON(profile.sensitive_topics, []);
      if (avoids.length) pp.push(`注意回避: ${avoids.join('、')}`);
    }
    if (profile.emotional_pattern) pp.push(`情绪基线: ${profile.emotional_pattern}`);
    if (pp.length > 1) parts.push(pp.join('\n'));
  }

  // Layer 3: Cross-session
  if (crossSessionSummaries.length > 0) {
    parts.push('== 之前咨询记录 ==');
    crossSessionSummaries.forEach(s => parts.push(s.raw_summary));
  }

  // Layer 2: Thread + rolling
  if (sessionThread) {
    const tp = ['== 本次对话线索 =='];
    const events = safeParseJSON(sessionThread.key_events, []);
    if (events.length) tp.push(`关键事件: ${events.join('、')}`);
    const shifts = safeParseJSON(sessionThread.emotion_shifts, []);
    if (shifts.length) tp.push(`情绪变化: ${shifts.join('、')}`);
    const quotes = safeParseJSON(sessionThread.student_quotes, []);
    if (quotes.length) tp.push(`学生原话: "${quotes.join('" / "')}"`);
    const unresolved = safeParseJSON(sessionThread.unresolved, []);
    if (unresolved.length) tp.push(`未解决: ${unresolved.join('、')}`);
    const strategies = safeParseJSON(sessionThread.strategies_tried, []);
    if (strategies.length) {
      const stratText = strategies.map(s =>
        typeof s === 'object' ? `${s.method}(${s.result})` : s
      ).join('、');
      tp.push(`已尝试: ${stratText}`);
    }
    if (tp.length > 1) parts.push(tp.join('\n'));
  }

  if (rollingCheckpoints.length > 0) {
    parts.push('== 本次对话早期摘要 ==');
    rollingCheckpoints.forEach(cp => parts.push(cp.raw_summary));
  }

  // Layer 1: Recent messages
  parts.push('== 最近对话 ==');
  parts.push(recentMessages.map(m => {
    const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
    return `${role}: ${m.content}`;
  }).join('\n'));

  return parts.join('\n\n');
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = {
  assembleSuggestionContext,
};



