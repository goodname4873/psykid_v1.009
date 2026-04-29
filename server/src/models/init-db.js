const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.resolve(__dirname, '../../data/psy_consult.db');

function initDatabase() {
  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ============================================================
  // 1. School table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_school (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      province TEXT,
      city TEXT,
      address TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // ============================================================
  // 2. Teacher table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_teacher (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      avatar TEXT,
      school_id INTEGER NOT NULL,
      password TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 1,
      last_login_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      deleted_at TEXT,
      FOREIGN KEY (school_id) REFERENCES t_school(id)
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_school ON t_teacher(school_id);
  `);

  // ============================================================
  // 3. Student table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_student (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      gender INTEGER,
      phone TEXT,
      avatar TEXT,
      school_id INTEGER NOT NULL,
      grade TEXT,
      class_name TEXT,
      password TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 1,
      last_login_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      deleted_at TEXT,
      FOREIGN KEY (school_id) REFERENCES t_school(id)
    );
    CREATE INDEX IF NOT EXISTS idx_student_school ON t_student(school_id);
    CREATE INDEX IF NOT EXISTS idx_student_status ON t_student(status);
  `);

  // ============================================================
  // 4. Consult session table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_consult_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_no TEXT NOT NULL UNIQUE,
      student_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      school_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'text',
      start_time TEXT NOT NULL,
      end_time TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      warning_level INTEGER DEFAULT 0,
      last_message_time TEXT,
      last_message_preview TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (student_id) REFERENCES t_student(id),
      FOREIGN KEY (teacher_id) REFERENCES t_teacher(id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_student ON t_consult_session(student_id);
    CREATE INDEX IF NOT EXISTS idx_session_teacher ON t_consult_session(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_session_status ON t_consult_session(status);
    CREATE INDEX IF NOT EXISTS idx_session_warning ON t_consult_session(warning_level);
    CREATE INDEX IF NOT EXISTS idx_session_last_msg ON t_consult_session(last_message_time);
  `);

  // ============================================================
  // 5. Message table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_no TEXT NOT NULL UNIQUE,
      session_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL,
      input_type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      content_source TEXT DEFAULT 'direct',
      audio_url TEXT,
      audio_duration REAL,
      audio_source TEXT,
      is_realtime INTEGER DEFAULT 0,
      realtime_audio_url TEXT,
      realtime_transcript TEXT,
      llm_suggestion TEXT,
      is_edited INTEGER DEFAULT 0,
      emotion_polarity TEXT,
      emotion_score REAL,
      warning_triggered INTEGER DEFAULT 0,
      warning_level INTEGER,
      warning_keywords TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (session_id) REFERENCES t_consult_session(id),
      FOREIGN KEY (student_id) REFERENCES t_student(id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_session ON t_message(session_id);
    CREATE INDEX IF NOT EXISTS idx_message_student ON t_message(student_id);
    CREATE INDEX IF NOT EXISTS idx_message_sender ON t_message(sender_type);
    CREATE INDEX IF NOT EXISTS idx_message_created ON t_message(created_at);
    CREATE INDEX IF NOT EXISTS idx_message_read ON t_message(is_read);
    CREATE INDEX IF NOT EXISTS idx_message_warning ON t_message(warning_triggered);
    CREATE INDEX IF NOT EXISTS idx_message_realtime ON t_message(is_realtime);
  `);

  // ============================================================
  // 6. Warning table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_warning (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warning_no TEXT NOT NULL UNIQUE,
      student_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_word TEXT,
      trigger_context TEXT,
      emotion_score REAL,
      status INTEGER NOT NULL DEFAULT 1,
      handler_id INTEGER,
      handle_time TEXT,
      handle_result TEXT,
      handle_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (student_id) REFERENCES t_student(id),
      FOREIGN KEY (session_id) REFERENCES t_consult_session(id),
      FOREIGN KEY (message_id) REFERENCES t_message(id)
    );
    CREATE INDEX IF NOT EXISTS idx_warning_student ON t_warning(student_id);
    CREATE INDEX IF NOT EXISTS idx_warning_level ON t_warning(level);
    CREATE INDEX IF NOT EXISTS idx_warning_status ON t_warning(status);
    CREATE INDEX IF NOT EXISTS idx_warning_created ON t_warning(created_at);
  `);

  // ============================================================
  // 7. Warning keyword config table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_warning_keyword (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      category TEXT NOT NULL,
      level INTEGER NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_keyword_category ON t_warning_keyword(category);
    CREATE INDEX IF NOT EXISTS idx_keyword_level ON t_warning_keyword(level);
  `);

  // ============================================================
  // 8. Knowledge base table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT,
      source TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON t_knowledge(category);
  `);

  // ============================================================
  // 9. FAQ table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_faq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_type INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      keywords TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_faq_type ON t_faq(question_type);
  `);

  // ============================================================
  // 10. Student profile table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_student_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL UNIQUE,
      inferred_grade TEXT,
      primary_concerns TEXT,
      coping_style TEXT,
      emotional_pattern TEXT,
      cognitive_distortions TEXT,
      insight_level TEXT,
      preferred_approach TEXT,
      response_to_empathy TEXT,
      response_to_challenge TEXT,
      communication_style TEXT,
      effective_strategies TEXT,
      sensitive_topics TEXT,
      has_close_friends INTEGER,
      family_support TEXT,
      teacher_relationship TEXT,
      current_risk_level TEXT DEFAULT 'L4',
      historical_highest_level TEXT,
      last_evaluated_at TEXT,
      risk_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (student_id) REFERENCES t_student(id)
    );
    CREATE INDEX IF NOT EXISTS idx_profile_student ON t_student_profile(student_id);
    CREATE INDEX IF NOT EXISTS idx_profile_risk ON t_student_profile(current_risk_level);
  `);

  // ============================================================
  // 11. Emotion record table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_emotion_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      session_id INTEGER,
      message_id INTEGER,
      turn_number INTEGER,
      primary_emotion TEXT NOT NULL,
      intensity INTEGER NOT NULL,
      emotion_keywords TEXT,
      trend TEXT,
      trend_analysis TEXT,
      has_risk_signal INTEGER DEFAULT 0,
      risk_type TEXT,
      risk_evidence TEXT,
      source TEXT NOT NULL DEFAULT 'session',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (student_id) REFERENCES t_student(id),
      FOREIGN KEY (session_id) REFERENCES t_consult_session(id)
    );
    CREATE INDEX IF NOT EXISTS idx_emotion_student ON t_emotion_record(student_id);
    CREATE INDEX IF NOT EXISTS idx_emotion_session ON t_emotion_record(session_id);
    CREATE INDEX IF NOT EXISTS idx_emotion_created ON t_emotion_record(created_at);
    CREATE INDEX IF NOT EXISTS idx_emotion_risk ON t_emotion_record(has_risk_signal);
  `);

  // ============================================================
  // 12. Session summary table (3-layer context management)
  // Migrate: drop old schema if it lacks raw_summary column
  // ============================================================
  const summaryTableInfo = db.prepare("PRAGMA table_info(t_session_summary)").all();
  if (summaryTableInfo.length > 0 && !summaryTableInfo.find(c => c.name === 'raw_summary')) {
    console.log('Migrating t_session_summary to new schema...');
    db.exec('DROP TABLE IF EXISTS t_session_summary');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_session_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      summary_type TEXT NOT NULL,
      -- 'rolling': 对话中滚动压缩（每~8轮更新，同session只保留最新一条rolling）
      -- 'final':   会话结束时的完整总结（永久保留）
      trigger_turn INTEGER,
      topics_discussed TEXT,
      student_expressions TEXT,
      approaches_tried TEXT,
      unresolved_items TEXT,
      session_flow TEXT,
      raw_summary TEXT NOT NULL,
      model_used TEXT,
      message_range_start INTEGER,
      message_range_end INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (session_id) REFERENCES t_consult_session(id),
      FOREIGN KEY (student_id) REFERENCES t_student(id)
    );
    CREATE INDEX IF NOT EXISTS idx_summary_session ON t_session_summary(session_id);
    CREATE INDEX IF NOT EXISTS idx_summary_student ON t_session_summary(student_id);
    CREATE INDEX IF NOT EXISTS idx_summary_type ON t_session_summary(summary_type);
  `);

  // ============================================================
  // 13. Risk assessment table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_risk_assessment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      session_id INTEGER,
      risk_level TEXT NOT NULL,
      previous_level TEXT,
      level_changed INTEGER DEFAULT 0,
      change_direction TEXT,
      emotion_factor_score INTEGER,
      emotion_factor_detail TEXT,
      duration_factor_score INTEGER,
      duration_factor_detail TEXT,
      issue_factor_score INTEGER,
      issue_factor_detail TEXT,
      support_factor_score INTEGER,
      support_factor_detail TEXT,
      history_factor_score INTEGER,
      history_factor_detail TEXT,
      total_score INTEGER,
      alert_required INTEGER DEFAULT 0,
      alert_type TEXT,
      recommendation_action TEXT,
      recommendation_focus TEXT,
      warning_flags TEXT,
      ai_confidence REAL,
      teacher_confirmed INTEGER DEFAULT 0,
      teacher_id INTEGER,
      teacher_notes TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (student_id) REFERENCES t_student(id),
      FOREIGN KEY (session_id) REFERENCES t_consult_session(id)
    );
    CREATE INDEX IF NOT EXISTS idx_risk_student ON t_risk_assessment(student_id);
    CREATE INDEX IF NOT EXISTS idx_risk_level ON t_risk_assessment(risk_level);
    CREATE INDEX IF NOT EXISTS idx_risk_alert ON t_risk_assessment(alert_required);
    CREATE INDEX IF NOT EXISTS idx_risk_created ON t_risk_assessment(created_at);
  `);

  // ============================================================
  // 14. Emotion diary table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_emotion_diary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      emotion_type TEXT NOT NULL,
      intensity INTEGER NOT NULL DEFAULT 5,
      content TEXT,
      tags TEXT,
      diary_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (student_id) REFERENCES t_student(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_diary_student_date ON t_emotion_diary(student_id, diary_date);
    CREATE INDEX IF NOT EXISTS idx_diary_date ON t_emotion_diary(diary_date);
  `);

  // ============================================================
  // 15. Assessment record table
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS t_assessment_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      assessment_type TEXT NOT NULL,
      assessment_name TEXT NOT NULL,
      raw_score INTEGER,
      standard_score INTEGER,
      level TEXT,
      answers TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (student_id) REFERENCES t_student(id)
    );
    CREATE INDEX IF NOT EXISTS idx_assessment_student ON t_assessment_record(student_id);
    CREATE INDEX IF NOT EXISTS idx_assessment_type ON t_assessment_record(assessment_type);
  `);

  // ============================================================
  // Seed data
  // ============================================================
  const schoolCount = db.prepare('SELECT COUNT(*) as cnt FROM t_school').get();
  if (schoolCount.cnt === 0) {
    console.log('Seeding initial data...');

    // Insert school
    db.prepare(`
      INSERT INTO t_school (name, code, province, city) VALUES (?, ?, ?, ?)
    `).run('示范中学', 'DEMO001', '广东省', '深圳市');

    // Insert teacher (password: teacher123)
    const teacherPwd = bcrypt.hashSync('teacher123', 10);
    db.prepare(`
      INSERT INTO t_teacher (teacher_no, name, school_id, password) VALUES (?, ?, ?, ?)
    `).run('T001', '心理咨询师', 1, teacherPwd);

    // Insert test students (password: student123)
    const studentPwd = bcrypt.hashSync('student123', 10);
    const insertStudent = db.prepare(`
      INSERT INTO t_student (student_no, name, school_id, grade, class_name, password, gender) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertStudent.run('S20240001', '张同学', 1, '高一', '1班', studentPwd, 1);
    insertStudent.run('S20240002', '李同学', 1, '高二', '2班', studentPwd, 0);
    insertStudent.run('S20240003', '王同学', 1, '高一', '3班', studentPwd, 1);

    // Insert warning keywords
    const insertKeyword = db.prepare(`
      INSERT INTO t_warning_keyword (keyword, category, level, weight) VALUES (?, ?, ?, ?)
    `);
    const keywords = [
      // Level 1 - Emergency
      ['想死', 'suicide', 1, 1.0],
      ['不想活', 'suicide', 1, 1.0],
      ['自杀', 'suicide', 1, 1.0],
      ['结束生命', 'suicide', 1, 1.0],
      ['活着没意思', 'suicide', 1, 1.0],
      ['割腕', 'self_harm', 1, 1.0],
      ['跳楼', 'suicide', 1, 1.0],
      // Level 2 - High risk
      ['不想上学', 'depression', 2, 0.8],
      ['活着好累', 'depression', 2, 0.8],
      ['没有希望', 'depression', 2, 0.8],
      ['很绝望', 'depression', 2, 0.8],
      // Level 3 - Watch
      ['压力大', 'anxiety', 3, 0.5],
      ['睡不着', 'anxiety', 3, 0.5],
      ['焦虑', 'anxiety', 3, 0.5],
      ['难过', 'depression', 3, 0.5],
    ];
    const insertKeywords = db.transaction(() => {
      for (const kw of keywords) {
        insertKeyword.run(...kw);
      }
    });
    insertKeywords();

    console.log('Seed data inserted successfully.');
  }

  console.log('Database initialized successfully at:', DB_PATH);
  db.close();
}

// Run if called directly
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase, DB_PATH };
