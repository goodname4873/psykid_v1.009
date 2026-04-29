/**
 * Follow-up Task Scheduler - v1.005
 *
 * Checks for due follow-up tasks and pushes them to teacher for approval.
 * Tasks are created by:
 * - Session end (post_session_checkin)
 * - Silence monitor (silence_nudge)
 * - Future: scheduled wellness checks
 *
 * ALL tasks go to teacher first. Nothing auto-sends to student.
 */

const { getDb } = require('../models/db');
const { callLLM } = require('./ai-client');

let schedulerTimer = null;

/**
 * Start the scheduler. Checks every 60 seconds for due tasks.
 */
function startScheduler(io) {
  if (schedulerTimer) return;

  console.log('  Scheduler:       started (60s interval)');

  schedulerTimer = setInterval(() => {
    try {
      processDueTasks(io);
    } catch (err) {
      console.error('[Scheduler] Error:', err.message);
    }
  }, 60000);
}

function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function processDueTasks(io) {
  const db = getDb();

  let dueTasks;
  try {
    dueTasks = db.prepare(`
      SELECT ft.*, s.name as student_name, s.grade, s.class_name
      FROM t_followup_task ft
      JOIN t_student s ON ft.student_id = s.id
      WHERE ft.status = 0
        AND ft.scheduled_at <= datetime('now', 'localtime')
      ORDER BY ft.scheduled_at ASC
      LIMIT 10
    `).all();
  } catch (e) {
    return; // Table may not exist
  }

  if (!dueTasks || dueTasks.length === 0) return;

  for (const task of dueTasks) {
    // Push to teacher dashboard via WebSocket
    if (io) {
      io.to('teacher_room').emit('coordinator:suggestion', {
        type: task.task_type,
        task_id: task.id,
        session_id: task.session_id,
        student_id: task.student_id,
        student_name: task.student_name,
        content: task.content,
        reason: task.trigger_reason,
      });
    }

    // Mark as status=1 (pushed to teacher, awaiting action)
    db.prepare('UPDATE t_followup_task SET status = 1, sent_at = datetime(\'now\', \'localtime\') WHERE id = ?')
      .run(task.id);

    console.log(`[Scheduler] Task ${task.id} (${task.task_type}) pushed for student ${task.student_name}`);
  }
}

/**
 * Generate post-session follow-up task.
 * Called after session ends + final summary is ready.
 */
async function generateFollowUpTask(sessionId, studentId) {
  try {
    const db = getDb();

    // Wait a bit for final summary to be written
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check teacher setting
    let session;
    try {
      session = db.prepare('SELECT teacher_id FROM t_consult_session WHERE id = ?').get(sessionId);
    } catch (e) { return; }
    if (!session) return;

    let setting;
    try {
      setting = db.prepare('SELECT post_session_followup FROM t_teacher_setting WHERE teacher_id = ?')
        .get(session.teacher_id);
    } catch (e) { /* no setting = use default */ }

    if (setting && setting.post_session_followup === 0) return; // Teacher disabled follow-ups

    // Get final summary
    const summary = db.prepare(`
      SELECT * FROM t_session_summary
      WHERE session_id = ? AND summary_type = 'final'
      ORDER BY id DESC LIMIT 1
    `).get(sessionId);

    if (!summary) return;

    const unresolved = JSON.parse(summary.unresolved_items || '[]');
    const topics = JSON.parse(summary.topics_discussed || '[]');

    if (unresolved.length === 0 && topics.length === 0) return;

    // Generate follow-up content
    let content;
    try {
      const result = await callLLM([
        { role: 'system', content: '你是心理咨询师的助手。根据上次咨询的主题和未解决问题，生成一条温暖的跟进问候。25字以内，自然口语化，不要用"你好"开头，像朋友发微信。' },
        { role: 'user', content: `话题: ${topics.join('、')}\n未解决: ${unresolved.join('、')}` },
      ], { model: require('./runtime/counseling-config').schedulerModel, max_tokens: 80, temperature: 0.8 });
      content = result.content.trim().replace(/^["']|["']$/g, '');
    } catch (e) {
      content = '上次聊的那个事，后来怎么样了？';
    }

    // Schedule for next day 10:00 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    db.prepare(`
      INSERT INTO t_followup_task (student_id, session_id, task_type, trigger_reason, content, scheduled_at)
      VALUES (?, ?, 'post_session_checkin', ?, ?, ?)
    `).run(
      studentId, sessionId,
      `未解决: ${unresolved.join(', ') || '无'}; 话题: ${topics.join(', ')}`,
      content,
      tomorrow.toISOString()
    );

    console.log(`[Scheduler] Follow-up task created for student ${studentId}, scheduled ${tomorrow.toISOString()}`);
  } catch (err) {
    console.error(`[Scheduler] Follow-up generation error:`, err.message);
  }
}

module.exports = { startScheduler, stopScheduler, generateFollowUpTask };
