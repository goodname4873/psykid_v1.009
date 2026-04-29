/**
 * DashScope Paraformer One-shot ASR Helper
 * v1.007-05
 *
 * Used by push-to-talk (PT) mode: upload full PCM audio, get final text.
 * Wraps the streaming WebSocket API into a single Promise.
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('./runtime/counseling-config');

const DASHSCOPE_ASR_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

/**
 * One-shot ASR via DashScope Paraformer WebSocket.
 * @param {Buffer} pcmBuffer - 16kHz PCM16 mono audio
 * @param {number} timeoutMs - default 10000
 * @returns {Promise<string>} recognized text
 */
function transcribePcm(pcmBuffer, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const apiKey = config.dashscopeApiKey;
    if (!apiKey) return reject(new Error('DASHSCOPE_API_KEY not configured'));

    const taskId = crypto.randomUUID();
    let finalText = '';
    let taskStarted = false;
    let settled = false;

    const ws = new WebSocket(DASHSCOPE_ASR_WS_URL, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error('ASR timeout'));
    }, timeoutMs);

    const done = (err, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) reject(err); else resolve(text || '');
    };

    ws.on('open', () => {
      // One-shot helper still uses the legacy inference protocol. Realtime voice
      // uses Qwen3 ASR through dashscope-asr.js; this fallback keeps old upload
      // ASR routes from breaking when DASHSCOPE_ASR_MODEL is qwen3-*.
      const model = /^qwen3-asr/i.test(config.dashscopeAsrModel || '')
        ? (process.env.DASHSCOPE_ONESHOT_ASR_MODEL || 'paraformer-realtime-v1')
        : (config.dashscopeAsrModel || 'paraformer-realtime-v1');
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model,
          parameters: { format: 'pcm', sample_rate: 16000, language_hints: ['zh', 'en'] },
          input: {},
        },
      }));
    });

    ws.on('message', (data) => {
      let event;
      try { event = JSON.parse(data.toString()); } catch { return; }
      const header = event.header || {};
      const payload = event.payload || {};

      switch (header.event) {
        case 'task-started':
          taskStarted = true;
          // Send all audio in chunks of 3200 bytes (100ms of 16kHz PCM16)
          const CHUNK = 3200;
          for (let i = 0; i < pcmBuffer.length; i += CHUNK) {
            const chunk = pcmBuffer.slice(i, i + CHUNK);
            ws.send(chunk, { binary: true });
          }
          // Send finish-task
          ws.send(JSON.stringify({
            header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: {} },
          }));
          break;

        case 'result-generated':
          const sentence = payload.output?.sentence || {};
          if (sentence.text && sentence.end_time != null) {
            finalText += sentence.text;
          }
          break;

        case 'task-finished':
          done(null, finalText.trim());
          break;

        case 'task-failed':
          done(new Error(header.error_message || 'ASR task failed'));
          break;
      }
    });

    ws.on('error', (err) => done(err));
    ws.on('close', () => {
      if (!settled) done(null, finalText.trim());
    });
  });
}

module.exports = { transcribePcm };
