/**
 * Counseling Runtime - v1.007
 *
 * Orchestrates a complete suggestion turn:
 *   1. Assemble context
 *   2. Build coordinator prompt
 *   3. Call coordinator model
 *   4. Build suggestion prompt
 *   5. Call generator model
 *   6. Write emotion + traces
 *   7. Return structured result with stop_reason
 *
 * Inspired by claw-code's PortRuntime.bootstrap_session() pattern:
 * - Config separate from state (CounselingConfig)
 * - Structured result with stop_reason (like TurnResult)
 * - Full execution trace for replay
 *
 * Does NOT: handle HTTP, write to message table, emit WebSocket events
 */

const { getDb } = require('../../models/db');
const { callLLM, callLLMWithRetry } = require('../ai-client');
const { callLLMStreaming, collectSentences } = require('../streaming-llm');
const config = require('./counseling-config');
const { assembleSuggestionContext } = require('./context-assembler');
const { assembleCoordinatorPrompt, assembleSuggestionPrompt } = require('./prompt-assembler');
const { STAGE_NAMES } = require('./prompt-constants');
const { writeSuggestionTrace, writeContextTrace } = require('./suggestion-trace');
const continuationResolver = require('./continuation-resolver');
const openLoopManager = require('./open-loop-manager');
const contextGate = require('./context-gate');
const { verifyGuardianCandidate, applyVerifierResult } = require('./fast-verifier');
const topicFrame = require('./topic-frame');
const { subjectOf } = require('../guardian/branch-memory');
// v1.007: guardian replaces speculative-engine
const guardian = require('../guardian/guardian-service');

const DEFAULT_ANALYSIS = Object.freeze({
  skillWeights: { empathy: 0.8, cognitive: 0.1, action: 0.1, closing: 0 },
  emotion: { primary: '未知', intensity: 5, trend: '→' },
  confidence: 0.8,
  guidance: '',
  mirrorCues: '',
  suggestions: null,
  continueIf: null,
  currentTopic: null,
  stage: 'listening',
  reason: '默认倾听',
});

function reportGuardianCandidateOutcome(sessionId, guardianCandidate, accepted) {
  if (!guardianCandidate?.branchMemoryId) return;
  guardian.reportBranchMemoryOutcome(sessionId, guardianCandidate.branchMemoryId, accepted);
}

function normalizeTopic(topic) {
  if (!topic || topic === 'null' || topic === '未指定' || topic === '无法判断') return null;
  const value = String(topic).trim();
  return value || null;
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function parseLLMJsonObject(content, label = 'LLM') {
  const text = String(content || '').trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : text;
  const jsonMatch = source.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[Runtime] ${label} JSON missing object; using fallback analysis`);
    return null;
  }

  const raw = jsonMatch[0];
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    const repaired = raw
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try {
      return JSON.parse(repaired);
    } catch (secondErr) {
      console.warn(`[Runtime] ${label} JSON parse failed; using fallback analysis: ${secondErr.message}`);
      return null;
    }
  }
}

function applyCoordinatorParsedAnalysis(baseAnalysis, parsed) {
  if (!parsed || typeof parsed !== 'object') return { ...baseAnalysis };
  return {
    skillWeights: parsed.skillWeights || baseAnalysis.skillWeights,
    emotion: parsed.emotion || baseAnalysis.emotion,
    confidence: parsed.confidence || 0.8,
    guidance: parsed.guidance || '',
    mirrorCues: parsed.mirrorCues || '',
    currentTopic: normalizeTopic(parsed.currentTopic),
    suggestions: parsed.suggestions || null,
    continueIf: parsed.continueIf || null,
    stage: parsed.stage || 'listening',
    reason: parsed.reason || '',
  };
}

function getTriggerMessageId(context) {
  const recentStudentMsgs = context.recentMessages.filter(m => m.sender_type === 'student');
  if (recentStudentMsgs.length === 0) return null;
  return recentStudentMsgs[recentStudentMsgs.length - 1].id;
}

function writeRuntimeTrace({
  sessionId,
  studentId,
  context,
  analysis,
  suggestions,
  coordinatorUsage,
  generatorUsage,
  perf,
  generatorModel = config.generatorModel,
  openLoopState = null,
}) {
  if (!config.traceEnabled) return null;
  const tracePayload = context.tracePayload;
  const suggestionTraceId = writeSuggestionTrace({
    sessionId,
    studentId,
    triggerMessageId: getTriggerMessageId(context),
    coordinatorModel: config.coordinatorModel,
    generatorModel,
    assembledContextJson: context.contextText,
    analysis,
    suggestions,
    usage: { coordinator: coordinatorUsage || null, generator: generatorUsage || null, perf },
    openLoop: openLoopState,
  });

  if (suggestionTraceId) {
    writeContextTrace({
      sessionId,
      studentId,
      suggestionTraceId,
      recentMessageIds: tracePayload.recentMessageIds,
      usedRollingIds: tracePayload.usedRollingIds,
      usedFinalIds: tracePayload.usedFinalIds,
      usedThreadFields: tracePayload.usedThreadFields,
      usedProfileFields: tracePayload.usedProfileFields,
      usedMemoryFragmentIds: tracePayload.usedMemoryFragmentIds,
      retrievalMode: tracePayload.retrievalMode,
      estimatedTokens: context.tokenEstimate,
    });
  }

  return suggestionTraceId;
}

function buildContinuationDirectDecision(openLoopState, continuationPlan, options = {}) {
  const { mode = 'text', latestMessage = '' } = options;
  if (openLoopState.action === 'clarify') {
    if (mode === 'voice') return null;
    const details = openLoopManager.buildDirectReplyDetails(openLoopState);
    if (!details?.reply) return null;
    return {
      reply: details.reply,
      source: 'open_loop_direct',
      reason: details.reason || 'open_loop_clarify',
      candidateCount: details.candidateCount || 0,
      maxLabelLength: details.maxLabelLength || 0,
      labels: details.labels || [],
      stopReason: 'open_loop_clarify',
    };
  }

  if (openLoopState.action === 'resume') {
    if (mode === 'voice' && openLoopState.flow?.allowFastBridge !== true) return null;
    const details = openLoopManager.buildDirectReplyDetails(openLoopState);
    if (!details?.reply) return null;
    return {
      reply: details.reply,
      source: 'open_loop_resume_bridge',
      reason: details.reason || 'open_loop_resume_bridge',
      candidateCount: details.candidateCount || 1,
      maxLabelLength: details.maxLabelLength || 0,
      labels: details.labels || [],
      stopReason: 'open_loop_resume_bridge',
    };
  }

  const reply = continuationResolver.buildDirectReply(continuationPlan);
  if (!reply) return null;
  const candidates = continuationPlan.candidates || [];
  return {
    reply,
    source: 'continuation_resolver',
    reason: `continuation_${continuationPlan.action}`,
    candidateCount: candidates.length,
    maxLabelLength: candidates.reduce((max, c) => Math.max(max, String(c.topic || '').length), 0),
    labels: candidates.map(c => c.topic).filter(Boolean),
    stopReason: `continuation_${continuationPlan.action}`,
  };
}

function applyContinuationDirectPerf(perf, directDecision, runtimeStartMs) {
  perf.generator_skipped = true;
  perf.coordinator_skipped = true;
  perf.continuation_direct = true;
  perf.continuation_reason = directDecision.reason;
  perf.continuation_candidate_count = directDecision.candidateCount;
  perf.continuation_label_max_len = directDecision.maxLabelLength;
  perf.candidate_source = directDecision.source;
  perf.verifier_decision = 'direct';
  perf.stop_reason = directDecision.stopReason;
  perf.total_runtime_ms = Date.now() - runtimeStartMs;
}

function applyContextGatePerf(perf, gate) {
  if (!perf || !gate) return;
  perf.context_gate_relation = gate.relation;
  perf.context_gate_speech_act = gate.speechAct || null;
  perf.context_gate_temporal_frame = gate.temporalFrame || null;
  perf.context_gate_scene = gate.currentScene || null;
  perf.context_gate_blocked_count = gate.blockedContext?.length || 0;
  perf.context_gate_deep_memory = !!gate.allowDeepMemory;
}

function pushCandidate(candidates, topic, source, strength = 'weak') {
  const normalized = normalizeTopic(topic);
  if (!normalized) return;
  if (normalized.length < 2) return;
  if (candidates.some(c => c.topic === normalized)) return;
  candidates.push({ topic: normalized, source, strength });
}

function isAmbiguousContinue(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return /继续|接着|昨天|上次|刚才|那个|前面|之前/.test(value)
    && value.length <= 18
    && !/[语数英政史地物化生]|桃花源|文言文|作文|函数|单词|考试|背/.test(value);
}

function extractTopicFromText(text) {
  const value = String(text || '');
  if (!value) return null;
  const subjects = ['语文', '数学', '英语', '历史', '政治', '物理', '化学', '生物', '地理'];
  const subject = subjects.find(s => value.includes(s));
  const knownWorks = ['桃花源记', '出师表', '岳阳楼记', '小石潭记', '三大改造'];
  const work = knownWorks.find(w => value.includes(w));
  if (subject && work) return `${subject}-${work}`;
  if (work) return work;
  if (subject) return subject;
  const match = value.match(/(?:讨论|聊|说|背|复习|继续)(?:了|的)?([^，。！？\n]{2,16})/);
  return match ? match[1].trim() : null;
}

function resolveCurrentTopic({ coordTopic, sessionId, studentId, latestMessage }) {
  const candidates = [];
  const normalizedCoord = normalizeTopic(coordTopic);
  const ambiguous = isAmbiguousContinue(latestMessage)
    && !continuationResolver.isLocalExpansionRequest(latestMessage, sessionId);

  if (normalizedCoord && !ambiguous) {
    return {
      topic: normalizedCoord,
      candidates: [{ topic: normalizedCoord, source: 'coordinator', strength: 'strong' }],
      confident: true,
      source: 'coordinator',
      ambiguous: false,
    };
  }

  const directTopic = ambiguous ? null : extractTopicFromText(latestMessage);
  pushCandidate(candidates, directTopic, 'latest_message', 'strong');

  if (normalizedCoord && ambiguous) {
    pushCandidate(candidates, normalizedCoord, 'coordinator_guess', 'weak');
  }

  const advice = guardian.getStrategyAdvice(sessionId);
  pushCandidate(candidates, advice?.currentTopic, 'strategyMemory', 'strong');

  const db = getDb();
  try {
    const rolling = db.prepare(`
      SELECT raw_summary FROM t_session_summary
      WHERE session_id = ? AND summary_type = 'rolling'
      ORDER BY id DESC LIMIT 4
    `).all(sessionId);
    for (const row of rolling) {
      pushCandidate(candidates, extractTopicFromText(row.raw_summary), 'rolling_summary', 'weak');
    }
  } catch (e) {}

  try {
    const thread = db.prepare('SELECT key_events FROM t_session_thread WHERE session_id = ?').get(sessionId);
    for (const event of safeParseJSON(thread?.key_events, [])) {
      pushCandidate(candidates, extractTopicFromText(event) || event, 'session_thread', 'weak');
    }
  } catch (e) {}

  try {
    const recentFinals = db.prepare(`
      SELECT raw_summary FROM t_session_summary
      WHERE student_id = ? AND session_id != ? AND summary_type = 'final'
      ORDER BY created_at DESC, id DESC LIMIT 3
    `).all(studentId, sessionId);
    for (const row of recentFinals) {
      pushCandidate(candidates, extractTopicFromText(row.raw_summary), 'final_summary', 'weak');
    }
  } catch (e) {}

  try {
    const profile = db.prepare('SELECT primary_concerns FROM t_student_profile WHERE student_id = ?').get(studentId);
    for (const concern of safeParseJSON(profile?.primary_concerns, [])) {
      pushCandidate(candidates, concern, 'profile', 'weak');
    }
  } catch (e) {}

  if (candidates.length === 1) {
    return {
      topic: candidates[0].topic,
      candidates,
      confident: candidates[0].strength === 'strong' && !ambiguous,
      source: candidates[0].source,
      ambiguous,
    };
  }

  return {
    topic: null,
    candidates,
    confident: false,
    source: candidates.length > 1 ? 'multiple' : null,
    ambiguous,
  };
}

function topicCompatible(currentTopic, branchTopic) {
  const current = normalizeTopic(currentTopic);
  const branch = normalizeTopic(branchTopic);
  if (!current || !branch) return false;
  const currentSubject = subjectOf(current);
  const branchSubject = subjectOf(branch);
  return current.includes(branch)
    || branch.includes(current)
    || (!!currentSubject && currentSubject === branchSubject);
}

function hasFastPathRiskSignal(text) {
  const value = String(text || '');
  return /自杀|不想活|想死|割腕|跳楼|伤害自己|伤害别人|杀人|报警|急救|救命/.test(value);
}

function isLowRiskContinuationText(text, sessionId) {
  const value = String(text || '').trim();
  if (!value || value.length > 24) return false;
  if (hasFastPathRiskSignal(value)) return false;
  if (continuationResolver.isLocalExpansionRequest(value, sessionId)) return true;
  return /^(嗯+|哦+|好+|可以|对|是的|有点|明白|懂了|然后呢|为什么|怎么说|继续|接着|展开|详细)/.test(value);
}

function canUsePreCoordinatorFastPath({ guardianCandidate, latestMessage, sessionId }) {
  if (!guardianCandidate || !guardianCandidate.response) return false;
  if ((guardianCandidate.matchConfidence || 0) < 0.9) return false;
  if (!isLowRiskContinuationText(latestMessage, sessionId)) return false;

  const expectedTopic = normalizeTopic(guardianCandidate.expectedTopic);
  if (!expectedTopic) return false;

  const advice = guardian.getStrategyAdvice(sessionId);
  const localTopic = extractTopicFromText(latestMessage) || advice?.currentTopic;
  if (localTopic && !topicCompatible(localTopic, expectedTopic)) return false;

  return true;
}

function buildTopicClarificationHint(topicResult) {
  const topics = topicResult.candidates.map(c => c.topic).slice(0, 4);
  if (topics.length >= 2) {
    return `\n\n【记忆系统提示】学生这句话可能是在说“继续之前的内容”，但记忆里有多个可能话题：\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n请温暖地反问学生想继续哪一个，不要替学生选择，也不要直接进入某个话题。`;
  }
  if (topics.length === 1 && topicResult.ambiguous) {
    return `\n\n【记忆系统提示】学生可能想继续之前的“${topics[0]}”，但这只是跨会话弱线索。\n请先轻轻确认是不是这个话题，再继续，不要把它当成确定事实。`;
  }
  return '';
}

function hasContinuationIntent(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return /(继续|接着|上次|上回|上一次|之前|前面|刚才|刚刚|那个|老话题|昨天|昨晚|前天|前几天|上周|上星期|上个月|上轮|上节|上回聊|之前聊|接着聊|继续聊)/.test(value);
}

function inferBusinessTopic(text) {
  const value = String(text || '');
  if (!value) return null;
  if (/桃花源记|古文|文言文|小剧场|背诵|朗读|课文/.test(value)) return '语文-古文背诵（桃花源记/小剧场）';
  if (/三大改造|新民主主义|社会主义|1949|1956|改革开放|政治|历史/.test(value)) return '政治历史-阶段概念辨析';
  if (/数学|函数|几何|第22题|第二问|解题|错题/.test(value)) return '数学-解题卡点';
  if (/考试|中考|二检|体育|实心球|踩线|排名/.test(value)) return '考试焦虑与临场表现';
  const heading = value.match(/【([^】]{2,32})】/);
  return heading ? heading[1].trim() : null;
}

function pushContinuationCandidate(candidates, topic, evidence, source, score) {
  const normalized = normalizeTopic(topic);
  if (!normalized) return;
  const existing = candidates.find(c => c.topic === normalized);
  if (existing) {
    existing.score += score;
    if (evidence && !existing.evidence.includes(evidence)) existing.evidence.push(evidence);
    existing.sources.add(source);
    return;
  }
  candidates.push({
    topic: normalized,
    evidence: evidence ? [evidence] : [],
    sources: new Set([source]),
    score,
  });
}

function collectContinuationCandidates(sessionId, studentId) {
  const db = getDb();
  const candidates = [];

  try {
    const rolling = db.prepare(`
      SELECT raw_summary FROM t_session_summary
      WHERE session_id = ? AND summary_type = 'rolling'
      ORDER BY id DESC LIMIT 6
    `).all(sessionId);
    rolling.forEach((row, idx) => {
      pushContinuationCandidate(
        candidates,
        inferBusinessTopic(row.raw_summary),
        String(row.raw_summary || '').slice(0, 160),
        'rolling_summary',
        6 - idx
      );
    });
  } catch (e) {}

  try {
    const thread = db.prepare('SELECT key_events, unresolved, strategies_tried FROM t_session_thread WHERE session_id = ?').get(sessionId);
    for (const field of ['key_events', 'unresolved', 'strategies_tried']) {
      for (const item of safeParseJSON(thread?.[field], [])) {
        const text = typeof item === 'string' ? item : `${item.method || ''} ${item.result || ''}`;
        pushContinuationCandidate(candidates, inferBusinessTopic(text), text.slice(0, 120), `thread_${field}`, 2);
      }
    }
  } catch (e) {}

  try {
    const finals = db.prepare(`
      SELECT raw_summary FROM t_session_summary
      WHERE student_id = ? AND session_id != ? AND summary_type = 'final'
      ORDER BY created_at DESC, id DESC LIMIT 3
    `).all(studentId, sessionId);
    finals.forEach((row, idx) => {
      pushContinuationCandidate(
        candidates,
        inferBusinessTopic(row.raw_summary),
        String(row.raw_summary || '').slice(0, 160),
        'final_summary',
        3 - idx
      );
    });
  } catch (e) {}

  return candidates
    .map(c => ({ ...c, sources: Array.from(c.sources), evidence: c.evidence.slice(0, 2) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function buildContinuationPlan({ latestMessage, sessionId, studentId }) {
  if (!hasContinuationIntent(latestMessage)) {
    return { intent: false, action: 'none', candidates: [] };
  }

  const candidates = collectContinuationCandidates(sessionId, studentId);
  if (candidates.length === 0) {
    return { intent: true, action: 'no_memory', candidates: [] };
  }

  const top = candidates[0];
  const runnerUp = candidates[1];
  const isDominant = !runnerUp || top.score >= runnerUp.score + 3;
  if (isDominant) {
    return { intent: true, action: 'lock', topic: top.topic, evidence: top.evidence, candidates };
  }

  return { intent: true, action: 'clarify', candidates };
}

function buildContinuationControlHint(plan) {
  if (!plan?.intent || plan.action !== 'lock') return '';
  return `\n\n【续聊控制】\n系统已根据记忆锁定学生想延续的话题：${plan.topic}\n证据：${(plan.evidence || []).join(' / ')}\n请直接承接这个话题继续，不要说“我没有昨天的记忆”，也不要再要求学生从头提醒。`;
}

function buildContinuationClarification(plan) {
  if (!plan?.intent) return null;
  if (plan.action === 'clarify') {
    const topics = plan.candidates.map(c => c.topic).slice(0, 3);
    return `我查了一下，前面可能有几个可以接上的点：${topics.join('、')}。你想先继续哪一个？`;
  }
  if (plan.action === 'no_memory') {
    return '我这边没查到足够明确的上一段线索。你给我一个关键词，我马上接着往下聊。';
  }
  return null;
}

function splitSentences(text) {
  const value = String(text || '').trim();
  if (!value) return [];
  const parts = value.match(/[^。！？!?]+[。！？!?]?/g) || [value];
  return parts.map(s => s.trim()).filter(Boolean);
}

/**
 * Stop reasons (mirrors claw-code's TurnResult.stop_reason):
 *   completed        - normal completion
 *   low_confidence   - coordinator confidence < threshold, forced empathy
 *   no_messages      - session has no messages
 *   api_not_configured - AI_API_KEY missing
 *   coordinator_error - coordinator LLM call failed
 *   generator_error  - generator LLM call failed
 */

/**
 * Run a complete suggestion turn.
 *
 * @param {Object} params
 * @param {number} params.sessionId
 * @param {number} params.studentId
 * @param {string} [params.latestMessage]
 * @param {string} [params.teacherGuidance] - v1.007-04: teacher direction hint for regeneration
 * @returns {Object} Structured result
 */
async function runSuggestionTurn({ sessionId, studentId, latestMessage, teacherGuidance }) {
  let stopReason = 'completed';
  const runtimeStartMs = Date.now();
  const perf = {
    guardian_match_ms: 0,
    verifier_ms: 0,
    coordinator_ms: 0,
    generator_ms: 0,
    pipeline_ms: 0,
    generator_skipped: false,
    guardian_candidate: false,
    guardian_fast_path: false,
    continuation_direct: false,
    coordinator_skipped: false,
    candidate_source: null,
    verifier_decision: 'fallback',
    rejected_reason: null,
    draft_age_ms: null,
    fast_path_saved_ms: 0,
    branch_id: null,
    match_confidence: null,
    branch_memory_hit: false,
    branch_memory_score: null,
    stop_reason: null,
  };

  // Step 1: Assemble context
  const context = assembleSuggestionContext({ sessionId, studentId, latestMessage });
  context.rawContextText = context.contextText || '';

  if (context.recentCount === 0) {
    return { error: '该会话暂无消息', stopReason: 'no_messages' };
  }

  const studentMessage = context.studentMessage || '';
  const openLoopState = openLoopManager.resolve({
    sessionId,
    studentId,
    latestMessage: studentMessage,
  });
  if (openLoopState.hint) {
    context.tracePayload.openLoopId = openLoopState.active_loop?.id || null;
    context.tracePayload.openLoopAction = openLoopState.action;
  }
  const continuationPlan = continuationResolver.buildPlan({
    latestMessage: studentMessage,
    sessionId,
    studentId,
  });
  const gateResult = contextGate.evaluate({
    context,
    latestMessage: studentMessage,
    openLoopState,
    continuationPlan,
    mode: 'text',
  });
  contextGate.applyToContext(context, gateResult);
  applyContextGatePerf(perf, gateResult);

  const directDecision = buildContinuationDirectDecision(openLoopState, continuationPlan, { latestMessage: studentMessage });
  if (directDecision && gateResult.directPolicy.allowDirectReply) {
    const continuationDirectReply = directDecision.reply;
    applyContinuationDirectPerf(perf, directDecision, runtimeStartMs);
    console.log(`[Runtime] Continuation direct ${directDecision.reason}: ${(directDecision.labels || []).join(' | ')}`);
    // Teacher-side suggestion preview must not mutate OpenLoop or Guardian draft state.
    // The state is updated only after the reply is actually sent to the student.
    const analysis = {
      stage: 'listening',
      stageName: STAGE_NAMES.listening || 'listening',
      skillWeights: DEFAULT_ANALYSIS.skillWeights,
      emotion: DEFAULT_ANALYSIS.emotion,
      confidence: 1,
      guidance: '续聊意图由开放环路/四层记忆解析器接管',
      mirrorCues: '',
      currentTopic: null,
      topicCandidates: directDecision.labels || [],
      speculativeHit: false,
      speculativeSavedMs: 0,
      openLoop: openLoopState,
      contextGate: gateResult.trace,
    };
    const suggestionTraceId = writeRuntimeTrace({
      sessionId,
      studentId,
      context,
      analysis,
      suggestions: [{ content: continuationDirectReply, delay: 0 }],
      coordinatorUsage: null,
      generatorUsage: null,
      perf,
      generatorModel: 'direct-continuation',
      openLoopState,
    });
    return {
      suggestion: continuationDirectReply,
      suggestions: [{ content: continuationDirectReply, delay: 0 }],
      analysis,
      suggestionTraceId,
      speculativeHit: false,
      speculativeSavedMs: 0,
      stopReason: perf.stop_reason,
      usage: { coordinator: null, generator: null, perf },
    };
  }

  // Step 2: Coordinator analysis — check speculative cache first
  let analysis = { ...DEFAULT_ANALYSIS };
  let coordinatorUsage = null;
  let speculativeHit = false;
  let speculativeSavedMs = 0;
  let guardianPreparedResponse = null; // If guardian hit, we can skip generator too

  // /api/ai/suggest is a teacher-side preview. Do not pause/complete Guardian here;
  // actual sent replies update Guardian/OpenLoop through the message save path.

  // Check guardian for prepared branch match
  // Skip guardian cache if teacher provided explicit guidance (regeneration mode)
  const guardianMatchStartMs = Date.now();
  const guardianResult = teacherGuidance ? null : await guardian.checkPreparedResponse(sessionId, studentMessage);
  perf.guardian_match_ms = Date.now() - guardianMatchStartMs;

  if (guardianResult && guardianResult.response) {
    speculativeHit = true;
    speculativeSavedMs = guardianResult.savedMs || 0;
    perf.guardian_candidate = true;
    perf.candidate_source = guardianResult.source || 'prepared_branch';
    perf.draft_age_ms = guardianResult.savedMs ?? null;
    perf.branch_id = guardianResult.branchId || null;
    perf.match_confidence = guardianResult.matchConfidence || null;
    perf.branch_memory_hit = !!guardianResult.branchMemoryId;
    perf.branch_memory_score = guardianResult.memoryScore ?? null;
    const gatePolicy = contextGate.evaluateGuardianPolicy(gateResult, {
      guardianCandidate: guardianResult,
      latestMessage: studentMessage,
    });
    const verifier = gatePolicy.decision === 'reject'
      ? contextGate.gateRejectResult(gatePolicy, guardianResult)
      : verifyGuardianCandidate({
          guardianCandidate: guardianResult,
          latestMessage: studentMessage,
          openLoop: openLoopState,
          activeFrame: topicFrame.getFrame(sessionId),
          mode: 'pre_coordinator',
        });
    applyVerifierResult(perf, verifier);
    if (verifier.decision === 'accept') {
      reportGuardianCandidateOutcome(sessionId, guardianResult, true);
      // Full guardian hit — use pre-generated response directly
      guardianPreparedResponse = guardianResult.response;
      analysis = { ...DEFAULT_ANALYSIS, ...guardianResult.analysis, openLoop: openLoopState };
      perf.guardian_fast_path = true;
      perf.generator_skipped = true;
      console.log(`[Runtime] Guardian HIT (branch ${guardianResult.branchId}, confidence ${guardianResult.matchConfidence})`);
    } else {
      reportGuardianCandidateOutcome(sessionId, guardianResult, false);
      console.log(`[Runtime] Guardian candidate rejected by FastVerifier: ${verifier.rejectedReason}`);
    }
  }

  if (!guardianPreparedResponse) {
    // Guardian miss — run coordinator normally
    try {
      const { systemPrompt, userPrompt } = assembleCoordinatorPrompt({
        context,
        latestMessage: studentMessage,
      });

      // v1.007-05: use retry for network resilience (text mode regenerate benefits from this)
      const coordinatorStartMs = Date.now();
      const coordResult = await callLLMWithRetry([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], {
        model: config.coordinatorModel,
        temperature: config.coordinatorTemperature,
        max_tokens: config.coordinatorMaxTokens,
      });
      perf.coordinator_ms = Date.now() - coordinatorStartMs;

      coordinatorUsage = coordResult.usage;

      const parsed = parseLLMJsonObject(coordResult.content, 'Coordinator');
      if (parsed) {
        analysis = applyCoordinatorParsedAnalysis(analysis, parsed);

        // Confidence fallback
        if (analysis.confidence < config.confidenceFallbackThreshold) {
          analysis.skillWeights = { empathy: 0.9, cognitive: 0.1, action: 0, closing: 0 };
          analysis.guidance = '置信度低，使用安全倾听模式，先共情再说';
          analysis.stage = 'listening';
          stopReason = 'low_confidence';
        }
      }
    } catch (e) {
      console.error('[Runtime] Coordinator error:', e.message);
      stopReason = 'coordinator_error';
    }
  }

  // Step 3: Write emotion to last student message
  writeEmotionToMessage(sessionId, analysis);

  // Step 4: Generate suggestion (or use guardian prepared response)
  let agentResult;
  if (guardianPreparedResponse) {
    // Guardian already prepared a full response — skip generator entirely
    agentResult = {
      content: guardianPreparedResponse,
      model: 'guardian-prepared',
      usage: null,
    };
  } else {
    const { chatMessages } = assembleSuggestionPrompt({ context, analysis, teacherGuidance });
    try {
      // v1.007-05: use retry for generator too
      const generatorStartMs = Date.now();
      agentResult = await callLLMWithRetry(chatMessages, {
        model: config.generatorModel,
        max_tokens: config.generatorMaxTokens,
      });
      perf.generator_ms = Date.now() - generatorStartMs;
      perf.pipeline_ms = perf.coordinator_ms + perf.generator_ms;
    } catch (e) {
      console.error('[Runtime] Generator error:', e.message);
      guardian.onMainTurnComplete(sessionId);
      return {
        error: '建议生成失败: ' + e.message,
        stopReason: 'generator_error',
        analysis: { ...analysis, stageName: STAGE_NAMES[analysis.stage] || analysis.stage },
      };
    }
  }
  perf.stop_reason = guardianPreparedResponse ? 'guardian_micro_fast_path' : stopReason;
  perf.total_runtime_ms = Date.now() - runtimeStartMs;

  // Step 5: Write traces
  const suggestions = analysis.suggestions || [{ content: agentResult.content, delay: 0 }];
  const tracePayload = context.tracePayload;

  let triggerMessageId = null;
  const recentStudentMsgs = context.recentMessages.filter(m => m.sender_type === 'student');
  if (recentStudentMsgs.length > 0) {
    triggerMessageId = recentStudentMsgs[recentStudentMsgs.length - 1].id;
  }

  let suggestionTraceId = null;
  if (config.traceEnabled) {
    analysis.openLoop = openLoopState;
    suggestionTraceId = writeSuggestionTrace({
      sessionId,
      studentId,
      triggerMessageId,
      coordinatorModel: config.coordinatorModel,
      generatorModel: config.generatorModel,
      assembledContextJson: context.contextText,
      analysis,
      suggestions,
      usage: { coordinator: coordinatorUsage, generator: agentResult.usage, perf },
      openLoop: openLoopState,
    });

    if (suggestionTraceId) {
      writeContextTrace({
        sessionId,
        studentId,
        suggestionTraceId,
        recentMessageIds: tracePayload.recentMessageIds,
        usedRollingIds: tracePayload.usedRollingIds,
        usedFinalIds: tracePayload.usedFinalIds,
        usedThreadFields: tracePayload.usedThreadFields,
        usedProfileFields: tracePayload.usedProfileFields,
        usedMemoryFragmentIds: tracePayload.usedMemoryFragmentIds,
        retrievalMode: tracePayload.retrievalMode,
        estimatedTokens: context.tokenEstimate,
      });
    }
  }

  // Step 6: Return structured result. This is a preview only; OpenLoop and Guardian
  // are updated when the teacher sends the selected reply.
  return {
    suggestion: agentResult.content,
    suggestions,
    continueIf: analysis.continueIf || null,
    stopReason,
    speculativeHit,
    speculativeSavedMs,
    analysis: {
      stage: analysis.stage,
      stageName: STAGE_NAMES[analysis.stage] || analysis.stage,
      skillWeights: analysis.skillWeights,
      emotion: analysis.emotion,
      confidence: analysis.confidence,
      guidance: analysis.guidance,
      mirrorCues: analysis.mirrorCues,
      currentTopic: analysis.currentTopic || null,
      reason: analysis.reason,
      openLoop: openLoopState,
    },
    triggerMessage: studentMessage,
    triggerMessageId,
    suggestionTraceId,
    model: agentResult.model,
    usage: {
      coordinator: coordinatorUsage,
      generator: agentResult.usage,
      perf,
    },
    contextMeta: {
      crossSessionCount: context.crossSessionCount,
      hasRolling: context.hasRolling,
      recentCount: context.recentCount,
      tokenEstimate: context.tokenEstimate,
      retrievalMode: tracePayload.retrievalMode || 'legacy',
    },
  };
}

/**
 * Write emotion data from coordinator analysis to the last student message.
 */
function writeEmotionToMessage(sessionId, analysis) {
  if (!analysis.emotion || typeof analysis.emotion !== 'object' || !analysis.emotion.intensity) return;
  try {
    const db = getDb();
    const lastMsg = db.prepare(`
      SELECT id FROM t_message WHERE session_id = ? AND sender_type = 'student'
      ORDER BY id DESC LIMIT 1
    `).get(sessionId);
    if (lastMsg) {
      db.prepare('UPDATE t_message SET emotion_intensity = ?, emotion_label = ? WHERE id = ?')
        .run(analysis.emotion.intensity, analysis.emotion.primary, lastMsg.id);
    }
  } catch (e) { /* non-fatal */ }
}

/**
 * Streaming version of runSuggestionTurn.
 * Coordinator runs non-streaming (needs complete JSON), Generator streams.
 * Yields sentence-sized chunks for TTS pipeline.
 *
 * @param {Object} params
 * @yields {{ type: string, data: any }}
 *   type: 'analysis' | 'sentence' | 'done' | 'error'
 */
async function* runSuggestionTurnStreaming({ sessionId, studentId, latestMessage, mode = 'text' }) {
  const runtimeStartMs = Date.now();
  const perf = {
    guardian_match_ms: 0,
    verifier_ms: 0,
    coordinator_ms: 0,
    generator_ms: 0,
    pipeline_ms: 0,
    generator_skipped: false,
    guardian_candidate: false,
    guardian_fast_path: false,
    continuation_direct: false,
    coordinator_skipped: false,
    candidate_source: null,
    verifier_decision: 'fallback',
    rejected_reason: null,
    draft_age_ms: null,
    fast_path_saved_ms: 0,
    branch_id: null,
    match_confidence: null,
    branch_memory_hit: false,
    branch_memory_score: null,
    stop_reason: null,
  };

  // Step 1: Assemble context (same as non-streaming)
  const context = assembleSuggestionContext({ sessionId, studentId, latestMessage });
  context.rawContextText = context.contextText || '';

  if (context.recentCount === 0) {
    yield { type: 'error', data: { message: '该会话暂无消息', stopReason: 'no_messages' } };
    return;
  }

  const studentMessage = context.studentMessage || '';
  const openLoopState = openLoopManager.resolve({
    sessionId,
    studentId,
    latestMessage: studentMessage,
  });
  if (openLoopState.hint) {
    context.tracePayload.openLoopId = openLoopState.active_loop?.id || null;
    context.tracePayload.openLoopAction = openLoopState.action;
  }
  const continuationPlan = continuationResolver.buildPlan({
    latestMessage: studentMessage,
    sessionId,
    studentId,
  });
  const gateResult = contextGate.evaluate({
    context,
    latestMessage: studentMessage,
    openLoopState,
    continuationPlan,
    mode,
  });
  contextGate.applyToContext(context, gateResult);
  applyContextGatePerf(perf, gateResult);

  const directDecision = buildContinuationDirectDecision(openLoopState, continuationPlan, { mode, latestMessage: studentMessage });
  if (directDecision && gateResult.directPolicy.allowDirectReply) {
    const continuationDirectReply = directDecision.reply;
    applyContinuationDirectPerf(perf, directDecision, runtimeStartMs);
    console.log(`[Runtime-Stream] Continuation direct ${directDecision.reason}: ${(directDecision.labels || []).join(' | ')}`);
    console.log(`[Runtime-Perf] ${JSON.stringify({ sessionId, ...perf })}`);
    guardian.onMainTurnStart(sessionId);
    const analysis = {
      stage: 'listening',
      stageName: STAGE_NAMES.listening || 'listening',
      skillWeights: DEFAULT_ANALYSIS.skillWeights,
      emotion: DEFAULT_ANALYSIS.emotion,
      confidence: 1,
      guidance: '续聊意图由开放环路/四层记忆解析器接管',
      mirrorCues: '',
      currentTopic: null,
      topicCandidates: directDecision.labels || [],
      speculativeHit: false,
      speculativeSavedMs: 0,
      perf,
      openLoop: openLoopState,
      contextGate: gateResult.trace,
    };
    const suggestionTraceId = writeRuntimeTrace({
      sessionId,
      studentId,
      context,
      analysis,
      suggestions: [{ content: continuationDirectReply, delay: 0 }],
      coordinatorUsage: null,
      generatorUsage: null,
      perf,
      generatorModel: 'direct-continuation',
      openLoopState,
    });
    yield {
      type: 'analysis',
      data: analysis,
    };
    for (const sentence of splitSentences(continuationDirectReply)) {
      yield { type: 'sentence', data: { text: sentence } };
    }
    openLoopManager.observeTurn({
      sessionId,
      studentId,
      studentText: studentMessage,
      aiText: continuationDirectReply,
      topic: null,
      source: 'continuation_direct_reply',
    });
    guardian.rememberTurnDraft({
      sessionId,
      studentId,
      studentText: studentMessage,
      aiText: continuationDirectReply,
      topic: null,
      source: 'continuation_direct_reply',
    });
    guardian.onMainTurnComplete(sessionId);
    yield {
      type: 'done',
      data: {
        fullContent: continuationDirectReply,
        suggestionTraceId,
        speculativeHit: false,
        stopReason: perf.stop_reason,
        usage: { coordinator: null, generator: null },
        perf,
        openLoop: openLoopState,
      },
    };
    return;
  }

  // Step 2: Coordinator — check guardian first
  let analysis = { ...DEFAULT_ANALYSIS };
  let coordinatorUsage = null;
  let speculativeHit = false;
  let guardianCandidate = null; // v1.008: Guardian branch object, optionally consumed by fast path

  guardian.onMainTurnStart(sessionId);

  // v1.007-05: In streaming (voice) mode, Guardian HIT becomes a "reference candidate"
  // Coordinator ALWAYS runs; Guardian's response is injected into generator prompt as suggestion
  const guardianMatchStartMs = Date.now();
  const guardianResult = await guardian.checkPreparedResponse(sessionId, studentMessage);
  perf.guardian_match_ms = Date.now() - guardianMatchStartMs;
  if (guardianResult && guardianResult.response) {
    guardianCandidate = guardianResult;
    speculativeHit = true;
    perf.guardian_candidate = true;
    perf.candidate_source = guardianResult.source || 'prepared_branch';
    perf.draft_age_ms = guardianResult.savedMs ?? null;
    perf.branch_id = guardianResult.branchId || null;
    perf.match_confidence = guardianResult.matchConfidence || null;
    perf.branch_memory_hit = !!guardianResult.branchMemoryId;
    perf.branch_memory_score = guardianResult.memoryScore ?? null;
    console.log(`[Runtime-Stream] Guardian candidate available (confidence ${guardianResult.matchConfidence})`);
  }

  const preGatePolicy = contextGate.evaluateGuardianPolicy(gateResult, {
    guardianCandidate,
    latestMessage: studentMessage,
  });
  const preVerifier = preGatePolicy.decision === 'reject'
    ? contextGate.gateRejectResult(preGatePolicy, guardianCandidate)
    : verifyGuardianCandidate({
        guardianCandidate,
        latestMessage: studentMessage,
        openLoop: openLoopState,
        activeFrame: topicFrame.getFrame(sessionId),
        mode: 'pre_coordinator',
      });
  applyVerifierResult(perf, preVerifier);

  if (preVerifier.decision === 'accept' && canUsePreCoordinatorFastPath({ guardianCandidate, latestMessage: studentMessage, sessionId })) {
    const response = guardianCandidate.response;
    reportGuardianCandidateOutcome(sessionId, guardianCandidate, true);
    const fastAnalysis = {
      ...DEFAULT_ANALYSIS,
      ...(guardianCandidate.analysis || {}),
      confidence: 0.95,
      guidance: 'Guardian micro fast path',
      currentTopic: guardianCandidate.expectedTopic,
      openLoop: openLoopState,
    };
    perf.generator_skipped = true;
    perf.guardian_fast_path = true;
    perf.coordinator_skipped = true;
    perf.pipeline_ms = 0;
    perf.stop_reason = 'guardian_micro_fast_path';
    perf.total_runtime_ms = Date.now() - runtimeStartMs;
    console.log(`[Runtime-Stream] Guardian micro fast path before Coordinator: ${guardianCandidate.expectedTopic}`);
    console.log(`[Runtime-Perf] ${JSON.stringify({ sessionId, ...perf })}`);
    const suggestionTraceId = writeRuntimeTrace({
      sessionId,
      studentId,
      context,
      analysis: fastAnalysis,
      suggestions: [{ content: response, delay: 0 }],
      coordinatorUsage: null,
      generatorUsage: null,
      perf,
      generatorModel: 'guardian-prepared',
      openLoopState,
    });

    yield {
      type: 'analysis',
      data: {
        stage: fastAnalysis.stage,
        stageName: STAGE_NAMES[fastAnalysis.stage] || STAGE_NAMES.listening || 'listening',
        skillWeights: fastAnalysis.skillWeights,
        emotion: fastAnalysis.emotion,
        confidence: fastAnalysis.confidence,
        guidance: fastAnalysis.guidance,
        mirrorCues: fastAnalysis.mirrorCues || '',
        currentTopic: fastAnalysis.currentTopic,
        topicCandidates: [guardianCandidate.expectedTopic],
        speculativeHit: true,
        speculativeSavedMs: guardianResult?.savedMs || 0,
        perf,
        openLoop: openLoopState,
      },
    };
    for (const sentence of splitSentences(response)) {
      yield { type: 'sentence', data: { text: sentence } };
    }
    openLoopManager.observeTurn({
      sessionId,
      studentId,
      studentText: studentMessage,
      aiText: response,
      topic: fastAnalysis.currentTopic,
    });
    guardian.rememberTurnDraft({
      sessionId,
      studentId,
      studentText: studentMessage,
      aiText: response,
      topic: fastAnalysis.currentTopic,
      source: 'guardian_fast_path_reply',
    });
    guardian.onMainTurnComplete(sessionId);
    yield {
      type: 'done',
      data: {
        fullContent: response,
        suggestionTraceId,
        speculativeHit: true,
        stopReason: perf.stop_reason,
        usage: { coordinator: null, generator: null },
        perf,
        openLoop: openLoopState,
      },
    };
    return;
  }

  // Coordinator always runs in streaming mode (even if Guardian matched)
  {
    try {
      const { systemPrompt, userPrompt } = assembleCoordinatorPrompt({
        context, latestMessage: studentMessage,
      });

      // v1.007-05: Use retry for streaming (voice) mode — network can be flaky
      const coordinatorStartMs = Date.now();
      const coordResult = await callLLMWithRetry([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], {
        model: config.coordinatorModel,
        temperature: config.coordinatorTemperature,
        max_tokens: config.coordinatorMaxTokens,
      });
      perf.coordinator_ms = Date.now() - coordinatorStartMs;

      coordinatorUsage = coordResult.usage;

      const parsed = parseLLMJsonObject(coordResult.content, 'Coordinator');
      if (parsed) {
        analysis = applyCoordinatorParsedAnalysis(analysis, parsed);

        if (analysis.confidence < config.confidenceFallbackThreshold) {
          analysis.skillWeights = { empathy: 0.9, cognitive: 0.1, action: 0, closing: 0 };
          analysis.guidance = '置信度低，使用安全倾听模式';
          analysis.stage = 'listening';
        }
      }
    } catch (e) {
      console.error('[Runtime] Coordinator error:', e.message);
      yield { type: 'error', data: { message: 'Coordinator error', stopReason: 'coordinator_error' } };
      return;
    }
  }

  writeEmotionToMessage(sessionId, analysis);

  let topicResult = resolveCurrentTopic({
    coordTopic: analysis.currentTopic,
    sessionId,
    studentId,
    latestMessage: studentMessage,
  });
  let topicHint = buildTopicClarificationHint(topicResult);
  if (continuationPlan.action === 'lock') {
    topicResult = {
      topic: continuationPlan.topic,
      candidates: continuationPlan.candidates.map(c => ({ topic: c.topic, source: c.sources.join('+'), strength: 'strong' })),
      confident: true,
      source: 'continuation_resolver',
      ambiguous: false,
    };
    topicHint = continuationResolver.buildControlHint(continuationPlan);
  }
  if (openLoopState.action === 'resume' && openLoopState.active_loop?.topic) {
    topicResult = {
      topic: openLoopState.active_loop.topic,
      candidates: [{
        topic: openLoopState.active_loop.topic,
        source: 'open_loop',
        strength: 'strong',
      }],
      confident: true,
      source: 'open_loop',
      ambiguous: false,
    };
    topicHint = openLoopState.hint;
  } else if (openLoopState.hint && !topicHint) {
    topicHint = openLoopState.hint;
  }
  const frameState = topicFrame.update({
    sessionId,
    latestMessage: studentMessage,
    topicResult,
    openLoop: openLoopState,
  });
  topicResult = frameState.topicResult || topicResult;
  if (frameState.hint) {
    topicHint = topicHint ? `${topicHint}\n${frameState.hint}` : frameState.hint;
  }
  console.log(`[Runtime-Stream] Topic result: topic=${topicResult.topic || 'null'}, confident=${topicResult.confident}, ambiguous=${topicResult.ambiguous}, candidates=${topicResult.candidates.map(c => c.topic).slice(0, 4).join(' | ')}`);

  // Yield analysis immediately (frontend can show skill weights while waiting for text)
  yield {
    type: 'analysis',
    data: {
      stage: analysis.stage,
      stageName: STAGE_NAMES[analysis.stage] || analysis.stage,
      skillWeights: analysis.skillWeights,
      emotion: analysis.emotion,
      confidence: analysis.confidence,
      guidance: analysis.guidance,
      mirrorCues: analysis.mirrorCues,
      currentTopic: topicResult.topic || analysis.currentTopic || null,
      topicCandidates: topicResult.candidates.map(c => c.topic),
      speculativeHit,
      speculativeSavedMs: guardianResult?.savedMs || 0,
      perf: { ...perf },
      openLoop: openLoopState,
      activeFrame: frameState.frame,
      topicStack: frameState.topicStack,
      contextGate: gateResult.trace,
    },
  };

  const postGatePolicy = contextGate.evaluateGuardianPolicy(gateResult, {
    guardianCandidate,
    latestMessage: studentMessage,
  });
  const postVerifier = postGatePolicy.decision === 'reject'
    ? contextGate.gateRejectResult(postGatePolicy, guardianCandidate)
    : verifyGuardianCandidate({
        guardianCandidate,
        latestMessage: studentMessage,
        topicResult,
        openLoop: openLoopState,
        activeFrame: frameState.frame,
        mode: 'post_coordinator',
      });
  applyVerifierResult(perf, postVerifier);

  if (postVerifier.decision === 'accept'
      && guardianCandidate
      && topicResult.confident
      && topicCompatible(topicResult.topic, guardianCandidate.expectedTopic)) {
    const response = guardianCandidate.response;
    reportGuardianCandidateOutcome(sessionId, guardianCandidate, true);
    const fastAnalysis = {
      ...analysis,
      currentTopic: topicResult.topic || analysis.currentTopic || guardianCandidate.expectedTopic,
      openLoop: openLoopState,
    };
    perf.generator_skipped = true;
    perf.guardian_fast_path = true;
    perf.pipeline_ms = perf.coordinator_ms;
    perf.stop_reason = 'topic_guarded_hit';
    perf.total_runtime_ms = Date.now() - runtimeStartMs;
    console.log(`[Runtime-Stream] Guardian fast path: ${guardianCandidate.expectedTopic} ≈ ${topicResult.topic}`);
    console.log(`[Runtime-Perf] ${JSON.stringify({ sessionId, ...perf })}`);
    for (const sentence of splitSentences(response)) {
      yield { type: 'sentence', data: { text: sentence } };
    }
    const suggestionTraceId = writeRuntimeTrace({
      sessionId,
      studentId,
      context,
      analysis: fastAnalysis,
      suggestions: [{ content: response, delay: 0 }],
      coordinatorUsage,
      generatorUsage: null,
      perf,
      generatorModel: 'guardian-prepared',
      openLoopState,
    });
    openLoopManager.observeTurn({
      sessionId,
      studentId,
      studentText: studentMessage,
      aiText: response,
      topic: fastAnalysis.currentTopic,
    });
    guardian.rememberTurnDraft({
      sessionId,
      studentId,
      studentText: studentMessage,
      aiText: response,
      topic: fastAnalysis.currentTopic,
      source: 'guardian_fast_path_reply',
    });
    guardian.onMainTurnComplete(sessionId);
    yield {
      type: 'done',
      data: {
        fullContent: response,
        suggestionTraceId,
        speculativeHit: true,
        stopReason: perf.stop_reason,
        usage: { coordinator: coordinatorUsage, generator: null },
        perf,
        openLoop: openLoopState,
      },
    };
    return;
  }

  if (guardianCandidate && postVerifier.decision === 'reject') {
    reportGuardianCandidateOutcome(sessionId, guardianCandidate, false);
  }

  // Step 3: Generator (STREAMING) — always runs, Guardian candidate as reference
  let fullContent = '';

  {
    const { chatMessages } = assembleSuggestionPrompt({ context, analysis, teacherGuidance: null });

    const lastUserIdx = chatMessages.findLastIndex(m => m.role === 'user');
    if (lastUserIdx >= 0 && topicHint) {
      chatMessages[lastUserIdx] = {
        ...chatMessages[lastUserIdx],
        content: chatMessages[lastUserIdx].content + topicHint,
      };
    } else if (lastUserIdx >= 0 && guardianCandidate) {
      chatMessages[lastUserIdx] = {
        ...chatMessages[lastUserIdx],
        content: chatMessages[lastUserIdx].content +
          `\n\n【Guardian参考建议】适用话题：${guardianCandidate.expectedTopic || '未标注'}\n${guardianCandidate.response}\n（仅供参考，如果与当前话题不符请忽略）`,
      };
    }

    try {
      const generatorStartMs = Date.now();
      const stream = callLLMStreaming(chatMessages, {
        model: config.generatorModel,
        max_tokens: config.generatorMaxTokens,
      });

      for await (const { text } of collectSentences(stream)) {
        fullContent += text;
        yield { type: 'sentence', data: { text } };
      }
      perf.generator_ms = Date.now() - generatorStartMs;
      perf.pipeline_ms = perf.coordinator_ms + perf.generator_ms;
    } catch (e) {
      console.error('[Runtime] Generator streaming error:', e.message);
      guardian.onMainTurnComplete(sessionId);
      yield { type: 'error', data: { message: 'Generator error', stopReason: 'generator_error' } };
      return;
    }
  }

  // Step 4: Write traces
  const generatorMeta = callLLMStreaming._lastResult || {};
  const tracePayload = context.tracePayload;

  let triggerMessageId = null;
  const recentStudentMsgs = context.recentMessages.filter(m => m.sender_type === 'student');
  if (recentStudentMsgs.length > 0) {
    triggerMessageId = recentStudentMsgs[recentStudentMsgs.length - 1].id;
  }

  let suggestionTraceId = null;
  if (config.traceEnabled) {
    analysis.openLoop = openLoopState;
    suggestionTraceId = writeSuggestionTrace({
      sessionId, studentId, triggerMessageId,
      coordinatorModel: config.coordinatorModel,
      generatorModel: config.generatorModel,
      assembledContextJson: context.contextText,
      analysis,
      suggestions: [{ content: fullContent, delay: 0 }],
      usage: { coordinator: coordinatorUsage, generator: generatorMeta.usage, perf },
      openLoop: openLoopState,
    });

    if (suggestionTraceId) {
      writeContextTrace({
        sessionId, studentId, suggestionTraceId,
        recentMessageIds: tracePayload.recentMessageIds,
        usedRollingIds: tracePayload.usedRollingIds,
        usedFinalIds: tracePayload.usedFinalIds,
        usedThreadFields: tracePayload.usedThreadFields,
        usedProfileFields: tracePayload.usedProfileFields,
        usedMemoryFragmentIds: tracePayload.usedMemoryFragmentIds,
        retrievalMode: tracePayload.retrievalMode,
        estimatedTokens: context.tokenEstimate,
      });
    }
  }

  openLoopManager.observeTurn({
    sessionId,
    studentId,
    studentText: studentMessage,
    aiText: fullContent,
    topic: topicResult.topic || analysis.currentTopic,
  });
  guardian.rememberTurnDraft({
    sessionId,
    studentId,
    studentText: studentMessage,
    aiText: fullContent,
    topic: topicResult.topic || analysis.currentTopic,
    source: 'slow_pipeline_reply',
  });

  // Step 5: Notify guardian that main turn is complete
  guardian.onMainTurnComplete(sessionId);

  perf.generator_skipped = false;
  perf.stop_reason = speculativeHit ? 'speculative_hit' : 'completed';
  perf.total_runtime_ms = Date.now() - runtimeStartMs;
  console.log(`[Runtime-Perf] ${JSON.stringify({ sessionId, ...perf })}`);

  // Step 6: Done
  yield {
    type: 'done',
    data: {
      fullContent,
      suggestionTraceId,
      speculativeHit,
      stopReason: perf.stop_reason,
      usage: { coordinator: coordinatorUsage, generator: generatorMeta.usage },
      perf,
      openLoop: openLoopState,
    },
  };
}

module.exports = {
  runSuggestionTurn,
  runSuggestionTurnStreaming,
};







