/**
 * Migration 009: v1.009 Direct Continuation trace fields.
 *
 * Keeps the "秒接" path queryable without confusing it with Guardian fast path.
 */
module.exports = {
  name: 'v1009_continuation_trace',
  up(db) {
    const add = (sql) => { try { db.exec(sql); } catch (e) {} };

    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN continuation_direct INTEGER DEFAULT 0');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN continuation_reason TEXT');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN continuation_candidate_count INTEGER');
    add('ALTER TABLE t_ai_suggestion_trace ADD COLUMN continuation_label_max_len INTEGER');
  },
};
