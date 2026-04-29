/**
 * Migration 006: Memory dedup + tags + tier fields
 *
 * v1.007: Fix the 80% duplication problem + enable topic-aware retrieval
 */
module.exports = {
  name: 'memory_dedup_and_tags',
  up(db) {
    // content_hash for fast exact dedup
    try { db.exec('ALTER TABLE t_memory_fragment ADD COLUMN content_hash TEXT'); } catch (e) {}
    // tags_json for keyword-based retrieval (replaces broken FTS5)
    try { db.exec('ALTER TABLE t_memory_fragment ADD COLUMN tags_json TEXT'); } catch (e) {}
    // memory_tier for 3-layer architecture
    try { db.exec("ALTER TABLE t_memory_fragment ADD COLUMN memory_tier TEXT DEFAULT 'session'"); } catch (e) {}
    // recall_count for tracking usage frequency
    try { db.exec('ALTER TABLE t_memory_fragment ADD COLUMN recall_count INTEGER DEFAULT 0'); } catch (e) {}

    // Index for dedup lookups
    db.exec('CREATE INDEX IF NOT EXISTS idx_fragment_hash ON t_memory_fragment(student_id, content_hash, fragment_type)');
    // Index for tag-based retrieval
    db.exec('CREATE INDEX IF NOT EXISTS idx_fragment_tier ON t_memory_fragment(student_id, memory_tier)');

    // Backfill content_hash for existing fragments
    const crypto = require('crypto');
    const rows = db.prepare('SELECT id, text FROM t_memory_fragment WHERE content_hash IS NULL').all();
    const updateStmt = db.prepare('UPDATE t_memory_fragment SET content_hash = ? WHERE id = ?');
    for (const row of rows) {
      const hash = crypto.createHash('sha256').update(row.text).digest('hex').substring(0, 16);
      updateStmt.run(hash, row.id);
    }
    console.log(`[Migration 006] Backfilled content_hash for ${rows.length} fragments`);
  }
};
