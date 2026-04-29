/**
 * Voice Routes - v1.007
 *
 * Streaming suggest endpoint for voice pipeline.
 * Uses SSE (Server-Sent Events) to push sentences as they're generated.
 */

const express = require('express');
const { getDb } = require('../models/db');
const { authRequired, teacherRequired } = require('../middleware/auth');
const { success, error } = require('../utils/response');
const { runSuggestionTurnStreaming } = require('../services/runtime/counseling-runtime');
const config = require('../services/runtime/counseling-config');

const router = express.Router();

router.use(authRequired);

/**
 * POST /api/voice/suggest-stream
 *
 * SSE endpoint: streams suggestion sentences as they're generated.
 * Client receives events:
 *   event: analysis    — coordinator result (skillWeights, emotion)
 *   event: sentence    — one sentence of the response
 *   event: done        — generation complete with trace info
 *   event: error       — something went wrong
 */
router.post('/suggest-stream', teacherRequired, async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return error(res, '会话ID不能为空');
  }

  if (!config.apiKey || config.apiKey === 'YOUR_API_KEY_HERE') {
    return error(res, 'AI API未配置');
  }

  const db = getDb();
  const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(session_id);
  if (!session) {
    return error(res, '会话不存在');
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  try {
    const stream = runSuggestionTurnStreaming({
      sessionId: parseInt(session_id),
      studentId: session.student_id,
    });

    for await (const event of stream) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);

      // Flush immediately for real-time delivery
      if (res.flush) res.flush();
    }
  } catch (err) {
    console.error('[Voice] Stream suggest error:', err);
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
  }

  res.end();
});

/**
 * POST /api/voice/guardian-send
 *
 * Teacher confirms a Guardian proactive suggestion — sends it to student.
 * Text mode: teacher clicks "send" on Guardian suggestion.
 */
router.post('/guardian-send', teacherRequired, (req, res) => {
  const { session_id, content } = req.body;
  if (!session_id || !content) {
    return error(res, '会话ID和内容不能为空');
  }

  const { sendProactiveToStudent } = require('../services/guardian/guardian-service');
  sendProactiveToStudent(parseInt(session_id), content);
  return success(res, { sent: true });
});

/**
 * POST /api/voice/guardian-toggle
 * Teacher pauses/resumes Guardian auto-send in voice mode.
 */
router.post('/guardian-toggle', teacherRequired, (req, res) => {
  const { session_id, auto } = req.body;
  if (!session_id) return error(res, '会话ID不能为空');

  const guardianState = require('../services/guardian/guardian-state');
  const state = guardianState.getState(parseInt(session_id));
  if (!state) return error(res, 'Guardian 未激活');

  state.autoProactive = !!auto;
  console.log(`[Guardian] Auto-proactive ${auto ? 'RESUMED' : 'PAUSED'} for session ${session_id}`);
  return success(res, { auto: state.autoProactive });
});

module.exports = router;
