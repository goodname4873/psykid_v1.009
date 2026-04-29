/**
 * Branch Matcher - v1.007 Guardian
 *
 * Given the actual student message + prepared branches, determines
 * which branch (if any) matches semantically.
 *
 * Uses the configured Guardian matcher model for fast semantic classification.
 * This REPLACES the old keyword-based matching in speculative-engine.
 */

const { callGuardianLLM: callLLM } = require('../ai-client');
const config = require('../runtime/counseling-config');

const MATCH_PROMPT = `你是语义分类器。判断学生的实际发言属于哪个预设分支。

## 规则
- 只看"方向"和"情绪类别"，不看字面词语
- "学生质疑方法" 和 "学生说这个没用" 应该算同一方向
- "学生继续诉说情绪" 和 "学生进入新话题" 算不同方向
- 只要主要情绪和意图类似就算匹配
- 如果明显不属于任何分支，返回 -1

## 输出
严格 JSON:
{"branchIndex": 0-based数字或-1, "confidence": 0-1, "reason": "简短原因"}`;

/**
 * Match a student message to prepared branches.
 * @param {string} actualText - student's actual message
 * @param {Array} branches - prepared branches from guardian state
 * @param {Object} situation - current situation (for context)
 * @returns {Object|null} { branchId, confidence, reason } or null
 */
async function match(actualText, branches, situation) {
  if (!actualText || !branches || branches.length === 0) return null;

  try {
    const branchList = branches.map((b, i) => `${i}: ${b.condition}`).join('\n');

    const userPrompt = `【预设分支】
${branchList}

【学生实际发言】
${actualText}

${situation?.emotionTrend ? `【当前对话情绪】${situation.emotionTrend} (${situation.emotionIntensity || '?'}/10)\n` : ''}
判断属于哪个分支，输出 JSON:`;

    const result = await callLLM([
      { role: 'system', content: MATCH_PROMPT },
      { role: 'user', content: userPrompt },
    ], {
      model: config.guardianMatcherModel,  // nano - fast
      temperature: 0.2,
      max_tokens: 150,
    });

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const idx = parsed.branchIndex;
    if (typeof idx !== 'number' || idx < 0 || idx >= branches.length) return null;

    return {
      branchId: branches[idx].id,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reason: parsed.reason || '',
    };
  } catch (err) {
    console.error('[Guardian/match] Match error:', err.message);
    return null;
  }
}

module.exports = { match };
