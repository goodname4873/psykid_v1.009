/**
 * Open Loop Manager - v1.009
 *
 * Tracks unresolved conversational obligations and short-lived current scene.
 * It returns structured state and prompt policy for the Pipeline and Guardian.
 */

const { getDb } = require('../../models/db');
const continuationResolver = require('./continuation-resolver');
const topicFlowJudge = require('./topic-flow-judge');

const RESUME_RE = /(回来|回来了|来啦|来了|继续|接着|刚才|前面|之前|那个|休息好|休息好了|往下)/;
const CLOSE_RE = /(懂了|明白了|解决了|会了|可以了|没问题了|顺了|知道了)/;
const AI_TEMPLATE_RE = /(我这边看到|前面还有几个|没完全收住|你刚说想接着聊|更像是哪一块|系统检测到|开放环路提示|建议承接方式|请用自然口吻|不要直接列成|不要替学生选择)/;
const MAX_DIRECT_LABEL_CHARS = 18;
const RECENT_SCENE_TTL_MS = 7 * 60 * 1000;
const LAST_SCENE_FALLBACK_MS = 24 * 60 * 60 * 1000;
const DIRECT_OPEN_LOOP_TTL_MS = 2 * 60 * 60 * 1000;

function normalizeTopic(topic) {
  const value = String(topic || '').trim();
  return value.length >= 2 ? value : null;
}

function inferTopic(text) {
  return continuationResolver.inferTopic(text) || null;
}

function compactText(text) {
  return String(text || '')
    .replace(/【[^】]{2,30}】/g, ' ')
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAiTemplateText(text) {
  const value = compactText(text);
  if (!value) return false;
  if (AI_TEMPLATE_RE.test(value)) return true;
  return value.length > 80 && /[。；;：:]/.test(value) && /(学生|系统|回复|建议|选择)/.test(value);
}

function friendlyLabelFromText(text) {
  const value = compactText(text);
  if (!value || isAiTemplateText(value)) return null;
  if (/政治.*(炸|考|期中)|考.*政治|炸锅|考炸/.test(value)) return '政治考砸';
  if (/面对.*(老师|同学)|老师|同学|周一|嘲笑|议论|等待审判|抬不起头|玩笑|开玩笑|说我|人际|别人|发抖/.test(value)) return '面对老师同学的担心';
  if (/考试|中考|临场|批评|排名|焦虑|月考|考砸|考炸/.test(value)) return '考试紧张';
  if (/政治|历史|三大改造|社会主义|阶段|公私合营/.test(value)) return '政治历史概念';
  if (/桃花源记|文言文|古文|背诵|小剧场/.test(value)) return '桃花源记/文言文';
  if (/数学|函数|几何|解题|卡题|错题/.test(value)) return '数学卡题';
  return null;
}

function sanitizeLabel(text, maxChars = MAX_DIRECT_LABEL_CHARS) {
  let value = compactText(text);
  if (!value || isAiTemplateText(value)) return null;
  value = value
    .replace(/^(关于|围绕|继续|接着|刚才那个|前面那个)/, '')
    .replace(/[，。；;：:].*$/, '')
    .replace(/[()（）[\]【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value || isAiTemplateText(value)) return null;
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function directLoopLabel(loop) {
  const unresolved = isAiTemplateText(loop.unresolved_point) ? '' : loop.unresolved_point;
  const combined = [loop.topic, loop.subtopic, unresolved, loop.evidence].filter(Boolean).join(' ');
  const friendly = friendlyLabelFromText(combined);
  if (friendly) return friendly;
  return sanitizeLabel(loop.subtopic)
    || sanitizeLabel(loop.topic)
    || sanitizeLabel(loop.unresolved_point)
    || null;
}

function isLearningLoop(loop) {
  const text = [loop?.topic, loop?.subtopic, loop?.unresolved_point, loop?.evidence]
    .filter(Boolean)
    .join(' ');
  return loop?.type === 'question' && /(政治|历史|语文|文言文|桃花源记|数学|函数|几何|概念|背诵|题)/.test(text);
}

function hasDormantLoopAuthorization(text) {
  const value = compactText(text);
  if (!value || isBareResumeIntentText(value)) return false;

  const genericResumeOnly = value
    .replace(/我|又|回来啦?|回来了?|来了|来啦|继续|接着|聊聊|聊吧|说吧|往下|前面|之前|上次|那个|的|吧/g, '')
    .trim();
  if (!genericResumeOnly) return false;

  return /(不会|不懂|卡住|卡点|概念|政治|历史|语文|文言文|桃花源记|数学|函数|几何|题|实心球|中考|发抖|老师|同学|考试|像|类似|一样)/.test(value);
}

function filterDefaultResumeLoops(loops, latestMessage) {
  if (!isBareResumeIntentText(latestMessage) && hasDormantLoopAuthorization(latestMessage)) {
    return loops;
  }
  // 学生只说“我回来了/继续聊吧”时，没有授权系统翻出长期学习卡点。
  // 学习类 open loop 仍保留在库里，等学生明确提到相关内容时再唤醒。
  return loops.filter(loop => !isLearningLoop(loop));
}

function loopLabel(loop) {
  const topic = sanitizeLabel(loop.topic, 28) || '刚才那个点';
  const point = sanitizeLabel(loop.unresolved_point || loop.subtopic, 28) || '';
  return point ? `${topic}（${point}）` : topic;
}

function rowToLoop(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    type: row.loop_type,
    topic: row.topic,
    subtopic: row.subtopic,
    unresolved_point: row.unresolved_point,
    suggested_resume: row.suggested_resume,
    confidence: row.confidence,
    source: row.source,
    evidence: row.evidence,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    flow_score: row.flow_score || null,
    flow_factors: row.flow_factors || null,
  };
}

function getOpenLoops(sessionId, studentId, limit = 12) {
  try {
    return getDb().prepare(`
      SELECT *
      FROM t_open_loop
      WHERE student_id = ?
        AND status = 'open'
        AND loop_type != 'current_scene'
        AND (session_id = ? OR session_id IS NOT NULL)
      ORDER BY session_id = ? DESC, last_seen_at DESC, confidence DESC, id DESC
      LIMIT ?
    `).all(studentId, sessionId, sessionId, limit).map(rowToLoop);
  } catch (e) {
    return [];
  }
}

function parseLocalTime(value) {
  const time = new Date(String(value || '').replace(' ', 'T')).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getRecentScene(sessionId, studentId, options = {}) {
  try {
    const row = getDb().prepare(`
      SELECT *
      FROM t_open_loop
      WHERE session_id = ?
        AND student_id = ?
        AND status = 'open'
        AND loop_type = 'current_scene'
      ORDER BY last_seen_at DESC, id DESC
      LIMIT 1
    `).get(sessionId, studentId);
    if (!row) return null;
    const lastSeen = parseLocalTime(row.last_seen_at || row.updated_at || row.created_at);
    if (!lastSeen) return null;
    const age = Date.now() - lastSeen;
    const maxAge = options.allowLastScene ? LAST_SCENE_FALLBACK_MS : RECENT_SCENE_TTL_MS;
    if (age > maxAge) return null;
    const loop = rowToLoop(row);
    loop.scene_age_ms = age;
    loop.scene_stale = age > RECENT_SCENE_TTL_MS;
    return loop;
  } catch (e) {
    return null;
  }
}

function isBareResumeIntentText(text) {
  const value = String(text || '').replace(/[\r\n\s，。！？、,.!?]/g, '').trim();
  return /^(我又)?(回来|回来了|回来啦|来啦|来了|继续|接着|继续说|接着说|往下说)$/.test(value);
}

function buildReplyPolicy(loop) {
  if (!loop) return null;
  return {
    should_resume: true,
    should_check_resolution: ['question', 'stuck_point', 'action', 'commitment'].includes(loop.type),
    must_mention_topic: loop.topic || null,
    avoid_topics: [],
    suggested_resume: loop.suggested_resume || null,
  };
}

function isShortTopicSlotAnswer(text, explicitTopic, resumeIntent) {
  const value = String(text || '').replace(/[\r\n\s，。！？、,.!?]/g, '').trim();
  if (!explicitTopic || resumeIntent || !value || value.length > 14) return false;
  if (/(继续|接着|刚才|前面|之前|那个|不懂|没懂|讲|解释|概念|怎么|为什么|展开)/.test(value)) return false;
  return true;
}

function slotAnswerLabel(text) {
  const value = String(text || '').replace(/[\r\n\s，。！？、,.!?]/g, '').trim();
  return value ? value.slice(0, 14) : null;
}

function studentHasCommitmentIntent(text) {
  const value = String(text || '');
  // A commitment is a future promise to return, not the act of already returning.
  return /(一会|等会|待会|稍后|休息一下|先歇|先休息).{0,16}(继续|接着|回来|再聊)/.test(value)
    || /(回来|继续|接着).{0,16}(等会|待会|稍后)/.test(value);
}

function sceneText(scene) {
  if (!scene) return '';
  return [scene.topic, scene.subtopic, scene.unresolved_point, scene.suggested_resume, scene.evidence]
    .filter(Boolean)
    .join(' ');
}

function isExamSceneText(text) {
  return /(期中|考试|考完|估分|挂科|挂了|排名|及格|答题卡|填反|考砸|考炸|炸了|没底|分数|边缘|很低|没考好|考不好|失利)/.test(String(text || ''));
}

function mentionsPolitics(text) {
  return /政治/.test(String(text || ''));
}

function isPoliticalExamScene(studentText, topic, previousScene) {
  const current = [studentText, topic].filter(Boolean).join(' ');
  const previous = sceneText(previousScene);
  if (mentionsPolitics(current) && isExamSceneText(`${current} ${previous}`)) return true;
  if (mentionsPolitics(previous) && isExamSceneText(current)) return true;
  if (mentionsPolitics(current) && isExamSceneText(previous)) return true;
  return false;
}

function normalizeSceneTopic(topic, studentText, previousScene) {
  const raw = normalizeTopic(topic) || inferTopic(studentText);
  if (isPoliticalExamScene(studentText, raw, previousScene)) return '政治考试失利与估分焦虑';
  if (raw && /政治历史-阶段概念辨析|政治历史概念/.test(raw) && isExamSceneText(sceneText(previousScene))) {
    return isPoliticalExamScene(studentText, raw, previousScene) ? '政治考试失利与估分焦虑' : raw;
  }
  if (raw && isExamSceneText(raw) && mentionsPolitics(sceneText(previousScene))) return '政治考试失利与估分焦虑';
  return raw;
}


function isSocialAnxietyText(text) {
  return /(发抖|会抖|说话|同学|玩笑|开玩笑|人际|社交|别人看|尴尬|紧张到抖)/.test(String(text || ''));
}

function shouldBypassRecentScene(text, recentScene) {
  const scene = sceneText(recentScene);
  return isExamSceneText(scene) && isSocialAnxietyText(text);
}
function isTopicCorrectionToRecentScene(text, explicitTopic, recentScene) {
  if (!recentScene || recentScene.type !== 'current_scene' || !explicitTopic) return false;
  const value = compactText(text);
  const scene = sceneText(recentScene);
  if (!isExamSceneText(scene) && !isExamSceneText(value)) return false;
  if (/刚才不是|一直.*说|我说的是|不是.*吗|不行吗|说了.*政治/.test(value) && mentionsPolitics(value)) return true;
  const compact = value.replace(/[\s，。！？、,.!?]/g, '');
  if (compact.length <= 18 && mentionsPolitics(compact) && isExamSceneText(scene)) return true;
  return mentionsPolitics(value) && isExamSceneText(scene) && /(感觉|不行|考|炸|挂|政治)/.test(value);
}

function buildRecentSceneFlow(flow, recentScene, reason = 'recent_scene_marker') {
  return {
    ...flow,
    intent: 'resume_recent_scene',
    reason,
    targetLoopId: recentScene?.id || null,
    allowFastBridge: true,
  };
}

function resolve({ sessionId, studentId, latestMessage }) {
  const text = String(latestMessage || '').trim();
  const recentScene = getRecentScene(sessionId, studentId, { allowLastScene: isBareResumeIntentText(text) });
  const rawOpenLoops = getOpenLoops(sessionId, studentId);
  const flow = topicFlowJudge.judge({ latestMessage: text, openLoops: rawOpenLoops, sessionId });
  let openLoops = (flow.rankedLoops || []).map(item => ({
    ...item.loop,
    flow_score: item.score,
    flow_factors: item.factors,
  }));
  const explicitTopic = inferTopic(text);
  const resumeIntent = RESUME_RE.test(text) || continuationResolver.detectContinuationIntent(text).intent;

  if (resumeIntent && !explicitTopic) {
    openLoops = filterDefaultResumeLoops(openLoops, text);
  }

  if (!openLoops.length && !recentScene) {
    return { action: 'none', active_loop: null, reply_policy: null, candidates: [], flow, hint: '' };
  }

  if (recentScene && !shouldBypassRecentScene(text, recentScene) && isTopicCorrectionToRecentScene(text, explicitTopic, recentScene)) {
    return buildResumeState(
      recentScene,
      [recentScene, ...openLoops],
      'recent_scene_marker',
      buildRecentSceneFlow(flow, recentScene, 'recent_scene_slot_correction'),
    );
  }

  if (!explicitTopic && resumeIntent && recentScene && !shouldBypassRecentScene(text, recentScene)) {
    return buildResumeState(
      recentScene,
      [recentScene, ...openLoops],
      'recent_scene_marker',
      buildRecentSceneFlow(flow, recentScene),
    );
  }

  if (!openLoops.length) {
    return { action: 'observe', active_loop: null, reply_policy: null, candidates: [], flow, hint: '' };
  }

  if (explicitTopic) {
    const shortSlotAnswer = isShortTopicSlotAnswer(text, explicitTopic, resumeIntent);
    const slotLabel = slotAnswerLabel(text);
    const matched = openLoops.find(loop => {
      const topic = normalizeTopic(loop.topic);
      return topic && (topic.includes(explicitTopic) || explicitTopic.includes(topic));
    });
    if (matched && resumeIntent && !shortSlotAnswer) {
      return buildResumeState(matched, openLoops, 'explicit_topic', flow);
    }
    return {
      action: 'observe',
      source: shortSlotAnswer ? 'topic_slot_answer' : 'explicit_new_topic',
      active_loop: null,
      reply_policy: {
        should_resume: false,
        should_allow_topic_switch: true,
        explicit_topic: shortSlotAnswer ? slotLabel : explicitTopic,
      },
      candidates: openLoops,
      flow,
      hint: [
        '',
        '',
        shortSlotAnswer
          ? '【开放环路提示】学生像是在回答上一轮问题中的一个槽位/选项。不要把这个短答案当成旧 open loop 的续接命令。'
          : '【开放环路提示】学生明确提出了一个新话题，应允许自然切换；旧的未闭合事项只作为背景，不要强行拉回。',
        shortSlotAnswer ? `学生本轮短答案：${slotLabel}` : `当前学生提到：${explicitTopic}`,
      ].join('\n'),
    };
  }

  if (!resumeIntent) {
    return { action: 'observe', active_loop: null, reply_policy: null, candidates: openLoops, flow, hint: '' };
  }

  if (flow.intent === 'switch_topic') {
    return {
      action: 'observe',
      source: flow.reason || 'topic_flow_switch',
      active_loop: null,
      reply_policy: { should_resume: false, should_allow_topic_switch: true },
      candidates: openLoops,
      flow,
      hint: '',
    };
  }

  const top = openLoops[0];
  const runnerUp = openLoops[1];
  const margin = runnerUp ? (top.flow_score || 0) - (runnerUp.flow_score || 0) : (top?.flow_score || 0);
  const singleOrClear = openLoops.length === 1
    || flow.intent === 'resume_recent'
    || (top && margin >= 1.15 && (top.flow_score || 0) >= 4.2);
  if (singleOrClear && flow.intent !== 'clarify_needed') {
    return buildResumeState(top, openLoops, flow.reason || 'topic_flow_ranked', flow);
  }

  return {
    action: 'clarify',
    source: flow.reason || 'topic_flow_close_candidates',
    active_loop: null,
    reply_policy: {
      should_resume: false,
      should_ask_choice: true,
      candidates: openLoops.slice(0, 4).map(loopLabel),
    },
    candidates: openLoops,
    flow,
    hint: buildClarifyHint(openLoops),
  };
}


function touchLoop(loop) {
  if (!loop?.id) return;
  try {
    getDb().prepare(`
      UPDATE t_open_loop
      SET last_seen_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'open'
    `).run(loop.id);
  } catch (e) {}
}
function buildResumeState(loop, candidates, source, flow = null) {
  const active = loop && loop.type ? loop : (rowToLoop(loop) || loop);
  const replyPolicy = buildReplyPolicy(active);
  return {
    action: 'resume',
    source,
    active_loop: active,
    reply_policy: replyPolicy,
    candidates,
    flow,
    hint: buildResumeHint(active, replyPolicy),
  };
}

function buildResumeHint(loop, policy) {
  if (!loop || !policy) return '';
  return [
    '',
    '',
    loop.type === 'current_scene' ? '【近期场景提示】' : '【开放环路提示】',
    loop.type === 'current_scene'
      ? `学生刚才正在聊：${loopLabel(loop)}`
      : `系统根据近期性、语义相似度和未闭合强度，选中一个可续接事项：${loopLabel(loop)}`,
    loop.suggested_resume ? `建议承接方式：${loop.suggested_resume}` : '',
    policy.should_check_resolution ? '回复时先轻轻关心：刚才这个疑问/卡点现在是否顺一点，再继续展开。' : '',
    '这是软锚定，不是硬锁；学生明确切换话题时应允许切换，不要强行拉回旧事项。',
  ].filter(Boolean).join('\n');
}

function buildClarifyHint(openLoops) {
  const labels = openLoops.slice(0, 4).map(loopLabel);
  return [
    '',
    '',
    '【开放环路提示】',
    `系统发现多个未闭合事项：${labels.join('、')}`,
    '请用自然口吻请学生确认想先接哪一个，不要直接列成机械编号，也不要替学生选择。',
  ].join('\n');
}


function buildRecentSceneDirectReply(loop, label) {
  const topicLine = [loop.topic, loop.subtopic, loop.unresolved_point].filter(Boolean).join(' ');
  const evidence = sceneText(loop);
  const politicalScene = /政治考试|政治.*(考|估分|排名|及格|答题卡|失利)|考.*政治/.test(topicLine);
  const socialScene = /(面对|老师|同学|周一|等待审判|抬不起头|被问|议论|嘲笑|人际)/.test(topicLine)
    || (/(面对|老师|同学|周一|等待审判|抬不起头|被问|议论|嘲笑|人际)/.test(evidence) && !politicalScene);

  if (socialScene) {
    return `欢迎回来。刚才你说到周一面对老师和同学这件事，我记得。现在最顶着你的，是怕老师问起，还是怕同学议论？`;
  }
  if (politicalScene && /(排名|名次|下降|大幅度)/.test(evidence)) {
    return `欢迎回来。政治这次估分低、还担心排名掉下去这条线我记得。咱们不再重复问原因了，先看排名这件事最刺你的是哪一块：怕别人怎么看，还是怕自己接受不了？`;
  }
  if (politicalScene && /(及格边缘|及格线|分数很低|估分|挂科|挂了)/.test(evidence)) {
    return `欢迎回来。我们接着政治考砸这件事聊。我记得你说估分在边缘，还出了答题卡填反这种失误；现在最压着你的是怕真挂科，还是怕后面排名被拉开？`;
  }
  if (politicalScene && /(答题卡|填反|题目|题难|考砸|考炸)/.test(evidence)) {
    return `欢迎回来。政治这次题难、还填反了两题这件事我记得。我们先不反复确认原因了，接下来更需要看的是：这会不会真的影响到及格和排名。`;
  }
  return `欢迎回来。我们先接着${label}这件事聊，刚才那个点我记得；现在最需要先处理的是结果本身，还是它带来的那种难受？`;
}
function buildDirectReply(state) {
  return buildDirectReplyDetails(state)?.reply || null;
}

function buildDirectReplyDetails(state) {
  if (!state) return null;
  if (state.action === 'resume') {
    const label = directLoopLabel(state.active_loop || {});
    if (!label || label.length > MAX_DIRECT_LABEL_CHARS) return null;
    if (state.source === 'recent_scene_marker' || state.active_loop?.type === 'current_scene') {
      return {
        reply: buildRecentSceneDirectReply(state.active_loop || {}, label),
        reason: 'recent_scene_marker',
        candidateCount: 1,
        maxLabelLength: label.length,
        labels: [label],
      };
    }
    const lastSeen = parseLocalTime(state.active_loop?.last_seen_at || state.active_loop?.updated_at || state.active_loop?.created_at);
    if (!lastSeen || Date.now() - lastSeen > DIRECT_OPEN_LOOP_TTL_MS) {
      return null;
    }
    const isEmotion = /紧张|焦虑|发抖|同学|玩笑|人际|考试|考砸/.test(label);
    return {
      reply: isEmotion
        ? `嗯，我们接着${label}这块聊。你更想先弄清楚为什么会这样，还是先练一个当场稳住的办法？`
        : `嗯，我们接着${label}这块聊。你想先把刚才卡住的地方理顺，还是让我接着往下讲？`,
      reason: 'open_loop_resume_bridge',
      candidateCount: 1,
      maxLabelLength: label.length,
      labels: [label],
    };
  }

  if (state.action !== 'clarify') return null;
  // 多候选澄清必须交给 Generator 自然表达。这里不再硬编码直出，
  // 否则学生反复说“我回来了”时会听到同一句机械回复。
  return null;
}

function observeTurn({ sessionId, studentId, studentText, aiText, topic, source }) {
  if (!sessionId || !studentId) return;
  if (source === 'teacher_suggestion_preview') return;
  const isDirectReply = source === 'continuation_direct_reply';
  const aiTextForLoop = isDirectReply ? '' : String(aiText || '');
  const studentTopic = inferTopic(studentText);
  const latestTopic = normalizeTopic(topic) || studentTopic || inferTopic(aiTextForLoop);

  if (CLOSE_RE.test(String(studentText || ''))) {
    closeTopLoop(sessionId, studentId, studentText);
    return;
  }

  const combined = `${studentText || ''}\n${aiTextForLoop}`;
  maybeUpsertRecentScene(sessionId, studentId, {
    topic: latestTopic,
    studentText,
    aiText: aiTextForLoop,
  });
  const loops = [];

  if (studentHasCommitmentIntent(studentText)) {
    loops.push({
      type: 'commitment',
      topic: studentTopic || normalizeTopic(topic) || latestTopic,
      unresolved_point: extractPoint(studentText) || '约定稍后继续',
      suggested_resume: latestTopic ? `学生回来时先承接${latestTopic}，再确认刚才的问题是否解决。` : '学生回来时先确认要接回哪个点。',
      confidence: 0.86,
      source: 'runtime_commitment',
      evidence: combined.slice(0, 240),
    });
  }

  if (/(不会|不懂|没懂|不知道|怎么填|怎么写|为什么|卡住|卡了)/.test(String(studentText || ''))) {
    loops.push({
      type: /卡住|卡了|怎么填|怎么写/.test(studentText) ? 'stuck_point' : 'question',
      topic: latestTopic,
      unresolved_point: extractPoint(studentText) || String(studentText || '').slice(0, 60),
      suggested_resume: '先问这个点现在是否顺一点；如果还不顺，换一种更具体的拆法。',
      confidence: 0.78,
      source: 'student_unresolved',
      evidence: String(studentText || '').slice(0, 240),
    });
  }

  if (!isDirectReply && /(你先试|可以先|试着|回去试|下一步).{0,30}/.test(String(aiText || ''))) {
    loops.push({
      type: 'action',
      topic: latestTopic,
      unresolved_point: extractPoint(aiText) || '行动建议待确认',
      suggested_resume: '先问刚才建议有没有试过或是否有卡住的地方，再继续。',
      confidence: 0.62,
      source: 'ai_action_suggestion',
      evidence: String(aiText || '').slice(0, 240),
    });
  }

  for (const loop of loops) upsertLoop(sessionId, studentId, loop);
}

function isBareResumeText(text) {
  const value = String(text || '').replace(/[\r\n\s，。！？、,.!?]/g, '').trim();
  return /^(我又)?回来啦?$|^回来了?$|^我回来了$|^继续$|^接着$|^继续说$|^接着说$|^往下说$/.test(value);
}

function isAckOnlyText(text) {
  const value = String(text || '').replace(/[\r\n\s，。！？、,.!?]/g, '').trim();
  return /^(对|对呀|对啊|是|是的|没|没有|不是|不对|好|好的|可以|嗯|嗯嗯|哦|啊|呃|额)$/.test(value);
}

function isLikelyAsrNoiseText(text) {
  const value = compactText(text);
  if (!value) return true;
  if (/^[a-zA-Z\s.'-]{1,32}$/.test(value) && !/^(ok|okay|right|yes|no|hmm)$/i.test(value)) return true;
  if (/^[，。！？、；：""''（）\s.!?,;:]+$/.test(value)) return true;
  return false;
}

function shouldWriteRecentScene(studentText, topic) {
  const value = compactText(studentText);
  if (!value || value.length < 4) return false;
  if (isAckOnlyText(value) || isLikelyAsrNoiseText(value)) return false;
  if (!normalizeTopic(topic) && !inferTopic(value)) return false;
  if (isBareResumeText(value)) return false;
  if (CLOSE_RE.test(value)) return false;
  return true;
}

function recentScenePoint(studentText, topic, previousScene = null) {
  const value = compactText(studentText);
  if (isPoliticalExamScene(value, topic, previousScene)) return '政治考试失利后的挫败感';
  if (/只想.*静|静一静|不想说/.test(value)) return '学生想先安静缓一缓';
  return extractPoint(value) || value.slice(0, 60);
}

function maybeUpsertRecentScene(sessionId, studentId, { topic, studentText, aiText }) {
  if (!shouldWriteRecentScene(studentText, topic)) return;
  try {
    const db = getDb();
    const existing = db.prepare(`
      SELECT * FROM t_open_loop
      WHERE session_id = ? AND student_id = ? AND status = 'open' AND loop_type = 'current_scene'
      ORDER BY id DESC LIMIT 1
    `).get(sessionId, studentId);
    const previousScene = rowToLoop(existing);
    const sceneTopic = normalizeSceneTopic(topic, studentText, previousScene);
    if (!sceneTopic) return;
    const point = recentScenePoint(studentText, sceneTopic, previousScene);
    const sameScene = previousScene?.topic === sceneTopic;
    const evidenceBase = sameScene ? (previousScene?.evidence || '') : '';
    const evidenceText = `${evidenceBase}\n${studentText || ''}\n${aiText || ''}`.slice(-360);
    const payload = {
      type: 'current_scene',
      topic: sceneTopic,
      unresolved_point: point,
      suggested_resume: `学生回来时优先承接刚才现场：${point}。先共情，再问最堵的是哪一块。`,
      confidence: 0.9,
      source: 'recent_scene_marker',
      evidence: evidenceText,
    };
    if (existing) {
      db.prepare(`
        UPDATE t_open_loop
        SET topic = ?, unresolved_point = ?, suggested_resume = ?, confidence = ?, source = ?, evidence = ?,
            last_seen_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(payload.topic, payload.unresolved_point, payload.suggested_resume, payload.confidence, payload.source, payload.evidence, existing.id);
      writeEvent(existing.id, sessionId, studentId, 'update', payload);
      return;
    }
    const result = db.prepare(`
      INSERT INTO t_open_loop (
        session_id, student_id, loop_type, topic, unresolved_point,
        suggested_resume, confidence, source, evidence
      ) VALUES (?, ?, 'current_scene', ?, ?, ?, ?, ?, ?)
    `).run(sessionId, studentId, payload.topic, payload.unresolved_point, payload.suggested_resume, payload.confidence, payload.source, payload.evidence);
    writeEvent(result.lastInsertRowid, sessionId, studentId, 'create', payload);
  } catch (e) {
    console.log('[OpenLoop] recent scene upsert failed:', e.message);
  }
}
function extractPoint(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const match = value.match(/(政治|历史|语文|数学|英语|桃花源记|内容栏|意义|背景|公式|题).{0,24}/);
  return (match ? match[0] : value).slice(0, 60);
}

function upsertLoop(sessionId, studentId, loop) {
  if (!loop.topic && !loop.unresolved_point) return;
  try {
    const db = getDb();
    const existing = db.prepare(`
      SELECT id, confidence
      FROM t_open_loop
      WHERE session_id = ? AND student_id = ? AND status = 'open'
        AND loop_type = ?
        AND COALESCE(topic, '') = COALESCE(?, '')
      ORDER BY id DESC LIMIT 1
    `).get(sessionId, studentId, loop.type, loop.topic || null);

    if (existing) {
      db.prepare(`
        UPDATE t_open_loop
        SET unresolved_point = COALESCE(?, unresolved_point),
            suggested_resume = COALESCE(?, suggested_resume),
            confidence = MAX(confidence, ?),
            evidence = COALESCE(?, evidence),
            source = ?,
            last_seen_at = datetime('now', 'localtime'),
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(
        loop.unresolved_point || null,
        loop.suggested_resume || null,
        loop.confidence || 0.5,
        loop.evidence || null,
        loop.source || null,
        existing.id,
      );
      writeEvent(existing.id, sessionId, studentId, 'update', loop);
      return;
    }

    const result = db.prepare(`
      INSERT INTO t_open_loop (
        session_id, student_id, loop_type, topic, subtopic, unresolved_point,
        suggested_resume, confidence, source, evidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      studentId,
      loop.type,
      loop.topic || null,
      loop.subtopic || null,
      loop.unresolved_point || null,
      loop.suggested_resume || null,
      loop.confidence || 0.5,
      loop.source || null,
      loop.evidence || null,
    );
    writeEvent(result.lastInsertRowid, sessionId, studentId, 'create', loop);
  } catch (e) {
    console.log('[OpenLoop] upsert failed:', e.message);
  }
}

function closeTopLoop(sessionId, studentId, evidence) {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT id FROM t_open_loop
      WHERE session_id = ? AND student_id = ? AND status = 'open'
      ORDER BY confidence DESC, id DESC LIMIT 1
    `).get(sessionId, studentId);
    if (!row) return;
    db.prepare(`
      UPDATE t_open_loop
      SET status = 'closed',
          closed_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(row.id);
    writeEvent(row.id, sessionId, studentId, 'close', { evidence });
  } catch (e) {
    console.log('[OpenLoop] close failed:', e.message);
  }
}

function writeEvent(openLoopId, sessionId, studentId, eventType, payload) {
  try {
    getDb().prepare(`
      INSERT INTO t_open_loop_event (open_loop_id, session_id, student_id, event_type, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(openLoopId || null, sessionId, studentId, eventType, JSON.stringify(payload || {}));
  } catch (e) {}
}

module.exports = {
  resolve,
  buildDirectReply,
  buildDirectReplyDetails,
  observeTurn,
};













