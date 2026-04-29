/**
 * Migration 004: AI suggestion trace + context trace + intervention feedback
 *
 * v1.006: Makes every AI suggestion turn explainable and replayable.
 */
module.exports = {
  name: 'ai_trace',
  up(db) {
    // === AI suggestion trace: full execution record per /api/ai/suggest call ===
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_ai_suggestion_trace (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        trigger_message_id INTEGER,
        coordinator_model TEXT,
        generator_model TEXT,
        assembled_context_json TEXT,
        prompt_digest TEXT,
        analysis_json TEXT,
        suggestions_json TEXT,
        usage_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (session_id) REFERENCES t_consult_session(id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sug_trace_session ON t_ai_suggestion_trace(session_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sug_trace_student ON t_ai_suggestion_trace(student_id)`);

    // === Context trace: what memory was used for each suggestion ===
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_context_trace (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        suggestion_trace_id INTEGER,
        recent_message_ids TEXT,
        used_rolling_ids TEXT,
        used_final_ids TEXT,
        used_thread_fields TEXT,
        used_profile_fields TEXT,
        used_memory_fragment_ids TEXT,
        retrieval_mode TEXT,
        estimated_tokens INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (session_id) REFERENCES t_consult_session(id),
        FOREIGN KEY (suggestion_trace_id) REFERENCES t_ai_suggestion_trace(id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ctx_trace_session ON t_context_trace(session_id)`);

    // === Intervention feedback: did teacher accept/edit/ignore the suggestion? ===
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_intervention_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        suggestion_trace_id INTEGER,
        trigger_message_id INTEGER,
        suggestion_content TEXT,
        teacher_action TEXT NOT NULL,
        edited_content TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (session_id) REFERENCES t_consult_session(id),
        FOREIGN KEY (suggestion_trace_id) REFERENCES t_ai_suggestion_trace(id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_session ON t_intervention_feedback(session_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_action ON t_intervention_feedback(teacher_action)`);
  }
};
