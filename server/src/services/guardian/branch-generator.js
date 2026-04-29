/**
 * Branch Generator - v1.007 Guardian
 *
 * Given current situation, pre-generate 2-3 possible AI responses for
 * the most likely student next-turn directions.
 *
 * Called by guardian heartbeat. Results stored in guardian state,
 * queried by main runtime via checkPreparedResponse.
 */

const { getDb } = require('../../models/db');
const { callGuardianLLM: callLLM } = require('../ai-client');
const config = require('../runtime/counseling-config');
const { COUNSELOR_SOUL } = require('../runtime/prompt-constants');
const { assembleSuggestionContext } = require('../runtime/context-assembler');

const MAX_BRANCHES = 3;

const BRANCH_PROMPT = `你是小树洞的预备回复生成器。你不面对学生，只为 AI 主管道准备预案。

## 任务
给你一个假设的"学生下一句会说的话"，请你**代入小树洞人格**生成回复。
这个回复将在真实情况匹配时直接播放给学生。

${COUNSELOR_SOUL}

## 特别要求
- 回复必须符合小树洞人格（温暖、简短、像朋友）
- 每条消息不超过 2 句话
- 必须是最自然的直接回复，不要引用"假设"
- ⚠️ 回复必须与最近对话的事实完全一致，发现矛盾宁可不说
- 不知道的事实不要猜测，不要编造学生没提过的事

## 输出格式
严格输出 JSON，不要加解释：
{
  "expectedTopic": "这个预案适用的话题，如 语文-文言文-桃花源记；无法判断则填 null",
  "response": "可以直接发给学生的回复"
}`;

/**
 * Generate multiple branches of prepared responses.
 * @param {number} sessionId
 * @param {number} studentId
 * @param {Object} situation - from situation-analyzer
 * @returns {Array<Object>} branches with { id, condition, response, analysis }
 */
async function generate(sessionId, studentId, situation) {
  if (!situation || !situation.likelyNextTurns || situation.likelyNextTurns.length === 0) {
    return [];
  }

  try {
    // Assemble context once (same as main runtime would)
    const context = assembleSuggestionContext({ sessionId, studentId });
    if (context.recentCount === 0) return [];

    // Generate branches in parallel. The voice fast path only helps if branches
    // are ready before the student answers, so sequential generation is too slow.
    const directions = situation.likelyNextTurns.slice(0, MAX_BRANCHES);
    const results = await Promise.allSettled(
      directions.map((direction, idx) => generateSingleBranch(context, situation, direction, idx))
    );
    return results
      .filter(r => r.status === 'fulfilled' && r.value && r.value.response)
      .map(r => r.value);
  } catch (err) {
    console.error('[Guardian/branch] Generate error:', err.message);
    return [];
  }
}

async function generateSingleBranch(context, situation, direction, idx) {
  try {
    // Build prompt: context + situation + assumed student reply
    const recentConv = context.recentMessages.slice(-6).map(m => {
      const role = m.sender_type === 'student' ? '学生' : 'AI';
      return `${role}: ${m.content}`;
    }).join('\n');

    const userPrompt = `【对话态势】
情绪: ${situation.emotionTrend || '稳定'} (${situation.emotionIntensity || 5}/10)
话题深度: ${situation.topicDepth || 'middle'}
战略建议: ${situation.nextStepHint || ''}

【最近对话】
${recentConv}

【假设学生下一句会】${direction}

请作为小树洞生成对这句话最自然的回复:`;

    const result = await callLLM([
      { role: 'system', content: BRANCH_PROMPT },
      { role: 'user', content: userPrompt },
    ], {
      model: config.guardianGeneratorModel,
      temperature: 0.7,
      max_tokens: 200,
    });

    const parsed = parseBranchOutput(result.content);
    const response = parsed.response;
    if (!response) return null;

    return {
      id: `branch_${idx}`,
      condition: direction,
      expectedTopic: parsed.expectedTopic || inferTopicFromText(`${direction} ${response}`),
      response,
      analysis: {
        stage: inferStageFromDirection(direction, situation),
        emotion: situation.emotionTrend,
      },
      generatedAt: Date.now(),
      model: result.model,
    };
  } catch (err) {
    console.error(`[Guardian/branch] Single branch ${idx} error:`, err.message);
    return null;
  }
}

async function generateFromPartial(sessionId, studentId, partialText, situation = {}) {
  const text = String(partialText || '').trim();
  if (text.length < 8) return null;

  try {
    const context = assembleSuggestionContext({ sessionId, studentId });
    if (context.recentCount === 0) return null;

    const recentConv = context.recentMessages.slice(-6).map(m => {
      const role = m.sender_type === 'student' ? '学生' : 'AI';
      return `${role}: ${m.content}`;
    }).join('\n');

    const userPrompt = `【最近对话】
${recentConv}

【学生正在说，还没结束】
${text}

请你先生成一个低风险、可被核验的候选回复。要求：
- 只回应当前 partial 已经明确的信息
- 不要补充学生还没说完的事实
- 不超过 2 句话
- 输出 JSON：{"expectedTopic":"话题","response":"候选回复"}`;

    const result = await callLLM([
      { role: 'system', content: BRANCH_PROMPT },
      { role: 'user', content: userPrompt },
    ], {
      model: config.guardianGeneratorModel,
      temperature: 0.5,
      max_tokens: 180,
    });

    const parsed = parseBranchOutput(result.content);
    if (!parsed.response) return null;
    return {
      id: `partial_${Date.now()}`,
      condition: text,
      expectedTopic: parsed.expectedTopic || inferTopicFromText(`${text} ${parsed.response}`),
      response: parsed.response,
      analysis: {
        stage: inferStageFromDirection(text, situation),
        emotion: situation.emotionTrend,
      },
      generatedAt: Date.now(),
      model: result.model,
      source: 'partial_asr_draft',
    };
  } catch (err) {
    console.error('[Guardian/branch] Partial draft error:', err.message);
    return null;
  }
}

function parseBranchOutput(content) {
  const text = (content || '').trim();
  if (!text) return { response: '', expectedTopic: null };
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        response: (parsed.response || '').trim(),
        expectedTopic: normalizeTopic(parsed.expectedTopic),
      };
    } catch (e) {}
  }
  return { response: text, expectedTopic: null };
}

function normalizeTopic(topic) {
  if (!topic || topic === 'null' || topic === '未指定' || topic === '无法判断') return null;
  return String(topic).trim() || null;
}

function inferTopicFromText(input) {
  const text = String(input || '');
  if (!text.trim()) return null;

  if (/桃花源记|古文|文言文|背诵|朗读|课文|小剧场/.test(text)) {
    return '语文-古文背诵（桃花源记/小剧场）';
  }
  if (/政治|新民主主义|社会主义|公有制|三大改造|1956|初级阶段|改革开放|公私合营/.test(text)) {
    return '政治历史-阶段概念辨析';
  }
  if (/历史|朝代|时间线|年代|事件/.test(text)) {
    return '历史-时间线与事件辨析';
  }
  if (/数学|函数|几何|方程|解题|错题|第\d+题/.test(text)) {
    return '数学-解题卡点';
  }
  if (/实心球|体育|踩线|中考体育|老师没喊停|跑步|跳远/.test(text)) {
    return '体育中考-临场规则与表现';
  }
  if (/考试|中考|月考|二检|排名|批评|临场|发挥|焦虑|紧张|担心/.test(text)) {
    return '考试焦虑与临场表现';
  }
  if (/同学|玩笑|开玩笑|说我|别人怎么看|发抖|社交|人际/.test(text)) {
    return '人际互动与被评价焦虑';
  }

  const schoolSubjects = ['语文', '数学', '英语', '历史', '政治', '物理', '化学', '生物', '地理'];
  const subject = schoolSubjects.find(s => text.includes(s));
  if (subject) return subject;
  return null;
}

function inferStageFromDirection(direction, situation) {
  const text = direction.toLowerCase();
  if (text.includes('情绪') || text.includes('难过') || text.includes('哭')) return 'listening';
  if (text.includes('质疑') || text.includes('反驳') || text.includes('不认为')) return 'cognitive';
  if (text.includes('方法') || text.includes('怎么做') || text.includes('具体')) return 'action';
  if (text.includes('谢') || text.includes('明白') || text.includes('结束')) return 'closing';
  return situation.stuckIndicator > 0.5 ? 'cognitive' : 'listening';
}

module.exports = { generate, generateFromPartial };
