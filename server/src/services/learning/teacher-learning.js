/**
 * TeacherLearning - v1.008
 *
 * Converts teacher feedback evidence into governed draft strategy fragments.
 * It never publishes global policy automatically.
 */

const crypto = require('crypto');
const { getDb } = require('../../models/db');
const { callReviewLLM } = require('../ai-client');
const config = require('../runtime/counseling-config');

const SYSTEM_PROMPT = `你是小树洞系统的教师反馈学习审查员。

你的任务是从教师纠偏中提炼"可学习的策略意图"，不是复制教师人格或措辞。

严格输出 JSON:
{
  "learnable": true,
  "category": "strategy|boundary|fact|style_preference|unsafe",
  "scenario": "什么场景下适用",
  "avoid": "以后要避免什么",
  "prefer": "以后更推荐什么",
  "scope": "student_teacher|teacher_local|domain_candidate",
  "style_contamination_risk": "low|medium|high",
  "confidence": 0.0
}

规则：
- 单个老师的反馈默认只能是 student_teacher 或 teacher_local。
- 不要把教师原话当模板。
- 如果只是个人口吻偏好，category=style_preference 且 risk=high。
- 如果不值得学习，learnable=false。`;

function enqueueFromFeedback(feedbackId) {
  setTimeout(() => {
    processFeedback(feedbackId).catch(err => {
      console.error('[TeacherLearning] process failed:', err.message);
    });
  }, 0);
}

async function processFeedback(feedbackId) {
  const db = getDb();
  const feedback = db.prepare('SELECT * FROM t_intervention_feedback WHERE id = ?').get(feedbackId);
  if (!feedback) return null;

  if (!['edited', 'ignored', 'teacher_guidance'].includes(feedback.teacher_action)) {
    markFeedback(db, feedbackId, 'skipped', null);
    return null;
  }

  const extraction = await extractLearning(feedback);
  if (!extraction.learnable) {
    markFeedback(db, feedbackId, 'rejected', null);
    return null;
  }

  if (extraction.style_contamination_risk === 'high' || extraction.category === 'style_preference') {
    markFeedback(db, feedbackId, 'pending_review', null);
    return null;
  }

  const text = renderStrategyText(extraction);
  const tags = [extraction.category, extraction.scenario, extraction.avoid, extraction.prefer]
    .filter(Boolean)
    .flatMap(extractTags)
    .slice(0, 10);
  const contentHash = crypto.createHash('sha256')
    .update(`${feedback.student_id}|${feedback.teacher_id || ''}|${text}`)
    .digest('hex')
    .substring(0, 16);

  const result = db.prepare(`
    INSERT INTO t_memory_fragment (
      student_id, session_id, fragment_type, text, tags, tags_json, importance,
      content_hash, memory_tier, source_table, source_id,
      scope, status, teacher_id, learning_category, style_contamination_risk, expert_confidence
    ) VALUES (?, ?, 'teacher_learning_strategy', ?, ?, ?, ?, ?, 'session',
      't_intervention_feedback', ?, ?, 'draft', ?, ?, ?, ?)
  `).run(
    feedback.student_id,
    feedback.session_id,
    text,
    tags.join(','),
    JSON.stringify(tags),
    Math.min(Math.max(extraction.confidence || 0.6, 0.3), 0.85),
    contentHash,
    feedback.id,
    extraction.scope || 'student_teacher',
    feedback.teacher_id || null,
    extraction.category || 'strategy',
    extraction.style_contamination_risk || 'medium',
    extraction.confidence || 0.6,
  );

  markFeedback(db, feedbackId, 'draft_created', result.lastInsertRowid);
  return result.lastInsertRowid;
}

async function extractLearning(feedback) {
  if (config.reviewApiKey) {
    try {
      const result = await callReviewLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(feedback) },
      ], {
        model: config.reviewModel,
        temperature: 0.2,
        max_tokens: 500,
      });
      const json = result.content.match(/\{[\s\S]*\}/);
      if (json) return normalizeExtraction(JSON.parse(json[0]));
    } catch (err) {
      console.warn('[TeacherLearning] Expert extraction fallback:', err.message);
    }
  }
  return heuristicExtraction(feedback);
}

function buildUserPrompt(feedback) {
  return `【AI 原建议】
${feedback.suggestion_content || ''}

【教师最终内容 / 编辑内容】
${feedback.edited_content || ''}

【教师动作】
${feedback.teacher_action}

请提炼可学习策略。`;
}

function heuristicExtraction(feedback) {
  const original = feedback.suggestion_content || '';
  const edited = feedback.edited_content || '';
  if (!edited || edited === original) {
    return { learnable: false };
  }
  return normalizeExtraction({
    learnable: true,
    category: 'strategy',
    scenario: '教师编辑过 AI 回复的相似咨询场景',
    avoid: summarize(original) || '沿用被教师修改的回应方式',
    prefer: summarize(edited) || '参考教师修改后的策略意图',
    scope: 'student_teacher',
    style_contamination_risk: 'medium',
    confidence: 0.55,
  });
}

function normalizeExtraction(raw) {
  const category = raw.category || 'strategy';
  return {
    learnable: raw.learnable === true || raw.learnable === 'true',
    category,
    scenario: clean(raw.scenario),
    avoid: clean(raw.avoid),
    prefer: clean(raw.prefer),
    scope: ['student_teacher', 'teacher_local', 'domain_candidate'].includes(raw.scope)
      ? raw.scope
      : 'student_teacher',
    style_contamination_risk: ['low', 'medium', 'high'].includes(raw.style_contamination_risk)
      ? raw.style_contamination_risk
      : 'medium',
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.6,
  };
}

function renderStrategyText(extraction) {
  return [
    `[场景] ${extraction.scenario || '相似咨询场景'}`,
    `[避免] ${extraction.avoid || '重复被纠偏的回应方式'}`,
    `[推荐] ${extraction.prefer || '采用更贴合学生当下表达的回应策略'}`,
  ].join('\n');
}

function markFeedback(db, feedbackId, status, fragmentId) {
  try {
    db.prepare('UPDATE t_intervention_feedback SET learning_status = ?, learning_fragment_id = ? WHERE id = ?')
      .run(status, fragmentId || null, feedbackId);
  } catch (e) {}
}

function clean(value) {
  return String(value || '').trim().substring(0, 240);
}

function summarize(value) {
  return clean(value).replace(/\s+/g, ' ').substring(0, 80);
}

function extractTags(value) {
  const text = clean(value).replace(/[，。！？、；：""''（）\s\n.!?,;:]+/g, '');
  const tags = [];
  for (let i = 0; i < text.length - 1 && tags.length < 4; i++) {
    tags.push(text.substring(i, i + 2));
  }
  return tags;
}

module.exports = {
  enqueueFromFeedback,
  processFeedback,
};
