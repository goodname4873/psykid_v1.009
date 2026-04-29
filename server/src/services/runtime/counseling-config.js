/**
 * Counseling Config - v1.007
 *
 * ALL model names and API settings read from .env.
 * Zero hardcoded model names. Switch providers by editing .env only.
 */

function buildCounselingConfig() {
  return Object.freeze({
    // --- LLM API (provider-agnostic chat-completion endpoint) ---
    apiKey: process.env.AI_API_KEY || '',
    apiBase: process.env.AI_API_BASE || '',

    // --- Main pipeline models ---
    coordinatorModel: process.env.COORDINATOR_MODEL || '',
    generatorModel: process.env.AI_MODEL || '',

    // --- Service models (summary/thread/profile/scheduler) ---
    threadModel: process.env.THREAD_MODEL || process.env.AI_MODEL || '',
    profileModel: process.env.PROFILE_MODEL || process.env.AI_MODEL || '',
    schedulerModel: process.env.SCHEDULER_MODEL || process.env.AI_MODEL || '',

    // --- Guardian models ---
    guardianAnalyzerModel: process.env.GUARDIAN_ANALYZER_MODEL || process.env.AI_MODEL || '',
    guardianGeneratorModel: process.env.GUARDIAN_GENERATOR_MODEL || process.env.AI_MODEL || '',
    guardianMatcherModel: process.env.GUARDIAN_MATCHER_MODEL || process.env.COORDINATOR_MODEL || '',

    // --- Guardian API (separate account to avoid RPM contention) ---
    guardianApiKey: process.env.GUARDIAN_API_KEY || process.env.AI_API_KEY || '',
    guardianApiBase: process.env.GUARDIAN_API_BASE || process.env.AI_API_BASE || '',

    // --- Token budgets ---
    coordinatorMaxTokens: 1000,
    generatorMaxTokens: 500,
    rollingMaxTokens: 600,
    finalMaxTokens: 800,
    threadMaxTokens: 600,
    profileMaxTokens: 500,

    // --- Temperature ---
    coordinatorTemperature: 0.7,
    generatorTemperature: undefined,
    summaryTemperature: 0.3,

    // --- Context assembly ---
    recentMessageLimit: 8,
    recentForAgentLimit: 6,
    crossSessionLimit: 3,
    fragmentRetrievalLimit: 10,

    // --- Compaction triggers ---
    rollingTriggerInterval: 8,
    threadMinMessages: 3,

    // --- Confidence thresholds ---
    confidenceFallbackThreshold: 0.6,
    profileConfidenceThreshold: 0.4,

    // --- DashScope voice services ---
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
    dashscopeTtsModel: process.env.DASHSCOPE_TTS_MODEL || 'qwen3-tts-flash-realtime',
    dashscopeAsrModel: process.env.DASHSCOPE_ASR_MODEL || 'qwen3-asr-flash-realtime',
    dashscopeAsrWsUrl: process.env.DASHSCOPE_ASR_WS_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    dashscopeTtsVoice: process.env.DASHSCOPE_TTS_VOICE || 'Cherry',
    dashscopeTtsSampleRate: 24000,

    // --- Review expert (DeepSeek V4 Pro, cross-model validation) ---
    reviewApiKey: process.env.REVIEW_API_KEY || '',
    reviewApiBase: process.env.REVIEW_API_BASE || '',
    reviewModel: process.env.REVIEW_MODEL || 'deepseek-v4-pro',

    // --- Feature flags ---
    fragmentRetrievalEnabled: true,
    traceEnabled: true,
    guardianEnabled: true,
  });
}

const config = buildCounselingConfig();

module.exports = config;
