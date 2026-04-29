/**
 * Voice Pipeline - v1.007
 *
 * Orchestrates the full voice conversation loop:
 *   ASR final text → Agent Runtime (coordinator + streaming generator) → TTS streaming
 *
 * Manages a WebSocket session with the browser:
 *   Browser ←WebSocket→ /ws/voice-pipeline
 *
 * Browser sends:
 *   { type: 'start', sessionId: number }           → initialize pipeline
 *   { type: 'asr_final', text: string }             → student finished speaking
 *   { type: 'stop' }                                → end pipeline
 *
 * Browser receives:
 *   { type: 'ready' }                               → pipeline initialized
 *   { type: 'thinking' }                            → coordinator analyzing
 *   { type: 'analysis', data: {...} }               → coordinator result
 *   { type: 'speaking' }                            → generator starting
 *   { type: 'tts_audio', data: base64PCM }          → audio chunk from TTS
 *   { type: 'sentence', text: string }              → text of current sentence
 *   { type: 'tts_sentence_end' }                    → one sentence done
 *   { type: 'response_done', data: {...} }          → full response complete
 *   { type: 'error', message: string }              → error
 *
 * The pipeline reuses the v1.006 runtime architecture:
 *   - assembleSuggestionContext (context-assembler.js)
 *   - assembleCoordinatorPrompt / assembleSuggestionPrompt (prompt-assembler.js)
 *   - callLLM for coordinator (ai-client.js, non-streaming)
 *   - callLLMStreaming + collectSentences for generator (streaming-llm.js)
 *   - writeSuggestionTrace / writeContextTrace (suggestion-trace.js)
 *   - DashScope TTS via internal WebSocket
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const { getDb } = require('../models/db');
const config = require('./runtime/counseling-config');
const { runSuggestionTurnStreaming } = require('./runtime/counseling-runtime');
const guardian = require('./guardian/guardian-service');

const DASHSCOPE_TTS_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
const activeVoicePipelines = new Map();

// Build WAV file from raw PCM16 buffer
function buildWav(pcmBuffer, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Handle one voice pipeline WebSocket connection.
 */
function handlePipelineConnection(browserWs, io) {
  let sessionId = null;
  let studentId = null;
  let ttsWs = null;
  let ttsReady = false;
  let processing = false;
  let lastStudentMessageId = null;     // To UPDATE audio_url when it arrives async
  let ttsAudioChunks = [];              // Accumulated TTS PCM chunks (for server-side saving)
  let lastAiMessageId = null;           // v1.007-05: track last AI message for audio_url update
  let pendingMessages = [];             // v1.007-05: queued student messages while processing
  let generationId = 0;                  // v1.008: invalidates stale AI turns after student interruption
  let activeTtsGenerationId = 0;          // v1.008: prevents stale TTS audio from being saved
  let ttsConnectionId = 0;                // v1.008: ignores late events from closed TTS sockets
  let currentTurnPerf = null;             // v1.008: per-turn voice latency breakdown
  let pendingTtsTexts = [];               // v1.009: queue sentences until TTS is ready
  const aiMessageIdsByGeneration = new Map(); // v1.009: bind delayed TTS save to the exact AI message
  let voiceTurnBuffer = [];              // v1.009: ASR final segments are not always full student turns
  let voiceTurnTimer = null;
  const VOICE_TURN_GRACE_MS = 1400;
  const VOICE_TURN_DANGLING_GRACE_MS = 2300;

  browserWs.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      sendBrowser({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'start':
        await initPipeline(msg);
        break;
      case 'asr_final': {
        const asrText = (msg.text || '').trim();
        // Backend filter: only skip technical empties. Short acknowledgements
        // like "对/好/是/没有/嗯" are meaningful in counseling and must reach
        // Context Gate as ack_segment instead of being discarded here.
        const isJunk = !asrText
          || /^[，。！？、；：""''（）\s.!?,;:]+$/.test(asrText);
        if (isJunk && asrText) {
          console.log(`[VoicePipeline] ASR junk filtered: "${asrText}"`);
          break;
        }
        if (!asrText || !sessionId) break;

        // v1.007-05: Always save to DB first (even if processing — preserves memory)
        saveStudentMessageToDB(asrText);

        // v1.009: final ASR is only an ASR segment, not necessarily a full student turn.
        // Buffer short/dangling segments so text and voice remain one continuous dialogue.
        queueVoiceTurnSegment(asrText);
        break;
      }
      case 'asr_partial': {
        const partialText = (msg.text || '').trim();
        if (partialText && sessionId) {
          guardian.onPartialAsr(sessionId, partialText);
        }
        break;
      }
      case 'student_audio_url':
        // Browser uploaded student WAV; update the last student message with audio_url
        if (msg.audio_url && lastStudentMessageId) {
          try {
            getDb().prepare('UPDATE t_message SET audio_url = ? WHERE id = ?').run(msg.audio_url, lastStudentMessageId);
            // Notify teacher of audio URL update via socket
            if (io) {
              io.to(`session_${sessionId}`).emit('message:audio_updated', { message_id: lastStudentMessageId, audio_url: msg.audio_url });
              io.to('teacher_room').emit('message:audio_updated', { message_id: lastStudentMessageId, audio_url: msg.audio_url });
            }
          } catch (e) { console.log('[VoicePipeline] Update student audio_url failed:', e.message); }
        }
        break;
      case 'stop':
        cleanup();
        break;
    }
  });

  browserWs.on('close', cleanup);
  browserWs.on('error', (err) => {
    console.error('[VoicePipeline] Browser error:', err.message);
    cleanup();
  });

  async function initPipeline(msg) {
    sessionId = msg.sessionId;
    if (!sessionId) {
      sendBrowser({ type: 'error', message: 'sessionId required' });
      return;
    }

    const db = getDb();
    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(sessionId);
    if (!session) {
      sendBrowser({ type: 'error', message: 'Session not found' });
      return;
    }
    studentId = session.student_id;
    activeVoicePipelines.set(sessionId, { streamGuardianProactiveAudio });

    // v1.007: Attach guardian to this session
    guardian.attachSession(sessionId, studentId);

    // Connect TTS WebSocket
    await connectTTS();

    // Notify teacher that student entered Agent voice mode
    if (io) {
      io.to(`session_${sessionId}`).emit('session:mode_change', { session_id: sessionId, mode: 'agent' });
      io.to('teacher_room').emit('session:mode_change', { session_id: sessionId, mode: 'agent' });
    }

    sendBrowser({ type: 'ready' });
    console.log(`[VoicePipeline] Initialized for session ${sessionId}`);
  }

  /**
   * Save accumulated TTS audio chunks as WAV file, update DB message, notify frontend.
   * Called when TTS response.done fires (not when LLM done fires — TTS lags behind).
   */
  function saveTtsAudio(targetGenerationId = activeTtsGenerationId) {
    if (ttsAudioChunks.length === 0) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const totalPcm = Buffer.concat(ttsAudioChunks);
      const wavBuffer = buildWav(totalPcm, 24000);
      const audioFile = `M${Date.now()}-${crypto.randomUUID().substring(0, 8)}.wav`;
      const uploadDir = path.resolve(__dirname, '../../uploads/audio');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, audioFile), wavBuffer);
      const audioUrl = `/uploads/audio/${audioFile}`;
      console.log(`[VoicePipeline] Saved TTS audio: ${audioUrl} (${wavBuffer.length} bytes)`);

      // Update the AI message in DB with audio_url
      const targetAiMessageId = aiMessageIdsByGeneration.get(targetGenerationId) || lastAiMessageId;
      if (targetAiMessageId) {
        try {
          const db = getDb();
          db.prepare('UPDATE t_message SET audio_url = ? WHERE id = ?').run(audioUrl, targetAiMessageId);
        } catch (e) {
          console.error('[VoicePipeline] Update audio_url failed:', e.message);
        }
      }

      // Notify student frontend + teacher
      sendBrowser({ type: 'ai_audio_saved', audio_url: audioUrl, message_id: targetAiMessageId || null });
      if (io && sessionId) {
        io.to(`session_${sessionId}`).emit('message:audio_updated', {
          message_id: targetAiMessageId || lastAiMessageId, audio_url: audioUrl,
        });
        io.to('teacher_room').emit('message:audio_updated', {
          message_id: targetAiMessageId || lastAiMessageId, audio_url: audioUrl,
        });
      }
    } catch (e) {
      console.error('[VoicePipeline] Save TTS audio failed:', e.message);
    }
    ttsAudioChunks = [];
  }

  function connectTTS() {
    return new Promise((resolve, reject) => {
      if (!config.dashscopeApiKey) {
        console.warn('[VoicePipeline] No DASHSCOPE_API_KEY, TTS disabled');
        resolve();
        return;
      }

      const model = config.dashscopeTtsModel;
      const wsUrl = `${DASHSCOPE_TTS_WS_URL}?model=${model}`;

      const connectionId = ++ttsConnectionId;
      const ws = new WebSocket(wsUrl, {
        headers: { 'Authorization': `Bearer ${config.dashscopeApiKey}` },
      });
      ttsWs = ws;

      ws.on('open', () => {
        if (connectionId !== ttsConnectionId) {
          try { ws.close(); } catch (e) {}
          return;
        }
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            mode: 'server_commit',
            voice: config.dashscopeTtsVoice,
            response_format: 'pcm',
            sample_rate: config.dashscopeTtsSampleRate,
          },
        }));
      });

      ws.on('message', (data) => {
        let event;
        try { event = JSON.parse(data.toString()); } catch { return; }

        switch (event.type) {
          case 'session.created':
          case 'session.updated':
            ttsReady = true;
            flushPendingTts();
            resolve();
            break;
          case 'response.audio.delta':
            if (event.delta && connectionId === ttsConnectionId && activeTtsGenerationId === generationId) {
              if (currentTurnPerf
                  && currentTurnPerf.generationId === activeTtsGenerationId
                  && currentTurnPerf.first_tts_audio_ms == null) {
                currentTurnPerf.first_tts_audio_ms = Date.now() - currentTurnPerf.startTime;
                console.log(`[VoicePipeline-Perf] ${JSON.stringify({
                  sessionId,
                  generationId: activeTtsGenerationId,
                  phase: 'first_tts_audio',
                  first_tts_audio_ms: currentTurnPerf.first_tts_audio_ms,
                })}`);
              }
              sendBrowser({ type: 'tts_audio', data: event.delta });
              // Accumulate for saving as WAV file
              ttsAudioChunks.push(Buffer.from(event.delta, 'base64'));
            }
            break;
          case 'response.audio.done':
          case 'response.done':
            if (connectionId === ttsConnectionId && activeTtsGenerationId === generationId) {
              sendBrowser({ type: 'tts_sentence_end' });
            }
            break;
          case 'error':
            console.error('[VoicePipeline] TTS error:', event.error);
            break;
        }
      });

      ws.on('error', (err) => {
        if (connectionId !== ttsConnectionId) return;
        console.error('[VoicePipeline] TTS WS error:', err.message);
        resolve(); // Don't block pipeline if TTS fails
      });

      ws.on('close', () => {
        if (connectionId !== ttsConnectionId) return;
        ttsReady = false;
        ttsWs = null;
        // Auto-reconnect TTS if pipeline is still active
        if (sessionId) {
          console.log('[VoicePipeline] TTS disconnected, reconnecting in 2s...');
          setTimeout(() => {
            if (sessionId && !ttsWs) {
              connectTTS().catch(e => console.error('[VoicePipeline] TTS reconnect failed:', e.message));
            }
          }, 2000);
        }
      });

      // Timeout
      setTimeout(() => resolve(), 5000);
    });
  }

  function isStaleGeneration(turnGenerationId) {
    return turnGenerationId !== generationId || !sessionId;
  }

  function sendTextToTts(text, turnGenerationId) {
    if (!text || isStaleGeneration(turnGenerationId) || activeTtsGenerationId !== turnGenerationId) {
      return false;
    }

    if (!ttsWs || ttsWs.readyState !== WebSocket.OPEN || !ttsReady) {
      pendingTtsTexts.push({ text, generationId: turnGenerationId });
      console.warn('[VoicePipeline] TTS not ready, queued audio for:', text.substring(0, 30));
      if (sessionId && !ttsWs) {
        connectTTS().catch(e => console.error('[VoicePipeline] TTS reconnect for queued text failed:', e.message));
      }
      return false;
    }

    try {
      ttsWs.send(JSON.stringify({ type: 'input_text_buffer.append', text }));
      ttsWs.send(JSON.stringify({ type: 'input_text_buffer.commit' }));
      return true;
    } catch (e) {
      pendingTtsTexts.unshift({ text, generationId: turnGenerationId });
      console.warn('[VoicePipeline] TTS send failed, queued audio:', e.message);
      return false;
    }
  }

  function flushPendingTts() {
    if (!ttsReady || !ttsWs || ttsWs.readyState !== WebSocket.OPEN || pendingTtsTexts.length === 0) {
      return;
    }

    const queue = pendingTtsTexts;
    const remaining = [];
    pendingTtsTexts = [];

    for (const item of queue) {
      if (!item || item.generationId !== activeTtsGenerationId || isStaleGeneration(item.generationId)) {
        continue;
      }
      try {
        ttsWs.send(JSON.stringify({ type: 'input_text_buffer.append', text: item.text }));
        ttsWs.send(JSON.stringify({ type: 'input_text_buffer.commit' }));
      } catch (e) {
        remaining.push(item);
        console.warn('[VoicePipeline] TTS flush failed:', e.message);
        break;
      }
    }

    if (remaining.length > 0) {
      pendingTtsTexts = remaining.concat(pendingTtsTexts);
    }
  }

  function interruptCurrentTts() {
    ttsAudioChunks = [];
    pendingTtsTexts = [];
    activeTtsGenerationId = 0;
    currentTurnPerf = null;
    if (ttsWs) {
      try {
        ttsWs.send(JSON.stringify({ type: 'session.finish' }));
        ttsWs.close();
      } catch (e) {}
      ttsWs = null;
      ttsReady = false;
    }
    // Reconnect in the background for the next turn.
    if (sessionId) {
      connectTTS().catch(e => console.error('[VoicePipeline] TTS reconnect after interrupt failed:', e.message));
    }
  }

  function isDanglingVoiceSegment(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    return /(但是|可是|不过|然后|因为|所以|而且|但今天|但是今天|考完以后|说完以后)[。.!?？！,，\s]*$/.test(value)
      || (value.length <= 18 && /(但是|可是|不过|然后|因为|所以|今天|考完|以后)/.test(value));
  }

  function compactVoiceTurnSegments(segments) {
    return segments
      .map(s => String(s || '').trim())
      .filter(Boolean)
      .join('。')
      .replace(/。{2,}/g, '。')
      .replace(/([。！？])。/g, '$1')
      .trim();
  }

  function queueVoiceTurnSegment(asrText) {
    voiceTurnBuffer.push(asrText);
    const delay = isDanglingVoiceSegment(asrText) ? VOICE_TURN_DANGLING_GRACE_MS : VOICE_TURN_GRACE_MS;
    if (voiceTurnTimer) clearTimeout(voiceTurnTimer);

    if (processing) {
      interruptCurrentTts();
      sendBrowser({ type: 'tts_interrupt' });
    }

    voiceTurnTimer = setTimeout(() => {
      flushVoiceTurn().catch(e => {
        console.error('[VoicePipeline] flushVoiceTurn crashed:', e.message);
        sendBrowser({ type: 'error', message: 'Processing error' });
      });
    }, delay);
    console.log(`[VoicePipeline] Buffered ASR segment (${voiceTurnBuffer.length}, delay=${delay}ms): "${asrText.substring(0, 30)}"`);
  }

  async function flushVoiceTurn() {
    if (voiceTurnTimer) {
      clearTimeout(voiceTurnTimer);
      voiceTurnTimer = null;
    }
    if (!voiceTurnBuffer.length || !sessionId) return;

    const merged = compactVoiceTurnSegments(voiceTurnBuffer);
    voiceTurnBuffer = [];
    if (!merged) return;

    const turnGenerationId = ++generationId;
    if (processing) {
      pendingMessages.push(merged);
      interruptCurrentTts();
      sendBrowser({ type: 'tts_interrupt' });
      console.log(`[VoicePipeline] Queued merged voice turn (${pendingMessages.length}, generation=${turnGenerationId}): "${merged.substring(0, 40)}"`);
      return;
    }

    processing = true;
    try {
      await processStudentMessage(merged, turnGenerationId);
      while (pendingMessages.length > 0) {
        const nextMerged = compactVoiceTurnSegments(pendingMessages);
        pendingMessages = [];
        const mergedGenerationId = generationId;
        console.log(`[VoicePipeline] Processing ${nextMerged.length > 30 ? nextMerged.substring(0, 30) + '...' : nextMerged} (merged pending)`);
        await processStudentMessage(nextMerged, mergedGenerationId);
      }
    } catch (e) {
      console.error('[VoicePipeline] processStudentMessage crashed:', e.message);
      sendBrowser({ type: 'error', message: 'Processing error' });
    } finally {
      processing = false;
    }
  }
  /**
   * v1.007-05: Save student message to DB + push to teacher.
   * Called immediately on ASR final, even if pipeline is busy.
   * Ensures memory system always sees all student messages.
   */
  function saveStudentMessageToDB(text) {
    if (!sessionId || !studentId) return;
    const db = getDb();
    const messageNo = 'M' + Date.now() + '-' + crypto.randomUUID().substring(0, 8);
    try {
      const r = db.prepare(`
        INSERT INTO t_message (message_no, session_id, student_id, sender_type, input_type, content, content_source)
        VALUES (?, ?, ?, 'student', 'voice', ?, 'voice_pipeline')
      `).run(messageNo, sessionId, studentId, text);
      lastStudentMessageId = r.lastInsertRowid;
      const preview = text.length > 50 ? text.substring(0, 50) + '...' : text;
      db.prepare(`
        UPDATE t_consult_session
        SET message_count = message_count + 1,
            unread_count = unread_count + 1,
            last_message_time = datetime('now', 'localtime'),
            last_message_preview = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(preview, sessionId);
    } catch (e) {
      console.error('[VoicePipeline] Save student message failed:', e.message);
    }
    if (io) {
      const studentMsgData = {
        id: lastStudentMessageId,
        session_id: sessionId,
        student_id: studentId,
        sender_type: 'student',
        input_type: 'voice',
        content: text,
        content_source: 'voice_pipeline',
        audio_url: null,
        created_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }),
      };
      io.to(`session_${sessionId}`).emit('student:message', studentMsgData);
      io.to('teacher_room').emit('student:message', studentMsgData);
    }

    // Voice ASR final is a real student turn too. Keep Guardian's silence
    // lock and event-driven tick behavior aligned with the text pipeline.
    guardian.onStudentMessage(sessionId);
  }

  /**
   * Core pipeline: runtime (coordinator + memory + profile + trace) → TTS
   * DB save is already done by saveStudentMessageToDB before this is called.
   */
  async function processStudentMessage(text, turnGenerationId = generationId) {
    const startTime = Date.now();
    ttsAudioChunks = [];
    activeTtsGenerationId = turnGenerationId;
    currentTurnPerf = {
      generationId: turnGenerationId,
      startTime,
      first_sentence_ms: null,
      first_tts_audio_ms: null,
      sentence_count: 0,
    };

    // Notify browser
    if (isStaleGeneration(turnGenerationId)) return;
    sendBrowser({ type: 'thinking', generationId: turnGenerationId });

    // Step 2: Use the SAME runtime as text mode — streaming version
    // This runs: speculative cache check → coordinator → memory/profile → generator (streaming) → trace
    let fullContent = '';

    try {
      const stream = runSuggestionTurnStreaming({
        sessionId,
        studentId,
        latestMessage: text,
        mode: 'voice',
      });

      for await (const event of stream) {
        if (isStaleGeneration(turnGenerationId)) {
          console.log(`[VoicePipeline] Drop stale generation ${turnGenerationId}, current=${generationId}`);
          break;
        }

        switch (event.type) {
          case 'analysis':
            sendBrowser({ type: 'analysis', generationId: turnGenerationId, data: event.data });
            sendBrowser({ type: 'speaking', generationId: turnGenerationId });
            // Push coordinator analysis to teacher panel
            if (io) {
              io.to(`session_${sessionId}`).emit('coordinator:update', {
                session_id: sessionId,
                ...event.data,
                reason: event.data.guidance || event.data.reason,
              });
              io.to('teacher_room').emit('coordinator:update', {
                session_id: sessionId,
                ...event.data,
                reason: event.data.guidance || event.data.reason,
              });
            }
            break;

          case 'sentence':
            if (isStaleGeneration(turnGenerationId)) break;
            if (currentTurnPerf && currentTurnPerf.generationId === turnGenerationId) {
              currentTurnPerf.sentence_count += 1;
              if (currentTurnPerf.first_sentence_ms == null) {
                currentTurnPerf.first_sentence_ms = Date.now() - startTime;
              }
            }
            fullContent += event.data.text;
            sendBrowser({ type: 'sentence', generationId: turnGenerationId, text: event.data.text });
            sendTextToTts(event.data.text, turnGenerationId);
            break;

          case 'done':
            if (isStaleGeneration(turnGenerationId)) {
              console.log(`[VoicePipeline] Ignore stale done for generation ${turnGenerationId}`);
              break;
            }
            fullContent = event.data.fullContent || fullContent;
            const totalTime = Date.now() - startTime;
            const runtimePerf = event.data.perf || {};
            const voicePerf = {
              ...runtimePerf,
              first_sentence_ms: currentTurnPerf?.first_sentence_ms ?? null,
              first_tts_audio_ms: currentTurnPerf?.first_tts_audio_ms ?? null,
              sentence_count: currentTurnPerf?.sentence_count ?? 0,
              total_ms: totalTime,
            };
            console.log(`[VoicePipeline] Response complete in ${totalTime}ms (stopReason: ${event.data.stopReason})`);
            console.log(`[VoicePipeline-Perf] ${JSON.stringify({
              sessionId,
              generationId: turnGenerationId,
              stop_reason: event.data.stopReason,
              speculative_hit: !!event.data.speculativeHit,
              ...voicePerf,
            })}`);

            // Save AI response to DB (without audio_url — TTS still streaming)
            // saveTtsAudio() will UPDATE audio_url after all TTS chunks arrive
            if (sessionId && studentId && fullContent) {
              try {
                const db = getDb();
                const aiMsgNo = 'M' + Date.now() + '-' + crypto.randomUUID().substring(0, 8);
                const r = db.prepare(`
                  INSERT INTO t_message (message_no, session_id, student_id, sender_type, input_type, content, content_source)
                  VALUES (?, ?, ?, 'ai', 'voice', ?, 'voice_pipeline')
                `).run(aiMsgNo, sessionId, studentId, fullContent);
                lastAiMessageId = r.lastInsertRowid;
                aiMessageIdsByGeneration.set(turnGenerationId, lastAiMessageId);
              } catch (e) {
                console.error('[VoicePipeline] Save AI message failed:', e.message);
              }
            }

            // Push AI response to teacher via Socket.IO
            if (io && fullContent) {
              const aiMsgData = {
                id: aiMessageIdsByGeneration.get(turnGenerationId) || lastAiMessageId,
                session_id: sessionId,
                student_id: studentId,
                sender_type: 'ai',
                input_type: 'voice',
                content: fullContent,
                content_source: 'voice_pipeline',
                created_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }),
              };
              io.to(`session_${sessionId}`).emit('teacher:message', aiMsgData);
              io.to('teacher_room').emit('teacher:message', aiMsgData);
            }

            // Prepare Guardian branches for the student's next turn after the AI reply is saved.
            guardian.onAiResponseComplete(sessionId);

            // Notify browser text is done; frontend builds WAV from its own cache
            sendBrowser({
              type: 'response_done',
              generationId: turnGenerationId,
              data: {
                fullContent,
                coordTimeMs: totalTime,
                totalTimeMs: totalTime,
                speculativeHit: !!event.data.speculativeHit,
                perf: voicePerf,
              },
            });

            // v1.007-05: Delayed server-side audio save (wait for TTS to finish)
            // 3s delay covers typical TTS tail; frontend has its own cache regardless
            setTimeout(() => {
              if (!isStaleGeneration(turnGenerationId) && activeTtsGenerationId === turnGenerationId && ttsAudioChunks.length > 0) {
                saveTtsAudio(turnGenerationId);
              }
            }, 3000);
            break;

          case 'error':
            console.error('[VoicePipeline] Runtime error:', event.data.message);
            sendBrowser({ type: 'error', message: event.data.message });
            break;
        }
      }
    } catch (e) {
      console.error('[VoicePipeline] processStudentMessage error:', e.message);
      sendBrowser({ type: 'error', message: 'Processing error' });
    }
  }

  function cleanup() {
    if (voiceTurnTimer) {
      clearTimeout(voiceTurnTimer);
      voiceTurnTimer = null;
    }
    voiceTurnBuffer = [];
    if (sessionId && activeVoicePipelines.get(sessionId)?.streamGuardianProactiveAudio === streamGuardianProactiveAudio) {
      activeVoicePipelines.delete(sessionId);
    }
    if (ttsWs) {
      try {
        ttsWs.send(JSON.stringify({ type: 'session.finish' }));
        ttsWs.close();
      } catch (e) {}
      ttsWs = null;
    }
    pendingTtsTexts = [];
    ttsReady = false;
    sessionId = null;
    studentId = null;
  }

  function streamGuardianProactiveAudio(text, messageId) {
    if (!sessionId || !text) return false;
    if (activeTtsGenerationId && ttsAudioChunks.length > 0) saveTtsAudio(activeTtsGenerationId);
    const proactiveGenerationId = ++generationId;
    activeTtsGenerationId = proactiveGenerationId;
    currentTurnPerf = null;
    ttsAudioChunks = [];
    if (messageId) {
      lastAiMessageId = messageId;
      aiMessageIdsByGeneration.set(proactiveGenerationId, messageId);
    }

    sendBrowser({ type: 'speaking', generationId: proactiveGenerationId, source: 'guardian_proactive' });
    const sent = sendTextToTts(text, proactiveGenerationId);
    sendBrowser({ type: 'sentence', generationId: proactiveGenerationId, text });
    sendBrowser({
      type: 'response_done',
      generationId: proactiveGenerationId,
      data: {
        fullContent: text,
        stopReason: 'guardian_proactive',
        source: 'guardian_proactive',
      },
    });
    setTimeout(() => {
      if (activeTtsGenerationId === proactiveGenerationId && ttsAudioChunks.length > 0) {
        saveTtsAudio(proactiveGenerationId);
      }
    }, 3000);
    return sent || true;
  }

  function sendBrowser(msg) {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify(msg));
    }
  }
}

/**
 * Mount voice pipeline on HTTP server.
 */
function startVoicePipelineOnServer(server, io) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/ws/voice-pipeline') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('[VoicePipeline] Client connected');
        handlePipelineConnection(ws, io);
      });
    }
  });

  console.log('  Voice Pipeline: /ws/voice-pipeline (on main server)');
}

module.exports = {
  startVoicePipelineOnServer,
  streamGuardianProactiveAudio(sessionId, text, messageId) {
    const pipeline = activeVoicePipelines.get(Number(sessionId));
    if (!pipeline) return false;
    return pipeline.streamGuardianProactiveAudio(text, messageId);
  },
};



