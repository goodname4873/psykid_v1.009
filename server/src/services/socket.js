const { verifyToken } = require('../middleware/auth');
const { getDb } = require('../models/db');

// v1.005: Track online teachers for auto-reply logic
const onlineTeachers = new Map(); // teacherId -> Set<socketId>

function isTeacherOnline(teacherId) {
  const sockets = onlineTeachers.get(teacherId);
  return sockets && sockets.size > 0;
}

function getOnlineTeacherIds() {
  return [...onlineTeachers.keys()].filter(id => isTeacherOnline(id));
}

function setupSocket(io) {
  // Authentication middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = verifyToken(token);
      socket.user = decoded;
      next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[Socket] ${user.role} connected: ${user.name} (${user.id})`);

    // Teacher joins teacher room for broadcast notifications
    if (user.role === 'teacher') {
      socket.join('teacher_room');
      // v1.005: Track teacher online state
      if (!onlineTeachers.has(user.id)) onlineTeachers.set(user.id, new Set());
      onlineTeachers.get(user.id).add(socket.id);

      // Notify all that teacher is online
      io.emit('teacher:online', {
        teacher_id: user.id,
        name: user.name,
        online: true
      });
      console.log(`[Socket] Teacher ${user.name} is online`);
    }

    // Join session room
    socket.on('join_session', (sessionId) => {
      const session = getDb().prepare('SELECT * FROM t_consult_session WHERE id = ? AND status = 1').get(parseInt(sessionId));
      if (!session) {
        socket.emit('session:error', { session_id: sessionId, message: 'Session not found' });
        return;
      }
      if (user.role === 'student' && session.student_id !== user.id) {
        socket.emit('session:error', { session_id: sessionId, message: 'Forbidden session' });
        console.warn(`[Socket] Blocked ${user.name} (${user.id}) from joining session_${sessionId}`);
        return;
      }
      if (user.role === 'teacher' && session.school_id !== user.school_id) {
        socket.emit('session:error', { session_id: sessionId, message: 'Forbidden session' });
        return;
      }
      const room = `session_${sessionId}`;
      socket.join(room);
      console.log(`[Socket] ${user.name} joined ${room}`);

      socket.to(room).emit('user_joined', {
        user_id: user.id,
        role: user.role,
        name: user.name
      });

      // v1.007-05: Re-attach Guardian when student joins a session (covers reconnect after drop)
      if (user.role === 'student') {
        try {
          const guardian = require('./guardian/guardian-service');
          guardian.attachSession(parseInt(sessionId), session.student_id);
        } catch (e) { /* ignore */ }
      }
    });

    // Leave session room
    socket.on('leave_session', (sessionId) => {
      const room = `session_${sessionId}`;
      socket.leave(room);
      console.log(`[Socket] ${user.name} left ${room}`);

      socket.to(room).emit('user_left', {
        user_id: user.id,
        role: user.role,
        name: user.name
      });
    });

    // Student sends message via WebSocket
    socket.on('student:message', (data) => {
      const room = `session_${data.session_id}`;
      // Broadcast to session room (teacher will receive)
      socket.to(room).emit('student:message', {
        ...data,
        sender_id: user.id,
        sender_name: user.name,
        sender_type: 'student'
      });
      // Also notify teacher room
      socket.to('teacher_room').emit('student:message', {
        ...data,
        sender_id: user.id,
        sender_name: user.name,
        sender_type: 'student'
      });
    });

    // Teacher sends reply via WebSocket
    socket.on('teacher:message', (data) => {
      const room = `session_${data.session_id}`;
      // Broadcast to session room (student will receive)
      socket.to(room).emit('teacher:message', {
        ...data,
        sender_id: user.id,
        sender_name: user.name,
        sender_type: 'teacher'
      });
    });

    // Message read event
    socket.on('message:read', (data) => {
      const room = `session_${data.session_id}`;
      socket.to(room).emit('message:read', {
        message_id: data.message_id,
        session_id: data.session_id,
        reader_id: user.id,
        reader_role: user.role
      });
    });

    // Coordinator analysis update (student → teacher relay)
    socket.on('coordinator:update', (data) => {
      socket.to('teacher_room').emit('coordinator:update', {
        ...data,
        student_id: user.id,
        student_name: user.name,
      });
    });

    // Teacher voice intervention (teacher sends text during voice session)
    socket.on('teacher:intervene', (data) => {
      const room = `session_${data.session_id}`;
      socket.to(room).emit('teacher:intervene', {
        ...data,
        sender_id: user.id,
        sender_name: user.name,
        sender_type: 'teacher',
      });
    });

    // Typing indicator
    socket.on('typing', (data) => {
      const room = `session_${data.session_id}`;
      socket.to(room).emit('user_typing', {
        user_id: user.id,
        role: user.role,
        name: user.name,
        is_typing: data.is_typing
      });
    });

    // Heartbeat
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Disconnect
    socket.on('disconnect', (reason) => {
      console.log(`[Socket] ${user.name} disconnected: ${reason}`);

      // v1.007-05 fix: 不再在 socket 断连时 detach Guardian
      // 原因：transport close / 切 tab / 网络抖动都会触发，频繁 detach 会清掉沉默计时器状态
      // 让 Guardian 的 5 分钟 idle timeout 自己兜底（足够清理真正离开的会话）

      // If teacher disconnects, update tracking
      if (user.role === 'teacher') {
        const sockets = onlineTeachers.get(user.id);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) onlineTeachers.delete(user.id);
        }
        io.emit('teacher:online', {
          teacher_id: user.id,
          name: user.name,
          online: isTeacherOnline(user.id)
        });
      }
    });
  });

  return io;
}

module.exports = { setupSocket, isTeacherOnline, getOnlineTeacherIds };
