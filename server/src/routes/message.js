const express = require('express');
const { getDb } = require('../models/db');
const { authRequired } = require('../middleware/auth');
const { success, error } = require('../utils/response');
const { checkWarningKeywords, createWarning } = require('../services/warning');
const { generateRollingSummary, extractSessionThread } = require('../services/summary');
const guardian = require('../services/guardian/guardian-service');
const openLoopManager = require('../services/runtime/open-loop-manager');
const crypto = require('crypto');

const router = express.Router();

router.use(authRequired);

// POST /api/message/send - Send a message
router.post('/send', (req, res) => {
  try {
    const db = getDb();
    const user = req.user;
    const {
      session_id,
      content,
      input_type = 'text',
      content_source = 'direct',
      audio_url,
      audio_duration,
      audio_source,
      llm_suggestion,
      is_edited = 0
    } = req.body;

    if (!session_id || !content) {
      return error(res, '会话ID和消息内容不能为空');
    }

    // Verify session exists and is active
    const session = db.prepare(
      'SELECT * FROM t_consult_session WHERE id = ? AND status = 1'
    ).get(session_id);

    if (!session) {
      return error(res, '会话不存在或已结束');
    }

    if (user.role === 'student' && session.student_id !== user.id) {
      return error(res, '无权向该会话发送消息', -1, 403);
    }
    if (user.role === 'teacher' && session.school_id !== user.school_id) {
      return error(res, '无权向该会话发送消息', -1, 403);
    }

    const senderType = user.role;
    const studentId = user.role === 'student' ? user.id : session.student_id;
    const messageNo = 'M' + Date.now() + '-' + crypto.randomUUID().substring(0, 8);

    // Check for warning keywords (only for student messages)
    let warningTriggered = 0;
    let warningLevel = null;
    let warningKeywords = null;
    let warningResult = null;

    if (senderType === 'student') {
      warningResult = checkWarningKeywords(content);
      if (warningResult) {
        warningTriggered = 1;
        warningLevel = warningResult.level;
        warningKeywords = JSON.stringify(warningResult.triggerWords);
      }
    }

    // Insert message
    const result = db.prepare(`
      INSERT INTO t_message (
        message_no, session_id, student_id, sender_type, input_type,
        content, content_source, audio_url, audio_duration, audio_source,
        llm_suggestion, is_edited, warning_triggered, warning_level, warning_keywords
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageNo, session_id, studentId, senderType, input_type,
      content, content_source, audio_url || null, audio_duration || null, audio_source || null,
      llm_suggestion || null, is_edited, warningTriggered, warningLevel, warningKeywords
    );

    const messageId = result.lastInsertRowid;

    // Update session stats
    const preview = content.length > 50 ? content.substring(0, 50) + '...' : content;
    const unreadIncrement = senderType === 'student' ? 1 : 0;

    db.prepare(`
      UPDATE t_consult_session
      SET message_count = message_count + 1,
          unread_count = unread_count + ?,
          last_message_time = datetime('now', 'localtime'),
          last_message_preview = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(unreadIncrement, preview, session_id);

    // Auto-trigger rolling summary every 8 messages (async, non-blocking)
    const updatedSession = db.prepare(
      'SELECT message_count FROM t_consult_session WHERE id = ?'
    ).get(session_id);
    if (updatedSession && updatedSession.message_count > 0 && updatedSession.message_count % 8 === 0) {
      generateRollingSummary(session_id).catch(err =>
        console.error('[Summary] Auto rolling trigger error:', err.message)
      );
      // v1.005: Also extract structured thread
      extractSessionThread(session_id).catch(err =>
        console.error('[Summary] Thread extraction error:', err.message)
      );
    }

    // v1.007: Attach guardian to session (idempotent — safe to call multiple times)
    // v1.007-04: Trigger guardian event-driven tick on student message
    if (senderType === 'student') {
      guardian.attachSession(parseInt(session_id), studentId);
      guardian.onStudentMessage(parseInt(session_id));
    }

    // Create warning record if triggered
    if (warningResult) {
      createWarning({
        studentId,
        sessionId: session_id,
        messageId,
        level: warningResult.level,
        triggerType: 'keyword',
        triggerWord: warningResult.triggerWords.join(','),
        triggerContext: content.substring(0, 200)
      });
    }

    // Get the io instance for real-time push
    const io = req.app.get('io');
    if (io) {
      const messageData = {
        id: messageId,
        message_no: messageNo,
        session_id,
        student_id: studentId,
        sender_type: senderType,
        input_type,
        content,
        content_source,
        audio_url,
        audio_duration,
        warning_triggered: warningTriggered,
        warning_level: warningLevel,
        created_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
      };

      // Emit to session room using architect's event naming
      const eventName = senderType === 'student' ? 'student:message' : 'teacher:message';
      const room = `session_${session_id}`;
      const roomSockets = io.sockets.adapter.rooms.get(room);
      console.log(`[WS] Emitting ${eventName} to ${room} (${roomSockets ? roomSockets.size : 0} sockets in room)`);
      io.to(room).emit(eventName, messageData);

      // Notify teacher room as well. Teacher tabs may not reliably be joined to
      // the active session room when the list/detail layout switches sessions.
      if (senderType === 'student') {
        io.to('teacher_room').emit('student:message', messageData);
      } else {
        io.to('teacher_room').emit('teacher:message', messageData);
      }

      // v1.007-04: Teacher reply resets guardian silence timer
      if (senderType === 'teacher') {
        guardian.onTeacherReply(parseInt(session_id));
        if (content_source === 'guardian_proactive') {
          openLoopManager.observeTurn({
            sessionId: parseInt(session_id),
            studentId,
            studentText: '',
            aiText: content,
            topic: null,
            source: 'guardian_proactive_teacher_sent',
          });
        }
      }

      // If warning triggered, emit to teacher
      if (warningResult) {
        io.to('teacher_room').emit('warning_alert', {
          session_id,
          student_id: studentId,
          level: warningResult.level,
          keywords: warningResult.triggerWords,
          message_preview: preview
        });
      }
    }

    return success(res, {
      message_id: messageId,
      message_no: messageNo,
      message: {
        id: messageId,
        message_no: messageNo,
        session_id,
        student_id: studentId,
        sender_type: senderType,
        input_type,
        content,
        content_source,
        audio_url,
        audio_duration,
        created_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
      },
      warning_triggered: warningTriggered,
      warning_level: warningLevel
    });
  } catch (err) {
    console.error('Send message error:', err);
    return error(res, '发送消息失败', -1, 500);
  }
});

// GET /api/message/history - Get message history for a session
router.get('/history', (req, res) => {
  try {
    const db = getDb();
    const { session_id, page = 1, limit = 50, before_id } = req.query;

    if (!session_id) {
      return error(res, '会话ID不能为空');
    }

    // Verify the session belongs to the current user
    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(parseInt(session_id));
    if (!session) {
      return error(res, '会话不存在', -1, 404);
    }
    if (req.user.role === 'student' && session.student_id !== req.user.id) {
      return error(res, '无权访问该会话', -1, 403);
    }
    if (req.user.role === 'teacher' && session.school_id !== req.user.school_id) {
      return error(res, '无权访问该会话', -1, 403);
    }

    let whereClause = 'WHERE m.session_id = ?';
    const params = [parseInt(session_id)];

    // Support loading older messages (pagination by message id)
    if (before_id) {
      whereClause += ' AND m.id < ?';
      params.push(parseInt(before_id));
    }

    const countSql = `SELECT COUNT(*) as total FROM t_message m ${whereClause}`;
    const total = db.prepare(countSql).get(...params).total;

    const listSql = `
      SELECT m.*
      FROM t_message m
      ${whereClause}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?
    `;

    const offset = before_id ? 0 : (parseInt(page) - 1) * parseInt(limit);
    const messages = db.prepare(listSql).all(...params, parseInt(limit), offset);

    // Reverse to get chronological order
    messages.reverse();

    return success(res, {
      total,
      list: messages,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    console.error('Get message history error:', err);
    return error(res, '获取消息历史失败', -1, 500);
  }
});

// GET /api/message/unread - Get unread message counts
// IMPORTANT: This static route must be defined BEFORE /:id/read
router.get('/unread', (req, res) => {
  try {
    const db = getDb();
    const user = req.user;

    if (user.role === 'teacher') {
      const sessions = db.prepare(`
        SELECT cs.id as session_id, cs.session_no, cs.unread_count,
               cs.last_message_preview, cs.last_message_time,
               s.name as student_name, s.student_no
        FROM t_consult_session cs
        LEFT JOIN t_student s ON cs.student_id = s.id
        WHERE cs.teacher_id = ? AND cs.status = 1 AND cs.unread_count > 0
        ORDER BY cs.last_message_time DESC
      `).all(user.id);

      const totalUnread = sessions.reduce((sum, s) => sum + s.unread_count, 0);
      return success(res, { total_unread: totalUnread, sessions });
    } else {
      const session = db.prepare(`
        SELECT cs.id as session_id
        FROM t_consult_session cs
        WHERE cs.student_id = ? AND cs.status = 1
        ORDER BY cs.created_at DESC LIMIT 1
      `).get(user.id);

      if (!session) {
        return success(res, { total_unread: 0, sessions: [] });
      }

      const unread = db.prepare(`
        SELECT COUNT(*) as cnt FROM t_message
        WHERE session_id = ? AND sender_type != 'student' AND is_read = 0
      `).get(session.session_id);

      return success(res, { total_unread: unread.cnt, session_id: session.session_id });
    }
  } catch (err) {
    console.error('Get unread error:', err);
    return error(res, '获取未读消息失败', -1, 500);
  }
});

// PUT /api/message/read - Batch mark messages as read (by session)
// IMPORTANT: This static route must be defined BEFORE /:id/read
// Teacher marks student messages as read; Student marks teacher/AI messages as read
router.put('/read', (req, res) => {
  try {
    const db = getDb();
    const user = req.user;
    const { session_id } = req.body;

    if (!session_id) {
      return error(res, '会话ID不能为空');
    }

    // Verify session belongs to caller
    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(parseInt(session_id));
    if (!session) {
      return error(res, '会话不存在', -1, 404);
    }
    if (user.role === 'student' && session.student_id !== user.id) {
      return error(res, '无权操作该会话', -1, 403);
    }
    if (user.role === 'teacher' && session.school_id !== user.school_id) {
      return error(res, '无权操作该会话', -1, 403);
    }

    // Mark the OTHER side's messages as read based on caller role
    const senderCondition = user.role === 'student'
      ? "sender_type != 'student'"   // Student reads teacher/AI messages
      : "sender_type = 'student'";   // Teacher reads student messages

    const result = db.prepare(`
      UPDATE t_message
      SET is_read = 1, read_time = datetime('now', 'localtime')
      WHERE session_id = ? AND is_read = 0 AND ${senderCondition}
    `).run(session_id);

    // Reset session unread_count (this tracks teacher-side unread)
    if (user.role === 'teacher') {
      db.prepare(`
        UPDATE t_consult_session
        SET unread_count = 0, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(session_id);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`session_${session_id}`).emit('message:read', {
        session_id: parseInt(session_id),
        all: true,
        count: result.changes
      });
    }

    return success(res, { session_id: parseInt(session_id), read_count: result.changes });
  } catch (err) {
    console.error('Batch mark read error:', err);
    return error(res, '批量标记已读失败', -1, 500);
  }
});

// PUT /api/message/:id/read - Mark a single message as read
router.put('/:id/read', (req, res) => {
  try {
    const db = getDb();
    const messageId = req.params.id;

    const message = db.prepare('SELECT * FROM t_message WHERE id = ?').get(messageId);
    if (!message) {
      return error(res, '消息不存在', -1, 404);
    }

    // Verify session belongs to caller
    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(message.session_id);
    if (session) {
      if (req.user.role === 'student' && session.student_id !== req.user.id) {
        return error(res, '无权操作', -1, 403);
      }
      if (req.user.role === 'teacher' && session.school_id !== req.user.school_id) {
        return error(res, '无权操作', -1, 403);
      }
    }

    db.prepare(`
      UPDATE t_message
      SET is_read = 1, read_time = datetime('now', 'localtime')
      WHERE id = ? AND is_read = 0
    `).run(messageId);

    db.prepare(`
      UPDATE t_consult_session
      SET unread_count = MAX(unread_count - 1, 0),
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(message.session_id);

    const io = req.app.get('io');
    if (io) {
      io.to(`session_${message.session_id}`).emit('message:read', {
        message_id: parseInt(messageId),
        session_id: message.session_id,
        read_time: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
      });
    }

    return success(res, { message_id: parseInt(messageId) });
  } catch (err) {
    console.error('Mark read error:', err);
    return error(res, '标记已读失败', -1, 500);
  }
});

module.exports = router;

