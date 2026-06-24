# CodexBridge 重构审计记录

日期：2026-06-24

## 当前判断

项目已经能跑通不少业务闭环，但维护风险开始集中在少数大文件里。最明显的是 `src/control-plane-web.mjs`：它同时承担 HTTP API、HTML 模板、前端脚本、Chat run 状态、workspace 文件操作、Operations 管理和配置表单，已经超过 4500 行。继续在这里堆功能会让每次修改都变慢、变脆。

## 主要风险

1. **Web 控制台职责过多**
   - API、页面、前端交互和业务 helper 混在一个文件。
   - 小功能也需要读大文件，维护成本高。

2. **渠道 bridge 仍偏厚**
   - Telegram / Feishu bridge 里同时有事件解析、用户提示、计费、run 生命周期和平台 SDK 调用。
   - 后续加微信或文档处理时容易复制复杂度。

3. **文档处理还没有真实文件链路**
   - 现在已有 workspace 文件能力和 Feishu Document Handling 配置骨架。
   - 仍缺附件下载、云文档读取、附件上传、飞书文档创建/导出。

4. **产品方向需要继续收缩**
   - 当前更应该围绕“AI 文档处理工作台 + IM 入口”验证真实需求。
   - 不应继续优先做大而全的多渠道 bot 平台。

## 已完成的重构

### 1. Workspace 文件能力抽离

已把 workspace 文件能力从 `src/control-plane-web.mjs` 抽到 `src/workspace-files.mjs`：

- `listWorkspaceFiles(botHome)`
- `readWorkspaceFile(botHome, relativePath)`
- `writeWorkspaceFile(botHome, relativePath, content)`
- `summarizeWorkspaceChanges(beforeEntries, afterEntries)`

收益：

- Web 控制台不再直接管理 workspace 文件路径、读写和变更比较。
- 后续 Telegram / Feishu / 微信 / 文档处理链路可以复用同一套 workspace 文件 API。
- 路径校验更清楚：空路径、父级路径和绝对路径直接拒绝，不再静默改写。
- 新增独立单测，降低后续继续拆分的风险。

### 2. Web Chat 执行能力抽离

已把 Web 控制台里的 chat run 状态和执行逻辑抽到 `src/web-chat-service.mjs`：

- `createWebChatService({ resolveBotHome, activeChatRuns })`
- `readChatStatus(botId, sessionLabel)`
- `startBotChat(botId, { prompt, sessionLabel })`
- `stopBotChat(botId, sessionLabel)`

收益：

- `control-plane-web.mjs` 不再直接管理 Codex 子进程结果、conversation log 写入、workspace snapshot 和 run 状态更新。
- Web chat 的并发拒绝、完成状态、失败状态和 workspace changes 有独立测试。
- 后续可以把 API route handler 继续拆出时，chat service 已经是清晰依赖。

### 3. Control Plane 配置安全逻辑抽离

已把 Web 控制台的配置脱敏、redacted secret 保留、placeholder Telegram token 拒绝逻辑抽到 `src/control-plane-config-service.mjs`：

- `redactConfigSecrets(config)`
- `redactControlPlaneDetail(detail)`
- `applySafeConfigPatch(currentConfig, patch)`

收益：

- secret 处理不再散落在 Web 控制台文件里。
- raw config 保存和 Quick Settings 保存可以复用同一套安全规则。
- placeholder token 拒绝、redacted secret 保留有独立单测。

### 4. Control Plane 运营服务抽离

已把 Web 控制台里的用户、额度、审计、用量、运行记录、指标、迁移和 conversation log review/cleanup 管理逻辑抽到 `src/control-plane-operations-service.mjs`：

- `listOperationsUsers(botHome)`
- `grantCredits(botHome, userId, amount)`
- `adjustCredits(botHome, userId, amount, reason)`
- `updateUserStatus(botHome, userId, status)`
- `updatePrivateEnabled(botHome, userId, privateEnabled)`
- `listUsage(botHome, options)`
- `listRuns(botHome, options)`
- `listAdminAudit(botHome, options)`
- `getMetrics(botHome)`
- `runMigrations(botHome)`
- `listConversationLogs(botHome, options)`
- `listConversationReviews(botHome, options)`
- `cleanupConversationLogs(botHome, options)`
- `reviewConversationLog(botHome, eventId, body)`

收益：

- `control-plane-web.mjs` 不再直接写用户状态、credits、admin audit 和 conversation review。
- HTTP 路由只负责解析 URL/body、解析 botId、调用服务函数。
- 运营能力可以被未来 CLI、微信入口或飞书后台复用，不需要绕过 Web 控制台。
- 新增独立单测覆盖额度变更、用户状态、私聊权限、conversation log review 和 cleanup 校验。

### 5. Control Plane readiness 诊断抽离

已把 Web 控制台里的 storage readiness、setup guide 和 quick test preflight 逻辑抽到 `src/control-plane-readiness-service.mjs`：

- `buildStorageReadiness(config, migrationStatus)`
- `buildSetupGuide(detail, health, access)`
- `buildQuickTestPreflight(setupGuide)`

收益：

- 邀请用户前的可用性判断从 HTML/HTTP 大文件里移出，便于单测和复用。
- Telegram 与 Feishu 的配置缺口提示有独立测试，不再只靠 Web 页面集成测试间接覆盖。
- `control-plane-web.mjs` 更接近“组装详情 + 返回页面/API”，减少后续修改 setup checklist 时的回归面。

### 6. Control Plane Quick Test 服务抽离

已把 Quick Test 和 workspace file demo 的提示词、模式归一化和 main session 启动编排抽到 `src/control-plane-quick-test-service.mjs`：

- `QUICK_TEST_PROMPT`
- `WORKSPACE_DEMO_PROMPTS`
- `normalizeQuickTestMode(mode)`
- `resolveQuickTestPrompt(mode)`
- `startQuickTest({ botId, mode, getDetail, startChat })`

收益：

- Quick Test 的业务含义从 Web route handler 中移出，后续 CLI 或其它本地控制入口可以复用同一套 smoke/file demo。
- workspace demo prompt 有独立测试，避免被 HTML 字符串和前端脚本间接耦合。
- Web 层只负责把 bot detail 和 chat starter 注入 service，减少跨模块依赖方向混乱。

### 7. Control Plane workflow 状态服务抽离

已把 Web 控制台里的 session 和 schedule 状态操作抽到 `src/control-plane-workflow-service.mjs`：

- `readSessions(botHome)`
- `createSession(botHome, label)`
- `activateSession(botHome, label)`
- `listBotSchedules(botHome)`
- `createBotSchedule(botHome, botId, payload)`
- `toggleBotSchedule(botHome, scheduleId, enabled)`

收益：

- session label 校验、active session 更新、schedule 校验和开关逻辑不再散落在 Web handler 里。
- 未来 CLI、微信 concierge 面板或其它本地控制入口可以复用同一套 session/schedule 能力。
- goal runner 仍保留在 Web 层，后续需要单独拆，因为它涉及 active child process、持久化回调和停止逻辑。

### 8. Control Plane goal 服务抽离

已把 Web 控制台里的 goal 列表、创建、Codex command config 组装和 runner 回调持久化抽到 `src/control-plane-goal-service.mjs`：

- `listControlPlaneGoals(botHome, options)`
- `startControlPlaneGoal(botHome, botId, payload, dependencies)`

收益：

- Web handler 不再直接创建 goal record、拼 command config 或绑定 launchGoal 回调。
- `activeGoalRuns` 仍由 Web 注入，停止逻辑保持不变，但 runner 生命周期已经集中到服务层。
- 新增测试用 fake `launchGoalFn` 覆盖成功启动、activeGoalRuns 注册、objective 校验和失败持久化。

### 9. Control Plane Telegram 服务抽离

已把 Web 控制台里的 Telegram pair 和 access allow 配置 patch 抽到 `src/control-plane-telegram-service.mjs`：

- `buildPairedTelegramConfig(currentConfig, token, paired)`
- `buildTelegramAccessConfig(currentConfig, payload)`
- `pairTelegramForControlPlane(botId, token, dependencies)`
- `allowTelegramAccessForControlPlane(botId, payload, dependencies)`

收益：

- Web handler 不再直接依赖 Telegram pairing SDK 或手写 Telegram 配置 patch。
- 修复并覆盖了 pair 路径里的 token 安全校验：placeholder Telegram token 现在会在 pair 前被拒绝。
- access allow 的去重和类型校验有独立单测，后续做微信或飞书 access 管理时可以复用类似模式。

### 10. Control Plane Skills 服务抽离

已把 Web 控制台里的 skills 列表和安装逻辑抽到 `src/control-plane-skills-service.mjs`：

- `listControlPlaneSkills(botHome)`
- `installControlPlaneSkill(botHome, sourcePath)`

收益：

- Web handler 不再直接遍历 skills 目录、读取 `SKILL.md` 或管理 `BOT_HOME` 环境切换。
- skills 管理能力可以被 CLI、未来的微信 concierge 面板或其它本地控制入口复用。
- 新增测试覆盖缺失目录、frontmatter fallback、排序和安装到指定 bot home。

### 11. Control Plane Detail 服务抽离

已把 Web 控制台里的 snapshot、bot detail、Telegram access 展示和 bridge log 读取抽到 `src/control-plane-detail-service.mjs`：

- `getControlPlaneSnapshot()`
- `getBotControlPlaneDetail(botId)`
- `buildTelegramAccessSummary(config)`
- `readBridgeLogs(botId, lines)`

收益：

- Web handler 不再直接组装 readiness/detail/access/logs，只负责 HTTP 路由和响应。
- Telegram access 展示规则有独立测试，不再埋在 Web 页面集成测试里。
- detail 组合逻辑可供未来 CLI 或其它本地控制入口复用。

### 12. Control Plane 页面模板抽离

已把 Web 控制台的 HTML/CSS/前端脚本模板从 `src/control-plane-web.mjs` 抽到 `src/control-plane-page.mjs`：

- `renderHtmlPage()`

收益：

- `control-plane-web.mjs` 从数千行页面字符串中解放出来，更接近纯 HTTP 路由层。
- 页面模板可以单独测试关键锚点、demo prompt 注入和前端函数存在性。
- 后续继续拆 API route handler、或把页面改成静态资源/前端包时，边界更清楚。

## 下一步重构顺序

1. **继续拆 `control-plane-web.mjs` 的 route handlers**
   - 抽 API route handlers。
   - 抽 HTML render。
   - 抽前端 JS 字符串或至少按功能分片。

2. **抽渠道提示文案**
   - Telegram / Feishu 的 welcome、credits、错误提示应集中到 channel message renderer。
   - 这样添加微信时不用复制旧 bridge 复杂度。

3. **落 Feishu 文档处理真实链路**
   - 附件下载到 workspace。
   - 飞书云文档链接读取。
   - workspace 结果上传为附件。
   - 按配置创建飞书云文档或同时返回附件。

4. **按真实需求决定微信入口**
   - 先用人工微信 concierge MVP 验证是否有人真实提交文档任务。
   - 有稳定任务后，再决定是否做微信自动化入口。
