/**
 * Frontend prompt cache for the v1.008 Agent voice pipeline.
 *
 * Legacy end-to-end voice helpers were removed from v1.008.
 * Voice mode now runs through /ws/voice-pipeline with DashScope ASR/TTS.
 */

import api from './api'

let promptCache = null

async function getPromptConfig() {
  if (promptCache) return promptCache

  try {
    const resp = await api.get('/api/ai/prompt-config')
    const data = resp.data?.data || resp.data
    promptCache = {
      COUNSELOR_SOUL: data.COUNSELOR_SOUL || '',
      SKILL_WEIGHT_GUIDE: data.SKILL_WEIGHT_GUIDE || '',
      STAGE_NAMES: data.STAGE_NAMES || {},
    }
  } catch (e) {
    console.warn('[aiAgent] Failed to fetch prompt config, using minimal fallback')
    promptCache = {
      COUNSELOR_SOUL: '你是小树洞，一位温暖的心理咨询师。简体中文，口语化，回复要短。',
      SKILL_WEIGHT_GUIDE: '',
      STAGE_NAMES: {
        listening: '倾听共情',
        cognitive: '认知引导',
        action: '行动策略',
        closing: '结束巩固',
      },
    }
  }

  return promptCache
}

export {
  getPromptConfig,
}
