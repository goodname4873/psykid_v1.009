/**
 * Memory Retrieval - v1.007 (complete rewrite)
 *
 * Retrieval strategy: tag-match > recency > tier > importance
 *
 * 1. Extract keywords from student's latest message
 * 2. Tag-match search in fragments (replaces broken FTS5)
 * 3. Score each fragment: relevance(0.30) + recency(0.20) + frequency(0.15) + importance(0.15) + tier(0.20)
 * 4. MMR diversity filter (no near-duplicate results)
 * 5. Always include: profile facts + current session context
 */

const { getDb } = require('../../models/db');

/**
 * Retrieve relevant memory for a suggestion turn.
 */
function retrieveRelevantMemory({ studentId, sessionId, latestMessage, limit = 12 }) {
  const db = getDb();

  try {
    const collected = [];

    // === Must-include: Profile + risk facts (max 4) ===
    const profileFrags = db.prepare(`
      SELECT * FROM t_memory_fragment
      WHERE student_id = ? AND fragment_type IN ('profile_fact', 'risk_fact')
      AND (status IS NULL OR status IN ('active', 'published'))
      ORDER BY importance DESC LIMIT 4
    `).all(studentId);
    collected.push(...profileFrags.map(f => ({ ...f, _source: 'profile' })));

    // === Must-include: Current session rolling summary ===
    const rollingSummary = db.prepare(`
      SELECT * FROM t_memory_fragment
      WHERE student_id = ? AND session_id = ? AND fragment_type = 'rolling_summary'
      AND (status IS NULL OR status IN ('active', 'published'))
      ORDER BY id DESC LIMIT 2
    `).all(studentId, sessionId);
    collected.push(...rollingSummary.map(f => ({ ...f, _source: 'session' })));

    // === Tag-match search (core retrieval) ===
    const queryTags = extractKeywords(latestMessage);
    const remaining = limit - collected.length;

    if (queryTags.length > 0 && remaining > 0) {
      // Search by tags_json field (keyword overlap)
      const tagConditions = queryTags.slice(0, 6).map(() => `(tags_json LIKE ? OR text LIKE ?)`).join(' OR ');
      const tagParams = queryTags.slice(0, 6).flatMap(t => [`%${t}%`, `%${t}%`]);

      const tagMatched = db.prepare(`
        SELECT * FROM t_memory_fragment
        WHERE student_id = ? AND (${tagConditions})
        AND (status IS NULL OR status IN ('active', 'published'))
        AND (style_contamination_risk IS NULL OR style_contamination_risk != 'high')
        ORDER BY importance DESC, id DESC
        LIMIT ?
      `).all(studentId, ...tagParams, remaining + 20); // Fetch extra for scoring

      // Score each result
      const scored = tagMatched.map(f => {
        const fTags = safeParseJSON(f.tags_json, []);
        const tagOverlap = queryTags.filter(t => fTags.some(ft => ft.includes(t) || t.includes(ft)) || f.text.includes(t)).length / Math.max(queryTags.length, 1);
        const recencyDays = (Date.now() - new Date(f.created_at).getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-0.03 * recencyDays); // Half-life ~23 days
        const freqScore = Math.min((f.recall_count || 0) / 5, 1);
        const impScore = f.importance || 0;
        const tierScore = f.memory_tier === 'long_term' ? 1.0 : f.memory_tier === 'session' ? 0.7 : 0.5;

        const totalScore =
          tagOverlap * 0.30 +
          recencyScore * 0.20 +
          freqScore * 0.15 +
          impScore * 0.15 +
          tierScore * 0.20;

        return { ...f, _score: totalScore, _source: 'tag_match' };
      });

      scored.sort((a, b) => b._score - a._score);
      collected.push(...scored);
    }

    // === Fallback: Recent fragments if tag search returned too few ===
    if (collected.length < limit) {
      const fallback = db.prepare(`
        SELECT * FROM t_memory_fragment
        WHERE student_id = ? AND fragment_type IN ('thread_event', 'student_quote', 'final_summary')
        AND (status IS NULL OR status IN ('active', 'published'))
        ORDER BY id DESC LIMIT ?
      `).all(studentId, limit);
      collected.push(...fallback.map(f => ({ ...f, _source: 'fallback' })));
    }

    // === Dedup + MMR diversity filter ===
    const result = [];
    const seenIds = new Set();
    const seenTexts = [];

    for (const f of collected) {
      if (result.length >= limit) break;
      if (seenIds.has(f.id)) continue;

      // MMR: skip if too similar to already selected
      const isDuplicate = seenTexts.some(existingText => jaccardSimilarity(f.text, existingText) >= 0.7);
      if (isDuplicate) continue;

      seenIds.add(f.id);
      seenTexts.push(f.text);
      result.push(f);
    }

    // Update recall_count for used fragments
    const updateStmt = db.prepare('UPDATE t_memory_fragment SET recall_count = recall_count + 1 WHERE id = ?');
    for (const f of result) {
      try { updateStmt.run(f.id); } catch (e) {}
    }

    return {
      fragments: result,
      usedFragmentIds: result.map(f => f.id),
    };
  } catch (e) {
    console.log('[Retrieval] Failed:', e.message);
    return { fragments: [], usedFragmentIds: [] };
  }
}

/**
 * Extract keywords from Chinese text for search.
 */
function extractKeywords(text) {
  if (!text || text.length < 2) return [];
  const stopWords = new Set(['我的', '你的', '他的', '什么', '怎么', '这个', '那个', '可以', '不是', '因为', '所以', '但是', '还有', '没有', '已经', '就是', '一个', '现在', '觉得', '感觉', '还是', '知道', '应该', '不会']);
  const clean = text.replace(/[，。！？、；：""''（）\s\n.!?,;:]+/g, '');
  const keywords = new Set();
  // 2-char bigrams
  for (let i = 0; i < clean.length - 1; i++) {
    const kw = clean.substring(i, i + 2);
    if (!stopWords.has(kw)) keywords.add(kw);
  }
  return [...keywords].slice(0, 8);
}

/**
 * Jaccard similarity for MMR diversity filtering.
 */
function jaccardSimilarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set();
  const setB = new Set();
  for (let i = 0; i < a.length - 1; i++) setA.add(a.substring(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) setB.add(b.substring(i, i + 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const bg of setA) { if (setB.has(bg)) intersection++; }
  return intersection / (setA.size + setB.size - intersection);
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Render retrieved fragments into context text.
 */
function renderFragmentsAsContext(fragments) {
  if (!fragments || fragments.length === 0) return '';

  const byType = {};
  for (const f of fragments) {
    if (!byType[f.fragment_type]) byType[f.fragment_type] = [];
    byType[f.fragment_type].push(f);
  }

  const parts = [];

  if (byType.profile_fact) {
    parts.push('== 学生画像 ==');
    parts.push(byType.profile_fact.map(f => f.text).join('\n'));
  }
  if (byType.risk_fact) {
    parts.push('== 风险记录 ==');
    parts.push(byType.risk_fact.map(f => f.text).join('\n'));
  }
  if (byType.rolling_summary) {
    parts.push('== 对话摘要 ==');
    parts.push(byType.rolling_summary.map(f => f.text).join('\n'));
  }
  if (byType.final_summary) {
    parts.push('== 历史咨询摘要 ==');
    parts.push(byType.final_summary.map(f => f.text).join('\n'));
  }

  const sessionItems = [...(byType.thread_event || []), ...(byType.student_quote || [])];
  if (sessionItems.length) {
    parts.push('== 对话线索 ==');
    parts.push(sessionItems.map(f => {
      const prefix = f.fragment_type === 'student_quote' ? '学生原话: ' : '';
      return `${prefix}${f.text}`;
    }).join('\n'));
  }

  return parts.join('\n\n');
}

module.exports = {
  retrieveRelevantMemory,
  renderFragmentsAsContext,
};
