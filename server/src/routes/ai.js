const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../models/db');
const { authRequired, teacherRequired } = require('../middleware/auth');
const { success, error } = require('../utils/response');
const { callLLM, callReviewLLM } = require('../services/ai-client');
const { generateRollingSummary, extractSessionThread } = require('../services/summary');
const { runSuggestionTurn } = require('../services/runtime/counseling-runtime');
const { writeInterventionFeedback } = require('../services/runtime/suggestion-trace');
const guardian = require('../services/guardian/guardian-service');
const openLoopManager = require('../services/runtime/open-loop-manager');
const {
  COUNSELOR_SOUL,
  COORDINATOR_PROMPT,
  SKILL_WEIGHT_GUIDE,
  STAGE_NAMES,
} = require('../services/runtime/prompt-constants');

const router = express.Router();

router.use(authRequired);

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function getCachedSuggestionForTrigger(db, sessionId, triggerMessageId) {
  if (!triggerMessageId) return null;
  const row = db.prepare(`
    SELECT id, analysis_json, suggestions_json, usage_json, coordinator_model, generator_model, created_at
    FROM t_ai_suggestion_trace
    WHERE session_id = ? AND trigger_message_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(sessionId, triggerMessageId);
  if (!row) return null;

  const suggestions = safeJsonParse(row.suggestions_json, []);
  return {
    suggestion: suggestions?.[0]?.content || '',
    suggestions,
    analysis: safeJsonParse(row.analysis_json, null),
    suggestionTraceId: row.id,
    model: row.generator_model || row.coordinator_model || 'cached',
    usage: safeJsonParse(row.usage_json, {}),
    cached: true,
    cachedAt: row.created_at,
  };
}

// POST /api/ai/analyze - Coordinator analysis (frontend proxy for realtime voice)
// Replaces direct frontend→ViVaAPI call in aiAgent.js analyzeWithCoordinator()
router.post('/analyze', async (req, res) => {
  try {
    const { student_message, conversation_history = [] } = req.body;

    if (!student_message) {
      return error(res, '学生消息不能为空');
    }

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
      return success(res, {
        stage: 'listening',
        emotion: '未知',
        distortion: null,
        activeAgent: 'listening',
        studentNeed: '',
        strategy: '',
        reason: 'AI API未配置，默认倾听',
      });
    }

    // Build history text from conversation_history [{role, content}]
    const historyText = conversation_history.slice(-6).map(m =>
      `${m.role === 'user' ? '学生' : 'AI'}: ${m.content}`
    ).join('\n');

    const coordResult = await callLLM([
      { role: 'system', content: COORDINATOR_PROMPT },
      { role: 'user', content: `对话历史:\n${historyText}\n\n学生最新消息: ${student_message}\n\n请分析并输出JSON:` },
    ], { model: require('../services/runtime/counseling-config').coordinatorModel, temperature: 0.7, max_tokens: 800 });

    const jsonMatch = coordResult.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // v1.005: Write emotion to last student message if available
      if (parsed.emotion && typeof parsed.emotion === 'object' && parsed.emotion.intensity) {
        try {
          const db = getDb();
          // Find the session for this student message to write emotion data
          const lastMsg = db.prepare(`
            SELECT m.id, m.session_id FROM t_message m
            WHERE m.sender_type = 'student' AND m.content = ?
            ORDER BY m.id DESC LIMIT 1
          `).get(student_message);
          if (lastMsg) {
            db.prepare(`
              UPDATE t_message SET emotion_intensity = ?, emotion_label = ?
              WHERE id = ?
            `).run(parsed.emotion.intensity, parsed.emotion.primary, lastMsg.id);
          }
        } catch (e) {
          // Non-fatal: emotion write failed
          console.log('[AI] Emotion write to message failed:', e.message);
        }
      }

      return success(res, {
        // v1.005 新格式
        skillWeights: parsed.skillWeights || null,
        emotion: parsed.emotion || { primary: '未知', intensity: 5, trend: '→' },
        confidence: parsed.confidence || 0.8,
        guidance: parsed.guidance || '',
        mirrorCues: parsed.mirrorCues || '',
        suggestions: parsed.suggestions || null,
        continueIf: parsed.continueIf || null,
        // 向后兼容
        stage: parsed.stage || 'listening',
        activeAgent: parsed.stage || 'listening',
        studentNeed: parsed.studentNeed || '',
        strategy: parsed.responseStrategy || parsed.guidance || '',
        reason: parsed.reason || '分析完成',
      });
    }

    // JSON parse failed, return default
    return success(res, {
      skillWeights: { empathy: 0.8, cognitive: 0.1, action: 0.1, closing: 0 },
      emotion: { primary: '未知', intensity: 5, trend: '→' },
      confidence: 0.5,
      guidance: '协调器返回格式异常，使用安全倾听模式',
      mirrorCues: '',
      suggestions: null,
      continueIf: null,
      stage: 'listening',
      activeAgent: 'listening',
      studentNeed: '',
      strategy: '',
      reason: '协调器返回格式异常，默认倾听',
    });
  } catch (err) {
    console.error('AI analyze error:', err);
    return error(res, 'AI分析失败', -1, 500);
  }
});

// POST /api/ai/suggest - Generate AI suggestion
// v1.006: Delegates to counseling-runtime.runSuggestionTurn()
router.post('/suggest', teacherRequired, async (req, res) => {
  try {
    const { session_id, message_content, trigger_message_id, if_not_analyzed = false } = req.body;

    if (!session_id) {
      return error(res, '会话ID不能为空');
    }

    const runtimeConfig = require('../services/runtime/counseling-config');
    if (!runtimeConfig.apiKey || runtimeConfig.apiKey === 'YOUR_API_KEY_HERE') {
      return success(res, {
        suggestion: '我理解你现在的感受。你愿意和我多说说吗？我在这里倾听你。',
        analysis: { stage: 'listening', stageName: '倾听共情', emotion: '未知', reason: 'AI API未配置' },
        model: 'fallback',
        stopReason: 'api_not_configured',
      });
    }

    const db = getDb();
    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(session_id);
    if (!session) {
      return error(res, '会话不存在');
    }

    if (if_not_analyzed && trigger_message_id) {
      const cached = getCachedSuggestionForTrigger(db, parseInt(session_id), parseInt(trigger_message_id));
      if (cached) {
        return success(res, {
          ...cached,
          triggerMessageId: parseInt(trigger_message_id),
          stopReason: 'already_analyzed',
        });
      }
    }

    const result = await runSuggestionTurn({
      sessionId: parseInt(session_id),
      studentId: session.student_id,
      latestMessage: message_content || undefined,
    });

    if (result.error) {
      return error(res, result.error);
    }

    return success(res, {
      suggestion: result.suggestion,
      suggestions: result.suggestions,
      continueIf: result.continueIf,
      stopReason: result.stopReason,
      speculativeHit: result.speculativeHit || false,
      speculativeSavedMs: result.speculativeSavedMs || 0,
      analysis: result.analysis,
      triggerMessage: result.triggerMessage,
      suggestionTraceId: result.suggestionTraceId || null,
      model: result.model,
      usage: result.usage,
      context: result.contextMeta,
    });
  } catch (err) {
    console.error('AI suggest error:', err);
    return error(res, 'AI建议生成失败', -1, 500);
  }
});

// POST /api/ai/review - AI审视：用 DeepSeek Expert 交叉验证 QWEN 的回复是否合适
// v1.007-04: 教师手动触发，不自动，省token
router.post('/review', teacherRequired, async (req, res) => {
  try {
    const { session_id, suggestion_content } = req.body;

    if (!session_id || !suggestion_content) {
      return error(res, '会话ID和建议内容不能为空');
    }

    const reviewConfig = require('../services/runtime/counseling-config');
    if (!reviewConfig.reviewApiKey) {
      return error(res, 'REVIEW_API_KEY 未配置，无法使用审视功能');
    }

    const db = getDb();
    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(session_id);
    if (!session) {
      return error(res, '会话不存在');
    }

    // Assemble review context: profile + recent 8 messages + rolling summary
    const studentId = session.student_id;

    // 1. Student profile
    let profileText = '';
    try {
      const profile = db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId);
      if (profile) {
        const parts = [];
        if (profile.communication_style) parts.push(`沟通风格: ${profile.communication_style}`);
        if (profile.primary_concerns) parts.push(`核心议题: ${profile.primary_concerns}`);
        if (profile.sensitive_topics) parts.push(`注意回避: ${profile.sensitive_topics}`);
        if (profile.emotional_pattern) parts.push(`情绪基线: ${profile.emotional_pattern}`);
        if (parts.length > 0) profileText = `== 学生画像 ==\n${parts.join('\n')}`;
      }
    } catch (e) { /* profile may not exist */ }

    // 2. Recent 8 messages
    const recentMessages = db.prepare(`
      SELECT sender_type, content FROM t_message
      WHERE session_id = ? ORDER BY id DESC LIMIT 8
    `).all(session_id);
    recentMessages.reverse();
    const recentText = recentMessages.map(m => {
      const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
      return `${role}: ${m.content}`;
    }).join('\n');

    // 3. Rolling summary (latest)
    let rollingSummary = '';
    try {
      const rolling = db.prepare(`
        SELECT raw_summary FROM t_session_summary
        WHERE session_id = ? AND summary_type = 'rolling'
        ORDER BY id DESC LIMIT 1
      `).get(session_id);
      if (rolling) rollingSummary = `== 对话摘要 ==\n${rolling.raw_summary}`;
    } catch (e) { /* may not exist */ }

    // Build review prompt
    const REVIEW_PROMPT = `你是心理咨询质量审查员。请审视 AI 的回复是否合适。

## 审查标准
1. 回复是否与学生最近说的话事实一致？（不能答非所问）
2. 回复的方向是否贴合学生的具体情境？（背书的不能说做题）
3. 回复是否有编造学生没提过的事？
4. 回复的语气是否适当？（不过度安慰也不过度严肃）

## 输出 JSON
{
  "pass": true/false,
  "issues": ["问题1", "问题2"],
  "suggestion": "如果不通过，给出修正方向（不是完整回复）",
  "confidence": 0-1
}`;

    const contextParts = [];
    if (profileText) contextParts.push(profileText);
    if (rollingSummary) contextParts.push(rollingSummary);
    contextParts.push(`== 最近对话 ==\n${recentText}`);
    contextParts.push(`== 待审视的 AI 建议回复 ==\n${suggestion_content}`);

    const result = await callReviewLLM([
      { role: 'system', content: REVIEW_PROMPT },
      { role: 'user', content: contextParts.join('\n\n') },
    ], {
      model: reviewConfig.reviewModel,
      temperature: 0.3,
      max_tokens: 500,
    });

    // Parse JSON response
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return success(res, {
        pass: !!parsed.pass,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestion: parsed.suggestion || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        model: result.model,
        usage: result.usage,
      });
    }

    // JSON parse failed
    return success(res, {
      pass: false,
      issues: ['审视模型返回格式异常'],
      suggestion: result.content,
      confidence: 0,
      model: result.model,
    });
  } catch (err) {
    console.error('AI review error:', err);
    return error(res, 'AI审视失败: ' + err.message, -1, 500);
  }
});

// POST /api/ai/regenerate - 教师引导重生成
// v1.007-05: 改由 Expert 直接生成单条回复
// 不再走协调器管道 — 教师已经给了明确方向，Expert 直接按引导生成，更快且当 DashScope 故障时仍可用
router.post('/regenerate', teacherRequired, async (req, res) => {
  try {
    const { session_id, teacher_guidance, original_suggestion } = req.body;
    if (!session_id || !teacher_guidance) {
      return error(res, '会话ID和教师引导不能为空');
    }

    const runtimeConfig = require('../services/runtime/counseling-config');
    if (!runtimeConfig.reviewApiKey) {
      return error(res, 'Expert API 未配置', -1, 500);
    }

    const db = getDb();
    const session = db.prepare('SELECT * FROM t_consult_session WHERE id = ?').get(session_id);
    if (!session) return error(res, '会话不存在');
    const studentId = session.student_id;

    // Assemble lightweight context (same as review: profile + recent + rolling)
    let profileText = '';
    try {
      const profile = db.prepare('SELECT * FROM t_student_profile WHERE student_id = ?').get(studentId);
      if (profile) {
        const parts = [];
        if (profile.communication_style) parts.push(`沟通风格: ${profile.communication_style}`);
        if (profile.primary_concerns) parts.push(`核心议题: ${profile.primary_concerns}`);
        if (profile.sensitive_topics) parts.push(`注意回避: ${profile.sensitive_topics}`);
        if (parts.length) profileText = `== 学生画像 ==\n${parts.join('\n')}`;
      }
    } catch (e) { /* ignore */ }

    const recentMessages = db.prepare(
      `SELECT sender_type, content FROM t_message WHERE session_id = ? ORDER BY id DESC LIMIT 8`
    ).all(session_id);
    recentMessages.reverse();
    const recentText = recentMessages.map(m => {
      const role = m.sender_type === 'student' ? '学生' : m.sender_type === 'teacher' ? '教师' : 'AI';
      return `${role}: ${m.content}`;
    }).join('\n');

    let rollingSummary = '';
    try {
      const rolling = db.prepare(
        `SELECT raw_summary FROM t_session_summary WHERE session_id = ? AND summary_type = 'rolling' ORDER BY id DESC LIMIT 1`
      ).get(session_id);
      if (rolling) rollingSummary = `== 对话摘要 ==\n${rolling.raw_summary}`;
    } catch (e) { /* ignore */ }

    // v1.007-05 改进：Expert 先分析再生成（两步合一）
    // 1. 分析：学生最近对话 + 教师不满意的原版（若有）+ 教师引导方向
    // 2. 生成：按分析结果产出单条回复 + 结构化分析字段
    const GENERATE_PROMPT = `你是心理咨询质量专家兼回复生成器。一位教师对之前 AI 的回复不满意，给出了明确的方向指导。

## 你的任务（两步）
第一步：快速分析当前对话情境
  - 识别学生当前的情绪（类型、强度 1-10、趋势）
  - 对照教师引导判断原版回复哪里不对（若提供了原版）
  - 决定本轮应侧重哪种技能（共情/认知引导/行动建议/结束巩固 的比例）

第二步：按分析结果生成**一条**回复
  - 严格按照教师的指导方向，不要偏离
  - 保持"小树洞"的温暖、简短、像朋友聊天的人格
  - 每条消息不超过 2 句话，像微信聊天
  - 简体中文，口语化，不用专业术语

## 核心原则
- 回复必须与学生最近说的话事实一致
- 不要编造学生没提过的事
- 不要说教、不列清单
- 如果学生在说考试已经结束后的写反、写错、答题卡、分数或排名担心，不要问“能不能改”，不要建议“翻回卷子/现在核对”，也不要主动追问“具体是哪道题”；除非学生主动要求复盘题目，否则重点是承认不确定、区分事实与担心、帮助情绪止损，并把注意力转回可控事项

## 输出 JSON 格式（严格遵守）
{
  "emotion": { "primary": "焦虑|难过|...", "intensity": 1-10, "trend": "↑|→|↓" },
  "skillWeights": { "empathy": 0.6, "cognitive": 0.3, "action": 0.1, "closing": 0 },
  "diagnosis": "一句话说明原版为什么不合适（若提供原版）",
  "reply": "学生能看到的回复文本（不要加引号或前缀）"
}`;

    const contextParts = [];
    if (profileText) contextParts.push(profileText);
    if (rollingSummary) contextParts.push(rollingSummary);
    contextParts.push(`== 最近对话 ==\n${recentText}`);
    if (original_suggestion) {
      contextParts.push(`== 教师不满意的 AI 原版回复 ==\n${original_suggestion}`);
    }
    contextParts.push(`== 教师引导方向 ==\n${teacher_guidance}`);
    contextParts.push(`请按以上信息输出 JSON:`);

    const result = await callReviewLLM([
      { role: 'system', content: GENERATE_PROMPT },
      { role: 'user', content: contextParts.join('\n\n') },
    ], {
      model: runtimeConfig.reviewModel,
      temperature: 0.5,
      max_tokens: 500,
    });

    // 解析 JSON
    const jsonMatch = (result.content || '').match(/\{[\s\S]*\}/);
    let parsed = {};
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch (e) { /* fallback: treat as plain text */ }
    }

    const suggestion = (parsed.reply || result.content || '').trim();
    if (!suggestion) {
      return error(res, 'Expert 生成为空', -1, 500);
    }

    return success(res, {
      suggestion,
      suggestions: [{ content: suggestion, delay: 0 }],
      continueIf: null,
      stopReason: 'expert_regenerate',
      analysis: {
        stage: 'teacher_guided',
        stageName: '教师引导（专家生成）',
        skillWeights: parsed.skillWeights || null,
        emotion: parsed.emotion || null,
        confidence: 0.95,
        guidance: teacher_guidance,
        diagnosis: parsed.diagnosis || '',
        mirrorCues: '',
      },
      model: result.model,
      usage: result.usage,
      teacherGuidance: teacher_guidance,
      source: 'expert',
    });
  } catch (err) {
    console.error('AI regenerate error:', err);
    return error(res, 'AI重生成失败: ' + err.message, -1, 500);
  }
});

// POST /api/ai/reply - Save AI-generated reply to a session
// v1.006: Also records intervention feedback (accepted/edited/ignored)
router.post('/reply', async (req, res) => {
  try {
    const {
      session_id, content, input_type = 'text', stage, emotion, audio_url,
      suggestion_trace_id, original_suggestion, content_source,
    } = req.body;

    if (!session_id || !content) {
      return error(res, '会话ID和内容不能为空');
    }

    const db = getDb();

    const session = db.prepare(
      'SELECT * FROM t_consult_session WHERE id = ? AND status = 1'
    ).get(session_id);

    if (!session) {
      return error(res, '会话不存在或已结束');
    }

    const lastStudentMessage = db.prepare(`
      SELECT content FROM t_message
      WHERE session_id = ? AND sender_type = 'student'
      ORDER BY id DESC LIMIT 1
    `).get(session_id);

    const messageNo = 'M' + Date.now() + '-' + crypto.randomUUID().substring(0, 8);
    const resolvedContentSource = content_source
      || ((suggestion_trace_id || original_suggestion) ? 'teacher_accepted_ai_reply' : (stage ? `agent_${stage}` : 'ai_direct'));

    const result = db.prepare(`
      INSERT INTO t_message (
        message_no, session_id, student_id, sender_type, input_type,
        content, content_source, audio_url
      ) VALUES (?, ?, ?, 'ai', ?, ?, ?, ?)
    `).run(
      messageNo, session_id, session.student_id, input_type,
      content, resolvedContentSource, audio_url || null
    );

    const messageId = result.lastInsertRowid;

    const preview = content.length > 50 ? content.substring(0, 50) + '...' : content;
    db.prepare(`
      UPDATE t_consult_session
      SET message_count = message_count + 1,
          last_message_time = datetime('now', 'localtime'),
          last_message_preview = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(preview, session_id);

    // Auto-trigger rolling summary every 8 messages (async, non-blocking)
    const updatedSession = db.prepare(
      'SELECT message_count FROM t_consult_session WHERE id = ?'
    ).get(session_id);
    if (updatedSession && updatedSession.message_count > 0 && updatedSession.message_count % 8 === 0) {
      generateRollingSummary(parseInt(session_id)).catch(err =>
        console.error('[Summary] Auto rolling trigger error (ai reply):', err.message)
      );
      // v1.005: Also extract structured thread
      extractSessionThread(parseInt(session_id)).catch(err =>
        console.error('[Summary] Thread extraction error (ai reply):', err.message)
      );
    }

    const io = req.app.get('io');
    if (io) {
      const messageData = {
        id: messageId,
        message_no: messageNo,
        session_id: parseInt(session_id),
        student_id: session.student_id,
        sender_type: 'ai',
        input_type,
        content,
        audio_url: audio_url || null,
        content_source: resolvedContentSource,
        stage,
        emotion,
        created_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
      };

      // Emit to session room so student receives in real-time
      io.to(`session_${session_id}`).emit('teacher:message', messageData);
      // Also notify teacher_room for other teacher tabs
      io.to('teacher_room').emit('teacher:message', messageData);
    }

    // v1.007-04: Reset guardian silence timer — teacher just replied
    guardian.onTeacherReply(parseInt(session_id));
    openLoopManager.observeTurn({
      sessionId: parseInt(session_id),
      studentId: session.student_id,
      studentText: lastStudentMessage?.content || '',
      aiText: content,
      topic: null,
      source: 'teacher_accepted_ai_reply',
    });
    guardian.rememberTurnDraft({
      sessionId: parseInt(session_id),
      studentId: session.student_id,
      studentText: lastStudentMessage?.content || '',
      aiText: content,
      topic: null,
      source: 'teacher_accepted_ai_reply',
    });

    // v1.006: Record intervention feedback
    // v1.007 fix: Check against suggestions[] array, not just main suggestion text
    if (suggestion_trace_id) {
      const { suggestions_array } = req.body; // Frontend should pass the suggestions[] array
      let teacherAction = 'accepted';
      let editedContent = null;

      if (original_suggestion && original_suggestion !== content) {
        // Content differs from original — but check if it matches any item in suggestions[]
        const isFromSuggestionsArray = Array.isArray(suggestions_array) &&
          suggestions_array.some(s => (s.content || s) === content);

        if (isFromSuggestionsArray) {
          teacherAction = 'accepted'; // Teacher picked one from the queue, not edited
        } else {
          teacherAction = 'edited';
          editedContent = content;
        }
      }

      writeInterventionFeedback({
        sessionId: parseInt(session_id),
        studentId: session.student_id,
        suggestionTraceId: suggestion_trace_id,
        triggerMessageId: null,
        suggestionContent: original_suggestion || content,
        teacherAction,
        editedContent,
        teacherId: req.user?.id || null,
      });
    }

    return success(res, {
      message_id: messageId,
      message_no: messageNo,
      message: {
        id: messageId,
        message_no: messageNo,
        session_id: parseInt(session_id),
        student_id: session.student_id,
        sender_type: 'ai',
        input_type,
        content,
        audio_url: audio_url || null,
        content_source: resolvedContentSource,
        stage,
        emotion,
        created_at: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
      }
    });
  } catch (err) {
    console.error('AI reply save error:', err);
    return error(res, '保存AI回复失败', -1, 500);
  }
});

// POST /api/ai/tts - Text-to-Speech synthesis
router.post('/tts', async (req, res) => {
  try {
    const { text, voice = 'alloy' } = req.body;

    if (!text || text.trim().length === 0) {
      return error(res, '文本内容不能为空');
    }

    const apiBase = require('../services/runtime/counseling-config').apiBase;
    const apiKey = process.env.AI_API_KEY;

    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
      return error(res, 'AI API未配置', -1, 500);
    }

    const ttsModel = process.env.TTS_MODEL || process.env.DASHSCOPE_TTS_MODEL || 'qwen3-tts-flash-realtime';
    const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    const selectedVoice = validVoices.includes(voice) ? voice : 'alloy';

    const response = await fetch(`${apiBase}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ttsModel,
        input: text.trim(),
        voice: selectedVoice,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('TTS API error:', response.status, errBody);
      return error(res, `TTS合成失败: ${response.status}`, -1, 500);
    }

    // Stream the audio binary back to the client
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('TTS error:', err);
    return error(res, 'TTS语音合成失败', -1, 500);
  }
});

// POST /api/ai/asr - Speech-to-Text recognition
router.post('/asr', async (req, res) => {
  try {
    // Primary = DashScope ASR. Expert review credentials must never be reused for ASR.
    const runtimeConfig = require('../services/runtime/counseling-config');

    if (!runtimeConfig.dashscopeApiKey) {
      return error(res, 'ASR 未配置 (需要 DashScope)', -1, 500);
    }

    // Parse multipart audio uploaded by the browser.
    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

    // Use multer middleware inline
    upload.single('file')(req, res, async (uploadErr) => {
      try {
        if (uploadErr) {
          return error(res, '音频文件上传失败: ' + uploadErr.message);
        }

        if (!req.file) {
          return error(res, '请上传音频文件');
        }

        console.log(`[ASR] Received audio: ${req.file.originalname}, size=${req.file.size}, type=${req.file.mimetype}`);

        const os = require('os');

        // Strategy: DashScope ASR only.

        // Step 1: Convert webm → wav (needed by both paths)
        let wavBuffer = null;
        try {
          const ffmpegPath = require('ffmpeg-static');
          const { execFileSync } = require('child_process');
          const tmpIn = path.join(os.tmpdir(), `asr_in_${Date.now()}.webm`);
          const tmpOut = path.join(os.tmpdir(), `asr_out_${Date.now()}.wav`);
          fs.writeFileSync(tmpIn, req.file.buffer);
          execFileSync(ffmpegPath, ['-y', '-i', tmpIn, '-ar', '16000', '-ac', '1', '-f', 'wav', tmpOut], { timeout: 5000 });
          wavBuffer = fs.readFileSync(tmpOut);
          try { fs.unlinkSync(tmpIn); } catch {}
          try { fs.unlinkSync(tmpOut); } catch {}
          console.log(`[ASR] Converted webm→wav: ${wavBuffer.length} bytes`);
        } catch (e) {
          console.log('[ASR] ffmpeg convert failed:', e.message);
        }

        // Step 2: Try DashScope ASR.
        if (wavBuffer && runtimeConfig.dashscopeApiKey) {
          try {
            console.log('[ASR] Trying DashScope ASR...');
            // Strip WAV header (44 bytes) to get raw PCM16 for DashScope
            const pcmBuffer = wavBuffer.slice(44);
            const { transcribePcm } = require('../services/dashscope-asr-oneshot');
            const text = await transcribePcm(pcmBuffer, 12000);
            if (text && text.length > 0) {
              console.log(`[ASR] ✓ DashScope ASR success: "${text}"`);
              return success(res, { text, provider: 'dashscope' });
            }
            console.log('[ASR] DashScope ASR returned empty');
          } catch (e) {
            console.log(`[ASR] ✗ DashScope ASR error: ${e.message}`);
          }
        }

        return error(res, '语音识别失败: DashScope 未返回有效文本', -1, 500);
      } catch (innerErr) {
        console.error('[ASR] Internal error:', innerErr);
        return error(res, '语音识别内部错误: ' + innerErr.message, -1, 500);
      }
    });
  } catch (err) {
    console.error('ASR error:', err);
    return error(res, '语音识别失败', -1, 500);
  }
});

// POST /api/ai/upload-audio - Upload audio file, return URL
router.post('/upload-audio', (req, res) => {
  try {
    const multer = require('multer');
    const uploadDir = path.resolve(__dirname, '../../uploads/audio');

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const storage = multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.webm';
        cb(null, `${Date.now()}-${crypto.randomUUID().substring(0, 8)}${ext}`);
      }
    });

    const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

    upload.single('file')(req, res, (uploadErr) => {
      if (uploadErr) {
        return error(res, '音频上传失败: ' + uploadErr.message);
      }
      if (!req.file) {
        return error(res, '请上传音频文件');
      }
      const audioUrl = `/uploads/audio/${req.file.filename}`;
      return success(res, { audio_url: audioUrl });
    });
  } catch (err) {
    console.error('Upload audio error:', err);
    return error(res, '音频上传失败', -1, 500);
  }
});

// GET /api/ai/prompt-config - Provide prompt constants to frontend (voice mode needs them)
// v1.006: Frontend no longer defines prompts, it fetches them from here
router.get('/prompt-config', (req, res) => {
  return success(res, {
    COUNSELOR_SOUL,
    SKILL_WEIGHT_GUIDE,
    STAGE_NAMES,
  });
});

module.exports = router;

