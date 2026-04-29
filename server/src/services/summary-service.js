/**
 * Summary Service - v1.006
 *
 * Manages rolling and final summaries.
 * Extracted from summary.js for single-responsibility.
 */

const { getDb } = require('../models/db');
const { callLLM } = require('./ai-client');
const { writeRollingFragments, writeFinalFragments } = require('./memory-fragment-writer');

// ==================== Prompts ====================

const ROLLING_SUMMARY_PROMPT = `你是资深心理咨询督导，负责整理咨询记录。将这段对话压缩为事实性摘要。

## 严格禁止
1. 禁止诊断标签（焦虑症、抑郁等）
2. 禁止量化评分（情绪7/10等）
3. 禁止程度判断（轻度/中度/重度）
4. 禁止治疗建议

## 话题归类原则（重要）
- 按学生的"核心困扰"归类，不要按表面现象归类
- 例如：父母盯作业→本质是"学习压力"的延伸，不是独立话题
- 只有真正不相关的新议题才另起话题

## 输出格式
【核心困扰名】2-3句事实描述

不同核心困扰之间空一行。

## 每个困扰包含
- 学生怎么描述的（用学生自己的话）
- 咨询师用了什么方法
- 目前什么状态

## 同时输出结构化 checkpoint JSON（放在摘要后面，用 === 分隔）

===CHECKPOINT===
{
  "main_issue": "核心困扰",
  "trigger_event": "触发事件",
  "student_state": "学生当前状态",
  "intervention_used": "使用的干预方法",
  "intervention_result": "干预效果",
  "pending_item": "待跟进事项",
  "key_quote": "学生关键原话",
  "risk_signal": null
}

## 字数限制
摘要部分200字以内。`;

const FINAL_SUMMARY_PROMPT = `你是心理咨询会话的记录员。将整个对话整理成事实性摘要。

## 严格禁止
1. 禁止诊断标签（焦虑症、抑郁等）
2. 禁止量化评分（情绪7/10等）
3. 禁止程度判断（轻度/中度/重度）
4. 禁止治疗建议
5. 禁止主观推测

## 输出JSON
{
  "topics_discussed": ["话题1", "话题2"],
  "student_expressions": ["学生说的原话1", "原话2"],
  "approaches_tried": ["方法1", "方法2"],
  "unresolved_items": ["未解决1"],
  "session_flow": "2-3句话客观描述对话全过程"
}`;

// ==================== Rolling Summary ====================

async function generateRollingSummary(sessionId) {
  try {
    const db = getDb();

    const session = db.prepare(
      'SELECT id, student_id, message_count FROM t_consult_session WHERE id = ?'
    ).get(sessionId);
    if (!session) return;

    const existingRolling = db.prepare(`
      SELECT id, raw_summary, message_range_end FROM t_session_summary
      WHERE session_id = ? AND summary_type = 'rolling'
      ORDER BY id DESC LIMIT 1
    `).get(sessionId);

    let messagesToSummarize;
    let rangeStart;

    if (existingRolling) {
      messagesToSummarize = db.prepare(`
        SELECT id, sender_type, content FROM t_message
        WHERE session_id = ? AND id > ?
        ORDER BY created_at ASC, id ASC LIMIT 30
      `).all(sessionId, existingRolling.message_range_end);
      rangeStart = existingRolling.message_range_end + 1;
    } else {
      messagesToSummarize = db.prepare(`
        SELECT id, sender_type, content FROM t_message
        WHERE session_id = ?
        ORDER BY created_at ASC, id ASC LIMIT 30
      `).all(sessionId);
      rangeStart = messagesToSummarize.length > 0 ? messagesToSummarize[0].id : 0;
    }

    if (messagesToSummarize.length === 0) return;

    const rangeEnd = messagesToSummarize[messagesToSummarize.length - 1].id;

    const conversationText = messagesToSummarize.map(m => {
      const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
      return `${role}: ${m.content}`;
    }).join('\n');

    const userContent = `对话内容:\n${conversationText}\n\n请按学生的核心困扰归类，压缩为摘要，并输出结构化checkpoint:`;

    const result = await callLLM([
      { role: 'system', content: ROLLING_SUMMARY_PROMPT },
      { role: 'user', content: userContent },
    ], { model: require('./runtime/counseling-config').coordinatorModel, max_tokens: 600, temperature: 0.3 });

    // v1.006: Parse raw_summary and structured checkpoint
    let rawSummary = result.content.trim();
    let checkpoint = null;

    const checkpointMatch = rawSummary.match(/===CHECKPOINT===\s*(\{[\s\S]*\})/);
    if (checkpointMatch) {
      rawSummary = rawSummary.substring(0, rawSummary.indexOf('===CHECKPOINT===')).trim();
      try {
        checkpoint = JSON.parse(checkpointMatch[1]);
      } catch (e) {
        console.log('[Summary] Checkpoint JSON parse failed, skipping');
      }
    }

    const actualTurn = db.prepare(
      'SELECT COUNT(*) as cnt FROM t_message WHERE session_id = ? AND id <= ?'
    ).get(sessionId, rangeEnd).cnt;

    // Store checkpoint in session_flow column (reuse existing column)
    db.prepare(`
      INSERT INTO t_session_summary (
        session_id, student_id, summary_type, trigger_turn,
        raw_summary, session_flow, model_used, message_range_start, message_range_end
      ) VALUES (?, ?, 'rolling', ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId, session.student_id, actualTurn,
      rawSummary, checkpoint ? JSON.stringify(checkpoint) : null,
      result.model, rangeStart, rangeEnd
    );

    const insertedId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    writeRollingFragments(session.student_id, sessionId, insertedId, rawSummary);

    console.log(`[Summary] Rolling summary generated for session ${sessionId} (turn: ${actualTurn})`);
  } catch (err) {
    console.error(`[Summary] Rolling summary error for session ${sessionId}:`, err.message);
  }
}

// ==================== Final Summary ====================

async function generateFinalSummary(sessionId) {
  try {
    const db = getDb();

    const session = db.prepare(
      'SELECT id, student_id, message_count FROM t_consult_session WHERE id = ?'
    ).get(sessionId);
    if (!session) return;

    const rollingCheckpoints = db.prepare(`
      SELECT raw_summary, trigger_turn, message_range_end FROM t_session_summary
      WHERE session_id = ? AND summary_type = 'rolling'
      ORDER BY id ASC
    `).all(sessionId);

    const lastRollingEnd = rollingCheckpoints.length > 0
      ? rollingCheckpoints[rollingCheckpoints.length - 1].message_range_end
      : null;

    let recentMessages;
    if (lastRollingEnd) {
      recentMessages = db.prepare(`
        SELECT sender_type, content FROM t_message
        WHERE session_id = ? AND id > ?
        ORDER BY created_at ASC, id ASC
      `).all(sessionId, lastRollingEnd);
    } else {
      recentMessages = db.prepare(`
        SELECT sender_type, content FROM t_message
        WHERE session_id = ?
        ORDER BY created_at ASC, id ASC LIMIT 30
      `).all(sessionId);
    }

    let userContent = '';
    if (rollingCheckpoints.length > 0) {
      userContent += '对话各阶段摘要:\n';
      rollingCheckpoints.forEach(cp => {
        userContent += `--- 第${cp.trigger_turn}轮 ---\n${cp.raw_summary}\n\n`;
      });
    }
    if (recentMessages.length > 0) {
      const recentText = recentMessages.map(m => {
        const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
        return `${role}: ${m.content}`;
      }).join('\n');
      userContent += `对话最后阶段原文:\n${recentText}\n\n`;
    }
    userContent += '请整理为JSON格式的会话总结:';

    const result = await callLLM([
      { role: 'system', content: FINAL_SUMMARY_PROMPT },
      { role: 'user', content: userContent },
    ], { model: require('./runtime/counseling-config').coordinatorModel, max_tokens: 800, temperature: 0.3 });

    let topics = null, expressions = null, approaches = null, unresolved = null, flow = null;
    let rawSummary = result.content.trim();

    try {
      const jsonMatch = rawSummary.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        topics = JSON.stringify(parsed.topics_discussed || []);
        expressions = JSON.stringify(parsed.student_expressions || []);
        approaches = JSON.stringify(parsed.approaches_tried || []);
        unresolved = JSON.stringify(parsed.unresolved_items || []);
        flow = parsed.session_flow || '';
        rawSummary = flow + ' 话题: ' + (parsed.topics_discussed || []).join('、');
      }
    } catch (parseErr) {
      console.error('[Summary] Final JSON parse error, using raw text:', parseErr.message);
    }

    const firstMsg = db.prepare('SELECT id FROM t_message WHERE session_id = ? ORDER BY id ASC LIMIT 1').get(sessionId);
    const lastMsg = db.prepare('SELECT id FROM t_message WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId);

    db.prepare(`
      INSERT INTO t_session_summary (
        session_id, student_id, summary_type, trigger_turn,
        topics_discussed, student_expressions, approaches_tried,
        unresolved_items, session_flow, raw_summary, model_used,
        message_range_start, message_range_end
      ) VALUES (?, ?, 'final', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId, session.student_id, session.message_count,
      topics, expressions, approaches, unresolved, flow, rawSummary,
      result.model, firstMsg?.id || 0, lastMsg?.id || 0
    );

    const finalId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    const finalRow = db.prepare('SELECT * FROM t_session_summary WHERE id = ?').get(finalId);
    if (finalRow) writeFinalFragments(session.student_id, sessionId, finalId, finalRow);

    console.log(`[Summary] Final summary generated for session ${sessionId}`);
  } catch (err) {
    console.error(`[Summary] Final summary error for session ${sessionId}:`, err.message);
  }
}

module.exports = {
  generateRollingSummary,
  generateFinalSummary,
};
