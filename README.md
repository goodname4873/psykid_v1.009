# 树洞 AI 心理咨询平台 v1.009

> 基于"类人脑快慢双系统 + 分层记忆 + 语境准入"架构的青少年心理支持 AI 系统。
> Guardian 快系统预判 + Pipeline 慢系统兜底 + Context Gate 语境准入 + 教师闭环治理。

完整设计、架构、原理、基线测试见配套 PDF 文档。

---

## 一、快速启动

### 环境要求

- **Node.js 20+**（必需，使用 `--watch` 等新特性）
- **npm 10+** 或 pnpm
- **SQLite 3**（无需单独安装，better-sqlite3 自带）
- **Windows 10+ / macOS 12+ / Linux**

---

## 🚀 零配置 5 分钟启动（团队内部版）

`server/.env` 已预填好可用的 API Key，**只需要装依赖 + 构建前端 + 启动后端**：

```bash
# ① 装后端依赖
cd server
npm install

# ② 装前端依赖 + 构建（生成 dist/）
cd ..
npm install
npm run build

# ③ 启动后端（同时静态托管前端）
cd server
npm start

# ④ 浏览器打开
# http://localhost:3000
```

完成。后端首次启动会自动建库、跑 migration、种入测试账号。

---

### 详细步骤说明

#### 第 1 步：配置后端（团队内部已预配置）

`.env` 已经包含可用的 API Key（团队共享版）。如果要换成自己的，参照 `.env.example` 的注释修改：

```bash
cd server
npm install
```

> 说明：仓库内的 `server/.env` 已包含 DashScope (主管道+Guardian/语音) 和 DeepSeek (Expert) 的可用 Key。

#### 第 2 步：启动后端

```bash
# 仍在 server/ 目录
npm start
```

第一次启动会自动：
- 创建 SQLite 数据库 (`./data/psy_consult.db`)
- 执行所有 6 个迁移脚本
- 插入默认学校 + 测试账号

正常启动后会打印：
```
==================================================
  Psychology Counseling Platform Server
  HTTP:       http://localhost:3000
  WebSocket:  ws://localhost:3000
  Voice Pipeline: /ws/voice-pipeline (on main server)
  Guardian Service: started (event-driven + 30s silence monitor)
  Scheduler:       started (60s interval)
==================================================
```

#### 第 3 步：构建并启动前端

**方式 A：生产模式（推荐 · 构建后由后端静态托管）** ⭐

```bash
# 项目根目录（不是 server/）
npm install
npm run build       # 输出到 dist/
# 后端启动后会自动从 dist/ 静态托管前端
# 浏览器访问 http://localhost:3000
```

**方式 B：开发模式（前端热更新，做开发用）**

```bash
npm install
npm run dev          # 启动 vite dev server，端口 5173
# 浏览器访问 http://localhost:5173
```

⚠️ **重要**：直接访问 `http://localhost:3000` 但出现 "Internal server error" / "ENOENT no such file index.html"——说明前端没构建。执行 `npm run build` 即可解决。

---

## 二、测试账号

数据库已包含测试数据，启动后可直接使用：

| 角色 | 账号 | 密码 | 姓名 | 说明 |
|------|------|------|------|------|
| 教师 | T001 | teacher123 | 心理咨询师 | 可管理学生、查看会话、Expert 审视 |
| 学生 | S20240001 | student123 | 张同学 | 高一1班 |
| 学生 | S20240002 | student123 | 李同学 | 高二2班 |
| 学生 | S20240003 | student123 | 王同学 | 高一3班 |

> **新增学生**：教师登录后进入「学生管理」页面，点击"添加学生"即可，初始密码自动设为学籍号后6位。
>
> **隐私说明**：公开仓库仅保留通用演示账号。真实测试账号、真实学生姓名、学籍号样式账号和真实对话数据不应写入公开 README。

登录入口：
- 学生端：访问 `/` 或 `/login`
- 教师端：访问 `/teacher/login`

---

## 三、系统架构

### 四大子系统 + v1.009 核心升级

```
┌──────────────────────────────────────────────────────────┐
│  ① Pipeline 主管道 · 处理"当下回合"                       │
│     Coordinator (qwen3.5-flash) + Generator (qwen3.6-plus) │
├──────────────────────────────────────────────────────────┤
│  ② Guardian 守护进程 · 快路预判 + 沉默关怀 + 语音方向把关  │
│     独立 API Key · 事件驱动 + 30s 轻量心跳                │
│     v1.009: Branch Working Memory + Fast Verifier 校验     │
├──────────────────────────────────────────────────────────┤
│  ③ Expert 专家审视 · 跨家族交叉验证（DeepSeek V4 Pro）     │
│     教师手动触发：审视 + 引导重生成                        │
├──────────────────────────────────────────────────────────┤
│  ④ Memory 分层记忆 · L1-L4 四层 + AutoDream + OpenLoop    │
│     v1.009: Context Gate 语境准入 + Topic Flow Judge       │
└──────────────────────────────────────────────────────────┘
        ↕
  教师 HITL（Human-In-The-Loop）：
  五种动作 — 发送 / 编辑 / 审视 / 引导重生成 / 忽略
  v1.009: TeacherLearning 作用域控制 + Expert 去偏
```

详细架构原理见配套 PDF 文档。

---

## 四、目录结构

```
树洞AI_v1.009_源码/
├── README.md                       # 本文档
├── package.json                    # 前端依赖
├── vite.config.js                  # 前端构建配置
├── tailwind.config.js
├── postcss.config.js
├── eslint.config.js
├── index.html
│
├── public/                         # 前端静态资源
│   ├── assets/                     # 图标 / 图片
│   └── images/
│
├── src/                            # 学生 + 教师前端 (React)
│   ├── App.jsx
│   ├── main.jsx
│   ├── pages/
│   │   ├── Home.jsx
│   │   ├── Chat.jsx                # 文本咨询
│   │   ├── Voice.jsx               # 语音咨询（1519行 · 核心 UI）
│   │   └── ...
│   ├── teacher/                    # 教师端
│   │   └── pages/
│   │       └── ChatPanel.jsx       # 教师监控 + Guardian + Expert 入口
│   ├── services/api.js
│   └── context/
│
├── server/                         # 后端 Node.js
│   ├── package.json
│   ├── .env.example                # ★ 配置模板（复制为 .env 并填 Key）
│   ├── data/
│   │   └── psy_consult.db          # SQLite 测试数据库（含示例数据）
│   ├── ssl/                        # 自签证书（本地 HTTPS）
│   ├── uploads/audio/              # 语音测试录音（.webm）
│   └── src/
│       ├── app.js                  # 入口 · 挂载所有路由与服务
│       ├── routes/                 # API 路由（9个文件）
│       │   ├── auth.js
│       │   ├── ai.js               # /suggest /review /regenerate /analyze
│       │   ├── session.js
│       │   ├── message.js
│       │   └── ...
│       ├── services/
│       │   ├── ai-client.js        # 三个 LLM 客户端（主管道/Guardian/Expert）
│       │   ├── voice-pipeline.js   # 语音管道（ASR→Agent→TTS）
│       │   ├── dream-service.js    # ★ AutoDream 会后记忆整理
│       │   ├── scheduler.js        # 跟进任务调度器
│       │   ├── runtime/            # ★ v1.009 核心（15个文件）
│       │   │   ├── counseling-runtime.js  # 主编排器（1472行）
│       │   │   ├── context-gate.js        # 语境准入控制器
│       │   │   ├── open-loop-manager.js   # 未闭合事项追踪
│       │   │   ├── topic-flow-judge.js    # 话题流评分
│       │   │   ├── fast-verifier.js       # 快路校验器
│       │   │   ├── continuation-resolver.js # 四层记忆检索
│       │   │   ├── context-assembler.js   # 上下文组装
│       │   │   ├── prompt-assembler.js    # 提示词组装
│       │   │   ├── prompt-constants.js    # 提示词常量
│       │   │   ├── memory-retrieval.js    # Memory Fragment 检索
│       │   │   ├── topic-frame.js         # 主题框架
│       │   │   ├── suggestion-trace.js    # Trace 写库
│       │   │   └── runtime-stats.js       # 运行时统计
│       │   ├── guardian/           # Guardian 守护进程（10个文件）
│       │   │   ├── guardian-service.js
│       │   │   ├── guardian-state.js
│       │   │   ├── situation-analyzer.js
│       │   │   ├── branch-generator.js
│       │   │   ├── branch-matcher.js
│       │   │   ├── branch-memory.js       # 分支工作记忆
│       │   │   ├── trigger-classifier.js
│       │   │   ├── proactive-decider.js
│       │   │   └── strategy-memory.js
│       │   └── learning/           # 教师学习
│       │       └── teacher-learning.js
│       ├── models/
│       │   ├── db.js
│       │   ├── init-db.js
│       │   ├── migrator.js
│       │   └── migrations/         # 9 个迁移（含 v1.009 OpenLoop + Trace）
│       └── middleware/
```

---

## 五、关键功能验证

启动后建议依次验证：

### 5.1 文本咨询（最基础）

1. 学生端 `S20240001` 登录 → 进入"聊天"页面
2. 发送一条文本消息（如"我最近很焦虑"）
3. 教师端 `T001` 登录 → 进入会话列表 → 点击该学生
4. 教师面板右侧应出现 AI 草稿建议
5. 教师点"发送" → 学生端应实时收到

### 5.2 Expert 审视

1. 在教师面板看到 AI 草稿后，点"审视"按钮
2. 等待几秒，下方应出现 ✅/❌ 评估 + issues + 修正方向
3. 模型显示为 DeepSeek Expert

### 5.3 引导重生成

1. 在"教师引导"输入框写一句方向（如"应该多共情少给建议"）
2. 点"引导重生成"
3. 几秒后右侧出现新草稿，stage 标为"教师引导（专家生成）"

### 5.4 语音模式

1. 学生端进入"语音"页面 → 选 Agent 模式
2. 允许麦克风权限，开始说话
3. AI 会用语音回复（4-5 秒响应）
4. 教师端"Guardian 守护进程"面板应实时刷新态势分析

### 5.5 Guardian 主动介入

1. 学生发完消息后**保持沉默 45 秒**
2. 教师面板应弹出红色"Guardian 建议主动介入"卡片
3. 教师可点"发送给学生"或"忽略"

---

## 六、常见问题

### Q1: `npm install` 在 better-sqlite3 失败

需要本机能编译 native 模块：
- Windows: 安装 [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools) 或 Visual Studio 2022 with C++ Build Tools
- macOS: 安装 Xcode CLI tools (`xcode-select --install`)
- Linux: `sudo apt install build-essential python3`

### Q2: 启动后看到 `JWT_SECRET environment variable is not set`

`.env` 没创建或 `JWT_SECRET` 没填。务必复制 `.env.example` 为 `.env` 并填值。

### Q3: AI 不响应 / `fetch failed`

通常是网络问题：
- 检查 `AI_API_KEY` / `GUARDIAN_API_KEY` / `REVIEW_API_KEY` 是否填对
- 如有 VPN，确保 `dashscope.aliyuncs.com` 走直连（`NO_PROXY` 已默认设置）
- 检查 API Key 余额是否充足

### Q4: 语音模式麦克风没反应

- 必须用 HTTPS 或 localhost（浏览器安全限制）
- 移动端需要自签证书 → 启动时会输出 `HTTPS: https://localhost:3001`
- 检查浏览器权限设置

### Q5: 教师面板看不到 Guardian 守护进程数据

- Guardian 在学生**进入会话**时才挂载
- 学生静默不发消息时 Guardian 不耗 token，但每 30 秒会做一次轻量心跳

---

## 七、技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite + Tailwind CSS |
| 后端 | Node.js 20 + Express 5 + Socket.IO |
| 数据库 | SQLite (better-sqlite3, WAL 模式) |
| LLM | DashScope (qwen3.6-plus + qwen3.5-flash) + DeepSeek V4 Pro |
| 语音 | DashScope paraformer-realtime-v1 (ASR) + qwen3-tts-flash-realtime (TTS) |

---

## 八、开发者文档

如要深入理解或二次开发，建议阅读顺序：

1. **配套 PDF 文档**（随代码包一起提交）：
   - `01_项目报告.pdf` — 完整设计哲学与架构原理
   - `02_安装与使用手册.pdf` — 环境配置与功能验证
   - `03_开发记录与资源.pdf` — 提示词全集 / 基线数据 / 版本演进
2. **代码阅读入口**：
   - `server/src/services/runtime/counseling-runtime.js` — 主编排器，理解三条快路
   - `server/src/services/runtime/context-gate.js` — 语境准入控制器
   - `server/src/services/runtime/open-loop-manager.js` — 未闭合事项管理
   - `server/src/services/guardian/branch-memory.js` — 分支工作记忆
3. **数据库表结构**：`server/src/models/migrations/` — 9个迁移文件按编号阅读

---

## 九、版本号说明

```
v1.009 (当前)
  ├── v1.007-04: 引入 Guardian 事件驱动 + Expert 系统
  ├── v1.007-05: Guardian 协商模式 + 策略记忆 + 教师在环增强
  ├── v1.008:    四层记忆检索 + TeacherLearning 闭环 + Continuation Resolver
  └── v1.009:    Context Gate 语境准入 + OpenLoop Manager + Fast Verifier
                 三条快路并存（DirectContinuation / Guardian Pre / Guardian Post）
                 AutoDream 记忆整理 + 基线测试框架

v1.010 (规划中)
  ├── Context Gate 语义升级（regex → embedding）
  ├── 代码统一重构（subjectOf / topicExtractor 去重）
  └── 自动化测试补位
```

---

## 十、社会价值

通过"AI 提速 + 教师把关 + 系统守护"协同范式，可让一名心理教师服务 500+ 学生而不降低质量——这是缓解我国基层心理健康资源短缺的一条可行技术路径。

详见 `项目报告/项目报告.md` 第十三章。
