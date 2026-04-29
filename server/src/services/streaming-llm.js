/**
 * Streaming LLM Client - v1.007
 *
 * Streaming version of callLLM using SSE (Server-Sent Events).
 * Uses the configured chat-completion provider and supports stream: true.
 *
 * Returns an async generator yielding text deltas.
 */

const config = require('./runtime/counseling-config');

/**
 * Call LLM with streaming. Yields text chunks as they arrive.
 *
 * @param {Array} messages - Chat messages [{role, content}]
 * @param {Object} options - { model, temperature, max_tokens }
 * @yields {string} Text delta chunks
 * @returns {Object} Final usage stats via .usage property on the generator
 */
async function* callLLMStreaming(messages, options = {}) {
  const apiBase = config.apiBase;
  const apiKey = config.apiKey;

  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    throw new Error('AI_API_KEY not configured');
  }

  const url = apiBase.endsWith('/v1') ? `${apiBase}/chat/completions` : `${apiBase}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || config.generatorModel,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens || 500,
      stream: true,
      enable_thinking: false,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`AI API ${response.status}: ${errBody}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let model = '';
  let usage = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));

          if (json.model) model = json.model;

          // Extract usage from final chunk (some providers include it)
          if (json.usage) usage = json.usage;

          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            yield delta.content;
          }
        } catch (e) {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Attach metadata to the generator's return value
  // Callers can access via: const gen = callLLMStreaming(...); for await (const chunk of gen) {...}; gen.meta
  // But since generators don't have post-iteration access easily, we store on a shared ref
  callLLMStreaming._lastResult = {
    content: fullContent,
    model,
    usage,
  };
}

/**
 * Helper: Collect streaming output into sentence-sized chunks.
 * Buffers text and yields when a sentence boundary is detected.
 *
 * @param {AsyncGenerator} stream - From callLLMStreaming
 * @yields {{ text: string, isPartial: boolean }}
 */
async function* collectSentences(stream) {
  let buffer = '';
  const sentenceEnders = /[。！？\n.!?]/;

  for await (const chunk of stream) {
    buffer += chunk;

    // Check if buffer contains a complete sentence
    let lastEnd = -1;
    for (let i = 0; i < buffer.length; i++) {
      if (sentenceEnders.test(buffer[i])) {
        lastEnd = i;
      }
    }

    if (lastEnd >= 0) {
      const sentence = buffer.substring(0, lastEnd + 1).trim();
      buffer = buffer.substring(lastEnd + 1);
      if (sentence) {
        yield { text: sentence, isPartial: false };
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    yield { text: buffer.trim(), isPartial: true };
  }
}

module.exports = {
  callLLMStreaming,
  collectSentences,
};
