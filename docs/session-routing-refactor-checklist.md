# AutoAide Session Routing Refactor Checklist

## 一、文档目的

这份文档把最新产品决策转成可执行的代码重构设计清单。

目标是把 AutoAide 从当前的：

- 各 channel 各自管理 session
- 用户可见多 session
- Telegram / Feishu 行为不统一

重构到新的统一模型：

- 所有 channel 先归一化“谁在说话”
- session 由系统自动按身份路由
- 一个 Bot 对外只表现为一条主会话体验
- session 降级为内部实现细节
- `/goal` 和 schedule 按上下文策略开放

## 二、重构目标

这次重构的最终目标有五个：

1. 所有 channel 都能统一识别当前发 query 的人是谁
2. session 路由从“按 chat”改成“按身份规则自动路由”
3. 移除用户侧手动 session 管理能力
4. 让 `/goal` 和 schedule 变成上下文敏感能力
5. 让 Telegram、Feishu、CLI、Web 共享同一套会话和能力判断模型

## 三、最终目标模型

未来每条入站消息都应先被归一化成统一 envelope。

建议结构：

```json
{
  "channel": "telegram",
  "chatType": "group",
  "chatId": "123456",
  "userId": "998877",
  "messageId": "445566",
  "isDirect": false,
  "isGroup": true,
  "explicitlyMentionedBot": true,
  "text": "..."
}
```

然后统一走：

1. `normalizeIncomingEnvelope`
2. `resolveSessionKey`
3. `resolveCapabilityPolicy`
4. `dispatchMessage`

## 四、重构范围

这次重构涉及的主要模块：

- `src/config.mjs`
- `src/cli.mjs`
- `src/bots.mjs`
- `src/control-plane-web.mjs`
- `src/channel-adapters.mjs`
- `plugins/telegram-codex/telegram-codex-bridge.mjs`
- `plugins/feishu-codex/feishu-codex-bridge.mjs`
- `src/goals-state.mjs`
- `src/goal-controller.mjs`
- `src/goal-runner.mjs`

建议新增的共享层文件：

- `src/channel-envelope.mjs`
- `src/session-routing.mjs`
- `src/capability-policy.mjs`
- `src/channel-runtime-controller.mjs`

## 五、设计原则

这次重构必须遵守以下原则：

1. session 是内部实现细节，不再是用户能力
2. 任何 channel 都必须输出统一 envelope
3. 任何外部消息都必须通过共享路由器决定 session key
4. 群聊和私聊的差异放在策略层，不放在底层身份层
5. 一个 Bot 对外只表现为一条主会话体验

## 六、阶段拆分

## Phase 1：建立统一 envelope 层

### 目标

让 Telegram 和 Feishu 都先输出统一的入站消息结构。

### 建议新增文件

- `src/channel-envelope.mjs`

### 建议职责

提供统一结构定义和构造函数，例如：

- `createEnvelope(...)`
- `normalizeTelegramEnvelope(update, context)`
- `normalizeFeishuEnvelope(event, context)`

### 最低输出字段

- `channel`
- `chatType`
- `chatId`
- `userId`
- `messageId`
- `isDirect`
- `isGroup`
- `explicitlyMentionedBot`
- `text`

### 现有代码问题

当前 Telegram / Feishu 各自内部判断：

- 是不是群
- 有没有 mention
- 用户是谁
- chat/session 怎么映射

这些逻辑散在 bridge 里，无法共享。

### 重构动作

1. Telegram bridge 把 update 先转成 envelope
2. Feishu bridge 把 event 先转成 envelope
3. 后续逻辑只吃 envelope，不再直接吃平台原始事件结构

## Phase 2：建立统一 session 路由层

### 目标

把 session key 的生成从各 bridge 内部逻辑中抽出来。

### 建议新增文件

- `src/session-routing.mjs`

### 建议职责

提供：

- `resolveSessionKey(envelope)`
- `resolveSessionLabel(envelope)`
- `resolveConversationIdentity(envelope)`

### 正式路由规则

私聊：

- `sessionKey = channel + userId`

群聊：

- `sessionKey = channel + chatId + userId`

### 现有代码问题

当前 Telegram：

- 以 chat 为主维护 session 结构
- 暴露 `/new`、`/switch`、`/sessions`

当前 Feishu：

- 以 chat 直接映射 session

这两套都不符合最新产品决策。

### 重构动作

1. Telegram 不再用“当前 chat 激活 session label”作为主模型
2. Feishu 不再用“整个 chat 一条 session”
3. 两者统一改成：
   - 私聊按 `channel + userId`
   - 群聊按 `channel + chatId + userId`

## Phase 3：建立能力策略层

### 目标

把“群聊能做什么、私聊能做什么”统一成策略判断，而不是写死在各 bridge 里。

### 建议新增文件

- `src/capability-policy.mjs`

### 建议职责

提供：

- `resolveCapabilityPolicy(envelope, botConfig)`
- `canUseGoal(envelope, botConfig)`
- `canUseSchedule(envelope, botConfig)`
- `requiresExplicitMention(envelope, botConfig)`
- `canStopTask(requesterEnvelope, taskOwner)`

### 正式策略

私聊：

- 允许 `/goal`
- 允许 schedule
- 不要求 `@`

群聊：

- 默认禁用 `/goal`
- 默认禁用 schedule
- 默认要求显式 `@机器人`
- `/stop` 默认只能停自己的任务

### 现有代码问题

当前这些能力规则：

- 分散在 Telegram bridge
- 分散在 Feishu bridge
- 不一致

### 重构动作

1. Telegram 的 `/goal`、`/schedule` 命令先走共享策略判断
2. Feishu 的 mention 规则也走共享策略判断
3. stop 权限按 envelope 的 `userId` 判断，不再按 chat 粗暴处理

## Phase 4：移除用户可见 session 管理能力

### 目标

让一个 Bot 对外只表现为一条主会话体验。

### 要移除的用户能力

CLI：

- `/new`
- `/switch`
- `/sessions`

Telegram：

- `/new`
- `/switch`
- `/sessions`
- `/home`
- `/start` 中与 session 切换绑定的行为

Web：

- session 创建 / 手动切换入口

### 要保留的内部能力

- `cliSessionRef`
- sessionKey / sessionLabel
- session state 存储

也就是说：

- 底层继续有 session
- 但这些 session 不再让用户手动操作

### 现有代码问题

当前 session 被做成了半个产品能力。

这会导致：

- 用户需要理解当前在哪条线
- stop 和 goal 行为依赖“当前活跃 session”
- 远程聊天产品变成终端工具心智

### 重构动作

1. CLI help 删除 session 命令
2. Telegram help 删除 session 命令
3. Web 移除 session list / use 主入口
4. Router state 保留，但只内部使用

## Phase 5：重构 Telegram bridge

### 目标

让 Telegram bridge 只负责：

- transport
- Telegram-specific parsing
- Telegram-specific message send/reply

而不再负责：

- session 产品逻辑
- 能力开放策略
- 独立会话管理心智

### 需要改的关键点

1. update -> envelope
2. envelope -> shared routing
3. 通过共享策略判断命令可用性
4. 去掉用户可见 session 管理命令
5. 群聊下 stop 只允许停止自己的任务
6. `/goal` 和 `/schedule` 在群聊中直接禁用

### Telegram 现有需要清理的内容

- `DEFAULT_MAIN_SESSION_LABEL`
- `activeSessionLabel`
- `/new`
- `/switch`
- `/sessions`
- `/home`

这些不一定全部删除底层字段，但至少不应再作为用户心智。

## Phase 6：重构 Feishu bridge

### 目标

让 Feishu bridge 与 Telegram 使用同一套路由和策略。

### 需要改的关键点

1. event -> envelope
2. Feishu 不再按整个群复用一条 session
3. 群聊路由改为 `channel + chatId + userId`
4. 私聊路由改为 `channel + userId`
5. 群聊仍然保留显式 `@机器人自己` 触发
6. 任务队列改成按“用户 session”而不是按整个 chat

### Feishu 现有需要清理的内容

- 当前整个 chat 一条 queue
- 当前整个 chat 一条 `cliSessionRef`

### Feishu 进一步建议

增加群现场上下文窗口：

- 最近几条群消息
- 当前发言人
- 当前被回复消息

但这些作为 turn 上下文，不作为 session 持久归属。

## Phase 7：重构 goal / schedule 的入口约束

### 目标

让 `/goal` 和 schedule 完全变成上下文敏感能力。

### 正式规则

私聊：

- 允许 `/goal`
- 允许 schedule

群聊：

- 默认禁止 `/goal`
- 默认禁止 schedule

### 需要改的共享层

- `src/goal-controller.mjs`
- `src/control-plane-web.mjs`
- `plugins/telegram-codex/telegram-codex-bridge.mjs`

### 需要做的事

1. goal 创建前增加统一 policy 判断
2. schedule 创建前增加统一 policy 判断
3. Web 创建 goal / schedule 时也使用同一策略

## Phase 8：重构 stop 权限模型

### 目标

把 stop 从“停当前 chat 的活跃任务”改成“停当前用户自己的活跃任务”。

### 建议设计

任务运行态里增加：

- `ownerUserId`
- `sessionKey`
- `chatId`
- `channel`

stop 请求时：

- 先用 envelope 识别当前请求人
- 再匹配运行中任务的 `ownerUserId`

### 群聊规则

- 默认只允许停自己的

### 私聊规则

- 由于私聊本来就是该用户自己的会话，所以直接允许

## Phase 9：重构配置模型

### 目标

让配置不再携带旧的“用户可见多 session 产品假设”。

### 建议保留

- `channel`
- channel-specific config
- mention gating config
- access control / allowed users / admins

### 建议新增

- `admins`
- `groupContextWindowSize`
- `allowGoalInGroups` 未来可选
- `allowScheduleInGroups` 未来可选

### 建议逐步弱化

- 一切围绕“当前 active session label”的配置或展示

## Phase 10：重构 Web 控制面

### 目标

让 Web 不再把 session 当成产品操作对象。

### 要调整的点

1. 去掉 session tab 的主导地位
2. 更强调：
   - 当前 bot
   - 当前 channel
   - 当前身份路由规则
3. 创建 goal / schedule 时明确显示：
   - 当前上下文是否允许
4. 如果是群聊上下文，要明确显示：
   - `/goal` 不可用
   - schedule 不可用

### 建议新增展示

- `chatType`
- `actor userId`
- `resolved sessionKey`
- `policy result`

## Phase 11：状态迁移与兼容

### 目标

避免现有用户状态直接失效。

### 迁移原则

1. 旧 router state 可读
2. 新 router state 优先写入统一 sessionKey
3. 保留一段兼容层，自动将旧 chat-level 状态映射到新 identity-level 状态

### 重点兼容对象

Telegram：

- `sessions.json`
- `activeSessionLabel`
- `state.chats[chatId]`

Feishu：

- `router.json`
- 旧的 `chatId -> cliSessionRef`

## Phase 12：测试与验证清单

### 单元测试

必须新增：

- envelope normalization tests
- session routing tests
- capability policy tests
- stop ownership tests

### 集成测试

必须覆盖：

1. Telegram 私聊 -> 路由到 `channel + userId`
2. Telegram 群聊两个不同用户 -> 两条不同 session
3. Feishu 私聊 -> 路由到 `channel + userId`
4. Feishu 群聊两个不同用户 -> 两条不同 session
5. 群聊中 `/goal` 被拒绝
6. 私聊中 `/goal` 可创建
7. 群聊中 `/stop` 不能停别人的任务
8. CLI / help 不再出现 `/new` `/switch` `/sessions`

## 七、建议实施顺序

建议严格按这个顺序推进：

1. 统一 envelope
2. 统一 session routing
3. 统一 capability policy
4. 移除用户可见 session 管理能力
5. Telegram 接共享 routing 和 policy
6. Feishu 接共享 routing 和 policy
7. goal / schedule 接 policy
8. stop ownership 重构
9. Web/CLI 展示收口
10. 迁移旧状态

## 八、最终判断

这次重构不是“改几个命令文案”，而是一次真正的产品架构收敛。

核心收敛方向就是三句话：

1. 先统一识别当前是谁在说话
2. 再统一决定这条消息该路由到哪条内部会话
3. 最后再根据上下文决定开放哪些能力

当这套结构完成以后，AutoAide 才会真正具备：

- 跨 channel 一致性
- 群聊可扩展性
- 私聊稳定性
- 更清晰的产品心智

