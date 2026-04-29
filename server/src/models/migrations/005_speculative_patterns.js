/**
 * Migration 005: Speculative patterns for predictive coordinator caching.
 *
 * v1.007: Dream service writes patterns, speculative engine reads them.
 * Data flow: Dream → t_speculative_pattern → Speculative Engine (one-way).
 */
module.exports = {
  name: 'speculative_patterns',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_speculative_pattern (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_context TEXT NOT NULL,
        predicted_weights TEXT NOT NULL,
        predicted_emotion TEXT,
        hit_count INTEGER DEFAULT 0,
        miss_count INTEGER DEFAULT 0,
        confidence REAL DEFAULT 0.5,
        last_hit_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (student_id) REFERENCES t_student(id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pattern_student ON t_speculative_pattern(student_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pattern_trigger ON t_speculative_pattern(trigger_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pattern_confidence ON t_speculative_pattern(confidence)`);
  }
};
