const { getDb } = require('../models/db');
const crypto = require('crypto');

// Check message content against warning keywords
function checkWarningKeywords(content) {
  const db = getDb();
  const keywords = db.prepare(
    'SELECT * FROM t_warning_keyword WHERE status = 1 ORDER BY level ASC'
  ).all();

  const triggered = [];
  for (const kw of keywords) {
    if (content.includes(kw.keyword)) {
      triggered.push({
        keyword: kw.keyword,
        category: kw.category,
        level: kw.level,
        weight: kw.weight
      });
    }
  }

  if (triggered.length === 0) return null;

  // Use the highest (most urgent = lowest number) warning level
  const highestLevel = Math.min(...triggered.map(t => t.level));
  return {
    level: highestLevel,
    keywords: triggered,
    triggerWords: triggered.map(t => t.keyword)
  };
}

// Create a warning record
function createWarning({ studentId, sessionId, messageId, level, triggerType, triggerWord, triggerContext }) {
  const db = getDb();
  const warningNo = 'W' + Date.now() + '-' + crypto.randomUUID().substring(0, 8);

  db.prepare(`
    INSERT INTO t_warning (warning_no, student_id, session_id, message_id, level, trigger_type, trigger_word, trigger_context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(warningNo, studentId, sessionId, messageId, level, triggerType, triggerWord, triggerContext);

  // Update session warning level if higher
  db.prepare(`
    UPDATE t_consult_session
    SET warning_level = CASE WHEN COALESCE(warning_level, 0) = 0 THEN ? ELSE MIN(warning_level, ?) END,
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(level, level, sessionId);

  return warningNo;
}

module.exports = { checkWarningKeywords, createWarning };
