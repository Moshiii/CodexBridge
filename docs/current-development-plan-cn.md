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

当前验证：`npm test` 通过，136 个测试全部通过。

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
   - Telegram / 飞书普通请求失败路径已接入 paid credit refund；用户主动 stop 默认不退。
   - 已新增基础 analytics service 和 Web metrics API，能聚合用户、usage、runs、credits 指标。
   - 已新增第一版错误分类，Web API 对用户错误返回明确 code，对内部错误隐藏细节。
   - 已新增 conversation log，Telegram / 飞书 / Web 普通输入输出会写入可查询日志，并自动打基础风险标签。
   - 已新增第一版 conversation policy：明显密钥类内容会在扣费和执行前阻断，prompt injection / PII 类内容进入 review 标签。
   - 已将 conversation log 接入 analytics：Web metrics 可看到输入输出事件量、风险事件量、policy block 次数、prompt injection 和 possible secret 计数。
   - conversation log API / Web Operations 默认返回脱敏内容，避免邮箱、手机号、token、credential-like 文本在运营查看时二次泄漏；底层 JSONL 仍保留原文用于必要审计。
   - 已新增 conversation review ledger，可对风险日志标记 confirmed_risk / false_positive / handled，并在日志查询和 metrics 中回显复盘结果。
   - conversation log API 已支持按时间窗口、riskOnly、riskLabel、reviewStatus 筛选，方便做风险复盘和样本分析。

9. **Phase 9：开箱即用和使用体验**
   - Web Overview 已新增 Setup Checklist，按当前 bot 状态提示连接 IM、确认身份、允许测试用户/群、启动 runtime、发送第一条消息。
   - Bot detail API 已返回 `setupGuide`，后续 CLI、IM 管理命令、Web UI 可以复用同一套 readiness 判断。
   - 首屏从静态说明改为动态下一步提示，降低第一次打开控制台时的理解成本。
   - Web Overview 已新增 Quick Test，用户可以从首屏一键发起 main session 试聊，不需要先理解 Sessions / Chat tab 的区别。
   - Chat / Quick Test 状态已新增 friendlyMessage，失败时会提示检查 Runtime Log，并确认主机上的 Codex 已安装且已登录。
   - Quick Test 已新增 preflight 提示：即使 IM 尚未完全配置，也能先验证本机 Codex；同时明确邀请用户前还缺哪些步骤。
   - Web Overview 已新增 Invite Readiness 摘要，直接告诉 operator “现在是否可以邀请真实用户”，并列出当前最关键的下一步。
   - Quick Test / Setup Checklist 已新增更具体的修复 hint：能提示缺 Telegram token、bot username、Feishu credentials/setup checklist、audience、runtime 等具体动作。
   - Setup Checklist 每一步已提供 Go 跳转按钮，用户看到缺口后可以直接进入对应配置页，不需要自己理解 tab 结构。
   - Telegram tab 已新增 Quick Settings，可直接保存 enabled、bot username、mention required 和 token，不必进入 Raw Config。
   - Known Chats / Known Users 已新增一键允许入口，可直接加入 private chat、group chat 或 group user 访问名单。
   - Feishu tab 已新增 Quick Settings，可直接保存 enabled、appId、appSecret、mention required 和 mention names，不必进入 Raw Config。
   - Feishu Quick Settings 已补齐 verification token、encrypt key、receive id type，并对这些敏感字段做脱敏展示和 `[redacted]` 保留。
   - Feishu Quick Settings 已新增接入检查清单，可记录 Bot 能力、`im.message.receive_v1` 事件订阅、租户安装/发布状态，减少排障时反复打开 Raw Config。
   - Feishu tab 已新增动态 Setup Summary，会按当前配置提示启用渠道、保存凭证、事件安全字段、Bot 能力、消息事件订阅、租户安装/发布等下一步动作。
   - Operations tab 已新增 Operator / Debug 视图切换；默认聚焦用户、充值/封禁、风险日志，Usage Ledger 和 Runs 放入 Debug。
   - Operations 风险日志已新增 Confirm Risk / False Positive / Handled 按钮，运营复盘不需要手写 review API。
   - Operations 风险日志已新增 review 状态筛选，可直接查看 all / unreviewed / confirmed risk / false positive / handled。
   - Operations 风险日志已新增 risk label 筛选，可按 prompt injection、possible secret、credential-like、email、phone 聚焦复盘。
   - Operations 风险日志已新增 user / run / channel 筛选，可直接定位某个用户、某次执行或某个入口的风险事件。
   - Operations 已改进空状态文案，用户、用量、runs、风险日志为空或筛选无结果时会提示下一步操作。
   - Operations Admin Actions 已新增选中用户摘要和操作说明，operator 能在 grant/deduct/private/ban 前看到该用户状态、私聊权限、paid credits 和 daily free 使用情况。
   - Telegram / 飞书用户侧 `/credits`、私聊未解锁、额度不足文案已改为更直接的产品说明，突出群聊每日免费、付费 credits、私聊解锁和下一步动作。
   - Telegram / 飞书 `/start` 和 `/help` 已改为首次使用说明，解释群聊每日免费、群聊公开可见、`/credits`、私聊解锁和 operator 管理入口。
   - Telegram / 飞书首次欢迎语已补齐可照抄的群聊提问示例：Telegram 提示 `@your_bot summarize this repo in 3 bullets`，飞书提示提到 CodexBridge 或应用名后提问。
   - Telegram 已新增 bot 入群欢迎触发：当当前 bot 被加入群聊时，会自动发送快速开始说明，避免新群用户不知道怎么问。
   - Telegram / 飞书常见失败提示已产品化：不支持的消息类型、未知命令、已有请求运行中、请求失败都会给出可行动下一步。
   - conversation policy block 的用户侧文案已产品化：明确说明消息疑似包含 secret/access token、本次未扣 credits、移除或轮换凭证后可重发。
   - Telegram / 飞书请求失败文案已补齐退款解释：paid credits 会自动退款，daily free 不消耗 paid credits，并提示稍后重试或让 operator 查看 runtime log。

### 本轮审计已修复的严重问题

1. 新用户默认 100 paid credits，已改为 0。
2. Web API 可能返回 Telegram token / Feishu appSecret，已改为 `[redacted]`。
3. 保存 raw config 中的 `[redacted]` 可能覆盖真实 secret，已修复为保留原值。
4. `/api/bots/:id/config` 保存后返回 registry entry，已改为返回脱敏后的真实 config。
5. Feishu bridge import 时直接启动外部连接，已改为 CLI guard。
6. 本地 CLI 被 IM 商业 credits 阻断，已移除本地普通输入扣费。

## 四、当前最大缺口

从常规开发架构和可运营产品范式看，当前项目已经有了 MVP 主链路，但还不是一个可以放心公开放量的完整服务。现在最应该补的不是更多 agent 能力，而是把入口、状态、权限、计费、审计、错误、部署这些基础能力继续补齐。

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

### 3. 错误类型和统一错误处理已有第一版，但覆盖还不完整

当前已新增 `src/errors.mjs`，并让 Web API 区分：

- user error：权限不足、额度不足、参数错误
- system error：文件锁失败、状态文件损坏、Codex 启动失败
- external error：Telegram / 飞书 API 或网络失败

Web API 已对明显的用户输入错误返回 4xx、`kind`、`code`，对普通内部错误隐藏细节。

后续仍需补：

- 更多核心模块抛出 `AppError` 子类，而不是普通 `Error`。
- IM 回复也统一按错误类型渲染。
- 外部 API 错误统一映射为 external error。

### 4. 失败、stop、退款策略已有第一版，但还不够产品化

当前已能记录 failed / stopped，并已接入第一版退款规则：

- 权限拒绝：不扣。
- 额度拒绝：不扣，写 deny。
- Codex 启动/执行失败：退还 paid credits；daily free 不退。
- 用户 stop：默认不退。

后续仍需补：

- 更明确的失败类型枚举。
- 面向用户的退款提示文案。
- 长任务 stop 是否部分退费的可配置策略。

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

### 7. 观测指标已有基础 API，但还不够产品化

当前已有：

- `src/analytics-service.mjs`
- `src/conversation-log.mjs`
- `/api/bots/:id/metrics`
- `/api/bots/:id/conversation-logs`
- `src/conversation-policy.mjs`

现在可以聚合：

- group trial users
- daily free consumed
- paid conversion
- private unlock count
- failed runs
- average latency
- conversation input/output events
- risky conversation events
- policy allow / review / block
- prompt injection / possible secret / PII-like risk labels
- top risky users
- Web/API conversation log redacted preview
- conversation review status counts
- conversation log filters: time window / riskOnly / riskLabel / reviewStatus

后续仍需要可视化和更细指标：

- cost per run
- 时间窗口过滤
- 渠道维度对比
- conversion funnel
- conversation log 留存策略
- 更细的隐私数据脱敏策略：可配置保留原文、只保留 hash、按风险等级截断、按角色授权查看
- 更细的恶意输入拦截策略
- 更完整的风险事件复盘视图：按用户、run、渠道、标签筛选，并支持在 Web UI 内直接标记误报/确认风险/已处理

### 8. 用户进入和体验路径还需要继续产品化

当前已经有 Setup Checklist、Quick Test、Telegram / Feishu Quick Settings 和 Operations 简化视图，首次配置门槛已经明显降低。

后续仍需补：

- 新用户进群后的欢迎语、免费额度说明、付费后私聊权益说明。
- 群聊内 `/credits`、额度不足、私聊未解锁、被封禁等文案统一，避免像内部系统错误。
- 用户不需要理解 bot id、session id、run id，也能知道“现在能不能用、为什么不能用、下一步做什么”。
- Operator 不需要打开 Raw Config，就能完成 80% 日常操作。
- Feishu 还需要补齐事件回调、可见性检查、访问名单的表单化配置。

### 9. 常规服务化架构仍缺少生产级边界

当前适合本地 beta、私有群试用和小规模手动运营；如果要走向稳定服务，还需要补这些范式能力：

- **身份与权限**：operator 登录、角色、会话过期、操作审计详情、最小权限。
- **后台任务**：可靠 queue、重试、超时、取消、并发限制、幂等 run。
- **存储**：SQLite/Postgres 迁移、schema version、备份恢复、状态校验和修复工具。
- **支付与订单**：订单、回调验签、幂等发放 credits、退款、对账、发票/收据。
- **可观测性**：结构化指标、错误率、延迟、run 成功率、成本估算、转化漏斗。
- **安全**：secret 管理、日志脱敏、conversation retention、敏感内容查看授权、外部 Web 暴露边界。
- **发布工程**：安装脚本、环境检查、版本升级、迁移脚本、回滚策略、CI。
- **用户文档**：从“开发者知道怎么配”改成“新 operator 跟着 3 步就能跑起来”。

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

当前最高优先级已经从“补商业闭环”和“可观测闭环”转为“开箱即用、操作简洁、直观易懂”。

下一阶段最高优先级已经完成：

1. 抽 `chat-request-service.mjs`
2. 抽 `run-service.mjs`
3. 抽 `billing-service.mjs`
4. 让 Telegram / 飞书都调用同一套业务服务
5. 明确 failed / stopped / refund 策略
6. 为 users / credits / usage / runs 增加 repository 层
7. 增加 config schema validator
8. 建立结构化日志和 admin audit
9. 记录 Telegram / 飞书 / Web 普通输入输出 conversation log
10. 接入 conversation policy，先阻断明显密钥类输入，并给 prompt injection / PII 打 review 标签
11. 将 conversation log 风险指标接入 analytics 和 Web metrics
12. Web/API conversation log 默认脱敏展示，减少敏感内容二次泄漏
13. 增加 conversation review ledger 和 API，支持运营复盘标记 confirmed risk / false positive / handled
14. 增加 conversation log 复盘筛选：时间窗口、riskOnly、riskLabel、reviewStatus
15. 增加 Web Overview Setup Checklist，让用户一眼看到当前 bot 还差哪一步才能可用
16. 增加 Web Overview Quick Test，从首屏一键试聊验证 CodexBridge 是否可用
17. 增加 Chat / Quick Test friendlyMessage，让成功、运行中、失败、停止状态都有可理解的下一步说明
18. 增加 Quick Test preflight，区分“本机 Codex 可试跑”和“邀请用户前还缺的 IM 配置”
19. 增加 Setup Checklist 的 Go 跳转，降低从提示到操作的路径成本
20. 增加 Telegram Quick Settings，把最常用配置从 Raw Config 前移到 Telegram tab
21. 增加 Telegram Known Chats / Known Users 一键加入访问名单
22. 增加 Feishu Quick Settings，把飞书常用配置从 Raw Config 前移到 Feishu tab
23. 补齐 Feishu Quick Settings 的 verification token、encrypt key、receive id type，并对敏感字段脱敏
24. 增加 Feishu 接入检查清单：Bot 能力、消息事件订阅、租户安装/发布状态
25. 增加 Operations Operator / Debug 视图，默认隐藏低频调试信息并优先展示风险日志
26. 增加 Operations 风险日志一键复盘按钮：confirm risk / false positive / handled
27. 增加 Operations 风险日志 review 状态筛选
28. 增加 Operations 风险日志 risk label 筛选
29. 增加 Operations 风险日志 user / run / channel 筛选
30. 改进 Operations 空状态文案，让无用户、无用量、无 runs、无风险日志和筛选无结果时都有可行动提示
31. 改进 Telegram / 飞书用户侧额度与私聊提示文案：`/credits`、额度不足、私聊未解锁
32. 改进 Telegram / 飞书首次使用文案：`/start`、`/help` 直接说明怎么问、群聊可见性、每日免费、私聊解锁和 operator 管理
33. 增加 Telegram bot 入群欢迎触发，自动发送快速开始说明
34. 改进 Telegram / 飞书常见失败提示：不支持的消息类型、未知命令、已有请求运行中、请求失败
35. 改进 Setup Checklist / Quick Test preflight 的具体修复提示，能明确指出缺 token、bot username、Feishu 接入检查、访问名单或 runtime
36. 增加 Feishu Setup Summary，让 Feishu tab 直接显示当前接入完成度和下一步动作，不需要 operator 自己解读配置字段
37. 改进 conversation policy block 用户提示，说明疑似 secret/access token、未扣 credits、移除或轮换凭证后重发
38. 改进 Telegram / 飞书请求失败退款提示，明确 paid credits 自动退款、daily free 不消耗 paid credits、下一步找 operator 看 runtime log
39. 改进 Operations Admin Actions：新增选中用户摘要和按钮语义说明，降低 grant/deduct/private/ban 误操作风险
40. 改进 Telegram / 飞书首次欢迎语，补齐可照抄的群聊 mention 示例和提问格式
41. 增加 Web Overview Invite Readiness，让 operator 一眼判断是否可以邀请真实用户，并看到最关键下一步

接下来再考虑：

1. 把 Feishu 真实事件触发、可见性检查、访问名单继续表单化，并把检查结果继续接入 Setup Summary。
2. 增加 Feishu 真实进群欢迎触发和更明确的付费私聊转化入口。
3. 继续完善 Quick Test 自动诊断：把 Telegram / 飞书 / 权限 / runtime 的检查结果绑定到具体表单字段，并继续补一键修复动作。
4. 数据库迁移、支付订单、worker queue、多实例并发继续作为后续工程化事项。

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
- conversation log / policy / review
- Web metrics / risk review API
- Setup Checklist / Quick Test / Quick Settings
- Operations Operator / Debug 视图

### 尚未完成但已经明确要做

- Feishu 配置继续表单化。
- 用户侧欢迎、额度、付费转化文案。
- Web 控制台拆分。
- 数据库存储迁移。
- 支付订单系统。
- 可靠 worker queue。
- 更完整的 operator 权限模型。

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
- Codex 未启动成功：已接入实际失败路径，退还 paid credits。
- 用户 stop：短任务不退，长任务后续可配置。
- Codex 执行失败：已退还 paid credits，run 记录 failure reason。
- 用户可见的退款提示已补第一版；后续继续补更细失败类型。

### Step 2：state migration / 数据库准备

现在已有 repository wrapper 和基础 state migration runner，但底层仍是 JSON / JSONL。下一步应补：

- 文件锁或单进程写入约束说明。
- SQLite / Postgres 迁移判断标准。
- JSON / JSONL 到数据库的迁移脚本。

### Step 3：Web 控制台拆分和权限模型

`src/control-plane-web.mjs` 后续应拆 API、HTML、CSS、前端 JS。当前已有 `CODEXBRIDGE_WEB_TOKEN` 保护入口，后续再补 operator 角色、会话过期、审计详情页。自动支付、订单和 worker queue 等支付/并发相关能力，建议等这一步之后再启动。

### Step 4：补用户侧增长漏斗文案

当前技术规则已经成立，但用户看到的解释还不够产品化。下一步应把以下场景统一成清楚、短、可行动的文案：

- 第一次在群里使用。
- 每日免费额度剩余。
- 免费额度用尽。
- 私聊未解锁。
- 已付费但 credits 不足。
- Codex 正在运行，暂时不能并发提问。

### Step 5：再做支付和生产化

只有当上述入口、运营和错误体验稳定后，再启动支付订单和生产化部署。否则支付上线后会把排障、退款、对账和用户解释压力一起放大。
