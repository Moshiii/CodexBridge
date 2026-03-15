# AutoAide 架构设计

## 一句话定义

`AutoAide` 是一个面向真人用户的管理型 AI 系统。

它不直接执行工程工作，而是负责：

- 接收用户目标
- 规划任务
- 搜索上下文
- 维护长期记忆
- 派发执行器
- 跟进执行进展
- 通过 channel 向用户汇报

实际执行工作由外部 `Codex executor` 完成。

---

## 角色定义

### 1. Owner

`owner` 就是软件的真人用户。

职责：

- 提出目标
- 调整优先级
- 确认重大决策
- 查看阶段汇报
- 终止或批准任务

交互入口：

- Discord
- Telegram
- Slack
- Web

### 2. Manager

`manager` 不是 `AutoAide core` 本身。

`manager` 是运行在 `AutoAide core` 之上的一个常驻 `Codex` 管家 agent。

`AutoAide core` 提供的是：

- 任务图
- 记忆系统
- worker orchestration
- supervision
- 权限与可见性边界
- owner terminal / channel interface

`manager` 提供的是：

- 持续对话
- 任务理解
- 拆解与派工决策
- 追问与汇报
- 基于结构化状态做管理判断

`manager` 的智能来自 `LLM`，但它的动作必须来自 `tool calls`。

#### 使命

`manager` 的使命只有一句话：

**代表 owner 持续盯事，直到事情被推进、澄清、升级或完成。**

#### 核心职责

- 接收 owner 的目标和补充说明
- 理解当前任务上下文和历史承诺
- 在信息不足时主动追问
- 把 owner 目标转成任务树和管理动作
- 选择是否派工、催办、重规划或升级
- 持续跟踪 worker 进展、阻塞和超时
- 把复杂执行过程汇总成 owner 能理解的状态
- 维护“接下来该盯什么”的管理节奏

#### 业务范围

`manager` 只负责 manager plane 的工作：

- owner communication
- task planning
- task decomposition
- worker routing decision
- follow-up scheduling
- escalation
- decision logging
- progress summarization

它不负责 execution plane 的工作：

- 写代码
- 跑命令
- 调工程工具
- 改文件
- 直接完成 worker 该做的执行任务

#### 能力边界

`manager` 可以：

- 读取结构化记忆摘要
- 读取 task / assignment / commitment / worker 状态
- 产出结构化 orchestration tool calls
- 请求 owner 补充信息
- 决定派工、重规划、安排 follow-up、记录决策

`manager` 不可以：

- 直接获得 worker 的 shell 权限
- 直接获得 workspace 写权限
- 直接读取 worker 私有凭据或原始工具上下文
- 假装自己已经执行了具体工程动作
- 绕过 orchestration layer 直接控制宿主环境

#### 默认运行语义

- 默认 manager runtime 是 `CodexManagerRuntime`
- `DeterministicManagerRuntime` 只用于测试和显式 fallback
- owner 在 TUI 中面对的默认就是这个 manager
- manager 的回复必须尽量建立在结构化 memory grounding 和 tool contract 上，而不是自由发挥
- manager 不应把“自然语言回复”当成真正的状态改变手段
- 任何会改变系统状态的管理动作，都应通过结构化 tool call 落地

### 3. Worker

`worker` 是外部执行器，当前默认是 `Codex executor`。

职责：

- 接收具体任务
- 自己使用工具和技能完成任务
- 回报结果、阻塞和进展

---

## 核心设计原则

### 原则 1：AutoAide 提供经理底座，不直接充当员工

`AutoAide core` 负责承载 manager 和 worker 的组织系统，不直接做执行。

### 原则 2：执行动作必须归属于 worker

任何真正的工程动作都必须可归因到具体 worker、具体任务、具体 owner 请求。

### 原则 3：核心资产是组织记忆

`AutoAide` 最重要的能力不是“会不会写代码”，而是：

- 记住有哪些任务
- 记住谁在做
- 记住卡在哪里
- 记住对 owner 的承诺
- 记住下一步该盯谁

### 原则 4：channel 是 owner interface，不是 worker interface

owner 只和 manager 交互。

worker 不直接面对 owner。

### 原则 5：稳健性优先于“看起来聪明”

如果系统在下面几件事上不稳，这个产品就不成立：

- 丢任务
- 忘承诺
- 错误汇报进度
- 无法恢复未完成工作
- worker 异常后 manager 无法接管

因此 `AutoAide` 的系统设计必须优先保证：

- 状态一致性
- 可恢复性
- 幂等
- 可审计
- 异常降级

### 原则 6：manager 只能调度，不能通过侧门获得执行权

即使 manager 可以 `spawn`、`assign`、`cancel` worker，也不意味着它可以：

- 直接继承 worker 的执行权限
- 直接读取 worker 私有凭据
- 直接操作 worker 工作区
- 直接访问 worker 的原始工具上下文

manager 只拥有调度权和监督权，不拥有执行权。

### 原则 8：manager 必须是 tool-first，而不是 prompt-first 自动化

`manager` 当然可以自由理解 owner 的意图，但它不应该靠“自由文本”直接驱动系统行为。

正确分工应该是：

- `LLM` 负责理解、判断、组织语言
- `tool calls` 负责改变状态、触发编排、写入记录

也就是说：

- manager 的智能来自模型
- manager 的行动来自工具

这条原则的价值在于：

- 可控
- 可审计
- 可恢复
- 可测试
- 可在 TUI 中清楚展示

### 原则 7：owner 面对的是一个持续在线的管家角色

在产品体验上，owner 不应该感知到底下有多少 worker、多少状态机或多少模块。

owner 面对的应该始终是：

- 一个持续在线的 manager
- 一个连续的对话界面
- 一个统一的任务入口

这也是为什么 TUI 和后续 channel 都应该以 conversation-first 为主，而不是默认把 dashboard 暴露给 owner。

---

## 核心能力边界

### AutoAide 应该具备

- `planning`
- `search`
- `memory`
- `scheduling`
- `progress supervision`
- `channel communication`
- `manager tool execution layer`

### AutoAide 不应该具备

- 原生 coding runtime
- 工程执行工具
- 文件修改能力
- shell 执行能力
- patch 应用能力
- 大而全的 provider orchestration

### 执行器安全边界

`AutoAide` 和 `Codex worker` 之间必须有明确边界：

- worker 凭据属于 worker runtime，不属于 manager
- manager 只能看到结构化状态、摘要结果和允许暴露的错误信息
- worker 的工作区默认和 manager 状态存储隔离
- manager 不得直接读取 worker 的 token、密钥、环境变量
- manager 对 worker 的控制通过 orchestration API，而不是通过共享 shell

建议默认规则：

- manager 只拿到结构化 read tools 和 orchestration tools
- shell、文件修改、工程执行这类工具默认只给 worker
- owner-facing 的关键动作默认都应可映射到某个 tool call

- `manager`：无 shell、无 patch、无 workspace 写权限
- `worker`：拥有执行工具，但权限受 executor policy 和 sandbox policy 限制
- `channel bridge`：只接触 owner-facing 文本，不接触 worker 私密凭据

---

## 高层架构

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
│   └── commitment-memory
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

说明：

- `manager-core` 只依赖抽象的 `channel-bridge` 和 `worker-orchestrator`
- 任何 Discord / Telegram / Slack 特性都必须落在 adapter 层
- 新增 channel 不应要求修改 `manager-core`、`task-system`、`memory-system`

---

## 管理层工具

Manager 只能拥有管理类工具。

### 任务工具

- `task_create`
- `task_split`
- `task_update`
- `task_close`
- `task_block`
- `task_unblock`
- `task_reprioritize`

### 搜索工具

- `task_search`
- `project_search`
- `memory_search`
- `worker_search`
- `dependency_search`

### worker 工具

- `worker_spawn`
- `worker_assign`
- `worker_status`
- `worker_cancel`
- `worker_reassign`
- `worker_archive`

### 监督工具

- `progress_check`
- `progress_watch`
- `blocked_tasks_list`
- `stalled_workers_list`
- `overdue_commitments_list`

### 沟通工具

- `owner_reply`
- `owner_ask`
- `owner_notify`
- `owner_summary`

### 记忆工具

- `memory_write`
- `memory_link`
- `memory_read`
- `decision_record`
- `commitment_record`

---

## worker 工具边界

worker 才拥有执行工具。

例如 `Codex executor` 可以拥有：

- 文件读写
- shell
- patch
- 测试执行
- 代码搜索
- git 检查

这些能力不属于 manager。

### worker 回报边界

worker 回传给 manager 的内容必须分级：

- `summary`: 可直接给 manager 和 owner 使用的摘要
- `status`: 结构化状态，如 `running` / `blocked` / `completed`
- `artifact_ref`: 可选的结果引用，例如日志、补丁、报告 id
- `sensitive_debug`: 默认不向 manager 直接暴露，除非策略允许

这样可以避免 manager 变成 worker 的“透明代理终端”。

---

## 核心数据模型

### Task

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

### Assignment

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

### ProgressEvent

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

## 管理记忆系统

### Task Memory

记录任务状态、负责人、最近进展、下一步动作。

### Project Memory

记录项目目标、里程碑、长期依赖、历史决策。

### Worker Memory

记录 worker 擅长领域、负载、最近表现和失败模式。

### Decision Memory

记录为什么这么拆任务、为什么做出某个调度决定。

### Commitment Memory

记录已经答应 owner 的事情，以及尚未完成的 follow-up。

---

## 稳健性设计要求

### 1. 幂等

必须对这些动作建立幂等键或 dedupe 机制：

- owner 发起任务
- manager 创建任务
- worker 完成回报
- channel 汇报发送

### 2. 可恢复

系统重启后必须恢复：

- 未完成任务
- 未兑现承诺
- worker 最近状态
- 需要 follow-up 的事项

### 2.1 状态存储版本化

所有核心 store 都应该携带：

- `schemaVersion`
- `createdAt`
- `updatedAt`

至少包括：

- task store
- assignment store
- progress event log
- commitment store
- worker registry

### 2.2 状态迁移与修复

系统应支持：

- 启动时 schema migration
- 部分损坏数据的 fail-soft 修复
- 无法修复记录的 quarantine 隔离
- repair log 审计

建议策略：

- 结构化主表尽量使用 append-safe 写入
- 高价值状态变更同时写 event log
- 启动时先校验，再迁移，再暴露服务

### 3. 可审计

系统必须能回答：

- 这个任务是谁创建的
- 为什么分给这个 worker
- 为什么现在 blocked
- 为什么向 owner 发了这条通知

### 4. 可降级

如果 worker 挂了、channel 失败了、executor 超时了，manager 也不能丢失任务状态。

### 5. 统一工程基线

为了避免实现阶段漂移，建议从第一天固定：

- Node.js 22+
- TypeScript ESM
- `pnpm` 作为默认包管理器
- `vitest` 作为测试框架
- `oxlint` / `oxfmt` 或同等级工具负责 lint / format
- `src/` 放源码
- 测试尽量 colocated 为 `*.test.ts`

这是为了让后续 package 化拆分仍然保持一致。

---

## 测试导向

`AutoAide` 的测试重点应该放在：

- 管理状态机
- 结构化持久化
- 监督逻辑
- 恢复逻辑
- channel 沟通正确性

不是只测 prompt 输出是否自然。

---

## 管理循环

Manager 的主循环：

1. 接收 owner 目标
2. 搜索历史记忆
3. 创建或更新任务树
4. 选择要派发的任务
5. spawn 对应 worker
6. 接收 worker heartbeat / result / blocker
7. 更新任务状态和记忆
8. 必要时重派、升级、返工或询问 owner
9. 向 owner 输出阶段总结

---

## 推荐保留的 OpenClaw 能力

- `src/gateway`
- `src/channels/*`
- `src/routing/*`
- `src/sessions/*`
- `src/cron/*`
- `src/gateway/server-methods/*`
- `src/acp/*`

不建议把下列部分当成 `AutoAide` 核心：

- `src/agents/pi-embedded-runner/*`
- 原生 provider / fallback / auth 编排
- 原生 coding agent runtime

---

## Package 建议

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

---

## 成功标准

1. 真人用户只和 manager 交互。
2. manager 清楚知道每个任务是谁在做、进展如何、卡在哪里。
3. manager 会主动跟进，不需要用户一直催。
4. manager 自己不执行工程动作。
5. worker 负责所有实际工具调用和执行。
6. 系统具备跨任务、跨项目、跨 worker 的长期记忆能力。
