const jwt = require('jsonwebtoken');
const { error } = require('../utils/response');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
  process.exit(1);
}

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Middleware: require authentication
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(res, '未提供认证令牌', 401, 401);
  }

  const token = authHeader.substring(7);
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return error(res, '认证令牌无效或已过期', 401, 401);
  }
}

// Middleware: require teacher role
function teacherRequired(req, res, next) {
  if (!req.user || req.user.role !== 'teacher') {
    return error(res, '需要教师权限', 403, 403);
  }
  next();
}

// Middleware: require student role
function studentRequired(req, res, next) {
  if (!req.user || req.user.role !== 'student') {
    return error(res, '需要学生权限', 403, 403);
  }
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  authRequired,
  teacherRequired,
  studentRequired
};
