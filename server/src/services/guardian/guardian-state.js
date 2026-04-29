/**
 * Guardian State - v1.007
 *
 * Shared in-memory state for each active counseling session.
 * Guardian service maintains one state per session, updated by heartbeat loop
 * and queried by main counseling-runtime pipeline.
 *
 * Lifecycle: attached when student enters session, detached when session ends.
 */

// Map<sessionId, GuardianSessionState>
const states = new Map();

/**
 * Create a fresh state for a session.
 */
function createState(sessionId, studentId) {
  const { createStrategyMemory } = require('./strategy-memory');
  return {
    sessionId,
    studentId,
    attachedAt: Date.now(),

    // === Strategy memory (v1.007-05) ===
    strategyMemory: createStrategyMemory(),

    // === Heartbeat metadata ===
    lastTickAt: 0,
    tickCount: 0,
    isRunning: false,       // currently executing a tick
    isMainPipelineBusy: false, // main runtime currently processing a turn
    lastMainActivityAt: 0,  // timestamp of last main pipeline activity

    // === Situation analysis (from situation-analyzer) ===
    situation: {
      emotionTrend: null,        // '稳定' | '上升' | '下降' | '波动'
      emotionIntensity: 0,       // 0-10
      topicDepth: 'shallow',     // 'shallow' | 'middle' | 'deep'
      stuckIndicator: 0,         // 0-1, higher = going in circles
      engagementLevel: 'normal', // 'low' | 'normal' | 'high'
      nextStepHint: '',          // brief hint for next turn
      lastAnalyzedAt: 0,
    },

    // === Prepared branches (from branch-generator) ===
    // Each branch is a possible response for a likely next student turn
    preparedBranches: [],
    draftBank: [],
    branchWorkingMemory: [],
    activeFrame: null,
    topicStack: [],
    partialAsr: {
      text: '',
      updatedAt: 0,
      updateCount: 0,
    },
    // Example branch:
    // {
    //   id: 'branch_1',
    //   condition: '学生继续质疑方法',
    //   expectedTopic: '语文-文言文-桃花源记',
    //   conditionKeywords: ['不好', '没用', '试过了'],
    //   response: '嗯，确实听着不稀奇...',  // pre-generated AI response
    //   analysis: { skillWeights, emotion, stage, ... },  // pre-run coordinator result
    //   generatedAt: timestamp,
    // }

    // === Hit tracking ===
    hitStats: {
      totalChecks: 0,
      hits: 0,
      misses: 0,
      totalSavedMs: 0,
      lastHitAt: 0,
      recent10: [],  // array of booleans for last 10 checks (for rate display)
    },

    // === Proactive intervention ===
    proactiveQueue: [],  // pending proactive suggestions to student
    lastProactiveAt: 0,  // rate limiter for proactive sends
    proactiveFiredSinceLastMessage: false, // v1.007-04: true = already fired, wait for next student message
    autoProactive: true, // teacher can pause auto-send in voice mode
    // proactive item:
    // {
    //   urgency: 'high' | 'normal',
    //   content: '还在吗？',
    //   reason: '沉默 45s',
    //   triggerAt: timestamp,
    // }

    // === History of recent ticks (for teacher panel) ===
    recentTicks: [],  // last 10 tick snapshots
  };
}

function attachSession(sessionId, studentId) {
  if (states.has(sessionId)) {
    const existing = states.get(sessionId);
    if (existing.studentId === studentId) return existing;
    console.warn(`[Guardian] Re-attaching session ${sessionId}: student ${existing.studentId} -> ${studentId}`);
    detachSession(sessionId);
  }
  const state = createState(sessionId, studentId);

  // v1.007-05 fix: 从最近消息时间戳初始化 lastMainActivityAt
  // 否则重新 attach 后 silenceMs 永远是 0,沉默计时器失效
  try {
    const { getDb } = require('../../models/db');
    const lastMsg = getDb().prepare(
      `SELECT created_at FROM t_message WHERE session_id = ? ORDER BY id DESC LIMIT 1`
    ).get(sessionId);
    if (lastMsg && lastMsg.created_at) {
      state.lastMainActivityAt = new Date(lastMsg.created_at).getTime();
    }
  } catch (e) { /* 没消息就保持 0（新会话）*/ }

  states.set(sessionId, state);
  console.log(`[Guardian] Attached session ${sessionId} (student ${studentId}, lastActivity=${state.lastMainActivityAt ? new Date(state.lastMainActivityAt).toISOString() : 'new'})`);
  return state;
}

function detachSession(sessionId) {
  if (states.has(sessionId)) {
    states.delete(sessionId);
    try { require('./branch-memory').clearSession(sessionId); } catch (e) {}
    console.log(`[Guardian] Detached session ${sessionId}`);
  }
}

function getState(sessionId) {
  return states.get(sessionId) || null;
}

function getAllActiveStates() {
  return Array.from(states.values());
}

function markMainPipelineBusy(sessionId, busy = true) {
  const s = states.get(sessionId);
  if (s) {
    s.isMainPipelineBusy = busy;
    if (!busy) s.lastMainActivityAt = Date.now();
  }
}

function recordHit(sessionId, savedMs) {
  const s = states.get(sessionId);
  if (!s) return;
  s.hitStats.totalChecks++;
  s.hitStats.hits++;
  s.hitStats.totalSavedMs += savedMs || 0;
  s.hitStats.lastHitAt = Date.now();
  s.hitStats.recent10.push(true);
  if (s.hitStats.recent10.length > 10) s.hitStats.recent10.shift();
}

function recordMiss(sessionId) {
  const s = states.get(sessionId);
  if (!s) return;
  s.hitStats.totalChecks++;
  s.hitStats.misses++;
  s.hitStats.recent10.push(false);
  if (s.hitStats.recent10.length > 10) s.hitStats.recent10.shift();
}

function pushTickSnapshot(sessionId, snapshot) {
  const s = states.get(sessionId);
  if (!s) return;
  s.recentTicks.push({ ...snapshot, at: Date.now() });
  if (s.recentTicks.length > 10) s.recentTicks.shift();
  s.tickCount++;
  s.lastTickAt = Date.now();
}

function updatePartialAsr(sessionId, text) {
  const s = states.get(sessionId);
  if (!s) return null;
  const value = String(text || '').trim();
  if (!value || value === s.partialAsr.text) return s;
  s.partialAsr = {
    text: value,
    updatedAt: Date.now(),
    updateCount: (s.partialAsr?.updateCount || 0) + 1,
  };
  s.draftBank.push({
    text: value,
    updatedAt: s.partialAsr.updatedAt,
    branchCount: s.preparedBranches?.length || 0,
  });
  if (s.draftBank.length > 8) s.draftBank.shift();
  return s;
}

/**
 * Snapshot for teacher panel display (stripped of internal fields).
 */
function getPublicSnapshot(sessionId) {
  const s = states.get(sessionId);
  if (!s) return null;
  let branchMemory = [];
  let traceStats = null;
  try {
    branchMemory = require('./branch-memory').snapshot(sessionId);
  } catch (e) {}
  try {
    traceStats = require('../runtime/runtime-stats').getSessionRuntimeStats(sessionId, 80);
  } catch (e) {}
  const hitRate = s.hitStats.totalChecks > 0
    ? (s.hitStats.hits / s.hitStats.totalChecks)
    : 0;
  const avgSavedMs = s.hitStats.hits > 0
    ? (s.hitStats.totalSavedMs / s.hitStats.hits)
    : 0;
  return {
    tickCount: s.tickCount,
    lastTickAt: s.lastTickAt,
    situation: s.situation,
    preparedBranches: s.preparedBranches.map(b => ({
      id: b.id,
      condition: b.condition,
      expectedTopic: b.expectedTopic || null,
      generatedAt: b.generatedAt,
      ready: !!b.response,
    })),
    partialAsr: {
      text: s.partialAsr?.text || '',
      updatedAt: s.partialAsr?.updatedAt || 0,
      updateCount: s.partialAsr?.updateCount || 0,
    },
    draftBank: (s.draftBank || []).slice(-3).map(d => ({
      text: d.text,
      updatedAt: d.updatedAt,
      branchCount: d.branchCount,
    })),
    branchWorkingMemory: branchMemory,
    activeFrame: s.activeFrame || null,
    topicStack: s.topicStack || [],
    hitStats: {
      totalChecks: s.hitStats.totalChecks,
      hits: s.hitStats.hits,
      misses: s.hitStats.misses,
      hitRate,
      avgSavedMs,
      recent10: s.hitStats.recent10,
    },
    traceStats,
    recentProactive: s.proactiveQueue.slice(-3),
  };
}

module.exports = {
  attachSession,
  detachSession,
  getState,
  getAllActiveStates,
  markMainPipelineBusy,
  recordHit,
  recordMiss,
  pushTickSnapshot,
  updatePartialAsr,
  getPublicSnapshot,
};
