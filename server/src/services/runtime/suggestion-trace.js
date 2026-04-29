/**
 * Suggestion Trace - v1.006
 *
 * Records every AI suggestion turn for debugging, A/B comparison, and feedback analysis.
 *
 * Three trace types:
 *   1. Suggestion trace: full execution record (models, prompts, analysis, output)
 *   2. Context trace: which memory fragments were used
 *   3. Intervention feedback: teacher accepted / edited / ignored
 */

const { getDb } = require('../../models/db');
const crypto = require('crypto');

/**
 * Write a suggestion trace after a suggestion turn completes.
 *
 * @param {Object} payload
 * @returns {number|null} The trace ID (for linking context trace and feedback)
 */
function writeSuggestionTrace({
  sessionId,
  studentId,
  triggerMessageId,
  coordinatorModel,
  generatorModel,
  assembledContextJson,
  analysis,
  suggestions,
  usage,
  openLoop,
}) {
  try {
    const db = getDb();

    // Digest: first 8 chars of SHA-256 of context (for quick comparison)
    const contextStr = typeof assembledContextJson === 'string'
      ? assembledContextJson
      : JSON.stringify(assembledContextJson || '');
    const promptDigest = crypto.createHash('sha256').update(contextStr).digest('hex').substring(0, 8);
    const perf = usage?.perf || {};
    const openLoopJson = openLoop
      ? JSON.stringify(openLoop)
      : (analysis?.openLoop ? JSON.stringify(analysis.openLoop) : null);

    const result = db.prepare(`
      INSERT INTO t_ai_suggestion_trace (
        session_id, student_id, trigger_message_id,
        coordinator_model, generator_model,
        assembled_context_json, prompt_digest,
        analysis_json, suggestions_json, usage_json,
        guardian_candidate, candidate_source, verifier_decision, rejected_reason,
        draft_age_ms, verifier_ms, pipeline_ms, fast_path_saved_ms,
        coordinator_skipped,
        continuation_direct, continuation_reason, continuation_candidate_count,
        continuation_label_max_len,
        open_loop_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      studentId,
      triggerMessageId || null,
      coordinatorModel || null,
      generatorModel || null,
      contextStr.length > 10000 ? contextStr.substring(0, 10000) + '...[truncated]' : contextStr,
      promptDigest,
      JSON.stringify(analysis || {}),
      JSON.stringify(suggestions || []),
      JSON.stringify(usage || {}),
      perf.guardian_candidate ? 1 : 0,
      perf.candidate_source || null,
      perf.verifier_decision || null,
      perf.rejected_reason || null,
      perf.draft_age_ms ?? null,
      perf.verifier_ms ?? null,
      perf.pipeline_ms ?? null,
      perf.fast_path_saved_ms ?? null,
      perf.coordinator_skipped ? 1 : 0,
      perf.continuation_direct ? 1 : 0,
      perf.continuation_reason || null,
      perf.continuation_candidate_count ?? null,
      perf.continuation_label_max_len ?? null,
      openLoopJson,
    );

    return result.lastInsertRowid;
  } catch (e) {
    console.log('[Trace] Suggestion trace write failed:', e.message);
    return null;
  }
}

/**
 * Write a context trace linked to a suggestion trace.
 *
 * @param {Object} payload
 * @returns {number|null}
 */
function writeContextTrace({
  sessionId,
  studentId,
  suggestionTraceId,
  recentMessageIds,
  usedRollingIds,
  usedFinalIds,
  usedThreadFields,
  usedProfileFields,
  usedMemoryFragmentIds,
  retrievalMode,
  estimatedTokens,
}) {
  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO t_context_trace (
        session_id, student_id, suggestion_trace_id,
        recent_message_ids, used_rolling_ids, used_final_ids,
        used_thread_fields, used_profile_fields, used_memory_fragment_ids,
        retrieval_mode, estimated_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      studentId,
      suggestionTraceId || null,
      JSON.stringify(recentMessageIds || []),
      JSON.stringify(usedRollingIds || []),
      JSON.stringify(usedFinalIds || []),
      JSON.stringify(usedThreadFields || []),
      JSON.stringify(usedProfileFields || []),
      JSON.stringify(usedMemoryFragmentIds || []),
      retrievalMode || 'legacy',
      estimatedTokens || 0,
    );
    return result.lastInsertRowid;
  } catch (e) {
    console.log('[Trace] Context trace write failed:', e.message);
    return null;
  }
}

/**
 * Record teacher's action on an AI suggestion.
 *
 * @param {Object} payload
 * @param {string} payload.teacherAction - 'accepted' | 'edited' | 'ignored'
 */
function writeInterventionFeedback({
  sessionId,
  studentId,
  suggestionTraceId,
  triggerMessageId,
  suggestionContent,
  teacherAction,
  editedContent,
  teacherId,
}) {
  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO t_intervention_feedback (
        session_id, student_id, suggestion_trace_id,
        trigger_message_id, suggestion_content,
        teacher_action, edited_content, teacher_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      studentId,
      suggestionTraceId || null,
      triggerMessageId || null,
      suggestionContent || null,
      teacherAction,
      editedContent || null,
      teacherId || null,
    );
    const feedbackId = result.lastInsertRowid;
    try {
      const teacherLearning = require('../learning/teacher-learning');
      teacherLearning.enqueueFromFeedback(feedbackId);
    } catch (e) {
      console.log('[Trace] TeacherLearning enqueue failed:', e.message);
    }
    return feedbackId;
  } catch (e) {
    console.log('[Trace] Intervention feedback write failed:', e.message);
    return null;
  }
}

module.exports = {
  writeSuggestionTrace,
  writeContextTrace,
  writeInterventionFeedback,
};
