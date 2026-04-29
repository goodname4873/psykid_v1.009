/**
 * Prompt Assembler - v1.006
 *
 * Builds coordinator and suggestion prompts from structured context.
 * Single place where context sections get rendered into prompt strings.
 *
 * Responsibilities:
 * - Build coordinator system+user prompt from context
 * - Build suggestion system prompt from context + analysis result
 *
 * Does NOT: query DB, call LLM, write traces
 */

const config = require('./counseling-config');
const {
  COUNSELOR_SOUL,
  COORDINATOR_PROMPT,
  SKILL_WEIGHT_GUIDE,
} = require('./prompt-constants');

/**
 * Build the coordinator prompt (system + user messages).
 *
 * @param {Object} params
 * @param {Object} params.context - Output from context-assembler
 * @param {string} params.latestMessage - Student's latest message
 * @returns {Object} { systemPrompt, userPrompt }
 */
function assembleCoordinatorPrompt({ context, latestMessage }) {
  const systemPrompt = COORDINATOR_PROMPT;

  // Build user prompt with profile + context + latest message
  let userPrompt = '';

  if (context.studentInfo) {
    userPrompt += `学生信息: ${context.studentInfo}\n\n`;
  }

  // Inject profile summary for coordinator
  if (context.profile) {
    const profileParts = [];
    if (context.profile.communication_style) profileParts.push(`沟通风格: ${context.profile.communication_style}`);
    if (context.profile.effective_strategies) {
      const methods = safeParseJSON(context.profile.effective_strategies, []);
      if (methods.length) profileParts.push(`有效方法: ${methods.join('、')}`);
    }
    if (context.profile.sensitive_topics) {
      const avoids = safeParseJSON(context.profile.sensitive_topics, []);
      if (avoids.length) profileParts.push(`注意回避: ${avoids.join('、')}`);
    }
    if (profileParts.length) userPrompt += `【学生画像】\n${profileParts.join('\n')}\n\n`;
  }

  userPrompt += `${context.contextText}\n\n学生最新消息: ${latestMessage}\n\n请分析并输出JSON:`;

  return { systemPrompt, userPrompt };
}

/**
 * Build the suggestion generation prompt (system prompt for the chat model).
 *
 * @param {Object} params
 * @param {Object} params.context - Output from context-assembler
 * @param {Object} params.analysis - Coordinator analysis result (skillWeights, emotion, guidance, mirrorCues)
 * @param {string} [params.teacherGuidance] - v1.007-04: teacher direction hint for regeneration
 * @returns {Object} { systemPrompt, chatMessages }
 */
function assembleSuggestionPrompt({ context, analysis, teacherGuidance }) {
  let systemPrompt = COUNSELOR_SOUL;

  // Skill weight description
  if (analysis.skillWeights) {
    const w = analysis.skillWeights;
    const weightParts = Object.entries(w)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => {
        const names = { empathy: '共情倾听', cognitive: '认知引导', action: '行动建议', closing: '结束巩固' };
        return `${names[k] || k}: ${Math.round(v * 100)}%`;
      })
      .join('，');
    systemPrompt += `\n\n【本轮技能侧重】${weightParts}\n${SKILL_WEIGHT_GUIDE}`;
  }

  // Coordinator strategy
  if (analysis.guidance) systemPrompt += `\n策略: ${analysis.guidance}`;
  if (analysis.emotion && typeof analysis.emotion === 'object') {
    systemPrompt += `\n当前情绪: ${analysis.emotion.primary} (${analysis.emotion.intensity}/10, ${analysis.emotion.trend})`;
  }
  if (analysis.mirrorCues) systemPrompt += `\n语言风格匹配: ${analysis.mirrorCues}`;

  // Student profile
  if (context.profile) {
    systemPrompt += '\n\n【学生画像】';
    if (context.profile.communication_style) systemPrompt += `\n沟通风格: ${context.profile.communication_style}`;
    if (context.profile.effective_strategies) {
      const m = safeParseJSON(context.profile.effective_strategies, []);
      if (m.length) systemPrompt += `\n有效方法: ${m.join('、')}`;
    }
    if (context.profile.sensitive_topics) {
      const a = safeParseJSON(context.profile.sensitive_topics, []);
      if (a.length) systemPrompt += `\n注意回避: ${a.join('、')}`;
    }
  }

  // v1.008: Give the generator the same memory context the coordinator sees.
  // Without this, the coordinator can analyze cross-session memory while the
  // final speaker still only sees recent chat messages and may claim it forgot.
  if (context.contextText) {
    systemPrompt += `\n\n【可用记忆与上下文】\n${context.contextText}`;
    systemPrompt += `\n\n【语境准入规则】\n`
      + `- 上面的内容已经过 Context Gate 过滤；没有出现在这里的旧记忆，不要主动带给学生。\n`
      + `- 学生最新一句话优先于历史摘要、画像和旧 open loop。\n`
      + `- 如果学生主动把旧事和当前事件做类比，可以用旧事比较心理模式，但不要把主线切回旧事。\n`
      + `- 学生姓名/账号名只代表学生显示名，不要把它当作老师、家长或第三方身份。`;
    if (context.contextGate?.relation) {
      systemPrompt += `\n本轮语境关系: ${context.contextGate.relation}`;
    }
    if (context.contextGate?.speechAct) {
      systemPrompt += `\n本轮话语行为: ${context.contextGate.speechAct}`;
    }
    if (context.contextGate?.temporalFrame) {
      systemPrompt += `\n本轮时空框架: ${context.contextGate.temporalFrame}`;
    }
  }

  // v1.007-04: Inject teacher guidance if provided (regeneration mode)
  if (teacherGuidance) {
    systemPrompt += `\n\n【教师补充指导】${teacherGuidance}\n请严格按照教师的指导方向来回复，不要偏离。`;
  }

  systemPrompt += `\n\n必须使用简体中文。像朋友聊天一样自然，每条消息不超过2句话。`;
  if (context.studentInfo) systemPrompt += `\n学生: ${context.studentInfo}`;

  // Build chat messages from recent context
  const chatMessages = [{ role: 'system', content: systemPrompt }];
  const recent = context.recentMessages.slice(-config.recentForAgentLimit);
  for (const msg of recent) {
    if (msg.sender_type === 'student') {
      chatMessages.push({ role: 'user', content: msg.content });
    } else {
      chatMessages.push({ role: 'assistant', content: msg.content });
    }
  }

  return { systemPrompt, chatMessages };
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = {
  assembleCoordinatorPrompt,
  assembleSuggestionPrompt,
};
