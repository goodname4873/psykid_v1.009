/**
 * Dream Service - v1.007
 *
 * Offline memory consolidation, inspired by Kairos/autoDream.
 * Cleans up and improves memory quality during idle periods.
 *
 * Triggered by:
 *   - session.js: session end → dreamAfterSession(sessionId, studentId)
 *   - silence-monitor.js: idle > 5min → dreamOnIdle(studentId)
 *
 * NOT triggered by speculative-engine (they are independent).
 *
 * Four operations:
 *   1. Fragment dedup: merge near-duplicate fragments (FTS similarity)
 *   2. Fragment decay: lower recency_score of old fragments
 *   3. Profile consistency: detect contradictions in student profile
 *   4. Pattern solidify: convert high-hit speculative results into t_speculative_pattern
 */

const { getDb } = require('../models/db');

/**
 * Run dream after a session ends.
 * Called async from session.js, non-blocking.
 */
async function dreamAfterSession(sessionId, studentId) {
  const startMs = Date.now();
  console.log(`[Dream] Starting post-session consolidation for student ${studentId}`);

  try {
    const dedupCount = deduplicateFragments(studentId);
    const decayCount = decayOldFragments(studentId);
    const contradictions = checkProfileConsistency(studentId);
    const patternCount = solidifyPatterns(studentId);

    const elapsed = Date.now() - startMs;
    console.log(`[Dream] Done in ${elapsed}ms: dedup=${dedupCount}, decay=${decayCount}, contradictions=${contradictions.length}, patterns=${patternCount}`);
  } catch (err) {
    console.error(`[Dream] Error for student ${studentId}:`, err.message);
  }
}

/**
 * Run dream during idle period.
 * Lighter version — skip pattern solidify (needs enough data).
 */
async function dreamOnIdle(studentId) {
  try {
    deduplicateFragments(studentId);
    decayOldFragments(studentId);
  } catch (err) {
    console.error(`[Dream] Idle consolidation error:`, err.message);
  }
}

// ==================== Operation 1: Fragment Dedup ====================

/**
 * Find and merge near-duplicate fragments for a student.
 * Uses exact text match first (cheapest), then short-text containment.
 */
function deduplicateFragments(studentId) {
  const db = getDb();
  let removedCount = 0;

  try {
    // Step 1: Exact duplicate removal (same text, same type)
    const dupes = db.prepare(`
      SELECT text, fragment_type, COUNT(*) as cnt, MIN(id) as keep_id
      FROM t_memory_fragment
      WHERE student_id = ?
      GROUP BY text, fragment_type
      HAVING cnt > 1
    `).all(studentId);

    for (const dupe of dupes) {
      const result = db.prepare(`
        DELETE FROM t_memory_fragment
        WHERE student_id = ? AND text = ? AND fragment_type = ? AND id != ?
      `).run(studentId, dupe.text, dupe.fragment_type, dupe.keep_id);
      removedCount += result.changes;
    }

    // Step 2: Jaccard similarity dedup (>= 0.85 → remove the newer one)
    const allFragments = db.prepare(`
      SELECT id, text, fragment_type, importance FROM t_memory_fragment
      WHERE student_id = ? AND fragment_type IN ('profile_fact', 'thread_event', 'student_quote')
      ORDER BY id ASC
    `).all(studentId);

    const toDelete = new Set();
    for (let i = 0; i < allFragments.length; i++) {
      if (toDelete.has(allFragments[i].id)) continue;
      for (let j = i + 1; j < allFragments.length; j++) {
        if (toDelete.has(allFragments[j].id)) continue;
        if (allFragments[j].fragment_type !== allFragments[i].fragment_type) continue;

        if (jaccardSim(allFragments[i].text, allFragments[j].text) >= 0.85) {
          toDelete.add(allFragments[j].id); // Remove the newer duplicate
        }
      }
    }

    if (toDelete.size > 0) {
      const ids = [...toDelete];
      db.prepare(`DELETE FROM t_memory_fragment WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
      removedCount += ids.length;
    }

    // Step 3: Promote high-recall fragments to long_term
    db.prepare(`
      UPDATE t_memory_fragment SET memory_tier = 'long_term'
      WHERE student_id = ? AND memory_tier = 'session' AND recall_count >= 3
    `).run(studentId);

    // Step 4: Demote old unused fragments
    db.prepare(`
      DELETE FROM t_memory_fragment
      WHERE student_id = ? AND memory_tier = 'session'
      AND recall_count = 0 AND created_at < datetime('now', '-90 days')
    `).run(studentId);
  } catch (e) {
    console.log('[Dream] Dedup error:', e.message);
  }

  return removedCount;
}

// ==================== Operation 2: Fragment Decay ====================

/**
 * Lower recency_score of old fragments.
 * Fragments older than 7 days get decayed, older than 30 days get heavily decayed.
 */
function decayOldFragments(studentId) {
  const db = getDb();
  let updated = 0;

  try {
    // Mild decay: 7-30 days old → recency_score *= 0.8
    const mildResult = db.prepare(`
      UPDATE t_memory_fragment
      SET recency_score = recency_score * 0.8,
          updated_at = datetime('now', 'localtime')
      WHERE student_id = ?
      AND created_at < datetime('now', '-7 days')
      AND created_at >= datetime('now', '-30 days')
      AND recency_score > 0.1
    `).run(studentId);
    updated += mildResult.changes;

    // Heavy decay: >30 days old → recency_score *= 0.5
    const heavyResult = db.prepare(`
      UPDATE t_memory_fragment
      SET recency_score = recency_score * 0.5,
          updated_at = datetime('now', 'localtime')
      WHERE student_id = ?
      AND created_at < datetime('now', '-30 days')
      AND recency_score > 0.05
    `).run(studentId);
    updated += heavyResult.changes;
  } catch (e) {
    console.log('[Dream] Decay error:', e.message);
  }

  return updated;
}

// ==================== Operation 3: Profile Consistency ====================

/**
 * Check if a student's profile has contradictory fields.
 * Returns list of contradiction descriptions (for logging, not auto-fix).
 */
function checkProfileConsistency(studentId) {
  const db = getDb();
  const contradictions = [];

  try {
    const profile = db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId);
    if (!profile) return contradictions;

    // Check: effective_strategies vs sensitive_topics overlap
    const strategies = safeParseJSON(profile.effective_strategies, []);
    const sensitive = safeParseJSON(profile.sensitive_topics, []);
    for (const s of strategies) {
      for (const t of sensitive) {
        if (s.includes(t) || t.includes(s)) {
          contradictions.push(`"${s}" is both an effective strategy and a sensitive topic`);
        }
      }
    }

    // Check: primary_concerns has duplicates
    const concerns = safeParseJSON(profile.primary_concerns, []);
    const uniqueConcerns = [...new Set(concerns)];
    if (uniqueConcerns.length < concerns.length) {
      // Auto-fix: remove duplicates
      db.prepare('UPDATE t_student_profile SET primary_concerns = ? WHERE student_id = ?')
        .run(JSON.stringify(uniqueConcerns), studentId);
      contradictions.push(`Removed ${concerns.length - uniqueConcerns.length} duplicate concerns`);
    }

    // Check: effective_strategies has duplicates
    const uniqueStrategies = [...new Set(strategies)];
    if (uniqueStrategies.length < strategies.length) {
      db.prepare('UPDATE t_student_profile SET effective_strategies = ? WHERE student_id = ?')
        .run(JSON.stringify(uniqueStrategies), studentId);
      contradictions.push(`Removed ${strategies.length - uniqueStrategies.length} duplicate strategies`);
    }

    // Check: sensitive_topics has duplicates
    const uniqueSensitive = [...new Set(sensitive)];
    if (uniqueSensitive.length < sensitive.length) {
      db.prepare('UPDATE t_student_profile SET sensitive_topics = ? WHERE student_id = ?')
        .run(JSON.stringify(uniqueSensitive), studentId);
      contradictions.push(`Removed ${sensitive.length - uniqueSensitive.length} duplicate sensitive topics`);
    }
  } catch (e) {
    console.log('[Dream] Profile consistency error:', e.message);
  }

  if (contradictions.length > 0) {
    console.log(`[Dream] Profile contradictions for student ${studentId}:`, contradictions);
  }

  return contradictions;
}

// ==================== Operation 4: Pattern Solidify ====================

/**
 * Convert repeated speculative cache hits into persistent patterns.
 * Reads from t_ai_suggestion_trace to find recurring emotion/topic patterns.
 */
function solidifyPatterns(studentId) {
  const db = getDb();
  let patternCount = 0;

  try {
    // Check if t_speculative_pattern exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='t_speculative_pattern'"
    ).get();
    if (!tableExists) return 0;

    // Find recurring emotion patterns from recent traces
    const recentTraces = db.prepare(`
      SELECT analysis_json FROM t_ai_suggestion_trace
      WHERE student_id = ? AND created_at > datetime('now', '-30 days')
      ORDER BY created_at DESC LIMIT 20
    `).all(studentId);

    if (recentTraces.length < 3) return 0;

    // Count emotion frequencies
    const emotionCounts = {};
    for (const trace of recentTraces) {
      try {
        const analysis = JSON.parse(trace.analysis_json || '{}');
        const emotion = analysis.emotion?.primary;
        if (emotion && emotion !== '未知') {
          emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
        }
      } catch (e) { /* skip */ }
    }

    // If an emotion appears in >60% of traces, create a pattern
    for (const [emotion, count] of Object.entries(emotionCounts)) {
      const frequency = count / recentTraces.length;
      if (frequency < 0.6) continue;

      // Check if pattern already exists
      const existing = db.prepare(
        "SELECT id FROM t_speculative_pattern WHERE student_id = ? AND trigger_type = 'session_start' AND predicted_emotion = ?"
      ).get(studentId, emotion);

      if (existing) {
        // Update confidence
        db.prepare(
          'UPDATE t_speculative_pattern SET confidence = ?, hit_count = hit_count + 1, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
        ).run(frequency, existing.id);
      } else {
        // Create new pattern
        db.prepare(`
          INSERT INTO t_speculative_pattern (
            student_id, trigger_type, trigger_context, predicted_weights, predicted_emotion, confidence
          ) VALUES (?, 'session_start', ?, ?, ?, ?)
        `).run(
          studentId,
          `学生近期情绪以${emotion}为主(${Math.round(frequency * 100)}%)`,
          JSON.stringify({ empathy: 0.7, cognitive: 0.2, action: 0.1, closing: 0 }),
          emotion,
          frequency,
        );
        patternCount++;
      }
    }
  } catch (e) {
    console.log('[Dream] Pattern solidify error:', e.message);
  }

  return patternCount;
}

// ==================== Helpers ====================

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function jaccardSim(a, b) {
  if (!a || !b) return 0;
  const setA = new Set();
  const setB = new Set();
  for (let i = 0; i < a.length - 1; i++) setA.add(a.substring(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) setB.add(b.substring(i, i + 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  return inter / (setA.size + setB.size - inter);
}

module.exports = {
  dreamAfterSession,
  dreamOnIdle,
};
