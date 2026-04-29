const express = require('express');
const { getDb } = require('../models/db');
const { authRequired, teacherRequired } = require('../middleware/auth');
const { success, error } = require('../utils/response');
const { getRuntimeStats } = require('../services/runtime/runtime-stats');

const router = express.Router();

router.use(authRequired);
router.use(teacherRequired);

// GET /api/dashboard/stats - Teacher dashboard statistics
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const teacherId = req.user.id;

    // Active sessions (status=1)
    const activeSessions = db.prepare(
      'SELECT COUNT(*) as cnt FROM t_consult_session WHERE teacher_id = ? AND status = 1'
    ).get(teacherId).cnt;

    // Today's messages across teacher's sessions
    const today = new Date().toISOString().slice(0, 10);
    const todayMessages = db.prepare(`
      SELECT COUNT(*) as cnt FROM t_message m
      JOIN t_consult_session cs ON m.session_id = cs.id
      WHERE cs.teacher_id = ? AND m.created_at >= ?
    `).get(teacherId, today + ' 00:00:00').cnt;

    // Total students in teacher's school
    const teacher = db.prepare('SELECT school_id FROM t_teacher WHERE id = ?').get(teacherId);
    const studentsCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM t_student WHERE school_id = ? AND status = 1'
    ).get(teacher.school_id).cnt;

    // Pending warnings (status=1, scoped to school)
    const alertsCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM t_warning w
      JOIN t_student s ON w.student_id = s.id
      WHERE w.status = 1 AND s.school_id = ?
    `).get(teacher.school_id).cnt;

    // Risk distribution from student profiles (scoped to school)
    const riskRows = db.prepare(`
      SELECT sp.current_risk_level as level, COUNT(*) as count
      FROM t_student_profile sp
      JOIN t_student s ON sp.student_id = s.id
      WHERE s.school_id = ?
      GROUP BY sp.current_risk_level
      ORDER BY sp.current_risk_level
    `).all(teacher.school_id);

    // If no profile data, compute from students (all L4 by default)
    let riskDistribution;
    if (riskRows.length > 0) {
      riskDistribution = riskRows.map(r => ({ level: r.level, count: r.count }));
    } else {
      riskDistribution = [
        { level: 'L1', count: 0 },
        { level: 'L2', count: 0 },
        { level: 'L3', count: 0 },
        { level: 'L4', count: studentsCount },
      ];
    }

    // Recent sessions with student info
    const recentSessions = db.prepare(`
      SELECT cs.id, s.name as student_name, s.grade,
             cs.last_message_preview as last_message,
             cs.last_message_time as updated_at,
             cs.unread_count,
             COALESCE(sp.current_risk_level, 'L4') as risk_level
      FROM t_consult_session cs
      JOIN t_student s ON cs.student_id = s.id
      LEFT JOIN t_student_profile sp ON cs.student_id = sp.student_id
      WHERE cs.teacher_id = ? AND cs.status = 1
      ORDER BY cs.last_message_time DESC
      LIMIT 10
    `).all(teacherId);

    // Recent urgent alerts (level 1 or 2, pending, scoped to school)
    const alerts = db.prepare(`
      SELECT w.id, w.level, s.name as student_name,
             w.trigger_context as reason,
             w.created_at
      FROM t_warning w
      JOIN t_student s ON w.student_id = s.id
      WHERE w.status = 1 AND w.level <= 2 AND s.school_id = ?
      ORDER BY w.level ASC, w.created_at DESC
      LIMIT 5
    `).all(teacher.school_id);

    return success(res, {
      stats: {
        active_sessions: activeSessions,
        today_messages: todayMessages,
        students_count: studentsCount,
        alerts_count: alertsCount,
      },
      risk_distribution: riskDistribution,
      recent_sessions: recentSessions,
      alerts,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return error(res, '获取仪表盘数据失败', -1, 500);
  }
});

// GET /api/dashboard/runtime-stats - Guardian / Pipeline runtime hit report
router.get('/runtime-stats', (req, res) => {
  try {
    const limit = Number(req.query.limit || 80);
    const sessionId = req.query.session_id ? Number(req.query.session_id) : null;
    const stats = getRuntimeStats({
      teacherId: req.user.id,
      sessionId,
      limit,
    });
    return success(res, stats);
  } catch (err) {
    console.error('Runtime stats error:', err);
    return error(res, '获取运行统计失败', -1, 500);
  }
});

module.exports = router;
