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
