/**
 * Migration 007: Teacher learning governance.
 *
 * Adds enough metadata to keep teacher feedback as auditable evidence first,
 * and only expose published strategies to global/voice retrieval.
 */
module.exports = {
  name: 'teacher_learning_governance',
  up(db) {
    try { db.exec('ALTER TABLE t_intervention_feedback ADD COLUMN teacher_id INTEGER'); } catch (e) {}
    try { db.exec("ALTER TABLE t_intervention_feedback ADD COLUMN learning_status TEXT DEFAULT 'pending'"); } catch (e) {}
    try { db.exec('ALTER TABLE t_intervention_feedback ADD COLUMN learning_fragment_id INTEGER'); } catch (e) {}

    try { db.exec("ALTER TABLE t_memory_fragment ADD COLUMN scope TEXT DEFAULT 'student'"); } catch (e) {}
    try { db.exec("ALTER TABLE t_memory_fragment ADD COLUMN status TEXT DEFAULT 'active'"); } catch (e) {}
    try { db.exec('ALTER TABLE t_memory_fragment ADD COLUMN teacher_id INTEGER'); } catch (e) {}
    try { db.exec('ALTER TABLE t_memory_fragment ADD COLUMN learning_category TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE t_memory_fragment ADD COLUMN style_contamination_risk TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE t_memory_fragment ADD COLUMN expert_confidence REAL'); } catch (e) {}

    db.exec('CREATE INDEX IF NOT EXISTS idx_fragment_scope_status ON t_memory_fragment(student_id, scope, status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_fragment_teacher ON t_memory_fragment(teacher_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_teacher ON t_intervention_feedback(teacher_id)');
  },
};
