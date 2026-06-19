# CodexBridge PRD 与工程差距报告

日期：2026-06-18

## 1. 产品定义

### 产品名称

CodexBridge

### 长期会话原则

本 PRD 采用 [公开群聊入口与个人会话隔离原则](./public-group-private-conversation-principle.md)：

> 群聊是免费公开体验入口，不是多人共享 conversation。每个用户在群里也拥有自己的独立 conversation，只是回复公开发回群里。

### 一句话描述

CodexBridge 把一台专用 Mac mini 上已经登录的 Codex CLI 环境接入 Telegram 和飞书，让经过授权的用户可以通过 IM 聊天使用 Codex，同时由 operator 管理访问权限、用量和计费。

### 目标用户

主要 operator：

- 你本人，运行一台已经登录 Codex 的专用 Mac mini。
- 你负责配置 Telegram 和飞书 bot、管理用户、监控用量，并按使用量收费。

终端用户：

- 想通过 Telegram 或飞书使用你的 Codex 环境，但不直接登录你机器的人。
- 他们通过发送普通聊天消息交互，并在同一个 IM thread 里收到 Codex 输出。

### 核心价值主张

用户可以方便地通过 IM 访问一个强大的本地 Codex agent。operator 可以集中控制谁能使用、用了多少、应该付多少钱。

## 2. 基于当前实现的实际 PRD

### 2.1 Bot 管理

当前实现：

- 创建、列出、查看、启用、禁用、删除 bots。
- 启动、停止、重启 bot runtimes。
- 在 `~/.codexbridge/control` 下维护 bot registry。
- 在 `~/.codexbridge/bots/<bot-id>` 下维护 per-bot home。
- 跟踪 runtime pid、logs、health、desired/running version。

主要入口：

- CLI：`codexbridge bot ...`
- Web：`/api/bots`、`/api/bots/:id/start`、`/api/bots/:id/config` 等。

当前状态：**已实现，可用于私有 beta。**

与愿景的差距：

- Bot 是当前最接近 tenant/workspace 的实体，但还没有正式产品化。
- 没有价格、owner account、subscription 或比 enabled/disabled 更完整的生命周期状态。

### 2.2 通道集成

当前 Telegram 行为：

- 长轮询 Telegram Bot API。
- 支持私聊和群聊。
- 支持私聊、群聊、群用户 allow list。
- 群聊需要显式 mention。
- 捕获 Telegram metadata。
- 支持文本消息和 document 上传。
- 上传文件保存到 workspace 的 `inbox/`。
- 把文本输出发回 Telegram。
- 支持 `/start`、`/help`、`/where`、`/credits`、`/stop`。

当前飞书行为：

- 使用 Lark/飞书 WebSocket client。
- 处理 `im.message.receive_v1`。
- 支持私聊和群消息。
- 支持显式 mention 逻辑。
- 捕获基础 metadata。
- 只支持文本。
- 按 conversation route 排队请求。
- 支持 `/start`、`/help`、`/where`、`/credits`、`/stop`。

当前状态：

- Telegram：**已实现，beta 质量更强。**
- 飞书：**已实现，但 beta 质量更薄。**

与愿景的差距：

- 通道功能还没有完全对齐。
- 飞书缺少文件支持和更丰富的管理流程。
- 没有 channel-level product capability matrix。
- 没有跨通道统一的队列策略。

### 2.3 Codex 执行

当前实现：

- 执行 `codex exec --skip-git-repo-check --json -`。
- 通过 `codex exec resume --skip-git-repo-check --json __SESSION_ID__ -` 恢复会话。
- 从 bot config 或环境变量注入 model。
- 解析 Codex JSON 输出中的 thread ID 和最终 agent message。
- 支持通过 child process signal 停止。
- 从 Markdown 文件注入持久 workspace context。

当前状态：**已实现，是产品核心。**

与愿景的差距：

- 没有 per-run timeout 或 retry 策略。
- 没有为每次请求持久化结构化 run object。
- 没有 model/provider 成本元数据。
- 没有强 host sandbox。
- 没有清晰的失败 run 和计费规则。

### 2.4 对话线程管理

当前实现：

- Session key 从 channel、chat、user 派生。
- 私聊 session key：`channel:user:<userId>`。
- 群聊 session key：`channel:chat:<chatId>:user:<userId>`。
- Telegram 把 router state 存在通道状态 JSON 中。
- 飞书把 router state 存在通道状态 JSON 中，并同步到 CLI state。
- Web 控制台可以管理一个 bot 的 sessions。

当前状态：**基础实现完成，且群聊按 `chatId + userId` 隔离的方向符合长期原则。**

与愿景的差距：

- 免费群聊和付费私聊的权限还没有产品化。
- 群聊每日免费额度还没有实现。
- 群聊公开回复、个人 conversation 隔离的规则还需要写进测试和用户提示。
- 没有可搜索的 conversation history。
- 没有按用户查看 conversation 用量的 admin 视图。
- 没有 retention policy。

### 2.5 用户资料

当前实现：

- Telegram 和飞书 metadata 被捕获到 bot config 内。
- Credits 按原始 channel user ID 记录。
- Bot config 中存在 owner/admin IDs。

当前状态：**部分实现。**

与愿景的差距：

- 没有一等 `User` 实体。
- 没有 profile 字段：display name、email、channel identities、plan、status、created date。
- 无法把 Telegram 和飞书身份合并为同一个可计费客户。
- 没有邀请、onboarding、审批流程。

### 2.6 用量管理

当前实现：

- 每个用户默认获得初始 credits。
- 每个普通 turn 扣 1 credit。
- 每个 bot 的 `user-credits.json` 存储余额和 total consumed。
- 文件锁保护 credit 更新。
- `/credits` 命令显示余额。

当前状态：**原型已实现。**

与愿景的差距：

- 没有不可变 usage ledger。
- 没有 run ID 或 message ID 关联。
- 没有按 model 计价。
- 没有退款逻辑。
- 没有日/月报表。
- 没有 admin top-up 或 adjustment 流程。
- 没有 quota reset plan。

### 2.7 付费计费

当前实现：

- 没有真实支付系统。
- Credits 只是内部 quota。

当前状态：**未实现。**

与愿景的差距：

- 需要 payment provider。
- 需要 payment records。
- 需要 invoice/export。
- 需要预付 credits 或 subscription 规则。
- 需要余额耗尽后的 suspension 行为。
- 需要法律和退款政策。

### 2.8 用户隔离

当前实现：

- Per-bot home directories。
- Per-user session routing。
- 群消息按 chat 和 sender 分别路由。
- Workspace 是 per bot，不一定是 per user。

当前状态：**部分实现。**

与愿景的差距：

- 如果多个付费用户共享一个 bot workspace，workspace 文件和 context 可能泄漏。
- Codex runs 发生在同一个 host account 下。
- 没有 per-user filesystem sandbox。
- 没有 per-user tool permissions。
- 没有数据删除/export 流程。

### 2.9 Admin 控制台

当前实现：

- 本地 Web 控制台支持 bot list、status、logs、sessions、chat、config、Telegram pairing、goals、schedules、workspace、skills。
- 支持 Web runtime pid/status/restart 管理。

当前状态：**有用的本地 admin 工具。**

与愿景的差距：

- 没有 login/auth。
- 没有 RBAC。
- 没有 secret redaction 保证。
- 没有 billing/user management 页面。
- 没有 audit log。
- 不适合远程暴露。

## 3. 愿景差距总结

| 产品需求 | 当前状态 | 差距严重度 |
|---|---|---:|
| Telegram 输入输出接到 Codex | 已实现 | 低 |
| 飞书输入输出接到 Codex | 已实现 | 中 |
| 专用 Mac mini hosting | 本地 runtime 支持 | 中 |
| 多用户访问 | 部分支持 | 中 |
| 对话隔离 | 基础 session 隔离 | 中 |
| 用户资料 | 只有 metadata | 高 |
| 用量追踪 | credits 原型 | 高 |
| 付费计费 | 缺失 | 严重 |
| Tenant/workspace 隔离 | 部分支持 | 严重 |
| Admin 控制台 | 仅本地可用 | 高 |
| 安全硬化 | 很少 | 严重 |
| 运维可靠性 | 基础 logs/pids | 高 |

## 4. 推荐产品方向

### Phase 0：重新定位项目

把 CodexBridge 定义为：

> 一个面向 IM 通道的本地 Codex access gateway。

避免宣称：

- cloud hosting
- autonomous SaaS platform
- secure multi-tenant agent runtime
- complete billing product

当前适合使用的产品语言：

- self-hosted
- Mac mini operator
- approved users
- usage-gated beta
- Telegram and Feishu bridge

### Phase 1：Mac mini 私有 beta

目标：

用少量可信用户测试 CodexBridge，同时避免明显的运营和计费混乱。

必需工程：

1. 增加 `users.json` 或 SQLite `users` 表。
2. 增加 channel identity mapping：
   - Telegram user ID
   - Feishu open ID
   - display name
   - account status
3. 增加不可变 `usage-ledger.jsonl`。
4. 基于 usage events 扣费，而不是只改余额。
5. 增加 admin 命令或 Web 控件：
   - grant credits
   - deduct credits
   - suspend user
   - view user usage
6. 统一 Telegram 和飞书的队列行为。
7. 在 Web/API 输出中 redacts bot tokens 和 secrets。
8. 明确文档说明 Web 控制台只能 localhost 使用。

上线标准：

- 你可以添加一个用户。
- 用户可以从 Telegram 或飞书发消息。
- 用户获得隔离 session。
- 每次请求都会创建 usage event。
- 你能看到剩余余额和月度 consumed credits。
- 余额为 0 时用户被阻止。
- 你可以手动充值 credits。

### Phase 2：手动付费结算

目标：

基于可靠 usage records 手动向用户收费。

必需工程：

1. 增加可导出的月度用量报表。
2. 增加 manual payment records。
3. 增加账户状态：
   - trial
   - active
   - overdue
   - suspended
4. 增加 pricing config：
   - credit price
   - free trial credits
   - per-turn cost
   - optional per-model multiplier
5. 增加 refund/failed-run 规则。
6. 增加用户和余额的 operator dashboard。

上线标准：

- 你可以把 usage 和 payment 对账。
- 每一次余额变化都能解释。
- 失败或中断 run 有明确计费结果。

### Phase 3：支付集成

目标：

用户可以自动付款并获得 credits。

必需工程：

1. 集成 payment provider。
2. 存储带 provider ID 的 payment records。
3. 增加 webhook handling。
4. 对 payment credit grants 做 idempotency。
5. 增加 receipts/invoice exports。
6. 增加自动 suspension/reactivation。

上线标准：

- 一笔支付只创建一次 credits。
- 重复 webhook 不会重复加 credits。
- Admin 可以审计每一笔 payment 和 credit movement。

### Phase 4：更强隔离和规模化

目标：

随着用户增长，降低隐私和运维风险。

必需工程：

1. 把产品状态迁移到 SQLite。
2. 增加 per-user 或 per-tenant workspaces。
3. 增加 workspace path enforcement。
4. 增加 backup/restore。
5. 增加 structured logs 和 metrics。
6. 用 launchd 或正式 service manager 做进程监督。
7. 对高价值客户考虑 per-tenant macOS users 或 containers。

## 5. 现在建议做的工程调整

### 调整 1：引入产品实体

增加明确的领域对象：

```text
UserAccount
ChannelIdentity
Bot
Workspace
Conversation
Run
UsageEvent
CreditAdjustment
PaymentRecord
```

不要继续把 `config.json` 扩张成产品数据库。

### 调整 2：把余额型 credits 改成 ledger 型 credits

当前：

```text
user-credits.json
  accounts[userId].balance
  accounts[userId].totalConsumed
```

建议：

```text
usage-ledger.jsonl
  event_id
  user_id
  channel
  chat_id
  message_id
  run_id
  amount
  event_type: charge | refund | grant | adjustment
  reason
  created_at
```

余额应从 ledger 派生，或以可 reconcile 的方式缓存。

### 调整 3：持久化 Run Records

每一次用户请求都应该创建 run record：

```text
run_id
user_id
bot_id
channel
chat_id
message_id
session_label
status
started_at
finished_at
charged_credits
codex_thread_id
error
```

这会给客服、计费和调试提供证据。

### 调整 4：明确通道策略

创建 channel capability matrix：

```text
telegram:
  text: true
  files: true
  queue: reject-or-queue
  group_mentions: required

feishu:
  text: true
  files: false
  queue: queue
  group_mentions: configurable
```

然后让产品行为保持一致，或在文档里明确说明差异。

### 调整 5：硬化 Admin 控制台

远程暴露 Web 控制台前，需要：

- password/session auth
- CSRF token
- secret redaction
- role checks
- mutation audit events
- 默认绑定 localhost
- 非 localhost 绑定必须显式加 flag

### 调整 6：决定 Workspace 隔离规则

首个付费 beta 推荐：

> 一个付费客户拥有一个 bot home 和一个 workspace。

这比让很多互不相关的付费用户共享一个 bot workspace 更简单、更安全。群用法仍然可以存在，但同一个 bot/workspace 里的所有人应该属于同一个客户/account 上下文。

## 6. 下一步应该做什么

推荐下一个 sprint：

1. 增加 user/account registry。
2. 增加 usage ledger。
3. 重构 `chargeTurnCredits`，让它创建 charge events。
4. 为 failed/interrupted runs 增加 refund path。
5. 增加 users 和 credits 的 admin CLI/Web 视图。
6. 在 web detail/config APIs 中 redacts secrets。
7. 增加 ledger idempotency 和 failed-run billing 测试。

## 7. 建议 MVP 范围

MVP 应该包含：

- Telegram 文本聊天
- 飞书文本聊天
- 群聊免费公开入口
- 群聊中每个用户独立 conversation
- 私聊付费私人入口
- approved user allow list
- per-user conversation threads
- 每日免费额度
- credit balance 和 usage ledger
- 手动 credit top-up
- 月度 usage export
- localhost-only admin console

MVP 暂时不应该包含：

- public self-serve signup
- automatic payments
- user-installed skills
- public web dashboard
- guaranteed long-running goals
- 对所有用户开放任意文件处理
- 群聊多人共享同一个 conversation

## 8. 最终产品判断

CodexBridge 已经是一个能工作的 bridge，不只是想法。当前最有价值的模块是 Telegram bridge、bot runtime lifecycle、session routing、Codex runner 和 local control plane。

下一步产品重点不是增加更多 agent 功能，而是把原型变成一个可计量的 access gateway：身份、流水、隔离、admin operations 和安全。等这些稳定后，支付集成会变得直接。没有这些就开始收费，会有较高运营风险，因为用量和责任归属还不够扎实。
