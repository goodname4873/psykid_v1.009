/**
 * Summary Service - v1.006 Re-export Hub
 *
 * Original monolithic summary.js has been split into:
 *   - summary-service.js  (rolling + final summaries)
 *   - thread-service.js   (session thread extraction)
 *   - profile-service.js  (student profile updates)
 *
 * This file re-exports everything for backward compatibility.
 * Existing callers (message.js, session.js, ai.js) don't need to change imports.
 *
 * Legacy buildCoordinatorContext is kept here since it's being phased out
 * in favor of context-assembler.js.
 */

const { generateRollingSummary, generateFinalSummary } = require('./summary-service');
const { extractSessionThread } = require('./thread-service');
const { updateStudentProfile } = require('./profile-service');

// ==================== Legacy Context Builder ====================
// Kept for backward compat; new code should use runtime/context-assembler.js

const { getDb } = require('../models/db');

function buildCoordinatorContextV2(sessionId, studentId) {
  const db = getDb();
  const parts = [];

  try {
    const profile = db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId);
    if (profile) {
      const pp = ['== 学生画像 =='];
      if (profile.communication_style) pp.push(`沟通风格: ${profile.communication_style}`);
      if (profile.primary_concerns) {
        const issues = JSON.parse(profile.primary_concerns || '[]');
        if (issues.length) pp.push(`核心议题: ${issues.join('、')}`);
      }
      if (profile.effective_strategies) {
        const methods = JSON.parse(profile.effective_strategies || '[]');
        if (methods.length) pp.push(`有效方法: ${methods.join('、')}`);
      }
      if (profile.sensitive_topics) {
        const avoids = JSON.parse(profile.sensitive_topics || '[]');
        if (avoids.length) pp.push(`注意回避: ${avoids.join('、')}`);
      }
      if (profile.emotional_pattern) pp.push(`情绪基线: ${profile.emotional_pattern}`);
      if (pp.length > 1) parts.push(pp.join('\n'));
    }
  } catch (e) { /* table may not exist */ }

  const prevSummaries = db.prepare(`
    SELECT raw_summary, created_at FROM t_session_summary
    WHERE student_id = ? AND summary_type = 'final' AND session_id != ?
    ORDER BY created_at DESC LIMIT 3
  `).all(studentId, sessionId);
  prevSummaries.reverse();
  if (prevSummaries.length > 0) {
    parts.push('== 之前咨询记录 ==');
    prevSummaries.forEach(s => parts.push(s.raw_summary));
  }

  try {
    const thread = db.prepare('SELECT * FROM t_session_thread WHERE session_id = ?').get(sessionId);
    if (thread) {
      const tp = ['== 本次对话线索 =='];
      const events = JSON.parse(thread.key_events || '[]');
      if (events.length) tp.push(`关键事件: ${events.join('、')}`);
      const shifts = JSON.parse(thread.emotion_shifts || '[]');
      if (shifts.length) tp.push(`情绪变化: ${shifts.join('、')}`);
      const quotes = JSON.parse(thread.student_quotes || '[]');
      if (quotes.length) tp.push(`学生原话: "${quotes.join('" / "')}"`);
      const unresolved = JSON.parse(thread.unresolved || '[]');
      if (unresolved.length) tp.push(`未解决: ${unresolved.join('、')}`);
      const strategies = JSON.parse(thread.strategies_tried || '[]');
      if (strategies.length) {
        tp.push(`已尝试: ${strategies.map(s => typeof s === 'object' ? `${s.method}(${s.result})` : s).join('、')}`);
      }
      if (tp.length > 1) parts.push(tp.join('\n'));
    }
  } catch (e) { /* table may not exist */ }

  const rollingCheckpoints = db.prepare(`
    SELECT raw_summary, trigger_turn FROM t_session_summary
    WHERE session_id = ? AND summary_type = 'rolling' ORDER BY id ASC
  `).all(sessionId);
  if (rollingCheckpoints.length > 0) {
    parts.push('== 本次对话早期摘要 ==');
    rollingCheckpoints.forEach(cp => parts.push(cp.raw_summary));
  }

  const recentMessages = db.prepare(`
    SELECT sender_type, content FROM t_message
    WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 8
  `).all(sessionId);
  recentMessages.reverse();
  parts.push('== 最近对话 ==');
  parts.push(recentMessages.map(m => {
    const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
    return `${role}: ${m.content}`;
  }).join('\n'));

  return {
    contextText: parts.join('\n\n'),
    crossSessionCount: prevSummaries.length,
    hasRolling: rollingCheckpoints.length > 0,
    recentCount: recentMessages.length,
  };
}

module.exports = {
  generateRollingSummary,
  generateFinalSummary,
  extractSessionThread,
  updateStudentProfile,
  buildCoordinatorContext: buildCoordinatorContextV2,
};
