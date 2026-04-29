/**
 * Profile Service - v1.006
 *
 * Manages student counseling profile updates.
 * Extracted from summary.js. Adds evidence tracking.
 */

const { getDb } = require('../models/db');
const { callLLM } = require('./ai-client');
const { writeProfileFragments } = require('./memory-fragment-writer');

// v1.007: Structured profile with domain/context/evidence per concern
const PROFILE_UPDATE_PROMPT = `根据本次咨询的总结信息，更新学生的咨询画像。

## 输出JSON（仅输出有足够证据更新的字段）

{
  "core_issues": [
    {
      "concern": "核心议题（如'考试紧张'）",
      "domain": "所属领域（如'数学'、'体育'、'人际'、'家庭'）",
      "context": "具体情境（如'体育中考800米跑前腿软'）",
      "evidence": "学生原话或行为证据"
    }
  ],
  "emotion_baseline": "情绪基线描述",
  "communication_style": "沟通风格描述",
  "effective_methods": [
    {
      "method": "方法名称",
      "domain": "适用领域",
      "result": "有效/无效/未确定",
      "evidence": "学生反馈"
    }
  ],
  "avoid_topics": ["需要回避的话题"],
  "risk_history_entry": { "quote": "风险相关原话", "level": "L1/L2/L3" },
  "confidence": 0.8
}

## 规则
- core_issues 必须标注 domain（如'数学'、'体育'、'情绪管理'），不要笼统写'考试'
- effective_methods 必须标注适用领域和结果
- 只输出有变化的字段
- confidence 0-1`;

async function updateStudentProfile(sessionId, studentId) {
  try {
    const db = getDb();

    const summary = db.prepare(`
      SELECT * FROM t_session_summary
      WHERE session_id = ? AND summary_type = 'final'
      ORDER BY id DESC LIMIT 1
    `).get(sessionId);

    let thread = null;
    try {
      thread = db.prepare('SELECT * FROM t_session_thread WHERE session_id = ?').get(sessionId);
    } catch (e) { /* table may not exist */ }

    if (!summary && !thread) return;

    // Build input
    let input = '';
    if (summary) {
      input += `会话总结:\n`;
      if (summary.topics_discussed) input += `话题: ${summary.topics_discussed}\n`;
      if (summary.student_expressions) input += `学生原话: ${summary.student_expressions}\n`;
      if (summary.approaches_tried) input += `尝试方法: ${summary.approaches_tried}\n`;
      if (summary.unresolved_items) input += `未解决: ${summary.unresolved_items}\n`;
      if (summary.session_flow) input += `过程: ${summary.session_flow}\n`;
    }
    if (thread) {
      input += `\n线索追踪:\n`;
      if (thread.key_events) input += `关键事件: ${thread.key_events}\n`;
      if (thread.strategies_tried) input += `策略效果: ${thread.strategies_tried}\n`;
      if (thread.student_quotes) input += `学生原话: ${thread.student_quotes}\n`;
    }

    const result = await callLLM([
      { role: 'system', content: PROFILE_UPDATE_PROMPT },
      { role: 'user', content: input },
    ], { model: require('./runtime/counseling-config').profileModel, max_tokens: 500, temperature: 0.3 });

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const update = JSON.parse(jsonMatch[0]);

    // v1.006: Log evidence and confidence
    if (update.evidence || update.confidence) {
      console.log(`[Profile] Evidence: ${update.evidence || 'none'}, Confidence: ${update.confidence || '?'}`);
    }

    // Skip low-confidence updates
    if (update.confidence !== undefined && update.confidence < 0.4) {
      console.log(`[Profile] Skipping update for student ${studentId}: confidence too low (${update.confidence})`);
      return;
    }

    let profile = null;
    try {
      profile = db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId);
    } catch (e) { return; }

    if (profile) {
      const mergeJson = (existing, newData) => {
        if (!newData || !newData.length) return existing;
        const old = JSON.parse(existing || '[]');
        return JSON.stringify([...new Set([...old, ...newData])]);
      };

      const updates = {};
      if (update.core_issues) updates.primary_concerns = mergeJson(profile.primary_concerns, update.core_issues);
      if (update.emotion_baseline) updates.emotional_pattern = update.emotion_baseline;
      if (update.communication_style) updates.communication_style = update.communication_style;
      if (update.effective_methods) updates.effective_strategies = mergeJson(profile.effective_strategies, update.effective_methods);
      if (update.avoid_topics) updates.sensitive_topics = mergeJson(profile.sensitive_topics, update.avoid_topics);
      if (update.coping_style) updates.coping_style = update.coping_style;

      if (update.risk_history_entry) {
        updates.current_risk_level = update.risk_history_entry.level || profile.current_risk_level;
        const noteDate = new Date().toISOString().split('T')[0];
        const existingNotes = profile.risk_notes || '';
        updates.risk_notes = `${existingNotes}\n[${noteDate}] [${update.risk_history_entry.level}] "${update.risk_history_entry.quote}"`.trim();
      }

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);
        db.prepare(`UPDATE t_student_profile SET ${setClauses} WHERE student_id = ?`).run(...values, studentId);
      }
    } else {
      db.prepare(`
        INSERT INTO t_student_profile (
          student_id, primary_concerns, emotional_pattern, communication_style,
          effective_strategies, sensitive_topics, coping_style
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        studentId,
        JSON.stringify(update.core_issues || []),
        update.emotion_baseline || null,
        update.communication_style || null,
        JSON.stringify(update.effective_methods || []),
        JSON.stringify(update.avoid_topics || []),
        update.coping_style || null
      );
    }

    const updatedProfile = db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId);
    if (updatedProfile) writeProfileFragments(studentId, updatedProfile);

    console.log(`[Profile] Student profile updated for student ${studentId}`);
  } catch (err) {
    console.error(`[Profile] Profile update error for student ${studentId}:`, err.message);
  }
}

module.exports = {
  updateStudentProfile,
};
