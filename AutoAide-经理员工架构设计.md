# AutoAide 经理员工架构设计

## 一句话定义

`AutoAide` 不是执行器。

`AutoAide` 是一个：

- 面向主人的多渠道管理中枢
- 面向任务的计划与调度系统
- 面向组织的跨任务记忆系统
- 面向执行器的派工与监督系统

实际执行工作全部交给外部执行器，例如 `Codex executor`。

---

## 核心定位

你的这个版本里，`AutoAide` 应该明确禁止自己承担“实际生产工作”。

也就是说它不应该负责：

- 直接改代码
- 直接跑测试
- 直接执行 shell
- 直接调用工程型工具完成任务
- 直接成为一个会干活的 coding agent

它应该负责的是：

- 接收主人需求
- 拆分目标
- 建立任务树
- 分配执行器
- 跟踪执行进度
- 维护跨任务记忆
- 根据反馈继续派工
- 向主人汇报

一句话：

**AutoAide 是经理，不是员工。**

---

## 角色模型

整个系统建议固定成 3 类角色。

### 1. Owner

就是主人。

职责：

- 提需求
- 看汇报
- 介入决策
- 调整优先级
- 终止或批准任务

交互入口：

- Discord
- Telegram
- Slack
- Web

### 2. Manager

不是 `AutoAide core` 本体。

它是运行在 `AutoAide core` 上的一个常驻 `Codex manager agent`。

`AutoAide core` 负责提供任务、记忆、调度、监督、权限和界面底座。  
`manager` 负责利用这些底座持续代表 owner 做管理判断。

职责：

- 接受 Owner 的目标和追加说明
- 维护与 Owner 的持续对话关系
- 理解当前组织上下文
- 查记忆和历史任务
- 规划工作分解结构
- 决定是否需要追问、拆任务、派工、重规划或升级
- 派发给 worker
- 监督 worker 进展
- 管理阻塞、升级、重试、返工
- 汇总信息并回报 Owner

使命：

**代表 owner 持续盯事，直到事情被推进、澄清、升级或完成。**

业务范围：

- owner communication
- planning
- task decomposition
- worker routing decision
- progress supervision
- escalation
- decision logging
- summary and reporting

限制：

- 不直接做工程执行
- 不直接操作宿主环境
- 不直接跑 coding tools
- 不直接继承 worker 的工具权限
- 不直接读取 worker 私有凭据
- 不假装自己已经完成了具体执行动作

### 3. Worker

就是 `Codex executor` 这类执行器。

职责：

- 接收具体 job
- 自己使用工具和技能完成任务
- 产出结果
- 回报状态

特点：

- worker 才是实际执行者
- worker 可以调用工具
- worker 可以读写代码、跑命令、做检查
- worker 的生命周期由 AutoAide 管理

---

## 最关键的设计原则

### 原则 1：经理和员工必须彻底分层

`AutoAide` 的 manager plane 不能和 worker plane 混在一起。

不能出现这种情况：

- manager 一边拆任务
- 一边顺手自己改文件
- 一边自己跑测试

这会立刻让系统退化成“大号 agent”。

### 原则 2：经理只拥有调度工具，不拥有生产工具

Manager 能用的工具应该只有：

- 搜索类
- 记忆类
- 任务管理类
- worker 生命周期类
- 状态观察类
- channel 沟通类

Manager 不应该拥有：

- shell exec
- apply patch
- 文件修改
- 本地工程操作

补充说明：

- manager 可以产出结构化 orchestration actions
- 但这些动作必须通过 `AutoAide core` 执行
- manager 不能越过 orchestration boundary 直接下场

### 原则 3：所有执行动作必须归属到某个 worker

系统里每个实际执行动作都必须可归因：

- 是哪个 worker 做的
- 属于哪个任务
- 属于哪个项目
- 对应哪个 owner 请求

### 原则 4：AutoAide 的核心资产是“组织记忆”

你这个系统真正最值钱的部分不是模型，而是：

- 任务记忆
- 组织记忆
- 项目记忆
- 执行器记忆
- 进展记忆

也就是：

**它要记得事情，并且持续盯事情。**

### 原则 5：owner 面对的应该始终是一个持续在线的 manager

即使底下有多个 worker、多种状态和多层系统，owner 感知到的也应该始终是：

- 一个统一的对话入口
- 一个持续在线的管家角色
- 一个稳定的任务控制点

所以默认交互设计必须优先支持 manager conversation，而不是默认暴露 dashboard。

---

## AutoAide 的核心能力边界

建议把 `AutoAide` 限定成 5 个核心能力。

### 1. Planning

负责：

- 接需求
- 理解目标
- 生成任务树
- 定义优先级
- 定义完成标准

### 2. Search

负责：

- 检索历史任务
- 检索项目上下文
- 检索 worker 结果
- 检索阻塞与依赖

这个 search 更偏“管理搜索”，不是“工程执行搜索”。

### 3. Scheduling

负责：

- 选择执行器
- 派单
- 排队
- 限流
- 重试
- 超时
- 重新分配

### 4. Memory

负责：

- 保存任务状态
- 保存任务之间的依赖关系
- 保存负责人和执行器关系
- 保存历史决策
- 保存已知阻塞
- 保存已承诺但未完成事项

### 5. Channel Communication

负责：

- 和主人沟通
- 接收指令
- 主动汇报
- 追踪需要确认的事项

---

## 什么绝对不应该放进 AutoAide

这是这个项目能不能保持轻量化的关键。

### 不应包含的能力

- 原生 LLM provider orchestration
- provider fallback
- coding tool runtime
- 文件系统写入执行
- 工程命令执行
- patch 应用
- 本地 repo 实际修改
- 大而全的 agent runtime

### 原因

如果把这些加进去，`AutoAide` 会变成另一个 OpenClaw agent runtime。

而你现在的目标恰恰相反：

- 让 `AutoAide` 成为轻量化管理层
- 让 `Codex` 成为执行层

---

## 推荐的目标架构

```text
Owner
-> Channel Interface
-> AutoAide Manager Core
-> Task / Memory / Scheduling System
-> Worker Orchestrator
-> Codex Executors
```

展开后：

```text
AutoAide
├── owner-interface
│   ├── discord
│   ├── telegram
│   ├── slack
│   └── web
├── manager-core
│   ├── planner
│   ├── task-graph
│   ├── scheduler
│   ├── progress-supervisor
│   └── escalation-policy
├── memory-system
│   ├── task-memory
│   ├── project-memory
│   ├── worker-memory
│   ├── decision-log
│   └── followup-reminders
├── orchestration
│   ├── worker-registry
│   ├── worker-spawn
│   ├── worker-routing
│   ├── worker-heartbeat
│   └── worker-reassignment
└── integrations
    ├── codex-executor
    └── channel-bridge
```

---

## 管理层工具设计

Manager 只能调用管理类工具。

建议分 6 组。

### 1. 任务工具

- `task_create`
- `task_split`
- `task_update`
- `task_close`
- `task_block`
- `task_unblock`
- `task_reprioritize`

### 2. 搜索工具

- `task_search`
- `project_search`
- `memory_search`
- `worker_search`
- `dependency_search`

### 3. worker 管理工具

- `worker_spawn`
- `worker_assign`
- `worker_status`
- `worker_cancel`
- `worker_reassign`
- `worker_archive`

### 4. 监督工具

- `progress_check`
- `progress_watch`
- `sla_overdue_list`
- `blocked_tasks_list`
- `stalled_workers_list`

### 5. 沟通工具

- `owner_reply`
- `owner_ask`
- `owner_notify`
- `owner_summary`

### 6. 记忆工具

- `memory_write`
- `memory_link`
- `memory_read`
- `decision_record`
- `commitment_record`

---

## Worker 工具设计

worker 才有执行工具。

例如 `Codex executor` 拥有：

- 文件读写
- 代码搜索
- shell
- patch
- 测试
- git 检查
- 文档修改

关键点是：

- worker 的工具权限不属于 manager
- manager 只能决定“派谁去做”
- manager 不应该直接越权执行

---

## 任务模型

建议把任务系统设计成显式的数据模型，而不是只靠 prompt 记忆。

### 顶层任务

```ts
type Task = {
  id: string;
  title: string;
  goal: string;
  status: "new" | "planned" | "assigned" | "running" | "blocked" | "reviewing" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  ownerId: string;
  projectId?: string;
  parentTaskId?: string;
  workerId?: string;
  executorType?: "codex";
  createdAt: number;
  updatedAt: number;
  dueAt?: number;
  completionCriteria?: string[];
  blockers?: string[];
  tags?: string[];
};
```

### 执行单元

```ts
type Assignment = {
  id: string;
  taskId: string;
  workerId: string;
  executorType: "codex";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  objective: string;
  inputs: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  resultSummary?: string;
};
```

### 进展记录

```ts
type ProgressEvent = {
  id: string;
  taskId: string;
  assignmentId?: string;
  source: "manager" | "worker" | "system";
  kind: "created" | "assigned" | "started" | "heartbeat" | "blocked" | "completed" | "failed" | "reassigned";
  summary: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
};
```

---

## 跨部门管理记忆系统

这是 `AutoAide` 最重要的模块。

它不是普通聊天记忆，而应该是组织管理记忆。

建议分 5 类。

### 1. Task Memory

记录：

- 任务是什么
- 当前状态是什么
- 谁在负责
- 上次推进到哪里
- 下一步是什么

### 2. Project Memory

记录：

- 这个项目的长期目标
- 关键里程碑
- 已知依赖
- 常见阻塞
- 历史决策

### 3. Worker Memory

记录：

- 哪个 worker 擅长什么
- 正在做什么
- 最近失败了什么
- 当前工作负载

### 4. Decision Memory

记录：

- 为什么这样拆任务
- 为什么选这个 worker
- 为什么延期
- 为什么停止某个方向

### 5. Commitment Memory

记录：

- 已经答应主人的事情
- 尚未完成的承诺
- 需要 follow-up 的事项

这个模块的最终目标是：

**让 AutoAide 能长期盯住很多并行事项，不丢事。**

---

## 管理循环

Manager 的核心循环建议固定成：

1. 收到主人目标
2. 检索相关记忆
3. 建立或更新任务树
4. 判断哪些任务要立即派工
5. spawn 对应 worker
6. 等待 worker 回报或 heartbeat
7. 更新任务状态和记忆
8. 判断是否需要继续拆解、返工、升级、汇报
9. 对主人输出阶段性总结

这个循环里最关键的是第 6 到第 8 步。

因为你的系统价值不只是“派一次工”，而是：

- 持续盯进度
- 自动发现 stalled task
- 自动追 worker
- 自动决定继续安排

---

## 一个完整链路示例

### 场景

主人说：

“把 AutoAide 新仓库搭起来，先迁 session、cron、discord channel 三部分。”

### 系统行为

1. `AutoAide` 接收指令。
2. 搜索历史是否已有相关项目和未完成任务。
3. 建立顶层项目任务：
   - 新仓库初始化
   - session 迁移
   - cron 迁移
   - discord channel 迁移
4. 给每个子任务定义完成标准。
5. spawn 3 个 `Codex worker` 去分别处理具体子任务。
6. manager 自己不改代码，只观察和协调。
7. 某个 worker 报告 blocked，manager 记录 blocker 并决定：
   - 换 worker
   - 重新拆任务
   - 问主人确认
8. 其它 worker 完成后，manager 汇总结果，更新主任务进展。
9. manager 向主人汇报：
   - 已完成
   - 卡住点
   - 下一步建议

---

## 推荐从 OpenClaw 保留什么

在这个架构下，建议保留的 OpenClaw 能力非常明确。

### 建议保留

- `src/gateway`
- `src/channels/*`
- `src/routing/*`
- `src/sessions/*`
- `src/cron/*`
- `src/gateway/server-methods/*`
- `src/acp/*`

### 建议重构为管理层能力

- 会话绑定
- worker spawn
- thread routing
- lifecycle management
- progress watching

### 建议不要继续保留为核心

- `src/agents/pi-embedded-runner/*`
- 原生 provider/model/fallback 大系统
- 原生 coding agent 内核

因为这些会让 `AutoAide` 重新变重。

---

## 推荐 package 边界

```text
AutoAide
├── packages/core-config
├── packages/core-sessions
├── packages/channel-bridge
├── packages/cron-runtime
├── packages/task-system
├── packages/memory-system
├── packages/manager-core
├── packages/worker-orchestrator
├── packages/executor-codex
└── apps/server
```

### `manager-core`

负责：

- 任务规划
- 调度策略
- 监督与升级
- 汇报生成

### `worker-orchestrator`

负责：

- spawn worker
- 路由任务到 worker
- 跟踪 worker 生命周期
- 处理 worker 心跳和回报

### `executor-codex`

负责：

- 启动 codex executor
- 接收具体 job
- 返回执行结果

注意：

- 这里不是 `AutoAide` 做事
- 而是 `AutoAide` 委托别人做事

---

## 成功标准

如果这个项目最终做对了，应该呈现为：

1. 主人只和 manager 对话。
2. manager 能清楚知道当前有哪些任务、谁在做、卡在哪。
3. manager 能主动跟进，不需要主人每次手动催。
4. manager 自己不执行工程动作。
5. worker 才执行工具和技能。
6. 系统能长期维护跨任务、跨项目、跨 worker 的记忆。

---

## 最终建议

你现在这个方向比“做另一个 OpenClaw”更清晰，也更轻。

真正应该做的是：

- 用 OpenClaw 的 channel / session / cron / orchestration 壳
- 做一个管理层系统 `AutoAide`
- 用 `Codex` 做员工执行器
- 让 `AutoAide` 专注在“记事、派工、盯进展、向主人汇报”

一句话收束：

**AutoAide 应该是一个会管理很多 Codex 员工的总经理，而不是一个自己下场干活的超级员工。**
