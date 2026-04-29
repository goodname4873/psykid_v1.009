const express = require('express');
const { getDb } = require('../models/db');
const { authRequired, teacherRequired } = require('../middleware/auth');
const { success, error } = require('../utils/response');
const { generateFinalSummary, extractSessionThread, updateStudentProfile } = require('../services/summary');
const { generateFollowUpTask } = require('../services/scheduler');
const { dreamAfterSession } = require('../services/dream-service');
const guardian = require('../services/guardian/guardian-service');
const crypto = require('crypto');

const router = express.Router();

// All session routes require authentication
router.use(authRequired);

// POST /api/session/create - Create a new consultation session
router.post('/create', (req, res) => {
  try {
    const db = getDb();
    const user = req.user;

    let studentId;
    if (user.role === 'student') {
      studentId = user.id;
    } else if (user.role === 'teacher') {
      studentId = req.body.student_id;
      if (!studentId) {
        return error(res, '请指定学生ID');
      }
    }

    // Get default teacher (single teacher mode)
    const teacher = db.prepare(
      'SELECT id FROM t_teacher WHERE status = 1 AND deleted_at IS NULL LIMIT 1'
    ).get();
    if (!teacher) {
      return error(res, '当前没有可用的咨询师');
    }

    // Check if student already has an active session
    const activeSession = db.prepare(
      'SELECT * FROM t_consult_session WHERE student_id = ? AND status = 1'
    ).get(studentId);

    if (activeSession) {
      // Return existing active session
      return success(res, {
        session_id: activeSession.id,
        session_no: activeSession.session_no,
        is_existing: true
      });
    }

    // Get student info for school_id
    const student = db.prepare('SELECT school_id FROM t_student WHERE id = ?').get(studentId);
    if (!student) {
      return error(res, '学生不存在');
    }

    const sessionNo = 'S' + Date.now() + '-' + crypto.randomUUID().substring(0, 8);
    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');

    const result = db.prepare(`
      INSERT INTO t_consult_session (session_no, student_id, teacher_id, school_id, mode, start_time)
      VALUES (?, ?, ?, ?, 'text', ?)
    `).run(sessionNo, studentId, teacher.id, student.school_id, now);

    return success(res, {
      session_id: result.lastInsertRowid,
      session_no: sessionNo,
      is_existing: false
    });
  } catch (err) {
    console.error('Create session error:', err);
    return error(res, '创建会话失败', -1, 500);
  }
});

// GET /api/session/list - Get session list
router.get('/list', (req, res) => {
  try {
    const db = getDb();
    const user = req.user;
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = '';
    const params = [];

    if (user.role === 'student') {
      whereClause = 'WHERE cs.student_id = ?';
      params.push(user.id);
    } else if (user.role === 'teacher') {
      whereClause = 'WHERE cs.teacher_id = ?';
      params.push(user.id);
    }

    if (status) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ' cs.status = ?';
      params.push(parseInt(status));
    }

    const countSql = `SELECT COUNT(*) as total FROM t_consult_session cs ${whereClause}`;
    const total = db.prepare(countSql).get(...params).total;

    const listSql = `
      SELECT cs.*, s.name as student_name, s.student_no, s.grade, s.class_name, s.avatar as student_avatar,
             t.name as teacher_name
      FROM t_consult_session cs
      LEFT JOIN t_student s ON cs.student_id = s.id
      LEFT JOIN t_teacher t ON cs.teacher_id = t.id
      ${whereClause}
      ORDER BY cs.last_message_time DESC, cs.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const list = db.prepare(listSql).all(...params, parseInt(limit), offset);

    return success(res, { total, list, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('List sessions error:', err);
    return error(res, '获取会话列表失败', -1, 500);
  }
});

// GET /api/session/:id - Get session detail
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const sessionId = req.params.id;

    const session = db.prepare(`
      SELECT cs.*, s.name as student_name, s.student_no, s.grade, s.class_name, s.avatar as student_avatar,
             t.name as teacher_name
      FROM t_consult_session cs
      LEFT JOIN t_student s ON cs.student_id = s.id
      LEFT JOIN t_teacher t ON cs.teacher_id = t.id
      WHERE cs.id = ?
    `).get(sessionId);

    if (!session) {
      return error(res, '会话不存在', -1, 404);
    }

    // Verify access: students can only see their own sessions
    if (req.user.role === 'student' && session.student_id !== req.user.id) {
      return error(res, '无权访问该会话', -1, 403);
    }
    if (req.user.role === 'teacher' && session.school_id !== req.user.school_id) {
      return error(res, '无权访问该会话', -1, 403);
    }

    return success(res, session);
  } catch (err) {
    console.error('Get session error:', err);
    return error(res, '获取会话详情失败', -1, 500);
  }
});

// PUT /api/session/:id/end - End a session
router.put('/:id/end', (req, res) => {
  try {
    const db = getDb();
    const sessionId = req.params.id;

    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(sessionId);
    if (!session) {
      return error(res, '会话不存在', -1, 404);
    }

    // Verify access: students only their own, teachers only their school
    if (req.user.role === 'student' && session.student_id !== req.user.id) {
      return error(res, '无权操作该会话', -1, 403);
    }
    if (req.user.role === 'teacher' && session.school_id !== req.user.school_id) {
      return error(res, '无权操作该会话', -1, 403);
    }

    if (session.status === 2) {
      return error(res, '会话已结束');
    }

    db.prepare(`
      UPDATE t_consult_session
      SET status = 2, end_time = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(sessionId);

    // Generate final summary + thread extraction + profile update (async chain)
    const sid = parseInt(sessionId);
    const studentId = session.student_id;

    // v1.007: Detach guardian (stop heartbeat for this session)
    guardian.detachSession(sid);

    // Step 1: Extract thread with the configured summary model.
    extractSessionThread(sid).catch(err =>
      console.error('[Summary] Thread extraction error:', err.message)
    );

    // Step 2: Generate final summary, then update profile + schedule follow-up + dream
    generateFinalSummary(sid).then(() => {
      // Step 3: Update student profile based on final summary + thread
      updateStudentProfile(sid, studentId).catch(err =>
        console.error('[Summary] Profile update error:', err.message)
      );
      // Step 4: Generate follow-up task for next day
      generateFollowUpTask(sid, studentId).catch(err =>
        console.error('[Scheduler] Follow-up generation error:', err.message)
      );
      // Step 5 (v1.007): Dream memory consolidation (async, non-blocking)
      dreamAfterSession(sid, studentId).catch(err =>
        console.error('[Dream] Post-session error:', err.message)
      );
    }).catch(err =>
      console.error('[Summary] Final summary error:', err.message)
    );

    return success(res, { session_id: sessionId });
  } catch (err) {
    console.error('End session error:', err);
    return error(res, '结束会话失败', -1, 500);
  }
});

// PUT /api/session/:id/mode - Switch session mode
router.put('/:id/mode', (req, res) => {
  try {
    const db = getDb();
    const sessionId = req.params.id;
    const { mode } = req.body;

    if (!['text', 'push', 'agent'].includes(mode)) {
      return error(res, '无效的模式，可选：text, push, agent');
    }

    // Verify access
    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(sessionId);
    if (!session) {
      return error(res, '会话不存在', -1, 404);
    }
    if (req.user.role === 'student' && session.student_id !== req.user.id) {
      return error(res, '无权操作该会话', -1, 403);
    }
    if (req.user.role === 'teacher' && session.school_id !== req.user.school_id) {
      return error(res, '无权操作该会话', -1, 403);
    }

    db.prepare(`
      UPDATE t_consult_session
      SET mode = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(mode, sessionId);

    // v1.008: Keep guardian attached across text/push/agent modes.
    // The silence monitor is lightweight and text mode needs proactive support too.
    guardian.attachSession(parseInt(sessionId), session.student_id);
    guardian.onSessionActivity(parseInt(sessionId));

    // v1.007-04: Emit mode_change to teacher panel so UI updates
    const io = req.app.get('io');
    if (io) {
      io.to(`session_${sessionId}`).emit('session:mode_change', { session_id: parseInt(sessionId), mode });
      io.to('teacher_room').emit('session:mode_change', { session_id: parseInt(sessionId), mode });
    }

    return success(res, { session_id: sessionId, mode });
  } catch (err) {
    console.error('Switch mode error:', err);
    return error(res, '切换模式失败', -1, 500);
  }
});

module.exports = router;
