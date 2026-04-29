/**
 * Memory Fragment Writer - v1.006
 *
 * Decomposes summary/thread/profile/risk objects into searchable fragments
 * in t_memory_fragment. Called after each memory write (rolling, final, thread, profile).
 *
 * Fragment types:
 *   rolling_summary, final_summary, thread_event, student_quote,
 *   profile_fact, risk_fact, teacher_note
 *
 * Does NOT: do retrieval (that's memory-retrieval.js)
 */

const { getDb } = require('../models/db');

/**
 * Write fragments from a rolling summary.
 */
function writeRollingFragments(studentId, sessionId, summaryId, rawSummary) {
  if (!rawSummary) return;
  insertFragment({
    student_id: studentId,
    session_id: sessionId,
    fragment_type: 'rolling_summary',
    text: rawSummary,
    importance: 0.4,
    source_table: 't_session_summary',
    source_id: summaryId,
  });
}

/**
 * Write fragments from a final summary.
 * Splits structured fields into individual fragments for better retrieval.
 */
function writeFinalFragments(studentId, sessionId, summaryId, summaryRow) {
  if (!summaryRow) return;

  // The raw summary as one fragment
  if (summaryRow.raw_summary) {
    insertFragment({
      student_id: studentId,
      session_id: sessionId,
      fragment_type: 'final_summary',
      text: summaryRow.raw_summary,
      importance: 0.7,
      source_table: 't_session_summary',
      source_id: summaryId,
    });
  }

  // Topics as individual fragments
  const topics = safeParseJSON(summaryRow.topics_discussed, []);
  for (const topic of topics) {
    insertFragment({
      student_id: studentId,
      session_id: sessionId,
      fragment_type: 'final_summary',
      text: topic,
      tags: '话题',
      importance: 0.6,
      source_table: 't_session_summary',
      source_id: summaryId,
    });
  }

  // Unresolved items
  const unresolved = safeParseJSON(summaryRow.unresolved_items, []);
  for (const item of unresolved) {
    insertFragment({
      student_id: studentId,
      session_id: sessionId,
      fragment_type: 'final_summary',
      text: item,
      tags: '未解决',
      importance: 0.8,
      source_table: 't_session_summary',
      source_id: summaryId,
    });
  }
}

/**
 * Write fragments from session thread extraction.
 */
function writeThreadFragments(studentId, sessionId, threadRow) {
  if (!threadRow) return;

  const events = safeParseJSON(threadRow.key_events, []);
  for (const event of events) {
    insertFragment({
      student_id: studentId,
      session_id: sessionId,
      fragment_type: 'thread_event',
      text: event,
      tags: '关键事件',
      importance: 0.7,
      source_table: 't_session_thread',
      source_id: threadRow.id,
    });
  }

  const quotes = safeParseJSON(threadRow.student_quotes, []);
  for (const quote of quotes) {
    insertFragment({
      student_id: studentId,
      session_id: sessionId,
      fragment_type: 'student_quote',
      text: quote,
      tags: '学生原话',
      importance: 0.9,
      source_table: 't_session_thread',
      source_id: threadRow.id,
    });
  }

  const strategies = safeParseJSON(threadRow.strategies_tried, []);
  for (const s of strategies) {
    const text = typeof s === 'object' ? `${s.method}(${s.result})` : s;
    insertFragment({
      student_id: studentId,
      session_id: sessionId,
      fragment_type: 'thread_event',
      text,
      tags: '策略效果',
      importance: 0.6,
      source_table: 't_session_thread',
      source_id: threadRow.id,
    });
  }
}

/**
 * Write fragments from student profile fields.
 * Called after profile update — replaces old profile fragments for this student.
 */
function writeProfileFragments(studentId, profileRow) {
  if (!profileRow) return;
  const db = getDb();

  // Delete old profile fragments (they get regenerated)
  try {
    db.prepare(
      "DELETE FROM t_memory_fragment WHERE student_id = ? AND fragment_type = 'profile_fact'"
    ).run(studentId);
  } catch (e) { /* table may not exist */ return; }

  const fields = [
    { key: 'primary_concerns', tag: '核心议题', importance: 0.8 },
    { key: 'effective_strategies', tag: '有效方法', importance: 0.7 },
    { key: 'sensitive_topics', tag: '注意回避', importance: 0.9 },
    { key: 'communication_style', tag: '沟通风格', importance: 0.5 },
    { key: 'emotional_pattern', tag: '情绪基线', importance: 0.6 },
    { key: 'coping_style', tag: '应对方式', importance: 0.5 },
  ];

  for (const { key, tag, importance } of fields) {
    if (!profileRow[key]) continue;
    const items = tryParseArray(profileRow[key]);
    if (items) {
      for (const item of items) {
        insertFragment({
          student_id: studentId,
          fragment_type: 'profile_fact',
          text: `${tag}: ${item}`,
          tags: tag,
          importance,
          source_table: 't_student_profile',
          source_id: profileRow.id,
        });
      }
    } else {
      insertFragment({
        student_id: studentId,
        fragment_type: 'profile_fact',
        text: `${tag}: ${profileRow[key]}`,
        tags: tag,
        importance,
        source_table: 't_student_profile',
        source_id: profileRow.id,
      });
    }
  }

  // Risk notes
  if (profileRow.risk_notes) {
    insertFragment({
      student_id: studentId,
      fragment_type: 'risk_fact',
      text: profileRow.risk_notes,
      tags: '风险记录',
      importance: 1.0,
      source_table: 't_student_profile',
      source_id: profileRow.id,
    });
  }
}

// ==================== Helpers ====================

function insertFragment({ student_id, session_id, fragment_type, text, tags, importance, source_table, source_id }) {
  if (!text || text.trim().length < 2) return; // Skip empty/trivial

  try {
    const db = getDb();
    const crypto = require('crypto');
    const contentHash = crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);

    // === Dedup 1: Exact hash match → skip ===
    const existingExact = db.prepare(
      'SELECT id FROM t_memory_fragment WHERE student_id = ? AND content_hash = ? AND fragment_type = ?'
    ).get(student_id, contentHash, fragment_type);
    if (existingExact) return; // Already exists

    // === Dedup 2: Jaccard similarity >= 0.85 → skip ===
    const candidates = db.prepare(
      'SELECT id, text FROM t_memory_fragment WHERE student_id = ? AND fragment_type = ? ORDER BY id DESC LIMIT 20'
    ).all(student_id, fragment_type);

    for (const c of candidates) {
      if (jaccardSimilarity(text, c.text) >= 0.85) return; // Too similar
    }

    // === Dedup passed → insert with hash ===
    // Extract tags for keyword-based retrieval (simple: 2-char grams from text)
    const autoTags = extractTagsLocal(text);
    const tagsJson = JSON.stringify([...(tags ? [tags] : []), ...autoTags].slice(0, 10));

    // Determine memory tier
    // profile_fact / risk_fact → long_term (curated, durable)
    // final_summary → session (persists across sessions but decays)
    // rolling_summary / thread_event / student_quote → session
    const tier = (fragment_type === 'profile_fact' || fragment_type === 'risk_fact') ? 'long_term' : 'session';

    db.prepare(`
      INSERT INTO t_memory_fragment (student_id, session_id, fragment_type, text, tags, tags_json, importance, content_hash, memory_tier, source_table, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      student_id, session_id || null, fragment_type, text,
      tags || null, tagsJson, importance || 0, contentHash, tier, source_table || null, source_id || null
    );
  } catch (e) {
    console.log('[Fragment] Write failed:', e.message);
  }
}

/**
 * Jaccard similarity between two Chinese text strings.
 * Uses 2-char bigrams as tokens.
 */
function jaccardSimilarity(a, b) {
  if (!a || !b) return 0;
  const bigramsA = new Set();
  const bigramsB = new Set();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.substring(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.substring(i, i + 2));
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const bg of bigramsA) { if (bigramsB.has(bg)) intersection++; }
  return intersection / (bigramsA.size + bigramsB.size - intersection);
}

/**
 * Extract keyword tags from Chinese text (local, no LLM).
 * Returns array of 2-3 char keywords.
 */
function extractTagsLocal(text) {
  if (!text) return [];
  const stopWords = new Set(['我的', '你的', '他的', '什么', '怎么', '这个', '那个', '可以', '不是', '因为', '所以', '但是', '还有', '没有', '已经', '就是', '一个', '现在', '觉得', '感觉', '还是', '知道', '应该', '不会', '这样', '那样', '他们', '自己']);
  const tags = new Set();
  // Remove punctuation
  const clean = text.replace(/[，。！？、；：""''（）\s\n.!?,;:]+/g, '');
  // 2-char sliding window
  for (let i = 0; i < clean.length - 1; i++) {
    const kw = clean.substring(i, i + 2);
    if (!stopWords.has(kw)) tags.add(kw);
  }
  // Also 3-char for better precision
  for (let i = 0; i < clean.length - 2; i++) {
    const kw = clean.substring(i, i + 3);
    if (!stopWords.has(kw) && kw.length === 3) tags.add(kw);
  }
  return [...tags].slice(0, 15);
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function tryParseArray(val) {
  if (Array.isArray(val)) return val.length ? val : null;
  if (typeof val !== 'string') return null;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = {
  writeRollingFragments,
  writeFinalFragments,
  writeThreadFragments,
  writeProfileFragments,
};
