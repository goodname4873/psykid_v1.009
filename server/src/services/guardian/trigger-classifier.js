/**
 * Guardian Trigger Classifier - v1.009
 *
 * Cheap subconscious gate before proactive generation.
 * It decides whether Guardian should intervene, who should receive the
 * intervention, and why. It does not call an LLM.
 */

const { getDb } = require('../../models/db');

const SILENCE_NUDGE_MS = 45 * 1000;
const IDLE_STOP_MS = 5 * 60 * 1000;
const STUCK_THRESHOLD = 0.6;

const RISK_RE = /(自杀|不想活|想死|割腕|跳楼|伤害自己|伤害别人|杀人|报警|急救|救命)/;
const EMOTION_RE = /(崩溃|受不了|喘不过气|发抖|害怕|恐惧|焦虑|紧张|绝望|完蛋|完了)/;
const WITHDRAW_RE = /(算了|没事|随便|无所谓|不知道|不想说|不聊了|懒得说|说不清|别问了)/;
const CONFUSION_RE = /(不懂|没懂|不会|还是不懂|讲不清|没明白|卡住|兜圈|绕晕|换个说法|再讲一遍)/;
const RESUME_RE = /(回来|回来了|继续|接着|刚才|前面|上次|昨天|那件事|往下说|展开说|你继续说)/;
const QUESTION_RE = /(为什么|怎么|什么|哪里|哪一|具体|说说|能不能|是不是|吗|呢|\?|\？)/;
const CLOSING_RE = /(先不聊|下次|不说了|我要走|再见|休息一下|等会儿)/;

function getRecentMessages(sessionId, limit = 12) {
  try {
    const rows = getDb().prepare(`
      SELECT id, sender_type, content, created_at
      FROM t_message
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(sessionId, limit);
    return rows.reverse();
  } catch (e) {
    return [];
  }
}

function getSessionMode(sessionId) {
  try {
    const row = getDb().prepare('SELECT mode FROM t_consult_session WHERE id = ?').get(sessionId);
    return row?.mode || 'text';
  } catch (e) {
    return 'text';
  }
}

function getOpenLoop(sessionId, studentId) {
  try {
    return getDb().prepare(`
      SELECT loop_type, topic, unresolved_point, suggested_resume, confidence
      FROM t_open_loop
      WHERE student_id = ?
        AND status = 'open'
        AND (session_id = ? OR session_id IS NOT NULL)
      ORDER BY session_id = ? DESC, confidence DESC, id DESC
      LIMIT 1
    `).get(studentId, sessionId, sessionId);
  } catch (e) {
    return null;
  }
}

function textOf(messages, senderType = null) {
  return messages
    .filter(m => !senderType || m.sender_type === senderType)
    .map(m => m.content || '')
    .join('\n');
}

function latestMessage(messages) {
  return messages.length ? messages[messages.length - 1] : null;
}

function shortStudentReply(message) {
  if (!message || message.sender_type !== 'student') return false;
  const text = String(message.content || '').trim();
  return text.length > 0 && text.length <= 14;
}

function countTeacherQuestions(messages) {
  return messages
    .filter(m => m.sender_type === 'teacher' || m.sender_type === 'ai')
    .reduce((sum, m) => sum + (QUESTION_RE.test(String(m.content || '')) ? 1 : 0), 0);
}

function build(type, patch = {}) {
  return {
    type,
    urgency: patch.urgency || 'normal',
    target: patch.target || 'student',
    reason: patch.reason || type,
    suggestedAction: patch.suggestedAction || '',
    contentHint: patch.contentHint || '',
    source: 'rule_prefilter',
  };
}

function classify(state) {
  if (!state?.sessionId) return null;

  const now = Date.now();
  const messages = getRecentMessages(state.sessionId);
  const latest = latestMessage(messages);
  const latestText = String(latest?.content || '');
  const allText = textOf(messages);
  const recentStudentText = textOf(messages.slice(-4), 'student');
  const situation = state.situation || {};
  const mode = getSessionMode(state.sessionId);
  const openLoop = getOpenLoop(state.sessionId, state.studentId);

  if (latestText && RISK_RE.test(latestText)) {
    return build('risk_signal', {
      urgency: 'high',
      target: 'teacher',
      reason: '学生出现高风险表达，需要教师接管或二次确认',
      suggestedAction: '提醒教师优先安全评估，不自动发送普通安慰话',
      contentHint: '建议教师先确认学生是否处于即时危险，并要求学生保持在线。',
    });
  }

  if (latest?.sender_type === 'student' && CLOSING_RE.test(latestText)) {
    return null;
  }

  const silenceMs = state.lastMainActivityAt ? (now - state.lastMainActivityAt) : 0;
  const latestIsStudent = latest?.sender_type === 'student';

  if (!latestIsStudent && silenceMs >= SILENCE_NUDGE_MS && silenceMs < IDLE_STOP_MS) {
    if (openLoop?.topic || openLoop?.unresolved_point) {
      const label = [openLoop.topic, openLoop.unresolved_point].filter(Boolean).join('：');
      return build('open_loop_silence', {
        urgency: 'normal',
        target: 'student',
        reason: `学生沉默 ${Math.round(silenceMs / 1000)}s，且存在未闭合事项`,
        suggestedAction: '先轻轻确认刚才的问题是否顺一点，再决定继续或换说法',
        contentHint: `围绕未闭合事项“${label}”承接，不要另起新话题。`,
      });
    }

    return build('silence', {
      urgency: 'normal',
      target: 'student',
      reason: `学生沉默 ${Math.round(silenceMs / 1000)}s`,
      suggestedAction: '根据最后一个具体内容给一小步承接，不要只问还在吗',
      contentHint: '保持短句，像教师轻轻把话接回来。',
    });
  }

  if ((situation.stuckIndicator || 0) >= STUCK_THRESHOLD || CONFUSION_RE.test(recentStudentText)) {
    return build('stuck', {
      urgency: 'normal',
      target: mode === 'agent' ? 'student' : 'teacher',
      reason: `对话可能兜圈或学生仍未理解，stuck=${Number(situation.stuckIndicator || 0).toFixed(2)}`,
      suggestedAction: '换一种更具体的拆法，先问刚才那个疑问是否解决了一点',
      contentHint: '不要继续重复原解释；用更小步骤或例子接住。',
    });
  }

  if (latest?.sender_type === 'student' && WITHDRAW_RE.test(latestText)) {
    return build('student_withdrawal', {
      urgency: 'normal',
      target: mode === 'agent' ? 'student' : 'teacher',
      reason: '学生出现退缩或回避表达',
      suggestedAction: '降低追问强度，给学生选择权',
      contentHint: '承认可以先放慢，再给一个很小的可选入口。',
    });
  }

  if (
    latest?.sender_type === 'student'
    && shortStudentReply(latest)
    && countTeacherQuestions(messages.slice(-6)) >= 3
  ) {
    return build('teacher_pressure', {
      urgency: 'normal',
      target: 'teacher',
      reason: '教师/AI 连续追问较多，学生回复变短',
      suggestedAction: '提醒教师从追问改为概括和选择题式承接',
      contentHint: '建议回复要少问为什么，多给学生两个可选方向。',
    });
  }

  if (
    situation.emotionTrend === '上升'
    && Number(situation.emotionIntensity || 0) >= 8
  ) {
    return build('emotion_escalation', {
      urgency: 'high',
      target: mode === 'agent' ? 'student' : 'teacher',
      reason: `情绪升温 ${situation.emotionIntensity}/10`,
      suggestedAction: '先稳定情绪，再处理具体问题',
      contentHint: '用一句具体、低压的稳定话，不做长篇分析。',
    });
  }

  if (latest?.sender_type === 'student' && RESUME_RE.test(latestText) && openLoop) {
    const label = [openLoop.topic, openLoop.unresolved_point].filter(Boolean).join('：');
    return build('open_loop_resume', {
      urgency: 'normal',
      target: mode === 'agent' ? 'student' : 'teacher',
      reason: '学生表达继续/回来，存在可承接的开放环路',
      suggestedAction: '先确认刚才疑问是否解决，再继续展开',
      contentHint: `承接“${label}”，如果学生明显换题则允许切换。`,
    });
  }

  if (EMOTION_RE.test(allText) && latest?.sender_type === 'student') {
    return build('emotion_signal', {
      urgency: 'normal',
      target: mode === 'agent' ? 'student' : 'teacher',
      reason: '学生表达紧张、焦虑或害怕',
      suggestedAction: '先把情绪落到一个具体场景，不急着讲道理',
      contentHint: '问一个很小的现实问题，帮助学生从泛化焦虑回到具体场景。',
    });
  }

  return null;
}

module.exports = {
  classify,
  hasSignal: state => !!classify(state),
};
