/**
 * DashScope Realtime ASR WebSocket Proxy - v1.009
 *
 * Browser (PCM audio) <--ws--> Proxy <--ws--> DashScope Qwen3 ASR Realtime
 *
 * Protocol:
 *
 * Browser sends:
 *   { type: 'start', sampleRate?: number }   → session.update / run-task
 *   binary PCM 16-bit frames                 → input_audio_buffer.append / audio payload
 *   { type: 'stop' }                         → session.finish / finish-task
 *
 * Browser receives:
 *   { type: 'ready' }                        ← task-started
 *   { type: 'partial', text: string }        ← 中间识别结果
 *   { type: 'final', text: string }          ← 最终识别结果（一句话完成）
 *   { type: 'finished' }                     ← task-finished
 *   { type: 'error', message: string }       ← error
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('./runtime/counseling-config');

const DASHSCOPE_LEGACY_ASR_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

function isQwen3AsrModel(model) {
  return /^qwen3-asr/i.test(String(model || ''));
}

/**
 * Handle one browser WebSocket connection for ASR.
 */
function handleASRConnection(browserWs) {
  let dashscopeWs = null;
  let taskId = null;
  let taskStarted = false;
  let finalizedText = '';        // Accumulated finalized text
  let silenceTimer = null;
  let reconnectAttempts = 0;     // v1.007-05: exp backoff counter
  let asrMode = 'legacy';
  const SILENCE_FLUSH_MS = 800;
  const MAX_RECONNECT_ATTEMPTS = 5;

  let audioFrameCount = 0;
  browserWs.on('message', (raw, isBinary) => {
    if (isBinary) {
      audioFrameCount++;
      if (audioFrameCount === 1) console.log('[DashScope-ASR] First audio frame from browser, size:', raw.length);
      if (audioFrameCount % 100 === 0) console.log('[DashScope-ASR] Audio frames:', audioFrameCount);
      // Binary = PCM audio frame → forward to DashScope
      if (dashscopeWs && taskStarted) {
        if (asrMode === 'qwen3') {
          dashscopeWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: Buffer.from(raw).toString('base64'),
          }));
        } else {
          dashscopeWs.send(raw, { binary: true });
        }
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      sendBrowser({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'start':
        startTask(msg);
        break;
      case 'stop':
        finishTask();
        break;
      default:
        console.log('[DashScope-ASR] Unknown message type:', msg.type);
    }
  });

  browserWs.on('close', () => {
    if (dashscopeWs) {
      try { dashscopeWs.close(); } catch (e) {}
      dashscopeWs = null;
    }
  });

  browserWs.on('error', (err) => {
    console.error('[DashScope-ASR] Browser WS error:', err.message);
    if (dashscopeWs) {
      try { dashscopeWs.close(); } catch (e) {}
    }
  });

  function startTask(msg) {
    const apiKey = config.dashscopeApiKey;
    if (!apiKey) {
      sendBrowser({ type: 'error', message: 'DASHSCOPE_API_KEY not configured' });
      return;
    }

    if (isQwen3AsrModel(config.dashscopeAsrModel)) {
      startQwen3Task(msg);
      return;
    }

    asrMode = 'legacy';
    taskId = crypto.randomUUID();

    dashscopeWs = new WebSocket(DASHSCOPE_LEGACY_ASR_WS_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    dashscopeWs.on('open', () => {
      console.log('[DashScope-ASR] Connected to DashScope');

      // Send run-task
      const sampleRate = msg.sampleRate || 16000;
      dashscopeWs.send(JSON.stringify({
        header: {
          action: 'run-task',
          task_id: taskId,
          streaming: 'duplex',
        },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: config.dashscopeAsrModel,
          parameters: {
            format: 'pcm',
            sample_rate: sampleRate,
            language_hints: ['zh', 'en'],
          },
          input: {},
        },
      }));
    });

    dashscopeWs.on('message', (data, isBinary) => {
      if (isBinary) return;

      let event;
      try {
        event = JSON.parse(data.toString());
      } catch (e) {
        return;
      }

      const header = event.header || {};
      const payload = event.payload || {};
      if (header.event === 'result-generated') {
        const s = payload.output?.sentence || {};
        console.log('[DashScope-ASR] result:', JSON.stringify({ text: s.text?.substring(0,30), sentence_end: s.sentence_end, end_time: s.end_time, sentence_id: s.sentence_id }));
      } else {
        console.log('[DashScope-ASR] event:', header.event || header.action || 'unknown', header.error_code || '');
      }

      switch (header.event) {
        case 'task-started':
          taskStarted = true;
          reconnectAttempts = 0;  // v1.007-05: reset on successful start
          sendBrowser({ type: 'ready' });
          break;

        case 'result-generated': {
          const output = payload.output || {};
          const sentence = output.sentence || {};

          if (sentence.text) {
            // end_time !== null = 这句话说完了（final）
            // end_time === null = 还在说（partial）
            const isFinal = sentence.end_time !== undefined && sentence.end_time !== null;

            if (isFinal) {
              // 这句话说完了，累积到 finalizedText
              finalizedText += sentence.text;
              sendBrowser({ type: 'partial', text: finalizedText });

              // 0.8s 没有新句子就认为整段话说完了，发 final
              if (silenceTimer) clearTimeout(silenceTimer);
              silenceTimer = setTimeout(() => {
                if (finalizedText.trim()) {
                  sendBrowser({ type: 'final', text: finalizedText.trim() });
                  finalizedText = '';
                }
              }, SILENCE_FLUSH_MS);
            } else {
              // 还在说，显示实时文字
              sendBrowser({ type: 'partial', text: finalizedText + sentence.text });
            }
          }
          break;
        }

        case 'task-finished':
          if (silenceTimer) clearTimeout(silenceTimer);
          if (finalizedText.trim()) {
            sendBrowser({ type: 'final', text: finalizedText.trim() });
            finalizedText = '';
          }
          sendBrowser({ type: 'finished' });
          taskStarted = false;
          break;

        case 'task-failed':
          console.error('[DashScope-ASR] Task failed:', header.error_code, header.error_message);
          sendBrowser({ type: 'error', message: header.error_message || 'ASR task failed' });
          taskStarted = false;
          break;

        default:
          if (header.event) {
            console.log('[DashScope-ASR] Event:', header.event);
          }
      }
    });

    dashscopeWs.on('error', (err) => {
      console.error('[DashScope-ASR] DashScope WS error:', err.message);
      // v1.007-05: Notify browser with recoverable flag so it knows task hasn't started
      sendBrowser({
        type: 'asr_unavailable',
        message: 'ASR 上游暂时不可达，正在重试...',
        recoverable: true,
        reason: err.message,
      });
    });

    dashscopeWs.on('close', (code, reason) => {
      console.log('[DashScope-ASR] DashScope WS closed:', code, reason?.toString() || '', 'taskStarted:', taskStarted);
      const wasStarted = taskStarted;
      taskStarted = false;
      dashscopeWs = null;

      // v1.007-05: If task was never started (connection failed), use exponential backoff with cap
      if (browserWs && browserWs.readyState === WebSocket.OPEN) {
        if (!wasStarted && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.log(`[DashScope-ASR] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
          sendBrowser({
            type: 'asr_unavailable',
            message: 'ASR 持续不可达，请检查网络',
            recoverable: false,
            reason: 'max_retries_exceeded',
          });
          return;
        }

        const delay = wasStarted ? 2000 : Math.min(2000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        console.log(`[DashScope-ASR] Auto-reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        setTimeout(() => {
          if (browserWs && browserWs.readyState === WebSocket.OPEN && !dashscopeWs) {
            startTask({ sampleRate: 16000 });
          }
        }, delay);
      }
    });
  }

  function startQwen3Task(msg) {
    asrMode = 'qwen3';
    taskId = crypto.randomUUID();
    finalizedText = '';

    const model = config.dashscopeAsrModel;
    const wsUrl = `${config.dashscopeAsrWsUrl}?model=${encodeURIComponent(model)}`;
    const betaHeaderName = ['Open', 'AI-Beta'].join('');
    dashscopeWs = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${config.dashscopeApiKey}`,
        [betaHeaderName]: 'realtime=v1',
      },
    });

    dashscopeWs.on('open', () => {
      console.log(`[Qwen3-ASR] Connected to DashScope realtime (${model})`);
      const sampleRate = msg.sampleRate || 16000;
      dashscopeWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          input_audio_format: 'pcm',
          sample_rate: sampleRate,
          input_audio_transcription: { model },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            silence_duration_ms: 700,
          },
        },
      }));
    });

    dashscopeWs.on('message', (data, isBinary) => {
      if (isBinary) return;
      let event;
      try { event = JSON.parse(data.toString()); } catch { return; }
      const type = event.type || event.event || '';

      switch (type) {
        case 'session.created':
        case 'session.updated':
          taskStarted = true;
          reconnectAttempts = 0;
          sendBrowser({ type: 'ready' });
          break;

        case 'conversation.item.input_audio_transcription.text':
        case 'response.audio_transcript.delta':
        case 'transcription.text.delta': {
          const text = event.text || event.delta || event.transcript || '';
          if (text) {
            finalizedText = text;
            sendBrowser({ type: 'partial', text });
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.completed':
        case 'input_audio_transcription.completed':
        case 'transcription.completed': {
          const text = (event.transcript || event.text || finalizedText || '').trim();
          if (text) {
            sendBrowser({ type: 'partial', text });
            sendBrowser({ type: 'final', text });
          }
          finalizedText = '';
          break;
        }

        case 'input_audio_buffer.speech_stopped':
          // Qwen3 realtime server VAD commits the segment itself. A second manual
          // commit causes "invalid audio stream" errors on short utterances.
          break;

        case 'session.finished':
          sendBrowser({ type: 'finished' });
          taskStarted = false;
          break;

        case 'error':
          console.error('[Qwen3-ASR] error:', event.error || event);
          sendBrowser({ type: 'error', message: event.error?.message || event.message || 'Qwen3 ASR error' });
          break;

        default:
          if (type) console.log('[Qwen3-ASR] event:', type);
      }
    });

    dashscopeWs.on('error', (err) => {
      console.error('[Qwen3-ASR] WS error:', err.message);
      sendBrowser({
        type: 'asr_unavailable',
        message: 'Qwen3 ASR 上游暂时不可达，正在重试...',
        recoverable: true,
        reason: err.message,
      });
    });

    dashscopeWs.on('close', (code, reason) => {
      console.log('[Qwen3-ASR] closed:', code, reason?.toString() || '', 'taskStarted:', taskStarted);
      const wasStarted = taskStarted;
      taskStarted = false;
      dashscopeWs = null;
      if (browserWs && browserWs.readyState === WebSocket.OPEN) {
        if (!wasStarted && reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          sendBrowser({
            type: 'asr_unavailable',
            message: 'Qwen3 ASR 持续不可达，请检查网络',
            recoverable: false,
            reason: 'max_retries_exceeded',
          });
          return;
        }
        const delay = wasStarted ? 2000 : Math.min(2000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        setTimeout(() => {
          if (browserWs && browserWs.readyState === WebSocket.OPEN && !dashscopeWs) {
            startTask({ sampleRate: 16000 });
          }
        }, delay);
      }
    });
  }

  function finishTask() {
    if (dashscopeWs && taskStarted && taskId) {
      if (asrMode === 'qwen3') {
        try { dashscopeWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); } catch (e) {}
        try { dashscopeWs.send(JSON.stringify({ type: 'session.finish' })); } catch (e) {}
        return;
      }
      dashscopeWs.send(JSON.stringify({
        header: {
          action: 'finish-task',
          task_id: taskId,
          streaming: 'duplex',
        },
        payload: {
          input: {},
        },
      }));
    }
  }

  function sendBrowser(msg) {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify(msg));
    }
  }
}

/**
 * Mount ASR proxy on an HTTP server.
 */
function startDashscopeASROnServer(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/ws/dashscope-asr') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('[DashScope-ASR] Browser connected');
        handleASRConnection(ws);
      });
    }
  });

  console.log('  DashScope ASR:  /ws/dashscope-asr (on main server)');
}

module.exports = {
  startDashscopeASROnServer,
};
