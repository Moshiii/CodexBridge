# CodexBridge 架构审计报告

日期：2026-06-18

## 执行摘要

CodexBridge 目前已经是一个可工作的本地运行时：它可以把 Telegram 和飞书里的 IM 消息接到一台已经登录 Codex CLI 的本机环境里，再把 Codex 的输出回传到原来的聊天窗口。项目已经具备一些有实际价值的产品基础设施，包括按 bot 隔离的运行目录、Telegram 和飞书通道适配器、会话路由、本地 Web 控制台、workspace 初始化文件、skills、goals、schedules，以及一个简单的按用户扣减 credits 的机制。

这个项目的价值在于它已经解决了最关键的第一段链路：`聊天消息 -> 路由到用户/会话 -> 运行本机 Codex -> 返回结果`。但如果按你的目标商业模式来看，它现在更接近一个高级用户自托管原型，而不是一个可以直接收费的多人服务。当前主要缺口是生产级身份体系、计费、账务、用户隔离、运维、访问控制和失败语义。

总体架构评分：**6.4 / 10**

商业化准备度评分：**3.2 / 10**

Mac mini 私有 beta 准备度评分：**6.8 / 10**

## 基于当前目标理解的产品意图

目标产品可以概括为：

> 一台专用 Mac mini 运行已经登录的 Codex 环境和 CodexBridge。用户通过 Telegram 或飞书与 CodexBridge 交互。CodexBridge 把每个用户的输入路由到 Codex，把输出返回同一个 IM 通道，同时隔离用户和会话，记录用量，并最终按用量收费。

这意味着 CodexBridge 并不是要把 Codex 作为云模型服务来托管。它更准确的定位是：围绕本地已认证 Codex CLI 运行时的一层桥接与控制层。

长期会话原则见 [公开群聊入口与个人会话隔离原则](./public-group-private-conversation-principle.md)。核心约束是：群聊只是免费公开体验入口，不是多人共享 conversation；群聊中的 conversation 仍然归发起用户，回复公开发回群里。

## 当前系统形态

本次审计查看的证据：

- CLI 入口：`bin/codexbridge.mjs`
- Bot / runtime / config：`src/config.mjs`、`src/bots.mjs`
- Codex 执行：`src/codex-runner.mjs`
- 通道抽象：`src/channel-adapters.mjs`、`src/channel-envelope.mjs`
- Telegram 桥接：`plugins/telegram-codex/telegram-codex-bridge.mjs`
- 飞书桥接：`plugins/feishu-codex/feishu-codex-bridge.mjs`
- 会话路由：`src/session-routing.mjs`
- Credits：`src/user-credits.mjs`
- 控制台：`src/control-plane-web.mjs`、`src/web-runtime.mjs`
- Workspace / bootstrap：`src/workspace-bootstrap.mjs`、`src/workspace-context.mjs`
- Goals / schedules：`src/goal-controller.mjs`、`src/goal-runner.mjs`、`src/goals-state.mjs`、`src/schedules-state.mjs`
- 测试：`test/unit/*.mjs`

运行模型：

```text
Telegram / 飞书
  -> 通道桥接进程
  -> 标准化消息 envelope
  -> 解析用户/聊天会话
  -> 扣减 credits
  -> 构建 workspace prompt
  -> codex exec / codex exec resume
  -> 解析 Codex JSON 事件
  -> 把输出发回 IM
```

控制模型：

```text
codexbridge CLI / 本地 Web 控制台
  -> ~/.codexbridge/control 下的 registry
  -> ~/.codexbridge/bots/<bot-id> 下的 bot home
  -> 每个 bot 独立的 config、workspace、logs、goals、schedules、skills、credits
```

## 模块评分

| 模块 | 评分 | 评估 |
|---|---:|---|
| CLI 入口和本地操作体验 | 7.0 | 命令覆盖较广，也有交互式配置。对单一 operator 很有用。但本地管理员命令和付费用户产品操作还需要更清晰地分离。 |
| Bot registry 和运行时生命周期 | 7.2 | 多 bot 生命周期、pid 文件、日志、启停、重启、健康检查、rollout 辅助功能都有价值。JSON 状态和 pid 管理在崩溃或并发场景下仍偏脆弱。 |
| 配置和文件系统布局 | 6.8 | 按 bot 隔离的 `~/.codexbridge/bots/<id>` 是一个好基础。但 secrets 以明文 JSON 保存，除了 normalize 外没有迁移/版本框架。 |
| 通道 adapter 抽象 | 6.5 | Telegram 和飞书都被清晰注册了。但 adapter 接口目前很薄，只包含是否配置完成、摘要、脚本路径；还没有标准化 capability、队列策略、文件支持、计费行为。 |
| Telegram 桥接 | 7.4 | 当前最成熟的通道。支持 polling、显式 mention、私聊/群聊 allow list、metadata、文件上传/下载安全处理、会话路由、credits、stop、status、输出截断。风险是单文件过大，以及队列行为和飞书不一致。 |
| 飞书桥接 | 5.9 | 已经可以作为基础飞书 WebSocket 事件桥使用，支持 mention 识别、去重、队列、credits、会话持久化和回复。但和 Telegram 的功能不完全对齐，尤其缺少文件处理和更深的管理命令。 |
| Codex runner | 6.6 | 能正确包装 `codex exec` 和 resume，解析 JSON，输出流式状态摘要。缺少 timeout 策略、结构化错误类型、重试、成本元数据和更强的进程沙箱。 |
| 会话路由 | 7.0 | 方向简单且正确：私聊按 channel/user，群聊按 channel/chat/user。它符合“群聊公开入口、个人会话隔离”的长期原则。下一步应补免费群聊/付费私聊的权限和额度策略。 |
| 用户 credits | 5.4 | 对用量 gating 是有用原型。有文件锁和用户余额。但不够支撑付费：没有流水账、价格计划、支付集成、退款、管理员充值 API、审计记录。 |
| Capability policy | 5.8 | 对 goal/schedule 和 stop task 已有 owner/admin 检查。但权限面太窄，不足以支撑商业多人访问控制。 |
| Web 控制台 | 6.2 | 对 Mac mini 运维很有用，覆盖 bots、logs、sessions、chat、config、Telegram pairing、goals、schedules、workspace、skills。但没有 auth、CSRF、RBAC 或硬化 API 边界，目前必须只作为 localhost 控制台。 |
| Workspace bootstrap/context | 6.7 | 提供了每个 bot 的持久身份和上下文注入，对个人助手体验有用。但如果一个 bot workspace 被多个付费用户共享，隐私边界不够强。 |
| Goals 和 schedules | 5.8 | 有野心，也部分实现了。今天更适合作为本地/admin 功能。IM 桥接现在把管理操作导向 CLI/Web，这是合理的。付费开放前还需要可靠性和用户可见状态模型。 |
| Skills | 5.9 | 本地扩展性不错，从路径安装 skill 很实用。但如果暴露给用户会有风险，需要 trust model、review、权限和安全执行边界。 |
| 可观测性和日志 | 5.6 | 有 logs 和 health checks。缺少结构化事件日志、指标、告警、trace ID、用量分析和事故排查工具。 |
| 测试 | 6.8 | 69 个单元测试通过，覆盖了关键 primitive。缺少真实/录制的 Telegram 和飞书集成流、崩溃恢复、并发文件状态写入、计费不变量测试。 |
| 安全姿态 | 3.8 | 对本地个人使用或私有 beta 可以接受。还不能公开暴露或给付费用户使用。主要风险：明文 secrets、未认证 Web 控制台、本地 Codex 可访问主机文件系统、没有 tenant 沙箱、审计能力弱。 |

## 已经有用的部分

1. **核心桥接概念已经成立。** 从 Telegram/飞书消息到 Codex 执行再回传的路径已经实现。

2. **按 bot 划分 runtime home 是正确基础。** 未来付费服务可以把客户、workspace 或 assistant 映射到 bot home。

3. **会话路由 primitive 方向正确。** `channel:user` 和 `channel:chat:user` 能避免群里所有人意外共享同一个 Codex thread。这应被明确为长期原则，而不是临时实现细节。

4. **Credits 证明了用量 gating 可以接入。** 代码里已经有一个可以挂接付费使用限制的位置。

5. **本地 Web 控制台有战略价值。** 对 Mac mini 部署来说，它是一个实用 operator dashboard。

6. **Telegram 接近私有 beta 质量。** 它已经有足够的控制项和安全检查，可以给友好用户测试。

7. **关键状态 primitive 有测试。** 这会降低后续向商业化架构重构的风险。

## 还不够有用或应该降优先级的部分

1. **Rollout/canary helper 现在偏早。** 对当前商业目标来说，它们不如身份、计费和隔离重要。

2. **Goals/schedules 对付费启动是次要功能。** 它们强大，但会带来可靠性和用户预期风险。付费核心产品应先把普通 chat turn 的计量做好。

3. **Skills 更适合作为后期用户功能。** Skill install 对 operator 有用，但没有权限和沙箱前，不适合面向客户开放。

4. **CLI 视觉识别不是当前商业关键。** 它能提升感觉，但不能解决付费多人运营问题。

5. **当前 credits 实现不能当作 billing。** 它是 quota counter，不是金融账务基础设施。

## 关键风险

### 1. 用户隔离强度不足

当前隔离：

- Bot home 隔离 bot 状态。
- Conversation session 隔离 Codex thread ref。
- Telegram 和飞书按 user/chat 标识路由。

缺失的隔离：

- 没有 per-user workspace sandbox。
- 没有 OS 级进程隔离。
- 所有人共享同一个本地 Codex 登录和主机文件系统。
- 如果多个付费用户共享一个 bot/workspace，workspace context 文件可能造成跨用户泄漏。
- 除非通过 Codex 配置和 OS 权限限制，否则 Codex 工具可能影响主机状态。

建议：面向付费用户时，引入明确的 tenant/account/workspace 模型，并在下面几种方式里做选择：

- 一个付费客户对应一个 bot home 和 workspace；
- 一个 bot 下每个付费用户一个 workspace，并做严格路径边界；
- 高信任/高价值客户使用独立 macOS 用户或容器。

### 2. 计费不可审计

当前 `user-credits.json` 只保存余额和 total consumed。它不保存不可变事件。

缺失：

- usage event ledger
- idempotency key
- request ID
- provider/model/runtime metadata
- 失败/退款规则
- 手动调整记录
- payment record
- invoice/export data

建议：把「余额文件里的 credits」替换为「append-only usage ledger + 派生余额」。

### 3. Web 控制台只能当本地工具

Web server 默认绑定 `127.0.0.1`，这是正确的。但如果暴露到 LAN 或 tunnel，它可以在没有认证的情况下修改配置、读取 workspace 文件、启动 Codex run、编辑文件、安装 skills。

建议：在加入认证、CSRF、防越权、secret redaction 前，不要把它暴露到 localhost 之外。

### 4. 状态存储基于文件，缺少完整并发纪律

有些状态有锁，尤其 credits。但大部分状态写入仍然是普通 JSON 写入。通道事件、Web 操作和 CLI 操作并发时可能产生 race。

建议：低用量私有 beta 可以继续使用 JSON，但要给 bot/session/config/ledger 等可变状态增加锁，或迁移到 SQLite。

### 5. Telegram 和飞书行为不一致

Telegram 在同一会话已有任务时拒绝并发请求；飞书则按 route 排队。Telegram 支持文件流程，飞书不支持。这会让产品行为难以解释。

建议：定义 channel capability matrix，并统一策略：排队/拒绝、文件支持、mention 行为、扣费时机、stop 语义。

## 架构建议

### 近期：Mac mini beta 架构

保留当前架构，但加强硬化：

```text
Mac mini
  ~/.codexbridge/
    control/
    bots/
      <bot-id>/
        config.json
        workspace/
        sessions
        usage-ledger.jsonl
        logs/
```

需要新增：

- append-only usage ledger
- per-user profile registry
- 明确账户状态：trial、active、suspended
- 仅管理员可用的充值和调整命令
- secret redaction 后的配置视图
- 全局事件日志
- 一致的 per-route queue 策略
- 明确警告 Web 控制台只能 localhost 使用

### 中期架构

把运行时产品状态从多个 JSON 文件迁移到 SQLite：

- `users`
- `identities`
- `bots`
- `workspaces`
- `conversations`
- `runs`
- `usage_events`
- `credit_adjustments`
- `payments`
- `channel_messages`
- `audit_events`

Workspace 文件仍然放在磁盘上，但产品关键记录放到数据库。

### 长期架构

如果要对真实用户收费：

- 把 admin control plane 和 end-user chat product 分开；
- 集成 Stripe 或其他支付服务；
- 按 bot/workspace/process user 隔离高价值客户；
- 增加备份和灾难恢复；
- 明确定义 ToS/privacy，说明用户 prompt 会被路由进本地已登录的 Codex CLI。

## 按模块行动优先级

| 优先级 | 领域 | 行动 |
|---|---|---|
| P0 | 安全 | Web 控制台保持 localhost-only；远程访问前先加 auth。 |
| P0 | 计费 | 收费前先增加不可变 usage ledger。 |
| P0 | 隔离 | 固化“群聊公开入口、个人 conversation 隔离、私聊付费私人入口”的产品规则。 |
| P0 | Secrets | API 响应和日志中 redacts tokens，避免直接暴露 raw config。 |
| P1 | 身份 | 增加用户 profile，把 Telegram ID 和飞书 open_id 映射到同一个 account。 |
| P1 | 队列 | 统一各通道的 per-user/session 排队或拒绝行为。 |
| P1 | 可靠性 | 对 sessions/config/runs 加状态锁，或迁移到 SQLite。 |
| P1 | 可观测性 | 增加结构化 run records 和 operator dashboard metrics。 |
| P2 | 飞书 | 把飞书能力补到接近 Telegram。 |
| P2 | 支付 | usage ledger 完成后再接支付服务。 |
| P3 | Goals/Skills | 权限和计费语义稳定后再对用户开放。 |

## 最终架构判断

CodexBridge 有可信的技术核心，也符合「Mac mini 上运行本机 Codex 桥接器」这个方向。现有代码不是要推倒重来；bot runtime、channel bridge、session routing、control plane 和 credits 都是有用基础。

主要架构转向应该是：从「带 IM adapter 的本地 assistant runtime」转成「按量计费的多人访问 gateway」。这意味着下一步真正重要的工作不是继续增加聊天功能，而是身份、计费流水、隔离、安全和运维可靠性。
