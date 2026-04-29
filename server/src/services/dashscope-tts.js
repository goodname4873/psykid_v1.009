/**
 * DashScope Qwen3-TTS Realtime WebSocket Proxy - v1.007
 *
 * Browser (JSON) <--ws--> Proxy <--ws--> DashScope Qwen3-TTS Realtime API
 *
 * Protocol (DashScope realtime-style):
 *
 * Browser sends:
 *   { type: 'start', voice?: string, sampleRate?: number }  → session.update
 *   { type: 'text', content: string }                       → input_text_buffer.append
 *   { type: 'flush' }                                       → input_text_buffer.commit
 *   { type: 'stop' }                                        → session.finish
 *
 * Browser receives:
 *   { type: 'ready' }                     ← session.created
 *   { type: 'audio', data: base64PCM }    ← response.audio.delta
 *   { type: 'sentence_end' }             ← response.done
 *   { type: 'finished' }                 ← session.finished
 *   { type: 'error', message: string }    ← error
 */

const WebSocket = require('ws');
const config = require('./runtime/counseling-config');

const DASHSCOPE_TTS_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

/**
 * Handle one browser WebSocket connection for TTS.
 */
function handleTTSConnection(browserWs) {
  let dashscopeWs = null;
  let sessionStarted = false;

  browserWs.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      sendBrowser({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'start':
        startSession(msg);
        break;
      case 'text':
        if (dashscopeWs && sessionStarted) {
          dashscopeWs.send(JSON.stringify({
            type: 'input_text_buffer.append',
            text: msg.content || '',
          }));
        }
        break;
      case 'flush':
        if (dashscopeWs && sessionStarted) {
          dashscopeWs.send(JSON.stringify({
            type: 'input_text_buffer.commit',
          }));
        }
        break;
      case 'stop':
        if (dashscopeWs && sessionStarted) {
          dashscopeWs.send(JSON.stringify({ type: 'session.finish' }));
        }
        break;
      default:
        console.log('[DashScope-TTS] Unknown message type:', msg.type);
    }
  });

  browserWs.on('close', () => {
    if (dashscopeWs) {
      try { dashscopeWs.close(); } catch (e) {}
      dashscopeWs = null;
    }
  });

  browserWs.on('error', (err) => {
    console.error('[DashScope-TTS] Browser WS error:', err.message);
    if (dashscopeWs) {
      try { dashscopeWs.close(); } catch (e) {}
    }
  });

  function startSession(msg) {
    const apiKey = config.dashscopeApiKey;
    if (!apiKey) {
      sendBrowser({ type: 'error', message: 'DASHSCOPE_API_KEY not configured' });
      return;
    }

    const model = config.dashscopeTtsModel;
    const wsUrl = `${DASHSCOPE_TTS_WS_URL}?model=${model}`;

    dashscopeWs = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    dashscopeWs.on('open', () => {
      console.log('[DashScope-TTS] Connected to DashScope');

      // Configure session
      dashscopeWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          mode: 'server_commit',
          voice: msg.voice || config.dashscopeTtsVoice,
          response_format: 'pcm',
          sample_rate: msg.sampleRate || config.dashscopeTtsSampleRate,
        },
      }));
    });

    dashscopeWs.on('message', (data) => {
      let event;
      try {
        event = JSON.parse(data.toString());
      } catch (e) {
        return;
      }

      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          sessionStarted = true;
          sendBrowser({ type: 'ready' });
          break;

        case 'response.audio.delta':
          if (event.delta) {
            sendBrowser({ type: 'audio', data: event.delta });
          }
          break;

        case 'response.done':
          sendBrowser({ type: 'sentence_end' });
          break;

        case 'session.finished':
          sendBrowser({ type: 'finished' });
          sessionStarted = false;
          break;

        case 'error':
          console.error('[DashScope-TTS] API error:', event.error || event);
          sendBrowser({ type: 'error', message: event.error?.message || 'DashScope TTS error' });
          break;

        default:
          // Log unknown events for debugging
          if (event.type && !event.type.startsWith('response.')) {
            console.log('[DashScope-TTS] Event:', event.type);
          }
      }
    });

    dashscopeWs.on('error', (err) => {
      console.error('[DashScope-TTS] DashScope WS error:', err.message);
      sendBrowser({ type: 'error', message: 'TTS connection error: ' + err.message });
    });

    dashscopeWs.on('close', (code, reason) => {
      console.log('[DashScope-TTS] DashScope WS closed:', code, reason?.toString());
      sessionStarted = false;
      dashscopeWs = null;
    });
  }

  function sendBrowser(msg) {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify(msg));
    }
  }
}

/**
 * Mount TTS proxy on an HTTP server (shared with main app).
 */
function startDashscopeTTSOnServer(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/ws/dashscope-tts') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('[DashScope-TTS] Browser connected');
        handleTTSConnection(ws);
      });
    }
    // Don't handle other paths; let the remaining upgrade handlers process them.
  });

  console.log('  DashScope TTS:  /ws/dashscope-tts (on main server)');
}

/**
 * Start standalone TTS proxy (for testing).
 */
function startDashscopeTTSStandalone(port = 8767) {
  const wss = new WebSocket.Server({ port });
  wss.on('connection', (ws) => {
    console.log('[DashScope-TTS] Standalone client connected');
    handleTTSConnection(ws);
  });
  console.log(`  DashScope TTS:  ws://localhost:${port} (standalone)`);
}

module.exports = {
  startDashscopeTTSOnServer,
  startDashscopeTTSStandalone,
};
