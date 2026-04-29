const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../models/db');
const { generateToken } = require('../middleware/auth');
const { success, error } = require('../utils/response');

const router = express.Router();

// POST /api/auth/student/login
router.post('/student/login', (req, res) => {
  try {
    const student_no = String(req.body.student_no || '').trim();
    const password = String(req.body.password || '').trim();

    if (!student_no || !password) {
      return error(res, '学号和密码不能为空');
    }

    const db = getDb();
    const student = db.prepare(
      'SELECT * FROM t_student WHERE student_no = ? COLLATE NOCASE AND status = 1 AND deleted_at IS NULL'
    ).get(student_no);

    if (!student) {
      return error(res, '学号不存在或账号已禁用');
    }

    if (!bcrypt.compareSync(password, student.password)) {
      return error(res, '密码错误');
    }

    // Update last login time
    db.prepare(
      "UPDATE t_student SET last_login_time = datetime('now', 'localtime') WHERE id = ?"
    ).run(student.id);

    const token = generateToken({
      id: student.id,
      student_no: student.student_no,
      name: student.name,
      school_id: student.school_id,
      role: 'student'
    });

    return success(res, {
      token,
      user: {
        id: student.id,
        student_no: student.student_no,
        name: student.name,
        gender: student.gender,
        grade: student.grade,
        class_name: student.class_name,
        avatar: student.avatar,
        school_id: student.school_id,
        role: 'student'
      }
    });
  } catch (err) {
    console.error('Student login error:', err);
    return error(res, '登录失败，请稍后重试', -1, 500);
  }
});

// POST /api/auth/teacher/login
router.post('/teacher/login', (req, res) => {
  try {
    const { teacher_no, password } = req.body;

    if (!teacher_no || !password) {
      return error(res, '工号和密码不能为空');
    }

    const db = getDb();
    const teacher = db.prepare(
      'SELECT * FROM t_teacher WHERE teacher_no = ? AND status = 1 AND deleted_at IS NULL'
    ).get(teacher_no);

    if (!teacher) {
      return error(res, '工号不存在或账号已禁用');
    }

    if (!bcrypt.compareSync(password, teacher.password)) {
      return error(res, '密码错误');
    }

    // Update last login time
    db.prepare(
      "UPDATE t_teacher SET last_login_time = datetime('now', 'localtime') WHERE id = ?"
    ).run(teacher.id);

    const token = generateToken({
      id: teacher.id,
      teacher_no: teacher.teacher_no,
      name: teacher.name,
      school_id: teacher.school_id,
      role: 'teacher'
    });

    return success(res, {
      token,
      user: {
        id: teacher.id,
        teacher_no: teacher.teacher_no,
        name: teacher.name,
        avatar: teacher.avatar,
        school_id: teacher.school_id,
        role: 'teacher'
      }
    });
  } catch (err) {
    console.error('Teacher login error:', err);
    return error(res, '登录失败，请稍后重试', -1, 500);
  }
});

// GET /api/auth/me - Get current user info
router.get('/me', (req, res) => {
  // This route requires auth middleware to be applied at router level
  const { authRequired } = require('../middleware/auth');
  authRequired(req, res, () => {
    return success(res, req.user);
  });
});

module.exports = router;
