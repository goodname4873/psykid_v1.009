/**
 * Migration 002: Structured memory + student profile + proactive suggestions
 *
 * v1.005 核心改动：
 * - t_session_thread: 会话线索追踪（替代笼统滚动摘要）
 * - t_student_profile: 学生咨询档案（跨会话持久）
 * - t_followup_task: 主动关怀任务（协调器建议队列）
 * - t_teacher_setting: 教师偏好设置
 * - t_message 新增 emotion_intensity / emotion_label
 * - t_consult_session 新增 ai_auto_reply
 */
module.exports = {
  name: 'memory_and_profile',
  up(db) {
    // === 会话线索追踪（替代滚动摘要的结构化提取） ===
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_session_thread (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        key_events TEXT DEFAULT '[]',
        emotion_shifts TEXT DEFAULT '[]',
        unresolved TEXT DEFAULT '[]',
        strategies_tried TEXT DEFAULT '[]',
        student_quotes TEXT DEFAULT '[]',
        last_turn INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (session_id) REFERENCES t_consult_session(id),
        FOREIGN KEY (student_id) REFERENCES t_student(id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_thread_session ON t_session_thread(session_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_thread_student ON t_session_thread(student_id)`);

    // === 学生咨询档案 ===
    // NOTE: t_student_profile 已由 init-db.js 创建（真表结构），此处不再重复建表。
    // init-db.js 列名：primary_concerns, coping_style, emotional_pattern, communication_style,
    //   effective_strategies, sensitive_topics, current_risk_level, risk_notes 等。
    // 代码中统一使用 init-db.js 的列名。

    // === 主动关怀任务 ===
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_followup_task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        session_id INTEGER,
        task_type TEXT NOT NULL,
        trigger_reason TEXT,
        content TEXT NOT NULL,
        status INTEGER DEFAULT 0,
        scheduled_at TEXT NOT NULL,
        sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (student_id) REFERENCES t_student(id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_followup_student ON t_followup_task(student_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_followup_status ON t_followup_task(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_followup_scheduled ON t_followup_task(scheduled_at)`);

    // === 教师偏好设置 ===
    db.exec(`
      CREATE TABLE IF NOT EXISTS t_teacher_setting (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL UNIQUE,
        auto_reply_when_offline INTEGER DEFAULT 0,
        silence_nudge_minutes INTEGER DEFAULT 3,
        post_session_followup INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (teacher_id) REFERENCES t_teacher(id)
      )
    `);

    // === t_message 新增情绪字段（已有 emotion_polarity/emotion_score 但从未写入） ===
    db.exec(`ALTER TABLE t_message ADD COLUMN emotion_intensity INTEGER`);
    db.exec(`ALTER TABLE t_message ADD COLUMN emotion_label TEXT`);

    // === t_consult_session 新增 AI 自动回复开关 ===
    db.exec(`ALTER TABLE t_consult_session ADD COLUMN ai_auto_reply INTEGER DEFAULT 0`);
  }
};
