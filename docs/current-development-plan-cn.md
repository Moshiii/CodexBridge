# CodexBridge 当前开发规划

日期：2026-06-22

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

因此，接下来开发重点不应该继续扩散功能，而应该先稳住「增长漏斗 + 用量计费 + 私聊付费」闭环，再把已经跑通的功能收敛成更常规、可维护的工程架构。

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
   - Operations：Users / Usage / Runs / grant / deduct / ban / unlock private

7. **商业闭环 MVP**
   - `src/users-state.mjs`
   - `src/user-credits.mjs`
   - `src/usage-ledger.mjs`
   - `src/runs-state.mjs`
   - Telegram / 飞书文本入口接入同一套 users、credits、ledger、runs 状态文件
   - 新用户默认 `paidCredits = 0`，群聊只有每日免费额度；付费额度必须由运营台或后续支付系统 grant/adjust
   - Web config API 返回 token/appSecret 时做服务端 redaction，保存 `[redacted]` 不覆盖真实 secret
   - 飞书 bridge 已改为可安全 import，避免单测或 helper import 时误启动外部连接

### 当前测试证据

现有单元测试覆盖：

- session routing
- capability policy
- user credits
- usage ledger
- run records
- Telegram mention/command parsing
- Telegram paid private gating
- Feishu bridge helper import / paid private gating
- bot runtime
- config
- web runtime/control plane
- Web Operations API
- Web config secret redaction

当前验证：`npm test` 通过，113 个测试全部通过。

## 三、当前进度与已完成项

### 已完成

1. **Phase 1：轻量用户模型与权限闭环**
   - 已新增 `src/users-state.mjs`。
   - 用户 id 使用 `channel:userId`。
   - 支持 `free | paid | banned | admin`。
   - 支持 `privateEnabled`。
   - Telegram / 飞书消息会自动 upsert user。
   - 免费用户群聊可用，私聊被拒。
   - paid/admin/privateEnabled 用户可私聊。
   - banned 用户所有入口拒绝。

2. **Phase 2：每日免费额度 + paid credits**
   - `src/user-credits.mjs` 已支持 `paidCredits`、`dailyFreeDate`、`dailyFreeUsed`、`dailyFreeLimit`、`totalConsumed`。
   - 群聊优先消耗 daily free。
   - daily free 用完后才消耗 paid credits。
   - paid credits 不足时拒绝。
   - 私聊只消耗 paid credits。
   - 新用户默认 `paidCredits = 0`，避免免费用户绕过每日额度。
   - 支持 `grantPaidCredits` 和 `adjustPaidCredits`。

3. **Phase 3：UsageEvent ledger**
   - 已新增 `src/usage-ledger.mjs`。
   - charge / grant / adjustment / deny 会写入 JSONL ledger。
   - UsageEvent 与 user/channel/chat/message/run 关联。

4. **Phase 4：Run record**
   - 已新增 `src/runs-state.mjs`。
   - 支持 queued / running / completed / failed / stopped / denied。
   - Telegram / 飞书请求会创建 run record。
   - UsageEvent 与 Run 通过 `runId` 关联。

5. **Phase 5：Telegram 商业闭环接入**
   - Telegram 群聊/私聊已接入 users、credits、ledger、runs。
   - `/credits` 展示 user status、private enabled、daily free、paid credits。
   - 同一 conversation 正在运行时拒绝新请求，避免并发账务复杂化。
   - admin 操作暂时放在 Web Operations，不放进群聊命令。

6. **Phase 6：飞书对齐 Telegram**
   - 飞书文本入口已使用同样的 users / credits / ledger / runs。
   - 飞书群聊按用户 conversation 隔离。
   - 飞书私聊执行 paid-only 规则。
   - `/credits` 输出与 Telegram 对齐。
   - 同一 conversation 正在运行时拒绝新请求。
   - 按要求没有做飞书外部连通测试，只做本地 helper / 语法 / 单元测试。

7. **Phase 7：Web 运营台**
   - 已新增 Operations tab。
   - 支持 Users、Usage、Runs 查看。
   - 支持 grant、deduct、ban/unban、unlock/lock private。
   - API 包括 users、usage、runs、grant、adjust、status、private。
   - raw config 中 token/appSecret 已做服务端 redaction。
   - Web 运营操作已写入 admin audit log。

8. **Phase 8：业务服务层与可维护性整理**
   - 已新增 `src/billing-service.mjs`，统一扣费、授信、调整、退款和 denied 文案。
   - 已新增 `src/run-service.mjs`，统一 run lifecycle 更新。
   - 已新增 `src/chat-request-service.mjs`，统一 IM 普通请求的用户识别、权限检查、run 创建和扣费。
   - Telegram / 飞书普通文本请求已接入同一套 `chat-request-service`。
   - 已新增 users / credits / usage-ledger / runs repository wrapper，先保留 JSON / JSONL 存储。
   - 已新增 config schema validator，配置写入前会做结构校验，并拒绝持久化 `[redacted]` secret。
   - 已新增结构化 JSONL bridge logging。
   - paid credit refund 已有基础实现；daily free 扣费不会退款。
   - 已新增 state migration runner，可通过 CLI `/migrate` 对当前 bot 执行幂等迁移。
   - Web 控制台已支持可选 operator token 鉴权，设置 `CODEXBRIDGE_WEB_TOKEN` 后启用。

### 本轮审计已修复的严重问题

1. 新用户默认 100 paid credits，已改为 0。
2. Web API 可能返回 Telegram token / Feishu appSecret，已改为 `[redacted]`。
3. 保存 raw config 中的 `[redacted]` 可能覆盖真实 secret，已修复为保留原值。
4. `/api/bots/:id/config` 保存后返回 registry entry，已改为返回脱敏后的真实 config。
5. Feishu bridge import 时直接启动外部连接，已改为 CLI guard。
6. 本地 CLI 被 IM 商业 credits 阻断，已移除本地普通输入扣费。

## 四、当前最大缺口

### 1. Bridge 仍然偏重，业务服务层还需要继续下沉

现在 Telegram / 飞书普通文本请求已经共用：

```text
upsert user
权限检查
扣费
run record
结果回传
```

这些核心流程已经下沉到：

- `chat-request-service.mjs`
- `billing-service.mjs`
- `run-service.mjs`

剩余问题是 channel bridge 仍然负责较多平台细节、文件上传、slash command、goal/schedule、running job 检查和结果回传。后续重构目标不是重新设计商业闭环，而是继续让 bridge 只负责：

- normalize incoming message
- send reply / running / denied / result
- 平台特有 metadata 处理

目标是让 channel bridge 只负责收消息、发消息、平台适配。

### 2. 持久化层已有 repository wrapper 和 migration runner，但还没有数据库迁移

现在 users / credits / usage / runs 仍使用 JSON / JSONL 状态文件，并已新增：

- `users-repository.mjs`
- `credits-repository.mjs`
- `usage-ledger-repository.mjs`
- `runs-repository.mjs`
- `state-migrations.mjs`

后续缺口不再是“有没有 repository / migration 入口”，而是：

- 更完整的 state version 策略
- 文件锁或单进程写入约束
- SQLite/Postgres 迁移判断标准
- 从 JSON / JSONL 到数据库的真实数据迁移

### 3. 错误类型和统一错误处理还不够正式

现在很多地方还是普通 `Error`。后续应区分：

- user error：权限不足、额度不足、参数错误
- system error：文件锁失败、状态文件损坏、Codex 启动失败
- external error：Telegram / 飞书 API 或网络失败

这样 Web/API/IM 回复可以稳定且不泄漏内部细节。

### 4. 失败、stop、退款策略还没有产品化

当前已能记录 failed / stopped，但扣费策略仍较简单。需要明确：

- 权限拒绝：不扣
- 额度拒绝：不扣，写 deny
- Codex 启动失败：是否退
- 用户 stop：是否退
- Codex 失败但消耗资源：是否扣

### 5. Web 控制台仍是单文件实现，权限模型还很轻

`src/control-plane-web.mjs` 当前包含 API、HTML、CSS、前端 JS，MVP 可接受，但后续维护成本会上升。
当前已有 `CODEXBRIDGE_WEB_TOKEN` 作为 operator token gate，但还没有角色、会话、审计详情页等更完整后台权限模型。

建议后续拆分为：

- API routes
- service 层
- HTML/template
- frontend render helpers

### 6. 仍没有自动支付/订单系统

当前是 Web Operations 手动 grant/deduct。后续收费需要：

- order
- payment provider callback
- credit grant idempotency
- refund
- invoice/receipt
- admin audit

### 7. 观测指标还不够产品化

后续需要可视化：

- group trial users
- daily free consumed
- paid conversion
- private unlock count
- failed runs
- average latency
- cost per run

## 五、已完成阶段验收清单

### Phase 1：轻量用户模型与权限闭环

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

### Phase 2：每日免费额度 + paid credits

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

### Phase 3：UsageEvent ledger

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

### Phase 4：Run record

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

### Phase 5：Telegram 商业闭环接入

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

### Phase 6：飞书对齐 Telegram

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

### Phase 7：Web 运营台

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

### Phase 8：执行可见性和产品体验

目标：把原 Roadmap 里的 execution visibility 接回来。

在商业闭环完成后，再统一：

- running 状态
- final output
- failed/stopped 文案
- Telegram/飞书/Web 的输出语义
- goal/schedule 的最终输出和普通 run 的关系

这阶段可以复用原 Roadmap Phase B。

## 六、下一阶段建议优先级

当前最高优先级已经从“补商业闭环”转为“把已跑通的商业闭环整理成长期可维护的工程架构”。

下一阶段最高优先级已经完成：

1. 抽 `chat-request-service.mjs`
2. 抽 `run-service.mjs`
3. 抽 `billing-service.mjs`
4. 让 Telegram / 飞书都调用同一套业务服务
5. 明确 failed / stopped / refund 策略
6. 为 users / credits / usage / runs 增加 repository 层
7. 增加 config schema validator
8. 建立结构化日志和 admin audit

接下来再考虑：

1. 数据库迁移和 state migration 的生产化执行器。
2. 支付、订单和自动充值。
3. worker queue / 多实例并发。
4. Web 控制台拆分和更完整的权限保护。

## 七、当前已有规划需要调整的地方

### 仍然有效

- `ROADMAP.md` 的长期战略方向有效。
- `public-group-private-conversation-principle.md` 是当前最高优先级产品原则。
- `session-routing-refactor-checklist.md` 中 envelope/routing/policy 的方向有效。

### 需要降优先级

- Goal first-class loop 继续后移，除非先完成 run/refund 策略。
- Skills 产品化继续后移。
- Web 视觉重构继续后移，优先拆结构和 service。
- 多 backend 抽象继续后移。
- 自动支付继续后移，先保留 Web 手动 grant/deduct。

### 已经进入主线并完成 MVP

- User 模型
- daily free quota
- paid credits
- private unlock
- UsageEvent ledger
- Run record
- Web 运营台

### 已经进入主线并完成第一轮

- channel business service
- billing service
- run lifecycle service
- repository layer
- refund policy
- config schema validation
- structured logs
- admin audit

## 八、最小可发布版本定义

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

当前状态：以上 10 项已达到本地可测试版本。Telegram 端已有单元测试覆盖；飞书端按要求没有做外部连通测试，只做本地逻辑和 import 安全测试。

这个版本不需要：

- 自动支付；
- 复杂租户；
- 跨平台身份合并；
- public API；
- 用户自助 dashboard；
- 多 worker pool；
- 完整 goal/schedule 商业化。

## 九、下一步开发建议

业务服务层第一轮已经完成。下一次实际编码建议不要直接上自动支付，先补足可运营性和持久化边界。

### Step 1：补齐 refund / failure 策略

- 权限拒绝：不扣费，只写 denied run。
- 额度拒绝：不扣费，写 deny usage event。
- Codex 未启动成功：当前已有 paid credit refund 基础能力，下一步要接入实际失败路径。
- 用户 stop：短任务不退，长任务后续可配置。
- Codex 执行失败：先不自动退，但 run 记录 failure reason。

### Step 2：state migration / 数据库准备

现在已有 repository wrapper 和基础 state migration runner，但底层仍是 JSON / JSONL。下一步应补：

- 文件锁或单进程写入约束说明。
- SQLite / Postgres 迁移判断标准。
- JSON / JSONL 到数据库的迁移脚本。

### Step 3：Web 控制台拆分和权限模型

`src/control-plane-web.mjs` 后续应拆 API、HTML、CSS、前端 JS。当前已有 `CODEXBRIDGE_WEB_TOKEN` 保护入口，后续再补 operator 角色、会话过期、审计详情页。自动支付、订单和 worker queue 等支付/并发相关能力，建议等这一步之后再启动。
