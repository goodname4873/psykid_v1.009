/**
 * Migration 008: v1.009 fast-path trace + open loop state.
 *
 * Adds structured fields so Guardian/Fast Verifier decisions are queryable
 * without digging through usage_json, and creates the first Open Loop tables.
 */
module.exports = {
  name: 'v1009_trace_open_loop',
  up(db) {
    const add = (sql) => { try { db.exec(sql); } catch (e) {} };

    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN guardian_candidate INTEGER DEFAULT 0');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN candidate_source TEXT');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN verifier_decision TEXT');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN rejected_reason TEXT');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN draft_age_ms INTEGER');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN verifier_ms INTEGER');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN pipeline_ms INTEGER');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN fast_path_saved_ms INTEGER');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN coordinator_skipped INTEGER DEFAULT 0');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN open_loop_json TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS t_open_loop (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        loop_type TEXT NOT NULL,
        topic TEXT,
        subtopic TEXT,
        unresolved_point TEXT,
        suggested_resume TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        confidence REAL DEFAULT 0.5,
        source TEXT,
        evidence TEXT,
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (session_id) REFERENCES t_consult_session(id)
      );
      CREATE INDEX IF NOT EXISTS idx_open_loop_session_status ON t_open_loop(session_id, status);
      CREATE INDEX IF NOT EXISTS idx_open_loop_student_status ON t_open_loop(student_id, status);
      CREATE INDEX IF NOT EXISTS idx_open_loop_topic ON t_open_loop(topic);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS t_open_loop_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        open_loop_id INTEGER,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (open_loop_id) REFERENCES t_open_loop(id)
      );
      CREATE INDEX IF NOT EXISTS idx_open_loop_event_loop ON t_open_loop_event(open_loop_id);
      CREATE INDEX IF NOT EXISTS idx_open_loop_event_session ON t_open_loop_event(session_id);
    `);
  },
};
