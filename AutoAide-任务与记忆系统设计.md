# AutoAide 任务与记忆系统设计

## 目标

这份文档定义 `AutoAide` 的任务系统、记忆系统和监督状态机。

目标不是做聊天历史存档，而是做一个能够长期管理很多并行任务的管理中枢。

`AutoAide` 必须做到：

- 记住用户交办了什么
- 记住这些事拆成了哪些子任务
- 记住每个子任务分给了哪个 worker
- 记住每个任务当前进度
- 记住哪些事情被承诺了但还没完成
- 能自动发现 stalled / blocked / overdue 状态

---

## 设计原则

### 原则 1：任务状态必须结构化

不能只靠 prompt 和记忆摘要保存任务状态。

所有任务、派工、进展、承诺都必须有结构化记录。

### 原则 2：聊天历史不是任务系统

聊天只是输入输出通道。

真正的状态源应该是：

- task store
- assignment store
- progress event log
- commitment store
- project memory store

### 原则 3：记忆要面向管理，而不是面向对话

`AutoAide` 的记忆系统不是“用户刚刚说了什么”，而是：

- 任务是什么
- 责任人是谁
- 阻塞是什么
- 下一步该盯谁

### 原则 4：监督要依赖事件，不依赖猜测

系统不应该仅凭 LLM 主观推断“任务好像卡住了”。

应该根据显式事件判断：

- 多久没有 heartbeat
- 是否出现 blocker
- 是否超过 dueAt
- 是否承诺事项未完成

### 原则 5：结构化真相层必须可版本化和可修复

`AutoAide` 是长期运行的 manager 系统。

因此任务和记忆存储必须默认支持：

- schema 版本演进
- 启动时迁移
- 损坏记录隔离
- repair log

---

## 核心实体

建议至少定义 7 个核心实体。

### 1. Owner

```ts
type Owner = {
  id: string;
  displayName: string;
  channels: Array<{
    kind: "discord" | "telegram" | "slack" | "web";
    accountId: string;
    peerId: string;
  }>;
  createdAt: number;
  updatedAt: number;
};
```

### 2. Project

```ts
type Project = {
  id: string;
  name: string;
  goal: string;
  ownerId: string;
  status: "active" | "paused" | "completed" | "archived";
  createdAt: number;
  updatedAt: number;
  tags?: string[];
};
```

### 3. Task

```ts
type Task = {
  id: string;
  projectId?: string;
  ownerId: string;
  parentTaskId?: string;
  title: string;
  goal: string;
  status: "new" | "planned" | "assigned" | "running" | "blocked" | "reviewing" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  executorType?: "codex";
  workerId?: string;
  completionCriteria?: string[];
  blockers?: string[];
  dueAt?: number;
  createdAt: number;
  updatedAt: number;
  lastProgressAt?: number;
  nextFollowupAt?: number;
  tags?: string[];
};
```

### 4. Assignment

```ts
type Assignment = {
  id: string;
  taskId: string;
  workerId: string;
  executorType: "codex";
  status: "queued" | "starting" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  objective: string;
  inputs: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  heartbeatAt?: number;
  resultSummary?: string;
  errorSummary?: string;
};
```

### 5. ProgressEvent

```ts
type ProgressEvent = {
  id: string;
  taskId: string;
  assignmentId?: string;
  source: "owner" | "manager" | "worker" | "system";
  kind:
    | "task_created"
    | "task_split"
    | "task_assigned"
    | "work_started"
    | "heartbeat"
    | "blocked"
    | "needs_clarification"
    | "completed"
    | "failed"
    | "reassigned"
    | "cancelled";
  summary: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
};
```

### 6. Commitment

```ts
type Commitment = {
  id: string;
  ownerId: string;
  taskId?: string;
  projectId?: string;
  summary: string;
  status: "open" | "fulfilled" | "cancelled" | "overdue";
  dueAt?: number;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt?: number;
};
```

### 7. WorkerProfile

```ts
type WorkerProfile = {
  id: string;
  executorType: "codex";
  status: "idle" | "busy" | "offline" | "error";
  currentAssignmentId?: string;
  strengths?: string[];
  recentFailures?: string[];
  createdAt: number;
  updatedAt: number;
};
```

---

## 任务树模型

任务必须支持树状拆解。

典型结构：

```text
Project
└── Task A
    ├── Task A1
    ├── Task A2
    └── Task A3
```

使用规则：

- owner 通常只关心顶层任务
- manager 负责拆成子任务
- worker 通常只接叶子任务

因此：

- 非叶子任务通常不直接派工
- 叶子任务才会产生 `Assignment`

---

## 状态机设计

### Task 状态机

```text
new
-> planned
-> assigned
-> running
-> reviewing
-> done
```

异常分支：

```text
assigned/running -> blocked
assigned/running -> cancelled
running/reviewing -> failed(通过 progress event 体现后通常回到 planned 或 assigned)
```

推荐规则：

- `new`: 刚创建，尚未拆解或规划
- `planned`: 已明确目标和完成标准，但未派工
- `assigned`: 已分配 worker，尚未开始
- `running`: worker 已启动
- `blocked`: 明确遇到阻塞
- `reviewing`: worker 已交付，manager 正在消化和决定后续
- `done`: manager 判断目标完成
- `cancelled`: owner 或 system 终止

### Assignment 状态机

```text
queued -> starting -> running -> succeeded
queued -> starting -> running -> failed
queued -> starting -> running -> timed_out
queued -> cancelled
running -> cancelled
```

---

## 记忆系统分层

建议把记忆分成两层。

### 第一层：结构化真相层

这是系统的真实状态源：

- `tasks`
- `assignments`
- `progress_events`
- `commitments`
- `workers`
- `projects`

特点：

- 强约束
- 可索引
- 可测试
- 可审计

### 第二层：摘要记忆层

这是给 manager 用的高层摘要：

- 项目摘要
- 任务摘要
- worker 摘要
- 历史决策摘要

特点：

- 便于 LLM 消化
- 可由结构化数据派生
- 不是事实源

关键原则：

**摘要记忆可以丢，结构化真相层不能错。**

---

## 存储设计

建议把存储拆成两类：

### 1. 主状态表

包含：

- `tasks`
- `assignments`
- `projects`
- `commitments`
- `workers`

特点：

- 当前状态视图
- 便于查询
- 便于 manager 直接读取

### 2. 事件日志

包含：

- `progress_events`
- `decision_events`
- `repair_events`
- `notification_events`

特点：

- append-only 优先
- 用于恢复、审计、调试

建议模型：

```text
current state tables
+ append-only event logs
-> summary memory materialization
```

---

## Schema 版本策略

每个核心 store 应包含：

```ts
type StoreEnvelope<T> = {
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  data: T;
};
```

建议：

- 每次破坏性结构变更都提升 `schemaVersion`
- migration 必须是显式、可测试、可回滚策略已知的
- 旧版本数据不能静默按新结构解释

---

## 迁移与修复策略

启动流程建议：

1. 读取 store envelope
2. 校验 `schemaVersion`
3. 运行 migration
4. 校验迁移结果
5. 如发现局部损坏，进入 repair 流程
6. 记录 `repair_event`
7. 再暴露服务

### Repair 策略

对于可修复错误：

- 缺少可推导字段：自动补齐
- 过期枚举值：规范化
- 孤儿 assignment：标记 quarantine

对于不可修复错误：

- 不阻断整个系统
- 隔离损坏记录
- 生成 operator-visible 告警

---

## 查询与摘要策略

manager 的 LLM 上下文不应直接读取全量 store。

应该经过两层：

1. 结构化查询
2. 摘要构造

例如：

- “有哪些 overdue task”
- “这个 owner 最近 7 天有哪些 open commitments”
- “worker X 最近两次为什么失败”

先查结构化数据，再生成摘要。

不要让 manager 直接对原始事件日志做无约束推理。

---

## 搜索设计

Manager 的搜索至少要支持 4 类查询。

### 1. task search

用于：

- 查当前未完成任务
- 查某项目下的所有任务
- 查 blocked 或 overdue 任务

### 2. commitment search

用于：

- 查对 owner 的未兑现承诺
- 查快到期事项

### 3. worker search

用于：

- 查谁空闲
- 查谁卡住
- 查谁最近表现差

### 4. project search

用于：

- 查某项目长期目标
- 查已知依赖
- 查历史决策

---

## 监督机制

`AutoAide` 的“自动盯进展”建议建立在 5 类检测上。

### 1. Heartbeat 缺失检测

规则示例：

- worker 正在 `running`
- 超过 `heartbeatTimeoutMs` 没有新 heartbeat
- 标记为 `stalled`

### 2. Blocked 检测

规则示例：

- worker 显式上报 blocker
- 任务进入 `blocked`
- manager 进入 follow-up 流程

### 3. DueAt 超时检测

规则示例：

- 当前时间超过 `task.dueAt`
- 任务不是 `done` / `cancelled`
- 标记为 `overdue`

### 4. Commitment 超时检测

规则示例：

- 已记录对 owner 的承诺
- 超过 `commitment.dueAt`
- 尚未 `fulfilled`

### 5. Silent Failure 检测

规则示例：

- assignment 状态停在 `starting` 或 `running`
- heartbeat 没了
- 结果也没回来
- 需要系统发起恢复检查

---

## 自动跟进策略

建议把自动跟进限制成管理动作，不做执行动作。

允许的自动跟进：

- 询问 worker 状态
- 催 heartbeat
- 重发任务上下文
- 标记 blocked
- 通知 owner
- 建议 reassign

不允许的自动跟进：

- manager 自己下场修 bug
- manager 自己执行代码操作

---

## 稳健性要求

### 1. 去重

所有 owner 消息、任务创建、worker 回报都要有幂等键或 dedupe 机制。

建议幂等键来源：

- owner ingress message id
- manager task creation request id
- worker assignment id
- worker result id / completion token

### 2. 可恢复

重启后必须能恢复：

- 未完成任务
- 正在运行的 assignment
- 未兑现 commitment
- worker 最近心跳状态

### 2.1 恢复语义

恢复后不要求“假装没重启过”，但必须保证：

- 未完成任务可继续监督
- 卡住任务不会被误判为完成
- commitment 不会遗漏
- follow-up 定时器可重建

### 3. 可审计

必须能追溯：

- 为什么创建这个任务
- 为什么分给这个 worker
- 为什么 overdue
- 为什么通知 owner

### 4. 可降级

如果 worker 离线或 Codex 不可用，manager 应该：

- 保持任务状态
- 标记阻塞
- 告知 owner

而不是丢任务。

---

## 最小可行实现建议

第一版建议先做：

- 结构化 `Task`
- 结构化 `Assignment`
- 结构化 `ProgressEvent`
- 结构化 `Commitment`
- 简单 `WorkerProfile`
- 基于时间阈值的 stalled / overdue 检测

先不要做太复杂的向量记忆或智能推断。

先把“能记住”和“不会丢事”做好。

---

## 成功标准

1. owner 交办的任务不会因为对话滚动而丢失。
2. manager 能清楚知道每个任务当前状态。
3. manager 能知道任务分给了哪个 worker。
4. manager 能自动发现 stalled、blocked、overdue。
5. 系统重启后不会忘掉未完成事项。
