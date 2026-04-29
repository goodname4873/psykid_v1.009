/**
 * Situation Analyzer - v1.007 Guardian
 *
 * Analyzes the current conversation situation to produce strategic guidance.
 * This is NOT per-turn coordinator — it's a higher-level "whole conversation" view.
 *
 * Output: situation object with trends, indicators, and next-step hints
 */

const { getDb } = require('../../models/db');
const { callGuardianLLM: callLLM } = require('../ai-client');
const config = require('../runtime/counseling-config');

const SITUATION_PROMPT = `你是心理咨询的态势分析师，不直接回复学生，只分析整段对话的走向。

## 你的任务
根据最近 10-15 条对话和学生画像，输出一个"对话态势"JSON。这不是给学生看的，是给另一个 AI 看的"战略参考"。

## 要分析的维度

1. **情绪趋势 emotionTrend**：
   - '稳定' | '上升' | '下降' | '波动'
   - 看最近几轮情绪强度的变化

2. **情绪当前强度 emotionIntensity**：0-10

3. **话题深度 topicDepth**：
   - 'shallow' = 学生刚开始描述
   - 'middle' = 已经进入细节
   - 'deep' = 已经到核心议题或自我反思

4. **兜圈指标 stuckIndicator**：0-1
   - 学生是否在同一件事上反复绕
   - AI 的建议学生是否在回避或不采纳
   - 对话是否有实质进展

5. **参与度 engagementLevel**：
   - 'low' = 短句/敷衍/想结束
   - 'normal' = 正常问答
   - 'high' = 主动深入/多提问

6. **下一步建议 nextStepHint**：
   一句话（<30字）给下一轮 AI 回复的战略建议。
   例如："学生开始接受，可以深入方法"
   或："学生在兜圈，换个角度切入"
   或："学生情绪升温，先充分共情再说"

7. **likelyNextTurns 学生可能的下一句方向**：
   数组，2-3 个可能方向的简短描述。
   例如：["继续质疑方法可行性", "问更具体的操作", "转移到情绪表达"]

## 输出格式（严格 JSON）

{
  "emotionTrend": "稳定|上升|下降|波动",
  "emotionIntensity": 0-10,
  "topicDepth": "shallow|middle|deep",
  "stuckIndicator": 0.0-1.0,
  "engagementLevel": "low|normal|high",
  "nextStepHint": "一句话战略建议",
  "likelyNextTurns": ["方向1", "方向2", "方向3"]
}`;

/**
 * Analyze current conversation situation.
 * @returns {Object|null} situation object or null on error
 */
async function analyze(sessionId, studentId) {
  try {
    const db = getDb();

    // Load recent 12 messages
    const messages = db.prepare(`
      SELECT sender_type, content, emotion_label, emotion_intensity, created_at
      FROM t_message
      WHERE session_id = ?
      ORDER BY id DESC LIMIT 12
    `).all(sessionId);

    if (messages.length < 2) return null;  // not enough to analyze
    messages.reverse();

    // Load profile summary
    let profileSummary = '';
    try {
      const profile = db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId);
      if (profile) {
        const parts = [];
        if (profile.primary_concerns) parts.push(`核心议题: ${profile.primary_concerns}`);
        if (profile.communication_style) parts.push(`沟通风格: ${profile.communication_style}`);
        if (profile.sensitive_topics) parts.push(`回避话题: ${profile.sensitive_topics}`);
        profileSummary = parts.join('\n');
      }
    } catch (e) { /* profile may not exist */ }

    // Build conversation text with emotion annotations
    const convText = messages.map(m => {
      const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
      const emo = m.emotion_label ? `[${m.emotion_label}/${m.emotion_intensity}]` : '';
      return `${role}${emo}: ${m.content}`;
    }).join('\n');

    const userPrompt = (profileSummary ? `${profileSummary}\n\n` : '') +
      `最近对话:\n${convText}\n\n请输出态势分析 JSON:`;

    const result = await callLLM([
      { role: 'system', content: SITUATION_PROMPT },
      { role: 'user', content: userPrompt },
    ], {
      model: config.coordinatorModel,
      temperature: 0.3,
      max_tokens: 400,
    });

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      emotionTrend: parsed.emotionTrend || '稳定',
      emotionIntensity: typeof parsed.emotionIntensity === 'number' ? parsed.emotionIntensity : 5,
      topicDepth: parsed.topicDepth || 'middle',
      stuckIndicator: typeof parsed.stuckIndicator === 'number' ? parsed.stuckIndicator : 0,
      engagementLevel: parsed.engagementLevel || 'normal',
      nextStepHint: parsed.nextStepHint || '',
      likelyNextTurns: Array.isArray(parsed.likelyNextTurns) ? parsed.likelyNextTurns.slice(0, 3) : [],
    };
  } catch (err) {
    console.error('[Guardian/situation] Analyze error:', err.message);
    return null;
  }
}

module.exports = { analyze };
