/**
 * Branch Working Memory - v1.009
 *
 * Session-scoped short-term draft memory for Guardian fast path.
 * It stores candidate replies only as verifiable drafts. A cached draft is
 * never sent directly; runtime must pass it through Fast Verifier first.
 */

const MAX_ITEMS_PER_SESSION = 14;
const HOT_TTL_MS = 10 * 60 * 1000;
const WARM_TTL_MS = 45 * 60 * 1000;

const sessions = new Map();

function now() {
  return Date.now();
}

function normalizeTopic(topic) {
  const value = String(topic || '').trim();
  if (!value || value === 'null' || value === '未指定' || value === '无法判断') return null;
  return value;
}

function topicCompatible(left, right) {
  const a = normalizeTopic(left);
  const b = normalizeTopic(right);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function subjectOf(text) {
  const value = String(text || '');
  if (/实心球|体育|踩线|中考体育|球/.test(value)) return 'sports_exam';
  if (/政治|新民主主义|社会主义|公有制|三大改造|1956|初级阶段/.test(value)) return 'politics';
  if (/历史/.test(value)) return 'history';
  if (/数学|函数|几何|方程|解题/.test(value)) return 'math';
  if (/语文|文言文|古文|桃花源记|背诵/.test(value)) return 'chinese';
  if (/同学|玩笑|开玩笑|说我|别人怎么看|发抖|社交|人际/.test(value)) return 'social_anxiety';
  if (/焦虑|紧张|害怕|担心|纠结/.test(value)) return 'emotion';
  return null;
}

function inferTopicFromText(text) {
  const value = String(text || '');
  if (/桃花源记|古文|文言文|背诵|朗读|课文|小剧场/.test(value)) return '语文-古文背诵（桃花源记/小剧场）';
  if (/政治|新民主主义|社会主义|公有制|三大改造|1956|初级阶段|改革开放|公私合营/.test(value)) return '政治历史-阶段概念辨析';
  if (/历史|朝代|时间线|年代|事件/.test(value)) return '历史-时间线与事件辨析';
  if (/数学|函数|几何|方程|解题|错题|第\d+题/.test(value)) return '数学-解题卡点';
  if (/实心球|体育|踩线|中考体育|老师没喊停|跑步|跳远/.test(value)) return '体育中考-临场规则与表现';
  if (/同学|玩笑|开玩笑|说我|别人怎么看|发抖|社交|人际/.test(value)) return '人际互动与被评价焦虑';
  if (/考试|中考|月考|二检|排名|批评|临场|发挥|焦虑|紧张|担心/.test(value)) return '考试焦虑与临场表现';
  return null;
}

function inferIntent(text) {
  const value = String(text || '');
  if (/继续|接着|往下|展开|详细|再说/.test(value)) return 'continue_or_expand';
  if (/怎么答|模板|套路|简答题|怎么写|怎么思考/.test(value)) return 'answer_method';
  if (/不懂|没懂|为什么|卡|模糊/.test(value)) return 'clarify_confusion';
  if (/休息|等会|回来/.test(value)) return 'pause_resume';
  if (/纠结|担心|难受|焦虑/.test(value)) return 'emotional_loop';
  return 'general';
}

function getList(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

function prune(sessionId) {
  const list = getList(sessionId);
  const t = now();
  const kept = list
    .filter(item => item.response && (t - item.createdAt) <= item.ttlMs)
    .sort((a, b) => (b.lastTouchedAt || b.createdAt) - (a.lastTouchedAt || a.createdAt))
    .slice(0, MAX_ITEMS_PER_SESSION);
  sessions.set(sessionId, kept);
  return kept;
}

function rememberDraft({
  sessionId,
  studentId,
  topic,
  expectedTopic,
  intent,
  source,
  userCue,
  response,
  analysis,
  confidence,
  ttlMs,
  branchId,
}) {
  if (!sessionId || !response) return null;
  const list = prune(sessionId);
  const finalTopic = normalizeTopic(topic || expectedTopic)
    || inferTopicFromText(`${userCue || ''} ${response || ''}`);
  const finalIntent = intent || inferIntent(`${userCue || ''} ${response || ''}`);
  const fingerprint = `${source || 'draft'}|${finalTopic || ''}|${finalIntent}|${String(response).slice(0, 48)}`;

  const existing = list.find(item => item.fingerprint === fingerprint);
  if (existing) {
    existing.lastTouchedAt = now();
    existing.confidence = Math.max(existing.confidence || 0, confidence || 0.6);
    existing.userCue = userCue || existing.userCue;
    return existing;
  }

  const item = {
    id: `bm_${sessionId}_${now()}_${Math.random().toString(16).slice(2, 8)}`,
    branchId: branchId || null,
    sessionId,
    studentId: studentId || null,
    topic: finalTopic,
    expectedTopic: normalizeTopic(expectedTopic || finalTopic),
    subject: subjectOf(`${finalTopic || ''} ${userCue || ''} ${response || ''}`),
    intent: finalIntent,
    source: source || 'branch_memory',
    userCue: String(userCue || '').slice(0, 240),
    response: String(response || '').trim(),
    analysis: analysis || null,
    confidence: confidence || 0.65,
    createdAt: now(),
    lastTouchedAt: now(),
    ttlMs: ttlMs || (source === 'partial_asr_draft' ? HOT_TTL_MS : WARM_TTL_MS),
    usedCount: 0,
    verifiedCount: 0,
    rejectedCount: 0,
    fingerprint,
  };
  list.unshift(item);
  sessions.set(sessionId, list.slice(0, MAX_ITEMS_PER_SESSION));
  return item;
}

function rememberPreparedBranches(sessionId, studentId, branches = []) {
  for (const branch of branches || []) {
    rememberDraft({
      sessionId,
      studentId,
      topic: branch.expectedTopic,
      expectedTopic: branch.expectedTopic,
      intent: inferIntent(branch.condition || ''),
      source: branch.source || 'prepared_branch',
      userCue: branch.condition,
      response: branch.response,
      analysis: branch.analysis,
      confidence: 0.72,
      branchId: branch.id,
      ttlMs: WARM_TTL_MS,
    });
  }
}

function scoreCandidate(item, { latestMessage, topicResult, openLoop }) {
  const text = String(latestMessage || '');
  const topic = normalizeTopic(topicResult?.topic);
  const loopTopic = normalizeTopic(openLoop?.active_loop?.topic || openLoop?.activeLoop?.topic);
  const msgSubject = subjectOf(text);
  const topicSubject = subjectOf(`${topic || ''} ${loopTopic || ''}`);
  const intent = inferIntent(text);
  let score = 0;
  let directEvidence = 0;

  if (topic && topicCompatible(topic, item.expectedTopic || item.topic)) { score += 5; directEvidence += 1; }
  if (loopTopic && topicCompatible(loopTopic, item.expectedTopic || item.topic)) { score += 3; directEvidence += 1; }
  if (msgSubject && item.subject && msgSubject === item.subject) score += 1.2;
  if (!msgSubject && topicSubject && item.subject && topicSubject === item.subject) score += 2;
  if (intent === item.intent && intent !== 'general') { score += 2; directEvidence += 1; }
  if (String(item.userCue || '').length > 0 && text.includes(String(item.userCue).slice(0, 8))) { score += 1; directEvidence += 1; }

  const ageMs = now() - item.createdAt;
  score += Math.max(0, 2 - ageMs / (15 * 60 * 1000));
  score += Math.min(1, item.confidence || 0);
  score -= (item.rejectedCount || 0) * 1.5;

  if (topic && item.subject && subjectOf(topic) && subjectOf(topic) !== item.subject) score -= 6;
  if (msgSubject && item.subject && msgSubject !== item.subject) score -= 6;

  if (msgSubject && item.subject && msgSubject === item.subject && directEvidence === 0) score -= 3.2;
  return score;
}

function getCandidates({ sessionId, latestMessage, topicResult, openLoop, limit = 4 }) {
  const list = prune(sessionId);
  const scored = list
    .map(item => ({ item, score: scoreCandidate(item, { latestMessage, topicResult, openLoop }) }))
    .filter(x => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => ({
      ...x.item,
      condition: x.item.userCue || x.item.intent || x.item.topic || 'cached draft',
      savedMs: now() - x.item.createdAt,
      matchConfidence: Math.min(0.98, Math.max(0.82, x.score / 10)),
      source: x.item.source || 'branch_memory',
      branchMemoryId: x.item.id,
      memoryScore: x.score,
    }));
  return scored;
}

function markOutcome(sessionId, itemId, accepted) {
  const list = getList(sessionId);
  const item = list.find(x => x.id === itemId);
  if (!item) return;
  item.lastTouchedAt = now();
  if (accepted) {
    item.usedCount += 1;
    item.verifiedCount += 1;
  } else {
    item.rejectedCount += 1;
  }
}

function snapshot(sessionId) {
  return prune(sessionId).slice(0, 6).map(item => ({
    id: item.id,
    topic: item.topic,
    subject: item.subject,
    intent: item.intent,
    source: item.source,
    ageMs: now() - item.createdAt,
    usedCount: item.usedCount,
    rejectedCount: item.rejectedCount,
  }));
}

function clearSession(sessionId) {
  sessions.delete(sessionId);
}

module.exports = {
  rememberDraft,
  rememberPreparedBranches,
  getCandidates,
  markOutcome,
  snapshot,
  clearSession,
  subjectOf,
  inferIntent,
  topicCompatible,
  inferTopicFromText,
};



