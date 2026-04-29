/**
 * Shared chat-completion compatible AI API client
 * Extracted from routes/ai.js for reuse across services (summary, coordinator, etc.)
 */

async function callLLM(messages, options = {}) {
  const apiBase = process.env.AI_API_BASE || '';
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    throw new Error('AI_API_KEY not configured');
  }

  // apiBase may already include /v1 (e.g. DashScope compatible-mode/v1)
  const url = apiBase.endsWith('/v1') ? `${apiBase}/chat/completions` : `${apiBase}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || process.env.AI_MODEL || '',
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens || 500,
      enable_thinking: false,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`AI API ${response.status}: ${errBody}`);
  }

  const result = await response.json();
  return {
    content: result.choices?.[0]?.message?.content || '',
    model: result.model,
    usage: result.usage,
  };
}

/**
 * v1.007-05: callLLM with 1 retry on network failure (for coordinator calls).
 * Same interface as callLLM, just adds retry on fetch errors.
 */
async function callLLMWithRetry(messages, options = {}) {
  try {
    return await callLLM(messages, options);
  } catch (err) {
    if (err.message.includes('fetch failed') || err.message.includes('ECONNRESET') || err.message.includes('network')) {
      console.log('[AI] Coordinator retry after:', err.message);
      await new Promise(r => setTimeout(r, 500));
      return await callLLM(messages, options);
    }
    throw err;
  }
}

/**
 * Guardian-specific LLM client — uses separate API Key + account
 * to avoid RPM contention with main pipeline.
 */
async function callGuardianLLM(messages, options = {}) {
  const config = require('./runtime/counseling-config');
  const apiBase = config.guardianApiBase || config.apiBase;
  const apiKey = config.guardianApiKey || config.apiKey;

  if (!apiKey) throw new Error('GUARDIAN_API_KEY not configured');

  const url = apiBase.endsWith('/v1') ? `${apiBase}/chat/completions` : `${apiBase}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || config.guardianAnalyzerModel || '',
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens || 500,
      enable_thinking: false,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Guardian API ${response.status}: ${errBody}`);
  }

  const result = await response.json();
  return {
    content: result.choices?.[0]?.message?.content || '',
    model: result.model,
    usage: result.usage,
  };
}

function requestJsonOnce(url, apiKey, payload, timeoutMs = 60000, forcedIp = null) {
  const target = new URL(url);
  const client = target.protocol === 'http:' ? require('http') : require('https');
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      servername: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    };

    if (forcedIp) {
      requestOptions.lookup = (_hostname, options, callback) => {
        if (options?.all) callback(null, [{ address: forcedIp, family: 4 }]);
        else callback(null, forcedIp, 4);
      };
    }

    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => data,
          json: async () => JSON.parse(data),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Review API timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function postJsonWithNativeHttp(url, apiKey, payload, timeoutMs = 60000) {
  try {
    return await requestJsonOnce(url, apiKey, payload, timeoutMs);
  } catch (firstErr) {
    const target = new URL(url);
    const dns = require('dns').promises;
    const addressSet = new Set();
    try {
      const lookupAddresses = await dns.lookup(target.hostname, { all: true, family: 4 });
      lookupAddresses.forEach(item => addressSet.add(item.address));
      try {
        const resolved = await dns.resolve4(target.hostname);
        resolved.forEach(ip => addressSet.add(ip));
      } catch (e) {}
    } catch (e) {
      throw firstErr;
    }

    let lastErr = firstErr;
    for (const address of addressSet) {
      try {
        return await requestJsonOnce(url, apiKey, payload, timeoutMs, address);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
}

/**
 * Review expert LLM client — uses DeepSeek V4 Pro for cross-model validation.
 * It must not silently fall back to the main qwen pipeline, otherwise Expert
 * loses the cross-family independence it is designed for.
 */
async function callReviewLLM(messages, options = {}) {
  const config = require('./runtime/counseling-config');
  const apiBase = config.reviewApiBase;
  const apiKey = config.reviewApiKey;

  if (!apiKey) throw new Error('REVIEW_API_KEY not configured');

  const url = apiBase.endsWith('/v1') ? `${apiBase}/chat/completions` : `${apiBase}/v1/chat/completions`;
  const payload = {
    model: options.model || config.reviewModel || 'deepseek-v4-pro',
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.max_tokens || 500,
    thinking: options.thinking || { type: 'disabled' },
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (err.message.includes('fetch failed') || err.message.includes('ECONNRESET')) {
      console.warn('[AI] Review fetch transport failed, retrying with native HTTPS:', err.message);
      response = await postJsonWithNativeHttp(url, apiKey, payload);
    } else {
      throw err;
    }
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Review API ${response.status}: ${errBody}`);
  }

  const result = await response.json();
  return {
    content: result.choices?.[0]?.message?.content || '',
    model: result.model,
    usage: result.usage,
  };
}

module.exports = { callLLM, callLLMWithRetry, callGuardianLLM, callReviewLLM };
