/**
 * Runtime statistics for Guardian fast path and direct continuation.
 *
 * The trace table records both DB columns and legacy perf JSON. This helper
 * normalizes both so the teacher panel and dashboard report the same numbers.
 */

const { getDb } = require('../../models/db');

function pct(count, total) {
  return total > 0 ? count / total : 0;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function inc(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function summarizeRows(rows) {
  const summary = {
    total: rows.length,
    guardianCandidate: { count: 0, rate: 0 },
    guardianFastPath: { count: 0, rate: 0, avgSavedMs: 0 },
    directContinuation: { count: 0, rate: 0 },
    generatorSkipped: { count: 0, rate: 0 },
    coordinatorSkipped: { count: 0, rate: 0 },
    missingExpectedTopic: 0,
    rejectReasons: {},
    sourceBreakdown: {},
    latest: [],
  };

  let savedTotal = 0;
  let savedCount = 0;

  for (const row of rows) {
    const usage = parseJson(row.usage_json);
    const perf = usage.perf || {};
    const generatorModel = row.generator_model || '';

    const directContinuation = row.continuation_direct === 1
      || perf.continuation_direct === true
      || generatorModel === 'direct-continuation';
    const guardianFastPath = generatorModel === 'guardian-prepared'
      || perf.guardian_fast_path === true
      || (perf.generator_skipped === true && perf.stop_reason === 'topic_guarded_hit');
    const guardianCandidate = row.guardian_candidate === 1 || perf.guardian_candidate === true;
    const generatorSkipped = directContinuation || guardianFastPath || perf.generator_skipped === true;
    const coordinatorSkipped = row.coordinator_skipped === 1 || perf.coordinator_skipped === true;
    const rejectedReason = row.rejected_reason || perf.rejected_reason || null;
    const source = row.candidate_source || perf.candidate_source || generatorModel || null;
    const savedMs = Number(row.fast_path_saved_ms ?? perf.fast_path_saved_ms ?? 0);

    if (guardianCandidate) summary.guardianCandidate.count += 1;
    if (guardianFastPath) {
      summary.guardianFastPath.count += 1;
      if (savedMs > 0) {
        savedTotal += savedMs;
        savedCount += 1;
      }
    }
    if (directContinuation) summary.directContinuation.count += 1;
    if (generatorSkipped) summary.generatorSkipped.count += 1;
    if (coordinatorSkipped) summary.coordinatorSkipped.count += 1;
    if (rejectedReason === 'missing_expected_topic') summary.missingExpectedTopic += 1;
    inc(summary.rejectReasons, rejectedReason);
    inc(summary.sourceBreakdown, source);

    summary.latest.push({
      id: row.id,
      sessionId: row.session_id,
      at: row.created_at,
      generatorModel,
      guardianCandidate,
      guardianFastPath,
      directContinuation,
      rejectedReason,
      source,
      savedMs,
    });
  }

  summary.guardianCandidate.rate = pct(summary.guardianCandidate.count, summary.total);
  summary.guardianFastPath.rate = pct(summary.guardianFastPath.count, summary.total);
  summary.guardianFastPath.avgSavedMs = savedCount > 0 ? Math.round(savedTotal / savedCount) : 0;
  summary.directContinuation.rate = pct(summary.directContinuation.count, summary.total);
  summary.generatorSkipped.rate = pct(summary.generatorSkipped.count, summary.total);
  summary.coordinatorSkipped.rate = pct(summary.coordinatorSkipped.count, summary.total);
  summary.latest = summary.latest.slice(-10).reverse();

  return summary;
}

function fetchTraceRows({ sessionId = null, teacherId = null, limit = 80 } = {}) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 80, 300));
  const where = [];
  const params = [];
  let join = '';

  if (teacherId) {
    join = 'JOIN t_consult_session cs ON cs.id = t.session_id';
    where.push('cs.teacher_id = ?');
    params.push(teacherId);
  }
  if (sessionId) {
    where.push('t.session_id = ?');
    params.push(sessionId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT t.id, t.session_id, t.student_id, t.created_at,
           t.generator_model, t.usage_json,
           t.guardian_candidate, t.candidate_source,
           t.verifier_decision, t.rejected_reason,
           t.fast_path_saved_ms, t.coordinator_skipped,
           t.continuation_direct, t.continuation_reason
    FROM t_ai_suggestion_trace t
    ${join}
    ${whereSql}
    ORDER BY t.id DESC
    LIMIT ?
  `).all(...params, safeLimit).reverse();
}

function getRuntimeStats(options = {}) {
  return summarizeRows(fetchTraceRows(options));
}

function getSessionRuntimeStats(sessionId, limit = 80) {
  if (!sessionId) return summarizeRows([]);
  return getRuntimeStats({ sessionId, limit });
}

module.exports = {
  getRuntimeStats,
  getSessionRuntimeStats,
  summarizeRows,
};
