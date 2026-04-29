/**
 * Soft Topic Frame - v1.009
 *
 * Keeps the current conversational frame without locking the student into it.
 * Ambiguous follow-ups inherit the frame; explicit new topics switch frame.
 */

const branchMemory = require('../guardian/branch-memory');

const frames = new Map();
const FRAME_TTL_MS = 45 * 60 * 1000;

function now() {
  return Date.now();
}

function normalizeTopic(topic) {
  const value = String(topic || '').trim();
  if (!value || value === 'null' || value === '未指定' || value === '无法判断') return null;
  return value;
}

function isExplicitSwitch(text) {
  const value = String(text || '');
  return /先不说|换个话题|我想问|突然想到|回到|继续.*吧|再聊|还是.*纠结|现在关键|我更/.test(value)
    || !!branchMemory.subjectOf(value);
}

function isAmbiguousFollowup(text) {
  const value = String(text || '').trim();
  return /^(继续|接着|往下|展开|详细|然后呢|这个呢|那这个|怎么展开|再说一点|你继续说吧)[。.!?？！,，\s]*$/.test(value)
    || (/继续|接着|展开|往下/.test(value) && value.length <= 18);
}

function getFrame(sessionId) {
  const frame = frames.get(sessionId);
  if (!frame) return null;
  if (now() - frame.updatedAt > FRAME_TTL_MS) {
    frames.delete(sessionId);
    return null;
  }
  return frame;
}

function pushTopic(stack, frame) {
  const existing = stack.filter(item => item.topic !== frame.topic);
  return [
    {
      topic: frame.topic,
      subject: frame.subject,
      status: 'active',
      updatedAt: frame.updatedAt,
    },
    ...existing.map(item => ({ ...item, status: item.status === 'active' ? 'paused' : item.status })),
  ].slice(0, 5);
}

function update({ sessionId, latestMessage, topicResult, openLoop }) {
  const current = getFrame(sessionId);
  const latestSubject = branchMemory.subjectOf(latestMessage);
  const resultTopic = normalizeTopic(topicResult?.topic);
  const resultSubject = branchMemory.subjectOf(resultTopic);
  const loopTopic = normalizeTopic(openLoop?.active_loop?.topic || openLoop?.activeLoop?.topic);
  const loopSubject = branchMemory.subjectOf(loopTopic);
  const ambiguous = isAmbiguousFollowup(latestMessage);
  const explicit = isExplicitSwitch(latestMessage);

  let next = current;
  let transition = 'keep';

  if (explicit && latestSubject && (!current || latestSubject !== current.subject)) {
    next = {
      topic: resultTopic || latestMessage,
      subject: latestSubject,
      confidence: 0.86,
      source: 'student_explicit_switch',
      updatedAt: now(),
    };
    transition = 'switch';
  } else if (resultTopic && resultSubject) {
    next = {
      topic: resultTopic,
      subject: resultSubject,
      confidence: topicResult?.confident ? 0.82 : 0.62,
      source: topicResult?.source || 'topic_result',
      updatedAt: now(),
    };
    transition = current && current.subject !== next.subject ? 'switch' : 'refresh';
  } else if (ambiguous && current) {
    next = {
      ...current,
      updatedAt: now(),
      source: 'soft_frame_inherited',
    };
    transition = 'inherit';
  } else if (loopTopic && loopSubject && !current) {
    next = {
      topic: loopTopic,
      subject: loopSubject,
      confidence: 0.66,
      source: 'open_loop_seed',
      updatedAt: now(),
    };
    transition = 'seed';
  }

  if (next) frames.set(sessionId, next);
  const stack = next ? pushTopic(current?.stack || [], next) : [];
  if (next) next.stack = stack;

  const shouldApplyToTopic = ambiguous && next && (!topicResult?.confident || !resultTopic);
  const framedTopicResult = shouldApplyToTopic
    ? {
        topic: next.topic,
        candidates: [{ topic: next.topic, source: 'soft_topic_frame', strength: 'medium' }],
        confident: true,
        source: 'soft_topic_frame',
        ambiguous: false,
      }
    : topicResult;

  const hint = next ? [
    '',
    '',
    '【语境框架提示】这是软框架，不是硬锁。',
    `当前语境：${next.topic}`,
    '学生表达模糊时优先承接当前语境；学生明确提出新话题时允许切换，不要强行拉回旧话题。',
    next.subject === 'politics' ? '若涉及三大改造/社会主义/新民主主义，按“政治课答题语境”表达，除非学生明确要求历史视角。' : '',
  ].filter(Boolean).join('\n') : '';

  return {
    frame: next || null,
    topicStack: stack,
    transition,
    topicResult: framedTopicResult,
    hint,
  };
}

module.exports = {
  update,
  getFrame,
};
