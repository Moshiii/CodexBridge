# CodexBridge 当前开发规划

日期：2026-06-21

## 一、这份规划解决什么问题

这份文档把已有规划重新收口成当前最应该执行的开发顺序。

已参考的现有文档：

- [ROADMAP.md](../ROADMAP.md)
- [公开群聊入口与个人会话隔离原则](./public-group-private-conversation-principle.md)
- [CodexBridge PRD 与工程差距报告](./codexbridge-prd-and-engineering-gap-report.md)
- [CodexBridge 架构审计报告](./codexbridge-architecture-audit-report.md)
- [Session Routing Refactor Checklist](./session-routing-refactor-checklist.md)

当前战略已经明确：

> CodexBridge 不做通用 token/API 转卖。长期方向是 IM-native 的去中心化 Codex 服务：群聊免费公开体验，满意后购买 credits，付费解锁私聊和更高额度。

因此，接下来开发重点不应该继续扩散功能，而应该补齐「增长漏斗 + 用量计费 + 私聊付费」这条闭环。

## 二、当前已经有的基础

### 已经基本完成

1. **Bot-scoped runtime**
   - `~/.codexbridge/bots/<bot-id>`
   - bot registry
   - start/stop/restart/health/logs

2. **Telegram 桥接**
   - 私聊/群聊消息接入
   - 群聊 mention gating
   - allow list
   - 文件上传到 workspace
   - Codex 执行和回传

3. **飞书桥接**
   - WebSocket 事件接入
   - mention 识别
   - 文本消息处理
   - 队列执行
   - Codex 执行和回传

4. **统一 envelope / session routing / capability policy 的第一版**
   - `src/channel-envelope.mjs`
   - `src/session-routing.mjs`
   - `src/capability-policy.mjs`
   - 测试已覆盖私聊和群聊路由。

5. **基础 credits**
   - `src/user-credits.mjs`
   - 每个 bot 内按 userId 建余额
   - 每 turn 扣 1 credit
   - 文件锁保护余额更新

6. **本地 Web 控制台**
   - bot 管理
   - session/chat
   - Telegram pairing
   - config
   - goals/schedules
   - workspace/skills

### 当前测试证据

现有单元测试覆盖：

- session routing
- capability policy
- user credits
- Telegram mention/command parsing
- bot runtime
- config
- web runtime/control plane

这说明代码已经有基础安全网，可以开始做商业闭环重构。

## 三、当前最大缺口

### 1. 免费群聊和付费私聊还没有产品化

文档里已经确定：

```text
群聊 = 免费公开体验入口
私聊 = 付费私人入口
```

但代码现在还没有完整实现：

- 免费用户私聊禁用；
- 群聊每日免费额度；
- paid credits；
- user status；
- 私聊 private unlock；
- 超额后的充值提示。

### 2. Credits 还不是账务系统

当前 `user-credits.json` 是余额文件，不是账务流水。

缺少：

- `UsageEvent`
- `Run`
- grant / charge / refund / adjustment
- request/message/run 关联
- 失败或中断时的扣费规则
- 管理员充值和调整

### 3. User 还不是一等对象

现在用户只是 channel 里的 raw userId。

短期不需要复杂 Account/Tenant，但至少需要：

```text
User
  id = channel:userId
  channel
  externalUserId
  displayName
  status = free | paid | banned | admin
  privateEnabled
  createdAt
  lastSeenAt
```

### 4. Run 还不是一等对象

现在一次 Codex 执行主要存在于内存运行态和 session state 里。

要做付费，必须每次请求都有 run record：

```text
Run
  id
  userId
  conversationId
  channel
  chatType
  visibility
  costSource
  creditsCharged
  status
  createdAt
  finishedAt
```

### 5. Web 控制台还不是商业运营台

现在 Web 控制台更像 bot 运维台。

还缺：

- 用户列表
- 用户状态
- credit 余额
- daily free 使用情况
- usage ledger
- 手动充值/扣减
- ban/unban
- 私聊解锁

## 四、推荐开发阶段

## Phase 1：轻量用户模型与权限闭环

目标：让系统知道谁是 free/paid/banned/admin，以及是否能私聊。

建议新增模块：

- `src/users-state.mjs`

建议新增状态文件：

```text
<botHome>/users.json
```

最小结构：

```json
{
  "version": 1,
  "users": {
    "telegram:123": {
      "id": "telegram:123",
      "channel": "telegram",
      "externalUserId": "123",
      "displayName": "@name",
      "status": "free",
      "privateEnabled": false,
      "createdAt": "...",
      "lastSeenAt": "..."
    }
  }
}
```

开发项：

1. 从 Telegram / 飞书消息自动 upsert user。
2. 用户 id 使用 `channel:userId`。
3. 免费用户允许群聊。
4. 免费用户私聊被拒绝，并提示去群里体验或充值。
5. paid/privateEnabled 用户允许私聊。
6. banned 用户任何入口都拒绝。

测试：

- 新用户自动创建为 free。
- free 用户群聊可用。
- free 用户私聊被拒。
- paid 用户私聊可用。
- banned 用户被拒。

## Phase 2：每日免费额度 + paid credits

目标：实现增长漏斗的核心用量规则。

建议重构 `src/user-credits.mjs`。

当前模型：

```text
balance
totalConsumed
```

建议短期模型：

```text
paidCredits
dailyFreeDate
dailyFreeUsed
dailyFreeLimit
totalUsed
```

扣费规则：

```text
群聊：
  先消耗 daily free quota
  超出后消耗 paid credits
  paid credits 也不足则提示充值

私聊：
  必须 privateEnabled
  消耗 paid credits
  不使用 daily free quota
```

建议 API：

```js
getUserCredits(userId, botHome)
chargeUsage({ userId, chatType, amount, botHome })
grantPaidCredits({ userId, amount, reason, botHome })
```

测试：

- 群聊优先消耗 daily free。
- daily free 每天重置。
- 群聊免费额度耗尽后扣 paid credits。
- 私聊只扣 paid credits。
- paid credits 不足时拒绝。

## Phase 3：UsageEvent ledger

目标：让 credits 可以对账，而不是只改余额。

建议新增：

- `src/usage-ledger.mjs`

建议状态文件：

```text
<botHome>/usage-ledger.jsonl
```

事件类型：

```text
grant
charge
refund
adjustment
deny
```

事件字段：

```text
eventId
userId
channel
chatType
chatId
messageId
runId
amount
source = daily_free | paid_credit | manual
reason
createdAt
```

开发项：

1. 每次 charge 都写 ledger。
2. 每次 grant/adjustment 都写 ledger。
3. denied request 也可以写 `deny`，用于观察转化漏斗。
4. `/credits` 返回余额时附带今日免费额度和 paid credits。

测试：

- charge 会写 ledger。
- grant 会写 ledger。
- 失败时不重复写 charge。
- ledger 可按 userId 查询。

## Phase 4：Run record

目标：每次 Codex 执行都有可追踪记录。

建议新增：

- `src/runs-state.mjs`

建议状态文件：

```text
<botHome>/runs.jsonl
```

Run 生命周期：

```text
queued -> running -> completed
queued -> running -> failed
queued -> running -> stopped
denied
```

开发项：

1. 消息通过权限和扣费前创建 pending/denied record。
2. Codex 开始时记录 running。
3. 成功后记录 completed、output preview、codex thread id。
4. 失败后记录 failed。
5. stop 后记录 stopped。
6. Run 与 UsageEvent 通过 runId 关联。

测试：

- 成功请求生成 completed run。
- 被额度拒绝生成 denied run。
- Codex 失败生成 failed run。
- stop 生成 stopped run。

## Phase 5：Telegram 商业闭环接入

目标：Telegram 先成为完整增长漏斗。

开发项：

1. Telegram 群聊消息：
   - upsert user
   - resolve conversation
   - chargeUsage
   - create Run
   - 公开回复
2. Telegram 私聊消息：
   - upsert user
   - 检查 privateEnabled
   - charge paid credits
   - 私聊回复
3. `/credits` 展示：
   - user status
   - private enabled
   - daily free used / limit
   - paid credits
4. 新增 admin 命令，至少支持：
   - `/grant <userId> <credits>`
   - `/ban <userId>`
   - `/unban <userId>`
   - `/unlock-private <userId>`

注意：admin 命令可以先只在本地 CLI/Web 做，不一定马上放进群聊。

## Phase 6：飞书对齐 Telegram

目标：飞书至少达到文本增长漏斗一致。

开发项：

1. 飞书使用同样的 users / credits / ledger / runs。
2. 飞书群聊按用户 conversation 隔离。
3. 飞书私聊执行 paid-only 规则。
4. `/credits` 输出与 Telegram 对齐。
5. 队列策略和 Telegram 做一次明确选择：
   - 要么都 queue；
   - 要么都同会话 running 时拒绝。

建议：早期统一为 **同一 conversation 正在运行时拒绝新请求**，简单、可解释、少并发账务问题。

## Phase 7：Web 运营台

目标：Web 从 bot 运维台补成轻量商业运营台。

新增页面/区块：

1. Users
   - userId
   - channel
   - displayName
   - status
   - privateEnabled
   - paidCredits
   - dailyFreeUsed
   - lastSeenAt

2. Usage
   - 最近 usage events
   - 按用户过滤
   - 按日期过滤

3. Runs
   - 最近 runs
   - 状态
   - 错误
   - 消耗 credits

4. Admin actions
   - grant credits
   - adjustment
   - unlock private
   - ban/unban

安全前提：

- 仍然只绑定 localhost。
- 不做公网暴露。
- raw config 中 tokens 需要 redaction。

## Phase 8：执行可见性和产品体验

目标：把原 Roadmap 里的 execution visibility 接回来。

在商业闭环完成后，再统一：

- running 状态
- final output
- failed/stopped 文案
- Telegram/飞书/Web 的输出语义
- goal/schedule 的最终输出和普通 run 的关系

这阶段可以复用原 Roadmap Phase B。

## 五、建议优先级

当前最高优先级不是 goal、schedule、skills，也不是更多 channel。

最高优先级是：

1. User 状态
2. 群聊每日免费额度
3. paid credits
4. 私聊付费解锁
5. UsageEvent ledger
6. Run record
7. Telegram 完整闭环
8. 飞书对齐
9. Web 运营台

## 六、当前已有规划需要调整的地方

### 仍然有效

- `ROADMAP.md` 的长期战略方向有效。
- `public-group-private-conversation-principle.md` 是当前最高优先级产品原则。
- `session-routing-refactor-checklist.md` 中 envelope/routing/policy 的方向有效。

### 需要降优先级

- Goal first-class loop 暂时后移。
- Skills 产品化暂时后移。
- Web 视觉重构暂时后移。
- 多 backend 抽象暂时后移。

### 需要新增到主线

- User 模型
- daily free quota
- paid credits
- private unlock
- UsageEvent ledger
- Run record
- Web 运营台

## 七、最小可发布版本定义

一个可测试的 MVP 应该做到：

1. 用户进 Telegram 群。
2. @bot 提问。
3. 系统自动识别用户。
4. 用户每天有 N 次免费额度。
5. 回复公开发在群里。
6. 免费额度耗尽后提示购买 credits。
7. 付费后用户获得 paid credits。
8. paid 用户可以私聊 bot。
9. 私聊消耗 paid credits。
10. Operator 能在 Web/CLI 里看到用户、余额、用量、runs。

这个版本不需要：

- 自动支付；
- 复杂租户；
- 跨平台身份合并；
- public API；
- 用户自助 dashboard；
- 多 worker pool；
- 完整 goal/schedule 商业化。

## 八、下一步开发建议

建议下一次实际编码从 Phase 1 + Phase 2 开始：

1. 新增 `src/users-state.mjs`。
2. 扩展 `src/user-credits.mjs` 为 daily free + paid credits。
3. 修改 Telegram bridge 的 message flow：
   - upsert user
   - 按群聊/私聊判断访问权限
   - 按规则 chargeUsage
4. 增加测试覆盖。

这一步完成后，CodexBridge 就会从“能桥接 IM 到 Codex”进入“有免费试用和付费私聊雏形”的阶段。

