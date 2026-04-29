const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../models/db');
const { authRequired, teacherRequired } = require('../middleware/auth');
const { success, error } = require('../utils/response');
const { calculateCurrentGrade, refreshAllGrades } = require('../utils/grade');

const router = express.Router();

router.use(authRequired);

// POST /api/student/add - Add a student (teacher only)
router.post('/add', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const { student_no, name, gender, grade, class_name, phone, notes } = req.body;

    // Validate required fields
    if (!student_no || !name || !grade) {
      return error(res, '学籍号、姓名、年级为必填项');
    }

    // Validate student_no format: starts with S/s, at least 7 chars total
    if (!/^[sS].{6,}$/.test(student_no)) {
      return error(res, '学籍号格式不正确，应以S开头且至少7位');
    }

    // Check uniqueness (case-insensitive)
    const existing = db.prepare(
      'SELECT id FROM t_student WHERE student_no = ? COLLATE NOCASE'
    ).get(student_no);
    if (existing) {
      return error(res, '该学籍号已存在');
    }

    // Password: last 6 chars of student_no
    const rawPassword = student_no.slice(-6);
    const hashedPassword = bcrypt.hashSync(rawPassword, 10);

    // Enrollment info: current academic year (Sep boundary)
    const now = new Date();
    const enrollmentYear = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;

    const result = db.prepare(`
      INSERT INTO t_student (
        student_no, name, gender, grade, class_name, phone,
        school_id, password,
        enrollment_grade, enrollment_year, added_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      student_no.toUpperCase(), name, gender || null, grade, class_name || null, phone || null,
      req.user.school_id, hashedPassword,
      grade, enrollmentYear, req.user.id, notes || null
    );

    // Create empty student profile
    db.prepare(
      'INSERT OR IGNORE INTO t_student_profile (student_id) VALUES (?)'
    ).run(result.lastInsertRowid);

    return success(res, {
      id: result.lastInsertRowid,
      student_no: student_no.toUpperCase(),
      name,
      grade,
      initial_password: rawPassword
    }, '学生添加成功');
  } catch (err) {
    console.error('Add student error:', err);
    return error(res, '添加学生失败: ' + err.message, -1, 500);
  }
});

// PUT /api/student/:id - Edit student info (teacher only)
router.put('/:id', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const studentId = req.params.id;
    const { name, gender, grade, class_name, phone, notes } = req.body;

    // Check student exists and belongs to teacher's school
    const student = db.prepare(
      'SELECT * FROM t_student WHERE id = ? AND deleted_at IS NULL AND school_id = ?'
    ).get(studentId, req.user.school_id);
    if (!student) {
      return error(res, '学生不存在', -1, 404);
    }

    // Build dynamic update
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (gender !== undefined) { updates.push('gender = ?'); params.push(gender); }
    if (grade !== undefined) { updates.push('grade = ?'); params.push(grade); }
    if (class_name !== undefined) { updates.push('class_name = ?'); params.push(class_name); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

    if (updates.length === 0) {
      return error(res, '没有要更新的字段');
    }

    updates.push("updated_at = datetime('now', 'localtime')");
    params.push(studentId);

    db.prepare(
      `UPDATE t_student SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);

    return success(res, null, '学生信息更新成功');
  } catch (err) {
    console.error('Update student error:', err);
    return error(res, '更新学生信息失败', -1, 500);
  }
});

// DELETE /api/student/:id - Soft delete student (teacher only)
router.delete('/:id', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const studentId = req.params.id;

    const student = db.prepare(
      'SELECT id, name, student_no FROM t_student WHERE id = ? AND deleted_at IS NULL AND school_id = ?'
    ).get(studentId, req.user.school_id);
    if (!student) {
      return error(res, '学生不存在', -1, 404);
    }

    db.prepare(
      "UPDATE t_student SET deleted_at = datetime('now', 'localtime'), status = 0, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(studentId);

    return success(res, { id: studentId, student_no: student.student_no }, '学生已删除');
  } catch (err) {
    console.error('Delete student error:', err);
    return error(res, '删除学生失败', -1, 500);
  }
});

// POST /api/student/:id/reset-password - Reset password to last 6 of student_no (teacher only)
router.post('/:id/reset-password', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const studentId = req.params.id;

    const student = db.prepare(
      'SELECT id, student_no FROM t_student WHERE id = ? AND deleted_at IS NULL AND school_id = ?'
    ).get(studentId, req.user.school_id);
    if (!student) {
      return error(res, '学生不存在', -1, 404);
    }

    const rawPassword = student.student_no.slice(-6);
    const hashedPassword = bcrypt.hashSync(rawPassword, 10);

    db.prepare(
      "UPDATE t_student SET password = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(hashedPassword, studentId);

    return success(res, { initial_password: rawPassword }, '密码已重置');
  } catch (err) {
    console.error('Reset password error:', err);
    return error(res, '重置密码失败', -1, 500);
  }
});

// POST /api/student/refresh-grades - Recalculate all grades (teacher only)
router.post('/refresh-grades', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const count = refreshAllGrades(db);
    return success(res, { updated: count }, `已更新 ${count} 名学生的年级`);
  } catch (err) {
    console.error('Refresh grades error:', err);
    return error(res, '年级更新失败', -1, 500);
  }
});

// GET /api/student/list - Get student list (teacher only)
router.get('/list', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const { search, grade, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE s.status = 1 AND s.deleted_at IS NULL AND s.school_id = ?';
    const params = [req.user.school_id];

    if (search) {
      whereClause += ' AND (s.name LIKE ? OR s.student_no LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (grade) {
      whereClause += ' AND s.grade = ?';
      params.push(grade);
    }

    const total = db.prepare(
      `SELECT COUNT(*) as total FROM t_student s ${whereClause}`
    ).get(...params).total;

    const list = db.prepare(`
      SELECT s.id, s.student_no, s.name, s.gender, s.grade, s.class_name, s.avatar,
             s.enrollment_grade, s.enrollment_year, s.notes,
             s.last_login_time, s.created_at,
             p.current_risk_level,
             (SELECT COUNT(*) FROM t_consult_session cs WHERE cs.student_id = s.id) as session_count,
             (SELECT MAX(cs2.last_message_time) FROM t_consult_session cs2 WHERE cs2.student_id = s.id) as last_session_time
      FROM t_student s
      LEFT JOIN t_student_profile p ON s.id = p.student_id
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    return success(res, { total, list, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('List students error:', err);
    return error(res, '获取学生列表失败', -1, 500);
  }
});

// GET /api/student/:id - Get student detail (teacher only)
router.get('/:id', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const studentId = req.params.id;

    const student = db.prepare(`
      SELECT s.id, s.student_no, s.name, s.gender, s.grade, s.class_name, s.avatar,
             s.phone, s.enrollment_grade, s.enrollment_year, s.notes, s.added_by,
             s.last_login_time, s.created_at
      FROM t_student s
      WHERE s.id = ? AND s.deleted_at IS NULL AND s.school_id = ?
    `).get(studentId, req.user.school_id);

    if (!student) {
      return error(res, '学生不存在', -1, 404);
    }

    // Calculate current grade from enrollment info
    if (student.enrollment_grade && student.enrollment_year) {
      student.calculated_grade = calculateCurrentGrade(student.enrollment_grade, student.enrollment_year);
    }

    // Get profile
    const profile = db.prepare(
      'SELECT * FROM t_student_profile WHERE student_id = ?'
    ).get(studentId);

    // Get session count
    const sessionStats = db.prepare(`
      SELECT COUNT(*) as total_sessions,
             SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as active_sessions
      FROM t_consult_session WHERE student_id = ?
    `).get(studentId);

    // Get who added this student
    let addedByName = null;
    if (student.added_by) {
      const teacher = db.prepare('SELECT name FROM t_teacher WHERE id = ?').get(student.added_by);
      if (teacher) addedByName = teacher.name;
    }

    return success(res, {
      ...student,
      added_by_name: addedByName,
      profile: profile || null,
      session_stats: sessionStats
    });
  } catch (err) {
    console.error('Get student error:', err);
    return error(res, '获取学生详情失败', -1, 500);
  }
});

// GET /api/student/:id/context - Get student cross-session context (for teacher panel)
router.get('/:id/context', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const studentId = req.params.id;

    const student = db.prepare(`
      SELECT s.id, s.student_no, s.name, s.gender, s.grade, s.class_name
      FROM t_student s
      WHERE s.id = ? AND s.deleted_at IS NULL AND s.school_id = ?
    `).get(studentId, req.user.school_id);

    if (!student) {
      return error(res, '学生不存在', -1, 404);
    }

    const sessionCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM t_consult_session WHERE student_id = ?'
    ).get(studentId).cnt;

    const finalSummaries = db.prepare(`
      SELECT ss.id, ss.session_id, ss.topics_discussed, ss.student_expressions,
             ss.approaches_tried, ss.unresolved_items, ss.session_flow,
             ss.raw_summary, ss.trigger_turn, ss.created_at,
             cs.start_time, cs.end_time
      FROM t_session_summary ss
      LEFT JOIN t_consult_session cs ON ss.session_id = cs.id
      WHERE ss.student_id = ? AND ss.summary_type = 'final'
      ORDER BY ss.created_at DESC
    `).all(studentId);

    const summaries = finalSummaries.map(s => {
      const checkpoints = db.prepare(`
        SELECT id, raw_summary, trigger_turn, message_range_start, message_range_end, created_at
        FROM t_session_summary
        WHERE session_id = ? AND summary_type = 'rolling'
        ORDER BY id ASC
      `).all(s.session_id);

      return {
        ...s,
        topics_discussed: safeParseJSON(s.topics_discussed, []),
        student_expressions: safeParseJSON(s.student_expressions, []),
        approaches_tried: safeParseJSON(s.approaches_tried, []),
        unresolved_items: safeParseJSON(s.unresolved_items, []),
        rolling_checkpoints: checkpoints,
      };
    });

    const allUnresolved = [];
    summaries.forEach(s => {
      if (s.unresolved_items && s.unresolved_items.length > 0) {
        allUnresolved.push(...s.unresolved_items);
      }
    });

    const activeSession = db.prepare(
      'SELECT id FROM t_consult_session WHERE student_id = ? AND status = 1 ORDER BY created_at DESC LIMIT 1'
    ).get(studentId);

    let rollingCheckpoints = [];
    if (activeSession) {
      rollingCheckpoints = db.prepare(`
        SELECT id, raw_summary, trigger_turn, message_range_start, message_range_end, created_at
        FROM t_session_summary
        WHERE session_id = ? AND summary_type = 'rolling'
        ORDER BY id ASC
      `).all(activeSession.id);
    }

    // v1.005: Load student counseling profile
    let profile = null;
    try {
      profile = db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId);
      if (profile) {
        // Map actual DB columns to v1.005 frontend field names
        profile.core_issues = safeParseJSON(profile.primary_concerns, []);
        profile.effective_methods = safeParseJSON(profile.effective_strategies, []);
        profile.avoid_topics = safeParseJSON(profile.sensitive_topics, []);
        profile.emotion_baseline = profile.emotional_pattern || null;
        profile.risk_history = profile.risk_notes
          ? profile.risk_notes.split('\n').filter(Boolean).map(line => {
              const match = line.match(/\[(.+?)\]\s*\[(.+?)\]\s*"(.+?)"/);
              return match ? { date: match[1], level: match[2], quote: match[3] } : { date: '', level: '', quote: line };
            })
          : [];
      }
    } catch (e) { /* t_student_profile may not exist */ }

    // v1.005: Load session thread for active session
    let sessionThread = null;
    try {
      if (activeSession) {
        sessionThread = db.prepare('SELECT * FROM t_session_thread WHERE session_id = ?').get(activeSession.id);
        if (sessionThread) {
          sessionThread.key_events = safeParseJSON(sessionThread.key_events, []);
          sessionThread.emotion_shifts = safeParseJSON(sessionThread.emotion_shifts, []);
          sessionThread.unresolved = safeParseJSON(sessionThread.unresolved, []);
          sessionThread.strategies_tried = safeParseJSON(sessionThread.strategies_tried, []);
          sessionThread.student_quotes = safeParseJSON(sessionThread.student_quotes, []);
        }
      }
    } catch (e) { /* t_session_thread may not exist */ }

    return success(res, {
      student,
      session_count: sessionCount,
      unresolved_items: allUnresolved,
      final_summaries: summaries,
      rolling_checkpoints: rollingCheckpoints,
      profile,          // v1.005
      session_thread: sessionThread,  // v1.005
    });
  } catch (err) {
    console.error('Get student context error:', err);
    return error(res, '获取学生上下文失败', -1, 500);
  }
});

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
