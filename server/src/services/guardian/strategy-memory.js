/**
 * Strategy Memory - v1.007-05
 *
 * Guardian's session-level memory for tracking topics, strategies, and predictions.
 * Stored in guardian-state.js's strategyMemory field.
 *
 * This is NOT persistent across sessions (that's the student profile's job).
 * This tracks the current conversation's strategic context.
 */

/**
 * Initialize strategy memory for a session.
 */
function createStrategyMemory() {
  return {
    currentTopic: null,         // e.g. "语文-文言文-桃花源记"
    topicFlow: [],              // [{ topic, enterTurn }]
    strategiesUsed: [],         // [{ method, turn, result }]
    branchHistory: [],          // [{ predicted, matched, correct, turn }]
  };
}

/**
 * Update topic tracking based on situation analysis.
 * Called after each situation-analyzer run.
 */
function updateTopic(strategyMemory, situation, turnNumber) {
  if (!situation || !situation.nextStepHint) return;

  // Extract topic hint from situation analysis
  const hint = situation.nextStepHint;
  const currentTopic = strategyMemory.currentTopic;

  // Simple topic change detection: if nextStepHint mentions a different subject
  // More sophisticated: could use LLM to classify, but keep it lightweight
  if (currentTopic && hint !== currentTopic && hint.length > 2) {
    // Only update if the hint is substantially different
    const isDifferent = !currentTopic.includes(hint.substring(0, 4)) &&
                        !hint.includes(currentTopic.substring(0, 4));
    if (isDifferent) {
      strategyMemory.topicFlow.push({
        topic: currentTopic,
        enterTurn: strategyMemory.topicFlow.length > 0
          ? strategyMemory.topicFlow[strategyMemory.topicFlow.length - 1].enterTurn
          : 0,
        exitTurn: turnNumber,
      });
    }
  }
}

/**
 * Update topic from recent messages (more reliable than situation hints).
 * Extracts topic keywords from the last few student messages.
 */
function updateTopicFromMessages(strategyMemory, recentMessages) {
  if (!recentMessages || recentMessages.length === 0) return;

  const studentMsgs = recentMessages
    .filter(m => m.sender_type === 'student')
    .map(m => m.content || '')
    .join(' ');

  // Simple keyword extraction for topic
  const subjectKeywords = {
    '语文': ['语文', '文言文', '古文', '课文', '桃花源', '古诗', '作文'],
    '数学': ['数学', '方程', '几何', '函数', '计算'],
    '英语': ['英语', '单词', '背诵', '语法', '阅读'],
    '历史': ['历史', '朝代', '三大改造', '社会主义'],
    '物理': ['物理', '力学', '电路'],
    '化学': ['化学', '元素', '反应'],
  };

  for (const [subject, keywords] of Object.entries(subjectKeywords)) {
    for (const kw of keywords) {
      if (studentMsgs.includes(kw)) {
        const detailedTopic = `${subject}-${kw}`;
        if (strategyMemory.currentTopic !== detailedTopic) {
          if (strategyMemory.currentTopic) {
            strategyMemory.topicFlow.push({
              topic: strategyMemory.currentTopic,
              exitTurn: Date.now(),
            });
          }
          strategyMemory.currentTopic = detailedTopic;
        }
        return; // First match wins
      }
    }
  }
}

/**
 * Record a strategy outcome.
 */
function recordStrategy(strategyMemory, method, result, turn) {
  strategyMemory.strategiesUsed.push({ method, result, turn });
  // Keep last 20
  if (strategyMemory.strategiesUsed.length > 20) {
    strategyMemory.strategiesUsed = strategyMemory.strategiesUsed.slice(-20);
  }
}

/**
 * Record a branch prediction outcome.
 */
function recordBranchOutcome(strategyMemory, predicted, matched, correct, turn) {
  strategyMemory.branchHistory.push({ predicted, matched, correct, turn });
  // Keep last 20
  if (strategyMemory.branchHistory.length > 20) {
    strategyMemory.branchHistory = strategyMemory.branchHistory.slice(-20);
  }
}

/**
 * Get strategy advice for the main pipeline.
 * Returns current topic, approach suggestions, and things to avoid.
 */
function getAdvice(strategyMemory) {
  const advice = {
    currentTopic: strategyMemory.currentTopic,
    topicHistory: strategyMemory.topicFlow.map(t => t.topic),
    avoid: [],
    effectiveMethods: [],
  };

  // Find what worked and what didn't
  for (const s of strategyMemory.strategiesUsed) {
    if (s.result === '拒绝' || s.result === '无效') {
      advice.avoid.push(s.method);
    } else if (s.result === '接受' || s.result === '有效') {
      advice.effectiveMethods.push(s.method);
    }
  }

  return advice;
}

module.exports = {
  createStrategyMemory,
  updateTopic,
  updateTopicFromMessages,
  recordStrategy,
  recordBranchOutcome,
  getAdvice,
};
