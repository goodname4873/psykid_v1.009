/**
 * Migration 003: Memory fragments for retrieval-based context
 *
 * v1.006: Replaces full-injection context with per-fragment retrieval.
 * All memory sources (rolling, final, thread, profile, risk) get
 * decomposed into searchable fragments in t_memory_fragment.
 */
module.exports = {
  name: 'memory_fragments',
  up(db) {
    // === Memory fragment table ===
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_memory_fragment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        session_id INTEGER,
        fragment_type TEXT NOT NULL,
        text TEXT NOT NULL,
        tags TEXT,
        importance REAL DEFAULT 0,
        recency_score REAL DEFAULT 0,
        source_table TEXT,
        source_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (student_id) REFERENCES t_student(id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fragment_student ON t_memory_fragment(student_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fragment_session ON t_memory_fragment(session_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fragment_type ON t_memory_fragment(fragment_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fragment_importance ON t_memory_fragment(importance)`);

    // === FTS5 virtual table for full-text search ===
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS t_memory_fragment_fts USING fts5(
        text,
        tags,
        content='t_memory_fragment',
        content_rowid='id'
      )
    `);

    // === Triggers to keep FTS in sync ===
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS t_memory_fragment_ai AFTER INSERT ON t_memory_fragment BEGIN
        INSERT INTO t_memory_fragment_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS t_memory_fragment_ad AFTER DELETE ON t_memory_fragment BEGIN
        INSERT INTO t_memory_fragment_fts(t_memory_fragment_fts, rowid, text, tags) VALUES ('delete', old.id, old.text, old.tags);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS t_memory_fragment_au AFTER UPDATE ON t_memory_fragment BEGIN
        INSERT INTO t_memory_fragment_fts(t_memory_fragment_fts, rowid, text, tags) VALUES ('delete', old.id, old.text, old.tags);
        INSERT INTO t_memory_fragment_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
      END
    `);
  }
};
