const express = require('express');
const { getDb } = require('../models/db');
const { authRequired, teacherRequired } = require('../middleware/auth');
const { success, error } = require('../utils/response');

const router = express.Router();

router.use(authRequired);

// GET /api/warning/list - Get warning list (teacher only)
router.get('/list', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const { status, level, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Scope to teacher's school
    let whereClause = 'WHERE s.school_id = ?';
    const params = [req.user.school_id];

    if (status) {
      whereClause += ' AND w.status = ?';
      params.push(parseInt(status));
    }
    if (level) {
      whereClause += ' AND w.level = ?';
      params.push(parseInt(level));
    }

    const total = db.prepare(
      `SELECT COUNT(*) as total FROM t_warning w JOIN t_student s ON w.student_id = s.id ${whereClause}`
    ).get(...params).total;

    const list = db.prepare(`
      SELECT w.*, s.name as student_name, s.student_no, s.grade, s.class_name
      FROM t_warning w
      JOIN t_student s ON w.student_id = s.id
      ${whereClause}
      ORDER BY w.level ASC, w.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    return success(res, { total, list, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('List warnings error:', err);
    return error(res, '获取预警列表失败', -1, 500);
  }
});

// PUT /api/warning/:id/handle - Handle a warning (teacher only)
router.put('/:id/handle', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const warningId = req.params.id;
    const { status, handle_result, handle_notes } = req.body;

    if (!status || ![2, 3, 4].includes(status)) {
      return error(res, '无效的处理状态，可选：2-处理中 3-已处理 4-已关闭');
    }

    // Verify warning belongs to teacher's school
    const warning = db.prepare(`
      SELECT w.id FROM t_warning w
      JOIN t_student s ON w.student_id = s.id
      WHERE w.id = ? AND s.school_id = ?
    `).get(warningId, req.user.school_id);
    if (!warning) {
      return error(res, '预警不存在', -1, 404);
    }

    db.prepare(`
      UPDATE t_warning
      SET status = ?, handler_id = ?, handle_time = datetime('now', 'localtime'),
          handle_result = ?, handle_notes = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(status, req.user.id, handle_result || null, handle_notes || null, warningId);

    return success(res, { warning_id: warningId });
  } catch (err) {
    console.error('Handle warning error:', err);
    return error(res, '处理预警失败', -1, 500);
  }
});

// GET /api/warning/stats - Warning statistics (teacher only)
router.get('/stats', teacherRequired, (req, res) => {
  try {
    const db = getDb();

    const stats = db.prepare(`
      SELECT
        SUM(CASE WHEN w.level = 1 AND w.status = 1 THEN 1 ELSE 0 END) as level1_pending,
        SUM(CASE WHEN w.level = 2 AND w.status = 1 THEN 1 ELSE 0 END) as level2_pending,
        SUM(CASE WHEN w.level = 3 AND w.status = 1 THEN 1 ELSE 0 END) as level3_pending,
        SUM(CASE WHEN w.status = 1 THEN 1 ELSE 0 END) as total_pending,
        COUNT(*) as total
      FROM t_warning w
      JOIN t_student s ON w.student_id = s.id
      WHERE s.school_id = ?
    `).get(req.user.school_id);

    return success(res, stats);
  } catch (err) {
    console.error('Warning stats error:', err);
    return error(res, '获取预警统计失败', -1, 500);
  }
});

module.exports = router;
