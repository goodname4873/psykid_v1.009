/**
 * Guardian Service - v1.007 (04 升级: 事件驱动)
 *
 * Kairos-inspired background daemon that runs in parallel with the main
 * counseling pipeline. Its job:
 *
 *   1. Analyze conversation situation on events (not timer)
 *   2. Pre-generate multiple likely next-turn AI responses (branches)
 *   3. Make proactive decisions (intervene when student is silent/stuck)
 *   4. Provide cached responses to main pipeline for speed
 *
 * v1.007-04 改动: 从 10s 定时心跳改为事件驱动
 *   - 学生发新消息 → 跑 1 次完整 tick (态势+分支+主动介入)
 *   - 沉默监测 → 30s 轻量检查 (只查 DB，不调 LLM，沉默>45s 才跑 proactive)
 *   - 兜圈指标 > 0.6 → 在 tick 中判断
 *   - 其他时候不跑心跳，不消耗 token
 *   预估节省: 70-80% token
 *
 * Architecture:
 *   - Event-driven, decoupled from request-response pipeline
 *   - One state per active session (in guardian-state.js)
 *   - Communicates with main pipeline via shared state (query) + Socket.IO (push)
 */

const guardianState = require('./guardian-state');
const branchMemory = require('./branch-memory');

// Will be filled in by Phase 2-5
let situationAnalyzer = null;
let branchGenerator = null;
let branchMatcher = null;
let proactiveDecider = null;

// Silence monitor configuration
const SILENCE_CHECK_INTERVAL_MS = 30000;  // 30s lightweight check (DB only)
const SILENCE_TRIGGER_MS = 45000;          // 45s silence → run proactive decider
const MIN_GAP_AFTER_MAIN_MS = 5000;        // skip tick if main pipeline just ran
const PROACTIVE_AFTER_MAIN_COOLDOWN_MS = SILENCE_TRIGGER_MS;
const NEXT_TURN_PREPARE_DELAY_MS = 250;    // after AI reply is saved, prepare next-turn branches immediately

let silenceTimer = null;
let ioInstance = null;
const nextTurnPrepareTimers = new Map();
const partialDraftTimers = new Map();
const partialDraftCooldowns = new Map();

/**
 * Start the global guardian service.
 * Called once at server startup.
 */
function startGuardianService(io) {
  if (silenceTimer) return;
  ioInstance = io;

  // Lazy load components
  try { situationAnalyzer = require('./situation-analyzer'); } catch (e) { /* not yet impl */ }
  try { branchGenerator = require('./branch-generator'); } catch (e) { /* not yet impl */ }
  try { branchMatcher = require('./branch-matcher'); } catch (e) { /* not yet impl */ }
  try { proactiveDecider = require('./proactive-decider'); } catch (e) { /* not yet impl */ }

  console.log('  Guardian Service: started (event-driven + 30s silence monitor)');

  // Lightweight silence monitor — only checks DB timestamps, no LLM calls
  silenceTimer = setInterval(async () => {
    try {
      await silenceCheckTick();
    } catch (err) {
      console.error('[Guardian] Silence check error:', err.message);
    }
  }, SILENCE_CHECK_INTERVAL_MS);
}

function stopGuardianService() {
  if (silenceTimer) {
    clearInterval(silenceTimer);
    silenceTimer = null;
  }
}

/**
 * Lightweight silence monitor: checks DB timestamps only, no LLM.
 * Triggers proactive decider only when silence > 45s.
 * Also handles idle session cleanup (5 min → auto detach).
 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min idle → auto detach

async function silenceCheckTick() {
  const sessions = guardianState.getAllActiveStates();
  if (sessions.length === 0) return;

  const now = Date.now();

  for (const state of sessions) {
    // Step 1: Idle cleanup (no activity for 5 min)
    const lastActivity = Math.max(state.lastMainActivityAt || 0, state.lastTickAt || 0, state.attachedAt || 0);
    if ((now - lastActivity) > IDLE_TIMEOUT_MS) {
      try {
        const { dreamOnIdle } = require('../dream-service');
        dreamOnIdle(state.studentId).catch(() => {});
      } catch (e) {}
      console.log(`[Guardian] Session ${state.sessionId} auto-detached (idle ${Math.round((now - lastActivity)/1000)}s) + Dream triggered`);
      guardianState.detachSession(state.sessionId);
      continue;
    }

    // Step 2: Check silence — DB only, no LLM
    if (state.isRunning || state.isMainPipelineBusy) continue;

    // v1.009: run the cheap trigger classifier first. It may detect silence,
    // stuck loops, withdrawal, pressure, open loops, or emotion escalation.
    // Once a real proactive decision fires, lock until the next student message.
    if (state.proactiveFiredSinceLastMessage) continue;

    const classifierReady = proactiveDecider?.shouldRunProactiveCheck?.(state);

    if (classifierReady && proactiveDecider) {
      // Run proactive decider only (no situation analysis or branch generation).
      // The fired lock is set only after a real decision, so a no-op classifier
      // check will not block later silence checks.
      runProactiveOnly(state).catch(err => {
        console.error(`[Guardian] Proactive check error for session ${state.sessionId}:`, err.message);
      });
    }
  }
}

/**
 * Event-driven trigger: called when a student sends a new message.
 * Runs a full tick (situation + branches + proactive) once per message.
 */
async function onStudentMessage(sessionId) {
  const state = guardianState.getState(sessionId);
  if (!state) return;
  // Reset immediately; voice turns may arrive while a Guardian tick is running.
  state.proactiveFiredSinceLastMessage = false;
  if (state.isRunning) return;

  // Reset proactive lock — student spoke, allow next proactive cycle
  // Wait for main pipeline to finish before analyzing
  // Use a short delay so the message is saved to DB first
  setTimeout(async () => {
    if (state.isMainPipelineBusy) return; // main still running, skip
    if (state.isRunning) return;

    try {
      await runSessionTick(state);
      console.log(`[Guardian] Event tick for session ${state.sessionId} (branches=${state.preparedBranches.length})`);
    } catch (err) {
      console.error(`[Guardian] Event tick error for session ${state.sessionId}:`, err.message);
      state.isRunning = false;
    }
  }, MIN_GAP_AFTER_MAIN_MS);
}

function scheduleNextTurnPreparation(sessionId, reason = 'ai_complete') {
  const state = guardianState.getState(sessionId);
  if (!state) return;

  const existing = nextTurnPrepareTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    nextTurnPrepareTimers.delete(sessionId);
    const current = guardianState.getState(sessionId);
    if (!current || current.isRunning || current.isMainPipelineBusy) return;

    try {
      await runSessionTick(current);
      console.log(`[Guardian] Next-turn prepared for session ${current.sessionId} (${reason}, branches=${current.preparedBranches.length})`);
    } catch (err) {
      console.error(`[Guardian] Next-turn prepare error for session ${sessionId}:`, err.message);
      current.isRunning = false;
    }
  }, NEXT_TURN_PREPARE_DELAY_MS);

  nextTurnPrepareTimers.set(sessionId, timer);
}

/**
 * Run proactive decider only (no situation analysis or branch generation).
 * Used by silence monitor to minimize token usage.
 */
async function runProactiveOnly(state) {
  if (!proactiveDecider) return;
  state.isRunning = true;
  try {
    const decision = await proactiveDecider.decide(state);
    if (decision && decision.shouldIntervene) {
      state.proactiveFiredSinceLastMessage = true;
      state.proactiveQueue.push({
        urgency: decision.urgency,
        content: decision.content,
        reason: decision.reason,
        triggerType: decision.triggerType,
        target: decision.target,
        triggerAt: Date.now(),
      });
      emitProactiveIntervention(state.sessionId, decision);
      console.log(`[Guardian] Proactive triggered for session ${state.sessionId}: ${decision.reason}`);
    }
  } finally {
    state.isRunning = false;
  }
}

/**
 * Run one tick for a single session.
 */
async function runSessionTick(state) {
  state.isRunning = true;
  const startMs = Date.now();

  try {
    const snapshot = { stage: 'started' };

    // Step 1: Analyze current situation
    if (situationAnalyzer) {
      const situation = await situationAnalyzer.analyze(state.sessionId, state.studentId);
      if (situation) {
        state.situation = { ...state.situation, ...situation, lastAnalyzedAt: Date.now() };
        snapshot.situation = situation;

        // v1.007-05: Update strategy memory with topic info
        if (state.strategyMemory) {
          const { updateTopicFromMessages } = require('./strategy-memory');
          try {
            const { getDb } = require('../../models/db');
            const recent = getDb().prepare(
              'SELECT sender_type, content FROM t_message WHERE session_id = ? ORDER BY id DESC LIMIT 6'
            ).all(state.sessionId);
            recent.reverse();
            updateTopicFromMessages(state.strategyMemory, recent);
          } catch (e) { /* non-fatal */ }
        }
      }
    }

    // Step 2: Generate branches (prepared responses for likely next turns)
    if (branchGenerator) {
      const branches = await branchGenerator.generate(state.sessionId, state.studentId, state.situation);
      if (branches && branches.length > 0) {
        state.preparedBranches = branches;
        branchMemory.rememberPreparedBranches(state.sessionId, state.studentId, branches);
        snapshot.branchCount = branches.length;
      }
    }

    // Step 3: Check if proactive intervention is needed
    // Both modes trigger, but behavior differs:
    //   Text mode: push to teacher panel, teacher decides (send/edit/ignore)
    //   Voice mode + auto on: auto-send to student, teacher can pause/retract
    //   Voice mode + auto off: same as text mode (teacher decides)
    const triggerPreview = proactiveDecider?.preview?.(state) || null;
    const msAfterMain = Date.now() - (state.lastMainActivityAt || 0);
    const proactiveCooldown = triggerPreview?.type === 'silence'
      && msAfterMain < PROACTIVE_AFTER_MAIN_COOLDOWN_MS;
    if (proactiveDecider && triggerPreview && !state.proactiveFiredSinceLastMessage && !proactiveCooldown) {
      const decision = await proactiveDecider.decide(state, triggerPreview);
      if (decision && decision.shouldIntervene) {
        state.proactiveFiredSinceLastMessage = true;
        state.proactiveQueue.push({
          urgency: decision.urgency,
          content: decision.content,
          reason: decision.reason,
          triggerType: decision.triggerType,
          target: decision.target,
          triggerAt: Date.now(),
        });
        snapshot.proactive = decision.reason;
        emitProactiveIntervention(state.sessionId, decision);
      }
    } else if (proactiveCooldown) {
      snapshot.proactiveSkipped = `cooldown_${Math.ceil((PROACTIVE_AFTER_MAIN_COOLDOWN_MS - msAfterMain) / 1000)}s`;
    }

    snapshot.durationMs = Date.now() - startMs;
    guardianState.pushTickSnapshot(state.sessionId, snapshot);

    // Push update to teacher panel
    emitGuardianUpdate(state.sessionId);
  } finally {
    state.isRunning = false;
  }
}

/**
 * Called by main runtime before running coordinator.
 * Returns a prepared response if one matches, null otherwise.
 */
async function checkPreparedResponse(sessionId, latestMessage) {
  const state = guardianState.getState(sessionId);
  if (!state) return null;
  if (!branchMatcher) return null;

  const startMs = Date.now();
  try {
    const cached = branchMemory.getCandidates({
      sessionId,
      latestMessage,
      topicResult: null,
      openLoop: null,
      limit: 4,
    });
    const branches = [
      ...(state.preparedBranches || []),
      ...cached.map(item => ({
        id: item.id,
        condition: item.condition || item.userCue || item.intent || item.topic,
        expectedTopic: item.expectedTopic || item.topic,
        response: item.response,
        analysis: item.analysis,
        generatedAt: item.createdAt,
        source: item.source || 'branch_memory',
        branchMemoryId: item.branchMemoryId || item.id,
        memoryScore: item.memoryScore,
      })),
    ];
    if (!branches.length) return null;

    const match = await branchMatcher.match(latestMessage, branches, state.situation);
    if (match && match.branchId && match.confidence >= 0.8) {
      const branch = branches.find(b => b.id === match.branchId);
      if (branch && branch.response) {
        const savedMs = Date.now() - (branch.generatedAt || Date.now());
        guardianState.recordHit(sessionId, savedMs);
        emitGuardianUpdate(sessionId);
        return {
          response: branch.response,
          expectedTopic: branch.expectedTopic || null,
          analysis: branch.analysis,
          savedMs,
          branchId: branch.id,
          generatedAt: branch.generatedAt || null,
          source: branch.source || 'prepared_branch',
          matchConfidence: match.confidence,
          branchMemoryId: branch.branchMemoryId || null,
          memoryScore: branch.memoryScore || null,
        };
      }
    }
    guardianState.recordMiss(sessionId);
    emitGuardianUpdate(sessionId);
    return null;
  } catch (err) {
    console.error('[Guardian] Match error:', err.message);
    guardianState.recordMiss(sessionId);
    return null;
  }
}

/**
 * Called by main runtime after a turn completes.
 * Notifies guardian of new conversation activity so next tick can re-analyze.
 */
function onMainTurnComplete(sessionId) {
  guardianState.markMainPipelineBusy(sessionId, false);
  // Clear stale branches (they were based on pre-turn state)
  const state = guardianState.getState(sessionId);
  if (state) {
    state.preparedBranches = [];
  }
}

/**
 * Called after the AI response has been persisted to t_message.
 * This is the right moment to prepare branches for the student's next turn.
 */
function onAiResponseComplete(sessionId) {
  const state = guardianState.getState(sessionId);
  if (!state) return;
  guardianState.markMainPipelineBusy(sessionId, false);
  state.preparedBranches = [];
  scheduleNextTurnPreparation(sessionId, 'ai_response_complete');
}

/**
 * Called by main runtime when starting to process a turn.
 */
function onMainTurnStart(sessionId) {
  guardianState.markMainPipelineBusy(sessionId, true);
}

/**
 * Called when teacher sends a reply (via /api/ai/reply or /api/message/send as teacher).
 * Resets silence timer so guardian doesn't trigger proactive right after teacher just replied.
 */
function onTeacherReply(sessionId) {
  let state = guardianState.getState(sessionId);
  if (!state) {
    try {
      const { getDb } = require('../../models/db');
      const session = getDb().prepare('SELECT student_id FROM t_consult_session WHERE id = ?').get(sessionId);
      if (session?.student_id) {
        state = guardianState.attachSession(sessionId, session.student_id);
      }
    } catch (e) {}
  }
  if (!state) return;
  state.lastMainActivityAt = Date.now();
  // Also reset proactive lock — teacher replied, treat like fresh activity
  state.proactiveFiredSinceLastMessage = false;
}

function onSessionActivity(sessionId) {
  const state = guardianState.getState(sessionId);
  if (!state) return;
  state.lastMainActivityAt = Date.now();
}

/**
 * v1.009: partial ASR shadow input.
 * Qwen3 ASR partial transcripts arrive while the student is still speaking.
 * Phase 1 stores them in Guardian shared state / draft bank for observation
 * and later Draft Bank expansion, without blocking the slow Pipeline.
 */
function onPartialAsr(sessionId, text) {
  const state = guardianState.updatePartialAsr(sessionId, text);
  if (!state) return;
  if (state.partialAsr.updateCount % 3 === 1) {
    emitGuardianUpdate(sessionId);
  }
  schedulePartialDraft(state);
}

function schedulePartialDraft(state) {
  if (!branchGenerator?.generateFromPartial) return;
  const text = String(state.partialAsr?.text || '').trim();
  if (text.length < 8) return;
  if (/^(hmm|um|uh|us|yes|yeah|ok|okay)$/i.test(text)) return;
  if (/^(那个|这个|以及|然后|就是|嗯|啊|哦|呃|额)[。.!?？！,，\s]*$/.test(text)) return;

  const lastStartedAt = partialDraftCooldowns.get(state.sessionId) || 0;
  if (Date.now() - lastStartedAt < 4000) return;

  const existing = partialDraftTimers.get(state.sessionId);
  if (existing) clearTimeout(existing);

  const stableText = text;
  const timer = setTimeout(async () => {
    partialDraftTimers.delete(state.sessionId);
    const current = guardianState.getState(state.sessionId);
    if (!current || current.isMainPipelineBusy) return;
    if (String(current.partialAsr?.text || '').trim() !== stableText) return;

    partialDraftCooldowns.set(state.sessionId, Date.now());
    try {
      const draft = await branchGenerator.generateFromPartial(
        current.sessionId,
        current.studentId,
        stableText,
        current.situation,
      );
      if (!draft?.response) return;
      branchMemory.rememberDraft({
        sessionId: current.sessionId,
        studentId: current.studentId,
        topic: draft.expectedTopic,
        expectedTopic: draft.expectedTopic,
        intent: branchMemory.inferIntent(stableText),
        source: 'partial_asr_draft',
        userCue: stableText,
        response: draft.response,
        analysis: draft.analysis,
        confidence: 0.78,
        branchId: draft.id,
        ttlMs: 10 * 60 * 1000,
      });
      console.log(`[Guardian] Partial draft ready for session ${current.sessionId}: ${stableText.slice(0, 24)}`);
      emitGuardianUpdate(current.sessionId);
    } catch (err) {
      console.error(`[Guardian] Partial draft error for session ${state.sessionId}:`, err.message);
    }
  }, 900);

  partialDraftTimers.set(state.sessionId, timer);
}

/**
 * Store a verified reply as short-term Branch Working Memory.
 * These drafts only help future fast-path matching inside the same session;
 * runtime still verifies every candidate before it can be sent.
 */
function rememberTurnDraft({
  sessionId,
  studentId,
  studentText,
  aiText,
  topic,
  source = 'slow_pipeline_reply',
}) {
  if (!sessionId || !aiText) return null;
  const item = branchMemory.rememberDraft({
    sessionId,
    studentId,
    topic,
    expectedTopic: topic,
    intent: branchMemory.inferIntent(studentText),
    source,
    userCue: studentText,
    response: aiText,
    analysis: null,
    confidence: source === 'guardian_fast_path_reply' ? 0.82 : 0.68,
    ttlMs: 45 * 60 * 1000,
  });
  if (item) emitGuardianUpdate(sessionId);
  return item;
}

function reportBranchMemoryOutcome(sessionId, branchMemoryId, accepted) {
  if (!sessionId || !branchMemoryId) return;
  branchMemory.markOutcome(sessionId, branchMemoryId, !!accepted);
  emitGuardianUpdate(sessionId);
}

// ==================== Socket.IO emitters ====================

function emitGuardianUpdate(sessionId) {
  if (!ioInstance) return;
  const snapshot = guardianState.getPublicSnapshot(sessionId);
  if (!snapshot) return;
  ioInstance.to(`session_${sessionId}`).emit('guardian:update', { session_id: sessionId, ...snapshot });
  ioInstance.to('teacher_room').emit('guardian:update', { session_id: sessionId, ...snapshot });
}

function emitProactiveIntervention(sessionId, decision) {
  if (!ioInstance) return;

  // Check session mode to decide auto-send behavior
  const { getDb } = require('../../models/db');
  let sessionMode = 'text';
  try {
    const session = getDb().prepare('SELECT mode FROM t_consult_session WHERE id = ?').get(sessionId);
    if (session) sessionMode = session.mode;
  } catch (e) {}

  const isVoiceMode = sessionMode === 'agent';
  const state = guardianState.getState(sessionId);
  const target = decision.target || 'student';
  const autoSend = isVoiceMode && target === 'student' && (state?.autoProactive !== false);

  // Notify teacher panel (always — teacher needs to see the suggestion)
  const proactiveEvent = {
    session_id: sessionId,
    urgency: decision.urgency,
    content: decision.content,
    reason: decision.reason,
    triggerType: decision.triggerType,
    target,
    suggestedAction: decision.suggestedAction,
    autoSent: autoSend,
    sessionMode,
  };
  ioInstance.to('teacher_room').emit('guardian:proactive', proactiveEvent);

  if (autoSend) {
    // Voice mode auto-sends to the student; text/push modes wait for teacher approval.
    sendProactiveToStudent(sessionId, decision.content);
  }
  // Text/push modes: only guardian:proactive to teacher panel, teacher decides to send or not
}

/**
 * Send a proactive message to student (save to DB + push via Socket.IO).
 * Called automatically in voice mode, or by teacher clicking "send" in text mode.
 */
function sendProactiveToStudent(sessionId, content) {
  if (!ioInstance) return;
  if (!content) return;
  const { getDb } = require('../../models/db');
  const crypto = require('crypto');

  // v1.007-05: Don't depend on guardian state — fetch studentId from DB
  // (guardian may have been detached if student switched modes)
  let studentId = null;
  try {
    const sess = getDb().prepare('SELECT student_id FROM t_consult_session WHERE id = ?').get(sessionId);
    studentId = sess?.student_id;
  } catch (e) { /* ignore */ }
  if (!studentId) {
    console.error(`[Guardian] sendProactiveToStudent: no studentId for session ${sessionId}`);
    return;
  }

  // Save to DB
  let messageId = null;
  try {
    const db = getDb();
    const messageNo = 'M' + Date.now() + '-' + crypto.randomUUID().substring(0, 8);
    const result = db.prepare(`
      INSERT INTO t_message (message_no, session_id, student_id, sender_type, input_type, content, content_source)
      VALUES (?, ?, ?, 'ai', 'text', ?, 'guardian_proactive')
    `).run(messageNo, sessionId, studentId, content);
    messageId = result.lastInsertRowid;

    db.prepare(`
      UPDATE t_consult_session SET message_count = message_count + 1,
        last_message_time = datetime('now','localtime'), last_message_preview = ?,
        updated_at = datetime('now','localtime') WHERE id = ?
    `).run(content.substring(0, 50), sessionId);
  } catch (e) {
    console.error('[Guardian] Save proactive message failed:', e.message);
  }

  // Push to student + teacher via Socket.IO
  const msgData = {
    id: messageId,
    session_id: sessionId,
    student_id: studentId,
    sender_type: 'ai',
    input_type: 'text',
    content,
    content_source: 'guardian_proactive',
    created_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }),
  };
  // Push to both student + teacher (teacher sees it as a chat message)
  ioInstance.to(`session_${sessionId}`).emit('teacher:message', msgData);
  ioInstance.to('teacher_room').emit('teacher:message', msgData);
  try {
    require('../voice-pipeline').streamGuardianProactiveAudio(sessionId, content, messageId);
  } catch (e) {
    console.warn('[Guardian] Voice proactive TTS bridge failed:', e.message);
  }
  console.log(`[Guardian] Proactive sent to student in session ${sessionId}`);
}

/**
 * v1.007-05: Get strategy advice for the main pipeline.
 * Returns current topic, effective/avoid methods, Guardian candidate.
 */
function getStrategyAdvice(sessionId) {
  const state = guardianState.getState(sessionId);
  if (!state || !state.strategyMemory) return null;
  const { getAdvice } = require('./strategy-memory');
  return getAdvice(state.strategyMemory);
}

module.exports = {
  startGuardianService,
  stopGuardianService,
  checkPreparedResponse,
  onMainTurnStart,
  onMainTurnComplete,
  onAiResponseComplete,
  onStudentMessage,
  onTeacherReply,
  onSessionActivity,
  onPartialAsr,
  rememberTurnDraft,
  reportBranchMemoryOutcome,
  sendProactiveToStudent,
  getStrategyAdvice,
  attachSession: guardianState.attachSession,
  detachSession: guardianState.detachSession,
  getPublicSnapshot: guardianState.getPublicSnapshot,
};
