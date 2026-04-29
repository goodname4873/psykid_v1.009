/**
 * Thread Service - v1.006
 *
 * Manages session thread extraction (structured events, quotes, strategies).
 * Extracted from summary.js for single-responsibility.
 */

const { getDb } = require('../models/db');
const { callLLM } = require('./ai-client');
const { writeThreadFragments } = require('./memory-fragment-writer');

const THREAD_EXTRACT_PROMPT = `你是心理咨询记录分析师。从这段对话中提取结构化信息。

## 严格输出JSON格式

{
  "key_events": ["具体事件，如'和妈妈吵架'、'数学考了45分'"],
  "emotion_shifts": ["情绪变化描述，如'提到妈妈时情绪明显加重'"],
  "unresolved": ["未解决的问题"],
  "strategies_tried": [
    { "method": "策略名称", "result": "有效/无效/未确定" }
  ],
  "student_quotes": ["保留学生的重要原话，不要改写"]
}

## 规则
1. key_events: 只提取具体事件，不要抽象概括
2. student_quotes: 保留学生最有价值的原话（情绪表达、自我认知、关键诉求），最多3条
3. strategies_tried: 咨询师尝试了什么方法，学生反应如何
4. unresolved: 还没解决或需要跟进的问题
5. 如果某个类别没有相关内容，返回空数组`;

async function extractSessionThread(sessionId) {
  try {
    const db = getDb();

    const session = db.prepare(
      'SELECT id, student_id, message_count FROM t_consult_session WHERE id = ?'
    ).get(sessionId);
    if (!session) return;

    let thread = null;
    try {
      thread = db.prepare('SELECT * FROM t_session_thread WHERE session_id = ?').get(sessionId);
    } catch (e) { return; }

    const lastTurn = thread ? thread.last_turn : 0;

    const messages = db.prepare(`
      SELECT id, sender_type, content FROM t_message
      WHERE session_id = ? AND id > ?
      ORDER BY created_at ASC, id ASC LIMIT 30
    `).all(sessionId, lastTurn);

    if (messages.length < 3) return;

    const lastMsgId = messages[messages.length - 1].id;

    const conversationText = messages.map(m => {
      const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
      return `${role}: ${m.content}`;
    }).join('\n');

    let existingContext = '';
    if (thread) {
      const existing = { key_events: JSON.parse(thread.key_events || '[]') };
      if (existing.key_events.length > 0) {
        existingContext = `\n\n已提取的事件(不要重复): ${existing.key_events.join('、')}`;
      }
    }

    const result = await callLLM([
      { role: 'system', content: THREAD_EXTRACT_PROMPT },
      { role: 'user', content: `对话内容:\n${conversationText}${existingContext}\n\n请提取结构化信息:` },
    ], { model: require('./runtime/counseling-config').threadModel, max_tokens: 600, temperature: 0.3 });

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const extracted = JSON.parse(jsonMatch[0]);

    if (thread) {
      const merge = (field, newData) => {
        const old = JSON.parse(thread[field] || '[]');
        const combined = [...old, ...(newData || [])];
        if (combined.length > 0 && typeof combined[0] === 'string') {
          return JSON.stringify([...new Set(combined)]);
        }
        return JSON.stringify(combined);
      };

      db.prepare(`
        UPDATE t_session_thread SET
          key_events = ?, emotion_shifts = ?, unresolved = ?,
          strategies_tried = ?, student_quotes = ?,
          last_turn = ?, updated_at = datetime('now','localtime')
        WHERE session_id = ?
      `).run(
        merge('key_events', extracted.key_events),
        merge('emotion_shifts', extracted.emotion_shifts),
        JSON.stringify(extracted.unresolved || []),
        merge('strategies_tried', extracted.strategies_tried),
        merge('student_quotes', extracted.student_quotes),
        lastMsgId, sessionId
      );
    } else {
      db.prepare(`
        INSERT INTO t_session_thread (
          session_id, student_id, key_events, emotion_shifts,
          unresolved, strategies_tried, student_quotes, last_turn
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId, session.student_id,
        JSON.stringify(extracted.key_events || []),
        JSON.stringify(extracted.emotion_shifts || []),
        JSON.stringify(extracted.unresolved || []),
        JSON.stringify(extracted.strategies_tried || []),
        JSON.stringify(extracted.student_quotes || []),
        lastMsgId
      );
    }

    const updatedThread = db.prepare('SELECT * FROM t_session_thread WHERE session_id = ?').get(sessionId);
    if (updatedThread) writeThreadFragments(session.student_id, sessionId, updatedThread);

    console.log(`[Summary] Thread extracted for session ${sessionId}`);
  } catch (err) {
    console.error(`[Summary] Thread extraction error for session ${sessionId}:`, err.message);
  }
}

module.exports = {
  extractSessionThread,
};
