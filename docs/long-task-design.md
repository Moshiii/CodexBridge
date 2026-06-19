# CodexBridge 长任务机制设计

> Historical draft. This document predates the current bot-scoped runtime and still references the removed daemon model.

## 1. 目标

这个设计解决的问题是：

> 用户给 CodexBridge 一个较长的任务后，CodexBridge 不应该只跑一轮然后停下。
> 它应该能在每轮执行结束后，对比原始目标和当前进度，判断是否继续，并在不需要用户输入时自动推进下一轮。

这里的重点不是“模型自己幻想自己醒来”，而是：

- 有持久任务状态
- 有结构化进度判断
- 有外层调度闭环
- 有明确的停止、挂起、重试、完成语义

## 2. 非目标

这套机制不做下面这些事：

- 不重做 Codex 的 agent runtime
- 不重做工具系统
- 不重做 skills runtime
- 不重做多 agent 控制面
- 不做一个重型 enterprise orchestrator

CodexBridge 仍然坚持“薄壳”路线。

## 3. 核心结论

最合理的方案不是让模型通过 prompt “自觉继续”，而是在 CodexBridge 里增加一层：

`Long Task Controller`

这一层位于：

- channel layer
- session layer
- Codex runtime

之间。

它负责：

- 记录任务目标
- 记录任务计划和验收标准
- 记录当前进度和阻塞状态
- 决定一轮执行结束后是否继续
- 决定何时等待用户
- 决定何时延迟重试

换句话说：

- Codex 负责做事和评估
- CodexBridge 宿主负责循环和调度

## 4. 为什么不能只靠 prompt

如果只是在 prompt 里写：

> 如果没做完就继续

会有几个问题：

1. final output 不等于真实完成
2. 模型没有可靠的外部完成判定
3. 模型没有结构化任务账本
4. 容易重复做同一步
5. 遇到外部等待、审批、文件生成、网络、CI 等情况时，不知道什么时候应该重新启动

所以必须把“继续执行”的判断从一次对话输出中拆出来，交给外层控制循环。

## 5. 当前仓库已有基础

当前 CodexBridge 已经有三块关键基础：

### 5.1 持久 session

- CLI 和 Telegram 都已经有 session label / session ref 的概念
- Codex 已支持 `start` / `resume`

### 5.2 持久 workspace

- `~/.codexbridge/workspace`
- `AGENTS.md`
- `SOUL.md`
- `IDENTITY.md`
- `USER.md`
- `TOOLS.md`
- `HEARTBEAT.md`
- `MEMORY.md`

### 5.3 常驻 daemon

- Telegram bridge 已归 daemon 管理
- daemon 可以作为定时巡检和任务续跑的宿主

所以当前真正缺的不是“持久性”，而是“任务控制器”。

## 6. 总体架构

推荐结构：

```text
CLI / Telegram / Future Channels
        |
        v
Channel Layer
        |
        v
Session Layer
        |- active session
        |- cliSessionRef
        |- per-channel pointer
        |
        v
Long Task Controller
        |- goal
        |- plan
        |- progress
        |- evaluator
        |- scheduler
        |
        v
Codex Runtime
        |- AGENTS.md
        |- skills
        |- tools
        |- MCP
        |- sub-agents
```

### 分工

#### Channel Layer

负责：

- 接收用户消息
- 发送结果和状态
- 接收 `/stop`、`/status`、`/restart` 等控制命令

#### Session Layer

负责：

- 当前 chat / CLI 对应哪个 session
- session label 对应哪个 `cliSessionRef`
- normal turn 与 resume turn 的选择

#### Long Task Controller

负责：

- 任务创建
- 任务计划
- 一轮执行结束后的评估
- 自动续跑
- 挂起 / 重试 / 完成

#### Codex Runtime

负责：

- 推理
- 调工具
- 读取 workspace context
- 执行实际工作

## 7. 任务状态模型

建议新增：

```text
~/.codexbridge/tasks.json
```

或者后续迁移到 SQLite。

MVP 阶段 JSON 足够。

### 单个任务建议字段

```json
{
  "id": "task_123",
  "sessionLabel": "main",
  "channel": "cli",
  "chatId": null,
  "goal": "完成一个较长的用户任务",
  "status": "running",
  "mode": "autonomous",
  "plan": [
    { "id": "p1", "title": "分析现状", "status": "done" },
    { "id": "p2", "title": "修改实现", "status": "running" },
    { "id": "p3", "title": "验证结果", "status": "pending" }
  ],
  "acceptanceCriteria": [
    "功能完成",
    "验证通过",
    "结果已汇报"
  ],
  "lastProgressSummary": "已完成分析，正在修改实现",
  "nextAction": "继续编码并验证",
  "continueAfterFinish": true,
  "needsUserInput": false,
  "blockedReason": null,
  "retryAt": null,
  "failureCount": 0,
  "createdAt": "2026-03-31T00:00:00.000Z",
  "updatedAt": "2026-03-31T00:00:00.000Z"
}
```

### 关键字段解释

#### `goal`

原始目标，不要丢。

这是每轮评估时最重要的对照物。

#### `plan`

不需要特别复杂，但必须结构化。

否则系统永远只能“靠线程记忆猜现在做到哪了”。

#### `status`

建议枚举：

- `running`
- `waiting_user`
- `blocked`
- `scheduled_retry`
- `completed`
- `failed`
- `cancelled`

#### `retryAt`

用于：

- 网络失败退避
- 外部系统稍后再试
- heartbeat / daemon 后续捞起

## 8. 核心控制循环

每个长任务不再只是“一次 prompt -> 一次 final output”，而是：

```text
start task
  -> run worker turn
  -> capture result
  -> run evaluator
  -> decide next state
  -> continue / wait / retry / complete
```

### 8.1 Worker Turn

worker turn 的职责是推进任务本身。

输入：

- 原始目标
- 当前计划
- 当前进度摘要
- workspace context
- 当前 session ref

输出：

- 正常 agent 输出
- 工具调用结果
- 可能的中间产物

### 8.2 Evaluator Turn

evaluator turn 不负责做事，只负责判断。

建议让 evaluator 输出结构化 JSON，而不是自然语言。

示例：

```json
{
  "task_completed": false,
  "should_continue": true,
  "needs_user_input": false,
  "blocked_reason": null,
  "progress_summary": "已经完成仓库分析与第一轮修改",
  "next_action": "运行验证并根据结果修复问题"
}
```

### 8.3 Scheduler 决策规则

基于 evaluator 结果，宿主做决策：

- `task_completed=true`
  - 标记 `completed`
- `needs_user_input=true`
  - 标记 `waiting_user`
- `blocked_reason != null` 且可重试
  - 标记 `scheduled_retry`
  - 写入 `retryAt`
- `should_continue=true`
  - 立即进入下一轮
- 其他异常情况
  - 标记 `failed` 或 `blocked`

## 9. 执行与评估必须分开

这是设计里的强约束。

不要让一次 prompt 同时负责：

- 干活
- 判断是否继续

原因：

- 语义混乱
- 输出结构不稳定
- 容易把“总结性回答”误判为“任务完成”

推荐方式：

1. `worker turn`
2. `evaluator turn`
3. scheduler 决策

## 10. 停止条件和保护阈值

长任务必须有护栏，否则很容易变成无限循环。

建议至少加这些限制：

### 10.1 单任务最大连续轮次

例如：

- `maxContinuousTurns = 5`

达到后：

- 强制汇报当前状态
- 再决定是否继续

### 10.2 最大 wall clock 时间

例如：

- 单任务连续执行不超过 15 分钟

### 10.3 最大失败次数

例如：

- `maxFailureCount = 3`

超过后转为：

- `blocked`
- `failed`

### 10.4 需要用户批准的动作

任何高风险外部动作：

- 删除
- 覆盖
- 外发消息
- 真正的发布行为

仍然应受现有安全边界约束。

长任务机制不能绕过这些约束。

## 11. 与 HEARTBEAT 的关系

`HEARTBEAT.md` 不是长任务主引擎。

它更适合做：

- 定期巡检
- 扫描待续跑任务
- 提醒用户
- 低风险 maintenance

### HEARTBEAT 应做的事

- 找出 `scheduled_retry` 且到期的任务
- 找出 `running` 但异常中断的任务
- 找出 `waiting_user` 太久的任务并提醒

### HEARTBEAT 不应做的事

- 直接承载所有任务状态
- 替代结构化 task store
- 在 Markdown 里硬编码复杂任务流程

## 12. 与 CLI / Telegram 的关系

长任务控制器应该是 channel-agnostic 的。

也就是说：

- CLI 发起任务
- Telegram 发起任务
- 将来其他 channel 发起任务

都应该落在同一套 task controller 上。

### CLI 侧

需要支持：

- 创建长任务
- 查看当前任务
- `/stop`
- `/status`

### Telegram 侧

需要支持：

- 创建长任务
- 查看任务摘要
- `/stop`
- `/status`

### 关键原则

不要让每个 channel 自己做一套长任务逻辑。

## 13. 模块落点建议

推荐新增：

```text
src/task-controller.mjs
src/task-store.mjs
src/task-evaluator.mjs
```

### `src/task-store.mjs`

负责：

- 读写 `tasks.json`
- 查询任务
- 更新任务状态
- 按条件筛选需要继续的任务

### `src/task-evaluator.mjs`

负责：

- 根据 worker 输出生成 evaluator prompt
- 调 Codex evaluator
- 解析 evaluator JSON

### `src/task-controller.mjs`

负责：

- 创建任务
- 执行 worker turn
- 调 evaluator
- 更新状态
- 决定 continue / wait / retry / complete

## 14. 与现有文件的接入方式

### `src/codex-runner.mjs`

保持执行层，不要把任务调度逻辑塞进去。

它只负责：

- start
- resume
- streaming status
- child handle
- final result

### `src/cli.mjs`

增加：

- 长任务入口
- 当前任务查询
- channel 对 task controller 的调用

### `plugins/telegram-codex/telegram-codex-bridge.mjs`

增加：

- Telegram 侧的长任务入口
- 结果通知
- 控制命令对 task controller 的调用

### `src/daemon.mjs`

增加定时 tick：

- 扫描 `retryAt <= now`
- 拉起待续跑任务
- 处理 heartbeat 触发

## 15. 失败语义

必须把失败分类型，不要所有失败都叫 failed。

建议区分：

### `waiting_user`

用户必须提供信息，系统不能自己继续。

### `blocked`

当前无法前进，但还没有明确重试时间。

### `scheduled_retry`

未来某个时间点应该自动再试。

### `failed`

这个任务已经判定为失败，不再自动继续。

### `cancelled`

用户主动停止。

## 16. MVP 范围

第一阶段不要一次做太大。

MVP 建议只做：

1. `tasks.json`
2. 单 session 单长任务
3. worker turn
4. evaluator JSON
5. 自动续跑最多 3 到 5 轮
6. `waiting_user`
7. `completed`
8. `blocked`

先不做：

- 多任务优先级调度
- 复杂 cron
- 多 worker 并发
- SQLite
- 图形化任务面板

## 17. 建议实现顺序

### Phase 1

- 新增 `task-store`
- 新增 `task-controller`
- 新增 evaluator JSON 协议
- 支持单任务闭环

### Phase 2

- daemon 定时续跑
- retry 机制
- heartbeat 扫描待续跑任务

### Phase 3

- 更强任务总结
- 更好的进度通知
- richer task inspection commands
- channel 统一控制面

## 18. 一句话总结

CodexBridge 的长任务能力，不应该依赖“模型自己记得继续”。

它应该建立在这条闭环上：

> 持久 session + 持久 workspace + 结构化任务状态 + evaluator + scheduler

只有这样，CodexBridge 才能从“会话型助手”真正升级为“可持续推进任务的个人 AI operator”。
