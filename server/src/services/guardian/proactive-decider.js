/**
 * Proactive Decider - v1.009 Guardian
 *
 * Decides if the guardian should proactively intervene (send a message
 * to the student without waiting for them to speak).
 */

const { getDb } = require('../../models/db');
const { callGuardianLLM: callLLM } = require('../ai-client');
const config = require('../runtime/counseling-config');
const { COUNSELOR_SOUL } = require('../runtime/prompt-constants');
const triggerClassifier = require('./trigger-classifier');

// Rate limiter: at most 1 proactive per minute
const MIN_PROACTIVE_GAP_MS = 60 * 1000;
const PROACTIVE_PROMPT = `你是小树洞的主动关怀模块。Guardian 已经先判断出是否需要介入、介入对象和原因；你只负责生成一条可被教师审核或语音模式自动发送给学生的自然回复。

${COUNSELOR_SOUL}

## 主动介入的原则
1. 不要说空洞的安慰话（"慢慢来""我在这里""抱抱你"）
2. 必须紧扣学生最后说的具体内容
3. 如果学生在纠结某个事实问题，帮他做逻辑分析
4. 如果学生在焦虑"万一"，帮他评估实际可能性
5. 简短但有信息量，1-2 句话
6. 像一个聪明的朋友，不像一个只会说"我理解你"的机器
7. 如果触发原因是教师追问过强或学生退缩，回复要降低压力，给学生选择权
8. 如果触发原因是开放环路，先轻轻确认刚才疑问是否解决，再继续展开
9. 如果【近期现场锚点】已经说明科目或主体，禁止再问“哪一科/哪个事”；直接承接已知主体
10. 如果学生正在聊考试结果、估分、排名、答题卡，不要拉回同学科的旧学习概念，先接考后情绪和现实后果

## 例子
- 学生纠结"万一踩线了" → "如果真踩了，裁判当场就会说的，没说就大概率没事。"
- 学生说"考砸了"且上下文未知科目 → 可以轻问具体哪一科；如果上下文已知是政治/语文等科目，禁止再问哪一科，直接承接该科目的考后情绪。
- 学生长时间沉默 → 根据上文说一句有内容的话，不要说"还在吗"`;

async function decide(state, knownTrigger = null) {
  if (!state) return null;

  const now = Date.now();
  if (state.lastProactiveAt && (now - state.lastProactiveAt) < MIN_PROACTIVE_GAP_MS) {
    return null;
  }

  const trigger = knownTrigger || detectTrigger(state);
  if (!trigger) return null;
  if (state.isMainPipelineBusy) return null;

  state.lastProactiveAt = now;

  try {
    const content = await generateProactiveMessage(state, trigger);
    if (!content) return null;

    return {
      shouldIntervene: true,
      urgency: trigger.urgency,
      triggerType: trigger.type,
      target: trigger.target || 'student',
      content,
      reason: trigger.reason,
      suggestedAction: trigger.suggestedAction || '',
      sendToStudent: (trigger.target || 'student') === 'student',
    };
  } catch (err) {
    console.error('[Guardian/proactive] Decide error:', err.message);
    return null;
  }
}

function getRecentScene(sessionId, studentId) {
  try {
    const row = getDb().prepare(`
      SELECT topic, unresolved_point, suggested_resume, evidence, last_seen_at, updated_at, created_at
      FROM t_open_loop
      WHERE session_id = ?
        AND student_id = ?
        AND status = 'open'
        AND loop_type = 'current_scene'
      ORDER BY last_seen_at DESC, id DESC
      LIMIT 1
    `).get(sessionId, studentId);
    if (!row) return null;
    const text = [row.topic, row.unresolved_point, row.suggested_resume, row.evidence].filter(Boolean).join(' ');
    return { ...row, text };
  } catch (e) {
    return null;
  }
}

function buildRecentSceneHint(scene) {
  if (!scene?.text) return '';
  const knownSubject = /政治/.test(scene.text) ? '政治'
    : (/语文/.test(scene.text) ? '语文'
      : (/数学/.test(scene.text) ? '数学'
        : (/英语/.test(scene.text) ? '英语' : '')));
  const examScene = /(期中|考试|考完|估分|挂科|挂了|排名|及格|答题卡|填反|考砸|考炸|炸了|分数|失利)/.test(scene.text);
  const lines = ['【近期现场锚点】', `当前现场：${scene.topic || scene.unresolved_point || ''}`];
  if (knownSubject) lines.push(`已知主体：${knownSubject}`);
  if (knownSubject && examScene) {
    lines.push(`约束：学生已经说明是${knownSubject}相关的考试失利/估分焦虑，主动插话时不要再问“哪一科”，应直接围绕${knownSubject}考试、分数、排名或考后情绪承接。`);
  }
  return lines.filter(Boolean).join('\n');
}

function detectTrigger(state) {
  return triggerClassifier.classify(state);
}

function preview(state) {
  return detectTrigger(state);
}

function shouldRunProactiveCheck(state) {
  return !!preview(state);
}

async function generateProactiveMessage(state, trigger) {
  const db = getDb();
  const recent = db.prepare(`
    SELECT sender_type, content FROM t_message
    WHERE session_id = ?
    ORDER BY id DESC LIMIT 4
  `).all(state.sessionId);
  recent.reverse();

  const convText = recent.map(m => {
    const role = m.sender_type === 'student' ? '学生' : 'AI';
    return `${role}: ${m.content}`;
  }).join('\n');
  const recentSceneHint = buildRecentSceneHint(getRecentScene(state.sessionId, state.studentId));

  const userPrompt = `【最近对话】
${convText}
${recentSceneHint ? `\n${recentSceneHint}\n` : ''}
【触发原因】${trigger.reason} (${trigger.type})
【介入对象】${trigger.target || 'student'}
【建议动作】${trigger.suggestedAction || '自然承接，不抢话'}
【内容提示】${trigger.contentHint || '围绕最近对话给一小步'}

请生成 1-2 句学生可见回复。只输出回复正文，不要输出分析:`;

  const result = await callLLM([
    { role: 'system', content: PROACTIVE_PROMPT },
    { role: 'user', content: userPrompt },
  ], {
    model: config.guardianAnalyzerModel,
    temperature: 0.8,
    max_tokens: 100,
  });

  return result.content.trim();
}

module.exports = { decide, preview, shouldRunProactiveCheck };
