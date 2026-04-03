# Telegram + Codex 全天候专属 AI 助理设计草案

> Historical draft. This design contains pre-runtime-refactor assumptions and should not be treated as the current implementation contract.

## 1. 目标

你要做的不是再造一个新的 agent 内核，而是给 Codex 套一个“全天候编排壳”。

这个壳负责：

- Telegram 作为输入/通知通道
- 一个长期主 session 作为默认全天候助理
- 少量可切换 secondary sessions
- Telegram 到 CLI session 的薄映射
- 会话恢复与推进
- 安全边界、权限和审计

这个壳不应该重复开发：

- agent 推理能力
- `AGENTS.md` 指令继承
- skills 加载
- 工具调用
- MCP server 接入
- 子 agent / 多 agent 能力

这些能力 Codex 本身已经有相当多现成基础设施。

## 2. 先说结论

最合理的方案不是重做一个大 orchestrator，而是“三层轻结构”：

1. `Telegram Channel Layer`
2. `Thin Session Mapping Layer`
3. `Codex Runtime Layer`

其中：

- Codex Runtime 继续负责思考、调用工具、读 `AGENTS.md`、加载 skills、接 MCP
- Thin Session Mapping 只负责 session label、active pointer、Telegram 命令路由、resume 定位
- Telegram 只做消息入口、通知出口、轻交互 UI

换句话说，Telegram 壳不是“第二个 Codex”，而是“Codex CLI 的 session router + mailbox”。

## 3. Codex 里已经有的能力

基于当前仓库，可以直接复用的部分有：

### 3.1 AGENTS.md

仓库已经明确支持 `AGENTS.md`，而且有分层 agent 指令作用域文档。

可复用结论：

- 不要在壳里另造一套 prompt policy system
- 壳只需要决定 session 的工作目录和上下文边界
- 真正的行为约束继续交给仓库/目录级 `AGENTS.md`

参考：

- `docs/agents_md.md`
- https://developers.openai.com/codex/guides/agents-md

### 3.2 Skills

仓库已经支持 skills，并且当前环境本身就在使用 `SKILL.md` 技能体系。

可复用结论：

- 不要重新定义 skill schema
- 壳只需要支持“启用哪些 skills”和“从哪里加载 skills”
- 如果你想兼容 Anthropic 通用 skills，最实用的做法是做一个“兼容层”，而不是重写 skill engine

参考：

- `docs/skills.md`
- https://developers.openai.com/codex/skills

### 3.3 MCP

Codex 已经支持 MCP server 连接和自己的 MCP server interface。

可复用结论：

- 不要在 Telegram 壳里直接做一套工具协议
- 优先让 Codex 通过它已有的 MCP 配置和审批链来接工具
- 壳只需要管理哪些 MCP server 可用、哪些默认挂载到哪个长期 session

参考：

- `docs/config.md`
- `codex-rs/docs/codex_mcp_interface.md`

### 3.4 非交互运行与会话恢复

Codex 已支持 `codex exec`、JSONL 事件输出、`resume` 这类自动化接口。

这意味着你的壳完全可以把 Codex 当作“长期 session engine”来驱动，而不是自己重做 session runtime。

参考：

- `codex-rs/exec/src/cli.rs`
- `docs/codex-multi-agent-findings.md`

### 3.5 Telegram bridge

仓库已经有一个非常薄的 Telegram bridge：

- `plugins/telegram-codex/telegram-codex-bridge.mjs`

但它当前只是：

- `getUpdates` 长轮询
- 收到消息后跑一次 `codex exec -`
- 等 Codex 退出后回一个最终消息

它没有：

- 流式输出
- CLI session 映射
- resume 路由
- 审批交互
- 并发控制

所以它可以作为原型起点，但需要补上一层很薄的 session mapping。

## 4. 哪些能力不要重复开发

最容易重复造轮子的地方有四个：

### 4.1 不要重做 prompt orchestration

`AGENTS.md`、skills、developer instructions 这类提示词拼装应该仍由 Codex Runtime 负责。

壳只补：

- 用户身份
- Telegram chat 到 session 的映射
- heartbeat/cron 注入的“系统事件”

### 4.2 不要重做工具系统

工具调用已经存在于 Codex 和 MCP 体系里。

壳不应该直接提供一堆“bot 内置工具”，除非它们是 channel-specific 的：

- `telegram.send_message`
- `telegram.edit_message`
- `telegram.pin_message`
- `telegram.get_chat_meta`

除此之外，尽量通过 MCP 暴露工具。

### 4.3 不要重做 skill runtime

你可以做的是：

- skill 搜索路径配置
- skill enable/disable policy
- Anthropic 风格 `SKILL.md` 的兼容

你不该做的是：

- 再定义第二套技能调度 DSL
- 在壳里解释技能依赖图

### 4.4 不要重做多 agent 控制面

Codex 本身已经有 `spawn_agent`、`send_input`、`wait_agent`、`close_agent` 这类协作工具。

如果未来要做“秘书 agent + 研究 agent + 执行 agent”，优先复用 Codex 的线程树和子 agent 机制，而不是在壳外再做一套 worker pool。

## 5. 推荐总体架构

## 5.1 结构图

```text
Telegram User
   |
   v
Telegram Adapter
   |
   v
Thin Session Mapping Layer
   |- active session pointer
   |- session label -> CLI session ref
   |- backend selector
   |- telegram command router
   |
   v
Codex Runtime
   |- AGENTS.md
   |- Skills
   |- Tools
   |- MCP Clients
   |- Sub-agents
   |
   +--> MCP Servers / Local Tools / External APIs
```

## 5.2 模块职责

### A. Telegram Adapter

职责：

- 接收 Telegram 更新
- 发送消息、编辑消息、发送状态
- 把 Telegram 事件转换成 orchestrator command

建议：

- 生产环境优先 webhook，不优先 `getUpdates`
- 保留 long polling 作为开发模式 fallback

原因：

- Telegram 官方明确说明 `getUpdates` 和 webhook 是互斥的
- `getUpdates` 适合测试，长期运行更适合 webhook

### B. Agent Orchestrator

这里更准确的名字应该改成 `Thin Session Mapping Layer`，不要把它做成重型 orchestrator。

职责：

- 管理 Telegram chat 当前活跃的是哪个 session label
- 管理 session label 对应哪个 CLI session ref
- 在 `main` 和 secondary sessions 之间切换
- 决定这条消息应该 `start` 还是 `resume`
- 记录最少必要的元数据

### C. Codex Runtime

尽量当黑盒复用，只通过稳定接口驱动：

- `codex exec`
- `codex exec resume ...`
- 后续再视情况接 `codex mcp-server` / app-server v2

当前阶段优先使用 CLI，不要一开始就引入更重的 runtime integration。

## 6. 最小状态模型建议

不要一开始就设计一堆表。

MVP 只需要一份很薄的状态数据，JSON 文件都可以，后续再切 SQLite。

### 6.1 chat_state

- `telegram_chat_id`
- `active_session_label`
- `updated_at`

### 6.2 sessions

- `label`
- `backend`
  - `codex`
  - `gemini`
  - `claude-code`
- `cli_session_ref`
- `is_main`
- `created_at`
- `updated_at`

### 6.3 推荐的 JSON 形状

```json
{
  "chat_state": {
    "6994248212": {
      "active_session_label": "main",
      "updated_at": "2026-03-26T20:00:00+08:00"
    }
  },
  "sessions": {
    "main": {
      "backend": "codex",
      "cli_session_ref": "sess_codex_main_123",
      "is_main": true,
      "updated_at": "2026-03-26T20:00:00+08:00"
    },
    "work:autoaide": {
      "backend": "codex",
      "cli_session_ref": "sess_codex_autoaide_456",
      "is_main": false,
      "updated_at": "2026-03-26T20:10:00+08:00"
    }
  }
}
```

这不是重做 session runtime，只是 Telegram 到 CLI session 的路由表。

## 9. 会话模型推荐

不要使用“每条 Telegram 消息启动一次全新 Codex 进程并结束”的模型。

推荐使用“一个长期主 session + 多个可切换 session + 短 turn”模型：

- 默认始终存在一个主 session
- 这个主 session 就是你的全天候个人助理
- 日常没有显式切换时，Telegram 普通消息都进入这个主 session
- 其他 session 用来承载专项工作流，例如：
  - 某个项目
  - 某个客户
  - 某个长期研究任务
  - 某个独立 coding task
- 用户可以随时切换“当前活跃 session”
- cron/heartbeat 可以作用于主 session，也可以作用于某个指定专项 session

更具体地说：

- `main session`
  - 长期存在
  - 负责你日常的 chief-of-staff / personal assistant / inbox triage / reminders / lightweight coordination
- `secondary sessions`
  - 按任务或目标创建
  - 负责需要独立上下文的长期工作
- `active session pointer`
  - Telegram 当前消息默认进入哪个 session，由这个指针决定

推荐默认命名：

- 主 session id：`main`
- 主 session label：`personal-chief-of-staff`

然后在这个模型下：

- 主 session 永远可 resume
- 每个长期目标也可以有自己的 session
- Telegram 用户消息进入当前活跃 session
- cron/heartbeat 进入它们绑定的目标 session
- Codex 每次只执行一个 turn
- turn 结束后把 session 状态持久化

这样有几个好处：

- 日常对话始终有一个稳定归宿，不会“我现在到底在哪个线程里”
- 主助理人格可以长期稳定积累上下文
- 专项任务不会污染主助理上下文
- 任务连续性强
- 可以自然接 `resume`
- heartbeat 能读懂前情提要
- 不必每次重新灌所有背景

### 9.1 你真正需要的默认行为

如果按你的使用习惯，这里应该明确成下面这套规则：

1. 系统启动后，如果不存在 `main` session，就自动创建它。
2. Telegram 普通消息默认进入 `main` session。
3. 当你显式 `/switch <id>` 后，普通消息进入被切换到的 session。
4. 当你 `/home` 时，活跃 session 指针回到 `main`。
5. 即使当前切到别的 session，`main` 仍然继续作为全天候助理存在，并且可以继续承接它自己的 cron/heartbeat。

这和“只有一个线程”不同，也和“每条消息一个新线程”不同。
它更像：

- 一个一直在线的主线程
- 多个按需切换的工作线程

### 9.2 推荐的 session 分类

- `main`
  - 你的默认入口
  - 管理日常事务、汇总、提醒、分发
- `work:<slug>`
  - 针对某个项目或仓库
- `task:<slug>`
  - 针对一个明确目标
- `research:<slug>`
  - 针对一个长期研究主题

重点是：

- Telegram chat 本身不是 session
- Telegram chat 只是 session 的入口和切换界面
- session 才是长期上下文载体

## 10. Telegram 交互层应该长什么样

Telegram 不适合作为重 UI 控制台，它适合“命令 + 通知 + 审批 + 摘要”。

推荐只做四类交互。

### 10.1 用户输入

- 普通消息：追加给当前活跃 session；如果没有切换过，则默认进入 `main`
- `/home`：切回主 session
- `/new <goal>`：创建新 session
- `/sessions`：列出会话
- `/switch <id>`：切换当前会话
- `/where`：显示当前正在使用哪个 session
- `/pause`、`/resume`

建议明确产品语义：

- `/new <goal>`
  - 创建一个新的 secondary session，并自动切过去
- `/switch <id>`
  - 只是切换当前活跃 session，不销毁主 session
- `/home`
  - 永远回到默认主 session
- `/sessions`
  - 列出所有 session，并标明哪个是 `main`、哪个当前活跃

### 10.2 状态播报

- `收到，开始处理`
- `正在运行：检查 PR CI`
- `已完成：日报已发送`
- `卡住：需要你批准发送邮件`

### 10.3 审批卡片

当 Codex 需要执行高风险动作时，Telegram 可以承接 approval router：

- 运行危险命令
- 修改关键文件
- 调用高风险 MCP 工具
- 对外发送消息

### 10.4 摘要而非原始日志

Telegram 回复不要原样倾倒 CLI 日志。

更合理的是：

- 默认发送摘要
- 提供“展开详情”按钮
- 详细日志放 Web 控制台或持久化存储

## 11. 安全设计

全天候 agent 最容易出事的不是“不会做”，而是“做太多”。

至少要有以下边界：

### 11.1 分层权限

- 只读工具默认放开
- 写本地文件需要项目级允许
- 对外副作用默认审批
  - 发邮件
  - 发消息
  - 下单
  - 转账
  - 删除远端对象

### 11.2 MCP allowlist

远程 MCP 比本地 skills 更需要白名单。

建议：

- 每个 session 有允许的 MCP server 列表
- 每个 server 有 tool allowlist
- 高风险 server 单独标红审批

### 11.3 审计

所有这些都要持久化：

- 用户消息
- heartbeat 触发原因
- cron 触发原因
- 工具调用
- 审批决策
- 对外副作用

## 12. 我推荐的落地顺序

### Phase 1: 薄壳 MVP

目标：

- 先把“Telegram + 主 session + 可切换 session + resume”跑通

能力：

- 单用户
- 单工作区
- long polling
- 默认创建并持久化 `main` session
- 支持创建 secondary session
- 支持 active session pointer
- 支持 `codex exec` 和 `resume`
- JSON 文件或极简 SQLite 持久化薄映射状态
- 支持 `/home`、`/new`、`/sessions`、`/switch`

不要做：

- 多 agent UI
- 重型 orchestrator
- 任务账本
- heartbeat / cron
- 全量 MCP 管理台

### Phase 2: 轻量增强

目标：

- 提升可用性，但仍保持 CLI-first

能力：

- 每 chat 串行锁
- resume 失败恢复策略
- backend 抽象
  - `codex`
  - `gemini`
  - `claude-code`
- 更好的状态播报
- 更稳的 webhook 支持

### Phase 3: 生产化

目标：

- 稳定、安全、可运营

能力：

- webhook 模式
- 流式状态回传
- Web 管理台
- 细粒度权限
- MCP allowlist
- 监控告警
- 多 session 管理

## 13. 技术选型建议

如果你想最快做出来，我建议：

- Thin Mapping Layer: TypeScript/Node.js
- State store: JSON 起步，后续可切 SQLite
- Telegram: webhook 为主，long polling 为开发 fallback
- Codex 接入：
  - MVP 用 `codex exec` / `resume`
  - 稳定后再评估 `codex mcp-server` 或 app-server v2

原因很简单：

- 你仓库里已经有 Node 版 Telegram bridge
- Telegram 生态在 Node 上很顺手
- 先做薄映射层比一上来做重型编排更快验证价值

## 14. 关于 Anthropic 通用 skills 的兼容

你提的这个方向是对的，但建议谨慎定义边界。

建议支持：

- `SKILL.md` 发现
- skills 搜索路径
- skill 元信息索引
- 手动启用/默认启用策略

建议不要承诺：

- 100% 兼容任意 Claude/Anthropic skill 的全部隐式行为

更现实的说法应该是：

> 壳层支持加载 Anthropic 风格的 `SKILL.md` 资源，并把它们交给 Codex 的现有技能机制或兼容适配层消费。

这比“完全兼容 Anthropic skills runtime”要稳妥得多。

## 15. 关键设计判断

### 判断 1

`AGENTS.md` / skills / MCP / tools 和 Codex 现有能力高度重叠。

所以：

- 应该复用
- 不应该在壳里再实现一遍

### 判断 2

当前阶段真正新增的核心价值，不是 scheduler，而是：

- 主 session
- secondary sessions
- active session pointer
- Telegram 到 CLI session 的薄映射
- backend 可切换能力

所以：

- 应该重点做 session label、resume 路由、backend adapter
- 不应该把大量时间花在重新造 agent core 或重型调度系统

### 判断 3

当前产品的正确抽象是“CLI-first 的长期 session router”，不是“Telegram bot + shell wrapper”，也不是“第二个 Codex orchestrator”。

## 16. 推荐的最终产品定义

一句话定义：

> 这是一个以 Telegram 为入口、以 Codex 为内核、以 scheduler 为驱动的长期运行个人 agent orchestrator。

它的最小闭环应该是：

1. 你在 Telegram 发任务
2. 壳把任务路由到已有长期 session
3. Codex 在该 session 中调用原生 skills / tools / MCP 推进
4. cron 和 heartbeat 在后续继续推进未完成工作
5. 有副作用动作时通过 Telegram 请求审批
6. 结果和状态再通过 Telegram 回来

## 17. 参考资料

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Webhooks Guide: https://core.telegram.org/bots/webhooks
- Anthropic Claude Code MCP: https://code.claude.com/docs/en/mcp
- OpenAI Codex `AGENTS.md`: https://developers.openai.com/codex/guides/agents-md
- OpenAI Codex Skills: https://developers.openai.com/codex/skills
- OpenAI Codex Config / MCP: https://developers.openai.com/codex/config-reference

仓库内相关参考：

- `plugins/telegram-codex/telegram-codex-bridge.mjs`
- `plugins/telegram-codex/README.md`
- `docs/agents_md.md`
- `docs/skills.md`
- `docs/config.md`
- `docs/codex-multi-agent-findings.md`
- `codex-rs/docs/codex_mcp_interface.md`

## 18. 下一步建议

下一步最值得写的不是代码，而是两个补充文档：

1. `MVP PRD`
2. `事件与数据模型详细设计`

如果你愿意，我下一步可以直接继续把这份草案扩成：

- 一份更正式的 RFC
- 一份 MVP 功能清单
- 一份数据库 schema + API 设计
- 一份 Telegram 命令与交互流设计
