/**
 * Fast Verifier - v1.009
 *
 * A lightweight gate before Guardian prepared responses are allowed to bypass
 * the slow Pipeline. It is intentionally rule-based for the first v1.009 pass:
 * fast enough to run every turn and conservative enough to fail closed.
 */

const MAX_DRAFT_AGE_MS = 5 * 60 * 1000;

function normalizeTopic(topic) {
  if (!topic || topic === 'null' || topic === '未指定' || topic === '无法判断') return null;
  const value = String(topic).trim();
  return value || null;
}

function topicCompatible(left, right) {
  const a = normalizeTopic(left);
  const b = normalizeTopic(right);
  if (!a || !b) return false;
  const aSubject = subjectOf(a);
  const bSubject = subjectOf(b);
  return a.includes(b) || b.includes(a) || (!!aSubject && aSubject === bSubject);
}

function subjectOf(text) {
  const value = String(text || '');
  if (/实心球|体育|踩线|中考体育|球|老师没喊停/.test(value)) return 'sports_exam';
  if (/政治|新民主主义|社会主义|公有制|三大改造|1956|初级阶段/.test(value)) return 'politics';
  if (/历史/.test(value)) return 'history';
  if (/数学|函数|几何|方程|解题/.test(value)) return 'math';
  if (/语文|文言文|古文|桃花源记|背诵/.test(value)) return 'chinese';
  if (/同学|玩笑|开玩笑|说我|别人怎么看|发抖|社交|人际/.test(value)) return 'social_anxiety';
  if (/焦虑|紧张|害怕|担心|纠结/.test(value)) return 'emotion';
  return null;
}

function hasRiskSignal(text) {
  return /自杀|不想活|想死|割腕|跳楼|伤害自己|伤害别人|杀人|报警|急救|救命/.test(String(text || ''));
}

function isMicroIntent(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 24) return false;
  return /^(嗯+|哦+|好+|可以|对|是的|有点|明白|懂了|然后呢|为什么|怎么说|继续|接着|展开|详细|举例|举个例子|换种说法|我不懂|没懂|往下说|接着讲|继续说)/.test(value);
}

function responseTopicConflict({ latestMessage, response, topicResult, expectedTopic, openLoop, activeFrame }) {
  const targetText = [
    latestMessage,
    topicResult?.topic,
    expectedTopic,
    openLoop?.active_loop?.topic || openLoop?.activeLoop?.topic,
    activeFrame?.topic,
  ].filter(Boolean).join(' ');
  const targetSubject = subjectOf(targetText);
  const responseSubject = subjectOf(response);

  if (!targetSubject || !responseSubject) return null;
  if (targetSubject === responseSubject) return null;

  if (targetSubject === 'politics' && responseSubject === 'sports_exam') {
    return 'body_topic_mismatch';
  }
  if (targetSubject === 'sports_exam' && responseSubject === 'politics') {
    return 'body_topic_mismatch';
  }
  if (targetSubject === 'math' && responseSubject !== 'math') {
    return 'body_topic_mismatch';
  }
  if (targetSubject === 'chinese' && responseSubject !== 'chinese') {
    return 'body_topic_mismatch';
  }
  return null;
}

function buildDecision(decision, patch = {}, startMs) {
  return {
    decision,
    rejectedReason: patch.rejectedReason || null,
    candidateSource: patch.candidateSource || null,
    draftAgeMs: patch.draftAgeMs ?? null,
    verifierMs: Date.now() - startMs,
    coordinatorSkipped: !!patch.coordinatorSkipped,
    fastPathSavedMs: patch.fastPathSavedMs || 0,
  };
}

function verifyGuardianCandidate({
  guardianCandidate,
  latestMessage,
  topicResult,
  openLoop,
  activeFrame,
  mode = 'post_coordinator',
}) {
  const startMs = Date.now();

  if (!guardianCandidate || !guardianCandidate.response) {
    return buildDecision('fallback', { rejectedReason: 'no_candidate' }, startMs);
  }

  const candidateSource = guardianCandidate.source || 'prepared_branch';
  const draftAgeMs = guardianCandidate.savedMs ?? (
    guardianCandidate.generatedAt ? Date.now() - guardianCandidate.generatedAt : null
  );

  const base = { candidateSource, draftAgeMs };

  if (hasRiskSignal(latestMessage)) {
    return buildDecision('reject', { ...base, rejectedReason: 'risk_high' }, startMs);
  }

  if ((guardianCandidate.matchConfidence || 0) < 0.8) {
    return buildDecision('reject', { ...base, rejectedReason: 'weak_intent' }, startMs);
  }

  if (draftAgeMs != null && draftAgeMs > MAX_DRAFT_AGE_MS) {
    return buildDecision('reject', { ...base, rejectedReason: 'stale_draft' }, startMs);
  }

  const expectedTopic = normalizeTopic(guardianCandidate.expectedTopic);
  if (!expectedTopic) {
    return buildDecision('reject', { ...base, rejectedReason: 'missing_expected_topic' }, startMs);
  }

  const activeLoopTopic = normalizeTopic(openLoop?.active_loop?.topic || openLoop?.activeLoop?.topic);
  if (activeLoopTopic && !topicCompatible(activeLoopTopic, expectedTopic)) {
    return buildDecision('reject', { ...base, rejectedReason: 'open_loop_conflict' }, startMs);
  }

  if (topicResult?.confident && topicResult.topic && !topicCompatible(topicResult.topic, expectedTopic)) {
    return buildDecision('reject', { ...base, rejectedReason: 'topic_mismatch' }, startMs);
  }

  const bodyConflict = responseTopicConflict({
    latestMessage,
    response: guardianCandidate.response,
    topicResult,
    expectedTopic,
    openLoop,
    activeFrame,
  });
  if (bodyConflict) {
    return buildDecision('reject', { ...base, rejectedReason: bodyConflict }, startMs);
  }

  if (mode === 'pre_coordinator') {
    if ((guardianCandidate.matchConfidence || 0) < 0.9) {
      return buildDecision('reject', { ...base, rejectedReason: 'weak_intent' }, startMs);
    }
    if (!isMicroIntent(latestMessage)) {
      return buildDecision('reject', { ...base, rejectedReason: 'not_micro_intent' }, startMs);
    }
    return buildDecision('accept', {
      ...base,
      coordinatorSkipped: true,
      fastPathSavedMs: 3000,
    }, startMs);
  }

  if (!topicResult?.confident || !topicResult.topic) {
    return buildDecision('reject', { ...base, rejectedReason: 'weak_topic' }, startMs);
  }

  return buildDecision('accept', {
    ...base,
    coordinatorSkipped: false,
    fastPathSavedMs: 1800,
  }, startMs);
}

function applyVerifierResult(perf, result) {
  if (!perf || !result) return;
  perf.verifier_decision = result.decision;
  perf.rejected_reason = result.rejectedReason;
  perf.candidate_source = result.candidateSource;
  perf.draft_age_ms = result.draftAgeMs;
  perf.verifier_ms = result.verifierMs;
  perf.coordinator_skipped = result.coordinatorSkipped;
  perf.fast_path_saved_ms = result.fastPathSavedMs || 0;
}

module.exports = {
  verifyGuardianCandidate,
  applyVerifierResult,
};
