/**
 * Context Gate - v1.009
 *
 * A lightweight semantic admission layer. It does not retrieve memory, store
 * state, or generate replies. It decides which already-collected context may
 * enter this turn's prompt, and whether fast-path candidates are allowed to
 * bypass the slow Pipeline.
 */

const continuationResolver = require('./continuation-resolver');

const MEMORY_ANCHOR_RE = /(继续|接着|回来|回来了|上次|上回|昨天|昨晚|前天|之前|前面|刚才|刚刚|那个|记得|忘了吗|聊过|讲过)/;
const LOCAL_EXPAND_RE = /^(继续说|接着说|往下说|展开说|详细说|举个例子|然后呢|还有呢|多说点|接着讲|继续讲)[。！？!?,，\s]*$/;
const ANALOGY_RE = /(像|类似|一样|很像|有点像|跟.*像|和.*像|跟.*一样|和.*一样|对比|类比)/;
const SWITCH_RE = /(先不说|不说这个|不讲这个|换个话题|突然想到|我想说|回到|转到)/;
const SPORTS_RE = /(体育|实心球|踩线|中考体育)/;
const EXAM_RESULT_RE = /(考炸|考砸|考完|考不好|没考好|分数|估分|排名|名次|答题卡|写反|写错|题目.*反|题目.*错|核对|对错|交卷|卷子|挂科|挂了|及格|老师.*骂|同学.*笑|被老师说|被同学笑)/;
const POLITICS_CONCEPT_RE = /(政治历史|历史|概念|阶段|三大改造|新民主主义|社会主义|时间线|公私合营)/;
const RISK_RE = /(自杀|不想活|想死|割腕|跳楼|伤害自己|伤害别人|杀人|报警|急救|救命)/;
const AFFIRM_RE = /^(对|对呀|对啊|是|是的|嗯对|没错|确实|就是)[。.!?？！,，\s]*$/;
const DENY_RE = /^(不|不是|不对|没有|没|那倒没有|也不是|不是的)[。.!?？！,，\s]*$/;
const ACCEPT_RE = /^(好|好的|好吧|可以|可以呀|行|行吧|嗯好|试试|我试试)[。.!?？！,，\s]*$/;
const HESITATION_RE = /^(嗯|嗯嗯|哦|啊|呃|额|唔|哎)[。.!?？！,，\s]*$/;
const CONTINUE_RE = /^(你讲吧|你说吧|继续说|接着讲|接着说|往下说|展开说|继续讲|讲一下吧)[。.!?？！,，\s]*$/;
const PAST_RE = /(当时|那时候|小时候|昨天|昨晚|前天|上次|以前|之前|刚才|那会儿|那一刻|发生的时候)/;
const PRESENT_RE = /(现在|此刻|目前|这会儿|正在|还在|身边|眼下)/;

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function hasMemoryAnchor(text) {
  return MEMORY_ANCHOR_RE.test(String(text || ''));
}

function hasAnalogy(text) {
  return ANALOGY_RE.test(String(text || ''));
}

function hasSwitch(text) {
  return SWITCH_RE.test(String(text || ''));
}

function isLocalExpand(text) {
  return LOCAL_EXPAND_RE.test(compact(text));
}

function isExamResultText(text) {
  return EXAM_RESULT_RE.test(String(text || ''));
}

function isPoliticsConceptText(text) {
  return POLITICS_CONCEPT_RE.test(String(text || ''));
}

function renderRecentMessages(context) {
  const recent = context.recentMessages || [];
  if (!recent.length) return '';
  return '== 最近对话 ==\n' + recent.map(m => {
    const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
    return `${role}: ${m.content}`;
  }).join('\n');
}

function lastNonStudentMessage(context) {
  const recent = context?.recentMessages || [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    if (msg?.sender_type !== 'student') return compact(msg.content);
  }
  return '';
}

function renderProfileBrief(context) {
  const profile = context.profile;
  if (!profile) return '';
  const parts = ['== 学生画像（仅限沟通边界） =='];
  if (profile.communication_style) parts.push(`沟通风格: ${profile.communication_style}`);
  if (profile.effective_strategies) {
    const methods = safeParseJSON(profile.effective_strategies, []);
    if (methods.length) parts.push(`有效方法: ${methods.join('、')}`);
  }
  if (profile.sensitive_topics) {
    const avoids = safeParseJSON(profile.sensitive_topics, []);
    if (avoids.length) parts.push(`注意回避: ${avoids.join('、')}`);
  }
  return parts.length > 1 ? parts.join('\n') : '';
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function buildAllowedContextText(context, gate) {
  const parts = [];
  const profileBrief = renderProfileBrief(context);
  if (profileBrief) parts.push(profileBrief);

  if (gate.allowDeepMemory && context.rawContextText) {
    parts.push(context.rawContextText);
  } else {
    const recent = renderRecentMessages(context);
    if (recent) parts.push(recent);
  }

  if (gate.allowOpenLoopHint && gate.openLoopHint) {
    parts.push(gate.openLoopHint);
  }

  if (gate.promptConstraints.length) {
    parts.push('== 语境准入约束 ==\n' + gate.promptConstraints.map(item => `- ${item}`).join('\n'));
  }

  return parts.filter(Boolean).join('\n\n');
}

function classifyRelation({ latestMessage, openLoopState, continuationPlan }) {
  const text = compact(latestMessage);
  const localExpand = isLocalExpand(text) || continuationPlan?.action === 'local_expand';
  const memoryAnchor = hasMemoryAnchor(text);
  const analogy = hasAnalogy(text);
  const switchTopic = hasSwitch(text);

  if (RISK_RE.test(text)) return 'risk_signal';
  if (switchTopic) return 'switch_topic';
  if (analogy && (memoryAnchor || SPORTS_RE.test(text))) return 'analogy_memory';
  if (localExpand) return 'continue_current';
  if (continuationPlan?.action === 'clarify') return 'clarify_memory';
  if (continuationPlan?.action === 'lock') return 'resume_open_loop';
  if (openLoopState?.action === 'resume' && memoryAnchor) return 'resume_open_loop';
  if (openLoopState?.action === 'clarify' && memoryAnchor) return 'clarify_memory';
  return 'continue_current';
}

function classifySpeechAct(text, context) {
  const value = compact(text);
  const previous = lastNonStudentMessage(context);
  if (!value) return 'unclear_noise';
  if (CONTINUE_RE.test(value) || isLocalExpand(value)) return 'continue';
  if (DENY_RE.test(value)) return 'deny';
  if (ACCEPT_RE.test(value)) {
    if (/好吗|可以吗|要不要|试试|愿意|先.*一下|做.*吗|行吗|好不好/.test(previous)) return 'accept';
    return 'affirm';
  }
  if (AFFIRM_RE.test(value)) return 'affirm';
  if (HESITATION_RE.test(value)) return 'hesitation';
  if (/^[a-zA-Z\s.'-]{1,24}$/.test(value) && !/^(ok|okay|hmm|right|yes|no)$/i.test(value)) return 'unclear_noise';
  return 'statement';
}

function inferTemporalFrame(text, context, speechAct) {
  const value = compact(text);
  const previous = lastNonStudentMessage(context);
  const past = PAST_RE.test(value) || PAST_RE.test(previous);
  const present = PRESENT_RE.test(value);
  if (past && present) return 'mixed_bridge';
  if (past) return 'past_recall';
  if (present) return 'present_state';
  if ((speechAct === 'affirm' || speechAct === 'deny') && PAST_RE.test(previous)) return 'past_recall';
  return 'unclear';
}

function evaluate(params) {
  const {
    context,
    latestMessage,
    openLoopState,
    continuationPlan,
    mode = 'text',
  } = params;

  const text = compact(latestMessage);
  const speechAct = classifySpeechAct(text, context);
  const temporalFrame = inferTemporalFrame(text, context, speechAct);
  const relation = speechAct === 'unclear_noise'
    ? 'unclear_or_noise'
    : classifyRelation({ latestMessage: text, openLoopState, continuationPlan });
  const contextText = [
    context?.rawContextText,
    renderRecentMessages(context || {}),
    openLoopState?.hint,
    openLoopState?.active_loop?.topic,
    openLoopState?.active_loop?.unresolved_point,
  ].filter(Boolean).join('\n');
  const examResultScene = isExamResultText(text) || (hasMemoryAnchor(text) && isExamResultText(contextText));
  const allowDeepMemory = relation === 'resume_open_loop'
    || relation === 'clarify_memory'
    || relation === 'analogy_memory';
  const allowOpenLoopHint = relation === 'resume_open_loop'
    || relation === 'clarify_memory'
    || relation === 'analogy_memory';

  const promptConstraints = [
    '学生最新一句话是最高优先级；历史记忆只能在被当前话语授权后显性提及。',
    '学生姓名或账号名只是学生显示名，不能把学生名误当作现实老师、家长或第三方身份。',
  ];
  promptConstraints.push(`本轮学生话语行为 speechAct=${speechAct}；短确认词必须结合上一轮问题理解，不要当作无意义噪声。`);
  promptConstraints.push(`本轮时间框架 temporalFrame=${temporalFrame}；回复必须和学生描述的过去/现在时空一致。`);

  if (speechAct === 'affirm') {
    promptConstraints.push('学生是在肯定上一轮判断或问题；先承接这个确认，再自然推进，不要重新猜测别的话题。');
  } else if (speechAct === 'deny') {
    promptConstraints.push('学生是在否定上一轮判断或问题；必须修正刚才的推理，不要继续沿用被否定的假设。');
  } else if (speechAct === 'accept') {
    promptConstraints.push('学生接受了建议；不要重复解释建议，转为轻量确认和后续跟进。');
  } else if (speechAct === 'continue') {
    promptConstraints.push('学生授权继续当前话题；延续当前现场，不要拉远记忆或突然换题。');
  } else if (speechAct === 'hesitation') {
    promptConstraints.push('学生可能在犹豫或低能量停顿；轻承接，降低压力，不要连续追问。');
  }

  if (temporalFrame === 'past_recall') {
    promptConstraints.push('学生正在回忆过去场景；用“当时/那时候”承接，不要假定学生此刻仍在同一现场，也不要直接给“现在摸桌子/看身边物体”这类现场动作。');
  } else if (temporalFrame === 'mixed_bridge') {
    promptConstraints.push('学生在连接过去事件和当前感受；先区分“当时发生了什么”和“现在还剩什么反应”，再给建议。');
  } else if (temporalFrame === 'present_state') {
    promptConstraints.push('学生在描述当前状态；可以给当下稳定方法，但仍需先共情并确认安全。');
  }

  const blockedContext = [];
  if (!allowDeepMemory) {
    blockedContext.push({
      topic: '历史记忆与旧 open loop',
      reason: '当前话语未授权显性带出旧记忆',
    });
    promptConstraints.push('不要主动带出旧话题、旧考试、旧卡点；除非学生本轮明确提到。');
  }

  if (examResultScene) {
    blockedContext.push({
      topic: '同学科旧学习环路',
      reason: '当前是考试结果/评价焦虑，不等于旧概念学习',
    });
    promptConstraints.push('如果学生在说考试结果、害怕老师批评或同学评价，不要拉回同学科概念学习。');
    promptConstraints.push('如果考试已经结束或学生在担心写反/写错题，不要问“能不能改”、不要建议“翻回卷子核对”，也不要主动追问“具体是哪道题”；除非学生主动要求复盘题目，否则重点是承认不确定、区分事实和担心、做情绪止损，并把注意力转回可控事项。');
  }

  if (relation === 'analogy_memory') {
    promptConstraints.push('学生主动建立类比时，旧记忆只能作为类比材料；主线仍是当前事件。');
  }

  if (relation === 'unclear_or_noise') {
    blockedContext.push({
      topic: '低置信语音或无语境片段',
      reason: '无法稳定判断话语行为，禁止覆盖当前现场或触发快路',
    });
    promptConstraints.push('如果最新输入像 ASR 噪声或无法建立语境，只做轻量澄清，不要强行心理解释。');
  }

  const gate = {
    relation,
    speechAct,
    temporalFrame,
    mode,
    currentScene: inferCurrentScene(text, examResultScene),
    allowDeepMemory,
    allowOpenLoopHint,
    openLoopHint: allowOpenLoopHint ? (openLoopState?.hint || continuationResolver.buildControlHint(continuationPlan) || '') : '',
    blockedContext,
    promptConstraints,
    directPolicy: {
      allowDirectReply: relation !== 'unclear_or_noise'
        && (relation === 'resume_open_loop' || (mode === 'text' && relation === 'clarify_memory')),
      reason: relation,
    },
    guardianPolicy: {
      allowFastPath: relation !== 'unclear_or_noise'
        && (relation === 'continue_current' || relation === 'resume_open_loop'),
      reason: relation,
    },
  };

  gate.allowedContextText = buildAllowedContextText(context, gate);
  gate.trace = {
    relation: gate.relation,
    speechAct: gate.speechAct,
    temporalFrame: gate.temporalFrame,
    currentScene: gate.currentScene,
    allowDeepMemory: gate.allowDeepMemory,
    allowOpenLoopHint: gate.allowOpenLoopHint,
    blockedCount: gate.blockedContext.length,
    promptConstraintCount: gate.promptConstraints.length,
  };

  return gate;
}

function inferCurrentScene(text, examResultScene = false) {
  if (!text) return null;
  if (examResultScene || isExamResultText(text)) return '考试结果与评价焦虑';
  if (SPORTS_RE.test(text)) return '体育中考或实心球相关现场';
  if (/发抖|会抖|同学|老师|笑|骂|评价|丢脸|尴尬/.test(text)) return '面对老师同学评价的焦虑';
  if (/政治/.test(text)) return '政治相关当前现场';
  return text.slice(0, 48);
}

function evaluateGuardianPolicy(gate, { guardianCandidate, latestMessage }) {
  if (!guardianCandidate?.response) {
    return { decision: 'fallback', rejectedReason: 'no_candidate' };
  }

  const text = compact(latestMessage);
  const expectedTopic = `${guardianCandidate.expectedTopic || ''} ${guardianCandidate.response || ''}`;

  if (gate?.guardianPolicy?.allowFastPath === false) {
    return { decision: 'reject', rejectedReason: `context_gate_${gate.guardianPolicy.reason}` };
  }

  if (!SPORTS_RE.test(text) && SPORTS_RE.test(expectedTopic)) {
    return { decision: 'reject', rejectedReason: 'context_gate_old_sports_memory' };
  }

  if (isExamResultText(text) && isPoliticsConceptText(expectedTopic)) {
    return { decision: 'reject', rejectedReason: 'context_gate_subject_not_resume_target' };
  }

  return { decision: 'pass', rejectedReason: null };
}

function applyToContext(context, gate) {
  if (!context || !gate) return context;
  context.rawContextText = context.rawContextText || context.contextText || '';
  context.contextText = gate.allowedContextText || context.contextText || '';
  context.contextGate = gate;
  context.tokenEstimate = Math.ceil((context.contextText || '').length * 1.5);
  context.tracePayload = context.tracePayload || {};
  context.tracePayload.contextGate = gate.trace;
  if (!gate.allowDeepMemory) {
    context.tracePayload.usedMemoryFragmentIds = [];
    context.tracePayload.usedFinalIds = [];
  }
  return context;
}

function gateRejectResult(policy, candidate) {
  const start = Date.now();
  return {
    decision: 'reject',
    rejectedReason: policy?.rejectedReason || 'context_gate_reject',
    candidateSource: candidate?.source || 'prepared_branch',
    draftAgeMs: candidate?.savedMs ?? null,
    verifierMs: Date.now() - start,
    coordinatorSkipped: false,
    fastPathSavedMs: 0,
  };
}

module.exports = {
  evaluate,
  applyToContext,
  evaluateGuardianPolicy,
  gateRejectResult,
};
