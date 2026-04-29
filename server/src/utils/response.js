function success(res, data = null, message = 'success') {
  return res.json({ code: 0, message, data });
}

function error(res, message = 'error', code = -1, statusCode = 400) {
  return res.status(statusCode).json({ code, message, data: null });
}

function serverError(res, message = 'Internal server error') {
  return res.status(500).json({ code: -1, message, data: null });
}

module.exports = { success, error, serverError };
