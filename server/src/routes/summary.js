const express = require('express');
const { getDb } = require('../models/db');
const { authRequired, teacherRequired } = require('../middleware/auth');
const { success, error } = require('../utils/response');
const { generateRollingSummary, generateFinalSummary } = require('../services/summary');

const router = express.Router();

router.use(authRequired);

// POST /api/summary/generate - Manually trigger summary generation
router.post('/generate', teacherRequired, async (req, res) => {
  try {
    const { session_id, type = 'rolling' } = req.body;

    if (!session_id) {
      return error(res, '会话ID不能为空');
    }

    // Verify session belongs to teacher's school
    const db = getDb();
    const session = db.prepare(
      'SELECT id FROM t_consult_session WHERE id = ? AND school_id = ?'
    ).get(parseInt(session_id), req.user.school_id);
    if (!session) {
      return error(res, '会话不存在', -1, 404);
    }

    if (type === 'final') {
      await generateFinalSummary(parseInt(session_id));
    } else {
      await generateRollingSummary(parseInt(session_id));
    }

    // Return the generated summary
    const summary = db.prepare(`
      SELECT * FROM t_session_summary
      WHERE session_id = ? AND summary_type = ?
      ORDER BY id DESC LIMIT 1
    `).get(parseInt(session_id), type);

    return success(res, summary || { message: '总结生成完成' });
  } catch (err) {
    console.error('Generate summary error:', err);
    return error(res, '生成总结失败', -1, 500);
  }
});

// GET /api/summary/session/:id - Get summaries for a session
router.get('/session/:id', teacherRequired, (req, res) => {
  try {
    const db = getDb();
    const sessionId = req.params.id;

    // Verify session belongs to teacher's school
    const session = db.prepare(
      'SELECT id FROM t_consult_session WHERE id = ? AND school_id = ?'
    ).get(parseInt(sessionId), req.user.school_id);
    if (!session) {
      return error(res, '会话不存在', -1, 404);
    }

    const summaries = db.prepare(`
      SELECT * FROM t_session_summary
      WHERE session_id = ?
      ORDER BY created_at DESC
    `).all(parseInt(sessionId));

    return success(res, summaries);
  } catch (err) {
    console.error('Get session summaries error:', err);
    return error(res, '获取会话总结失败', -1, 500);
  }
});

module.exports = router;
