/**
 * Topic Flow Judge - v1.009
 *
 * Lightweight flow classifier for topic continuation. It avoids phrase-table
 * routing by combining recency, text overlap, subject match and loop type.
 */

const branchMemory = require('../guardian/branch-memory');

const STOP_CHARS = new Set('我你他她它们的是了呢啊吧吗呀就还又再很有和跟把被在到这那一个一下刚才前面继续接着回来回来了'.split(''));
const EMOTION_TYPES = new Set(['stuck_point', 'question', 'action']);

function toTime(value) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function compact(text) {
  return String(text || '')
    .replace(/【[^】]+】/g, ' ')
    .replace(/[\s，。！？、；：,.!?;:()[\]（）“”"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  const value = compact(text);
  const chars = [...value].filter(ch => !STOP_CHARS.has(ch));
  const out = new Set();
  for (const ch of chars) out.add(ch);
  for (let i = 0; i < chars.length - 1; i += 1) out.add(`${chars[i]}${chars[i + 1]}`);
  return out;
}

function overlapScore(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const item of a) {
    if (b.has(item)) hit += item.length > 1 ? 2 : 1;
  }
  return Math.min(1, hit / Math.max(6, Math.min(a.size, b.size)));
}

function loopText(loop) {
  return [loop.topic, loop.subtopic, loop.unresolved_point, loop.suggested_resume, loop.evidence]
    .filter(Boolean)
    .join(' ');
}

function recencyScore(loop, nowMs = Date.now()) {
  const lastSeen = toTime(loop.last_seen_at || loop.updated_at || loop.created_at);
  if (!lastSeen) return { score: 0, hours: Infinity, stalePenalty: 1.2 };
  const hours = Math.max(0, (nowMs - lastSeen) / 36e5);
  if (hours <= 2) return { score: 4.2, hours, stalePenalty: 0 };
  if (hours <= 24) return { score: 3.6, hours, stalePenalty: 0 };
  if (hours <= 72) return { score: 2.8, hours, stalePenalty: 0.2 };
  if (hours <= 168) return { score: 1.4, hours, stalePenalty: 0.8 };
  return { score: 0.4, hours, stalePenalty: Math.min(2.4, hours / 168) };
}

function typePriority(loop) {
  if (EMOTION_TYPES.has(loop.type)) return 1.1;
  if (loop.type === 'commitment') return 0.35;
  return 0.65;
}

function scoreLoop(loop, { latestMessage, sessionId, nowMs = Date.now() }) {
  const text = String(latestMessage || '');
  const content = loopText(loop);
  const msgSubject = branchMemory.subjectOf(text);
  const loopSubject = branchMemory.subjectOf(content);
  const similarity = overlapScore(text, content);
  const recency = recencyScore(loop, nowMs);
  const sameSession = Number(loop.session_id) === Number(sessionId);

  let score = 0;
  score += Math.min(2.2, Number(loop.confidence || 0) * 2.2);
  score += recency.score;
  score += similarity * 5.5;
  score += typePriority(loop);
  if (sameSession) score += 0.8;
  if (msgSubject && loopSubject && msgSubject === loopSubject) score += 0.9;
  if (msgSubject && loopSubject && msgSubject !== loopSubject) score -= 3.2;
  if (msgSubject && loopSubject && msgSubject === loopSubject && similarity < 0.18 && !sameSession) score -= 1.4;
  score -= recency.stalePenalty;

  return {
    loop,
    score: Math.round(score * 100) / 100,
    factors: {
      confidence: Number(loop.confidence || 0),
      recencyHours: Number.isFinite(recency.hours) ? Math.round(recency.hours * 10) / 10 : null,
      similarity: Math.round(similarity * 100) / 100,
      msgSubject,
      loopSubject,
      sameSession,
      type: loop.type,
      stalePenalty: recency.stalePenalty,
    },
  };
}

function judge({ latestMessage, openLoops = [], sessionId }) {
  const ranked = openLoops
    .map(loop => scoreLoop(loop, { latestMessage, sessionId }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0] || null;
  const runner = ranked[1] || null;
  if (!top) {
    return { intent: 'observe', confidence: 0, targetLoopId: null, rankedLoops: [], allowFastBridge: false };
  }

  const margin = runner ? top.score - runner.score : top.score;
  const topSubject = top.factors.loopSubject;
  const msgSubject = top.factors.msgSubject;
  const clearSwitch = msgSubject && topSubject && msgSubject !== topSubject && top.factors.similarity < 0.24;

  if (clearSwitch) {
    return {
      intent: 'switch_topic',
      confidence: 0.78,
      targetLoopId: null,
      rankedLoops: ranked,
      allowFastBridge: false,
      topicDrift: 1,
      reason: 'subject_conflict',
    };
  }

  const sameSubjectCluster = runner
    && top.factors.loopSubject
    && top.factors.loopSubject === runner.factors.loopSubject;

  if (margin < 1.15 && ranked.length > 1 && !sameSubjectCluster) {
    return {
      intent: 'clarify_needed',
      confidence: 0.58,
      targetLoopId: null,
      rankedLoops: ranked,
      allowFastBridge: false,
      topicDrift: 0.45,
      reason: 'close_candidates',
    };
  }

  const subjectOnly = top.factors.msgSubject && top.factors.loopSubject && top.factors.msgSubject === top.factors.loopSubject && top.factors.similarity < 0.18;
  const intent = top.factors.similarity >= 0.28 || (sameSubjectCluster && !subjectOnly) ? 'resume_recent' : 'continue_current';
  return {
    intent,
    confidence: Math.min(0.94, Math.max(0.62, top.score / 8)),
    targetLoopId: top.loop.id,
    rankedLoops: ranked,
    allowFastBridge: top.score >= 4.2 && !subjectOnly,
    topicDrift: 0,
    reason: top.factors.recencyHours !== null && top.factors.recencyHours <= 72 ? 'recent_open_loop' : 'ranked_open_loop',
  };
}

module.exports = {
  judge,
  scoreLoop,
  overlapScore,
};






