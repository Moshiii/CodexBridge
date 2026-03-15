# AutoAide Manager 轻约束落地方案

## 当前口径更新

这份文档主要讨论的是单条任务线上的 manager 行为落地。

当前整体产品口径已经升级为：

- 你是 `CEO`
- `manager` 更准确地说是 `COO`
- `manager` 需要持续管理多条并行 workstreams

因此，本文的所有“manager 轻约束”原则仍然成立，但它们应被放入一个更高层的 `CEO -> COO -> workstreams -> workers` 架构中理解。

多线程控制面的正式目标见：

- [AutoAide-CEO-COO多线程管理架构设计.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/manager/AutoAide-CEO-COO多线程管理架构设计.md)

## 目标

本文基于 [AutoAide-Manager做事风格设计.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/manager/AutoAide-Manager做事风格设计.md) ，对比当前 manager 实现，给出一套“尽量依赖大模型能力、本地代码只保留轻约束”的落地方案。

核心原则：

- 让大模型负责判断、选人、跟进节奏、升级策略
- 让本地代码只负责状态持久化、权限边界、结构化执行
- 不把 manager 写死成一堆 if/else 工作流

---

## 一、当前实现和目标风格的差距

## 1. 当前已经做对的部分

当前代码里最正确的部分，是已经把 manager 定位成“communication-only manager”。

可以看到：

- [packages/manager-runtime/src/runtime/codex.ts](/Users/moshiwei/Documents/GitHub/AutoAide/packages/manager-runtime/src/runtime/codex.ts) 的 prompt 明确写了 manager 不直接执行具体工作
- [packages/manager-runtime/src/application/turn-execution.ts](/Users/moshiwei/Documents/GitHub/AutoAide/packages/manager-runtime/src/application/turn-execution.ts) 里 manager 通过结构化 tool call 改变系统状态
- [apps/tui/src/exec.ts](/Users/moshiwei/Documents/GitHub/AutoAide/apps/tui/src/exec.ts) 里实际 worker 执行在 manager turn 之后发生

这说明大方向已经是：

- owner 对 manager 说需求
- manager 决定 tool calls
- 本地系统落库和调度
- worker 负责实际执行

这个分层是对的。

## 2. 当前偏“规则式经理”，还不是“经理型 agent”

当前主要问题不是角色错了，而是本地逻辑替 manager 做了太多管理判断。

主要体现在：

### A. 任务理解过于规则化

[packages/manager-runtime/src/policy/owner-intent.ts](/Users/moshiwei/Documents/GitHub/AutoAide/packages/manager-runtime/src/policy/owner-intent.ts)

这里用字符串前缀和长度来判断：

- 是 `conversation_only` 还是 `managed_task`
- 是否需要 clarification

这很轻，但也很僵硬。真正的 manager 风格应该主要由大模型判断，而不是靠 `"what can you do"`、`?`、`text.length < 12` 这种规则。

### B. 计划和派工仍然被本地代码半自动决定

[packages/manager-runtime/src/runtime/deterministic.ts](/Users/moshiwei/Documents/GitHub/AutoAide/packages/manager-runtime/src/runtime/deterministic.ts)

这个 runtime 直接：

- 自动建 plan
- 自动 assign 第一个 step
- 自动 schedule follow-up

它更像 demo fallback，不像经理。

而在 codex runtime 中，虽然 plan 来自模型，但 apply 阶段仍然有很多硬编码约束。

### C. 选人逻辑过于简单

[packages/manager-runtime/src/application/turn-execution.ts](/Users/moshiwei/Documents/GitHub/AutoAide/packages/manager-runtime/src/application/turn-execution.ts)

当前 `assign_worker` 的逻辑基本是：

- 如果指定了 preferred worker，就用它
- 否则找第一个 idle worker
- 再不行就 spawn 一个默认 worker

这不是“经理在选人”，而是“调度器在拿空闲槽位”。

### D. follow-up 机制偏静态

[packages/manager-runtime/src/policy/manager-state.ts](/Users/moshiwei/Documents/GitHub/AutoAide/packages/manager-runtime/src/policy/manager-state.ts)

这里的 follow-up receipts 主要依据：

- clarification pending
- task reviewing
- task blocked

这是状态回显，不是 manager 主动监督。

缺的是：

- 模型决定何时跟进
- 模型决定跟进话术
- 模型决定继续等、催办、换人还是升级

### E. worker registry 太薄，难以支持“经理选人”

[packages/task-system/src/index.ts](/Users/moshiwei/Documents/GitHub/AutoAide/packages/task-system/src/index.ts)

[packages/worker-orchestrator/src/index.ts](/Users/moshiwei/Documents/GitHub/AutoAide/packages/worker-orchestrator/src/index.ts)

目前 worker 只有：

- `status`
- `strengths`
- `recentFailures`

缺少更适合 manager 判断的信号：

- 最近成功率
- 擅长任务类型
- 最近处理过什么
- 是否适合复用当前上下文
- 是否适合长任务 / 短任务

---

## 二、我建议的技术路线

## 总原则

不是把更多管理规则写进本地代码，而是把本地代码改成：

- 给模型更多结构化上下文
- 允许模型输出更丰富的管理动作
- 本地只做最小合法性检查和状态更新

可以把它理解成：

- 现在：本地系统负责“怎么管理”，模型只负责“填一点内容”
- 目标：模型负责“怎么管理”，本地系统只负责“把管理动作安全执行”

---

## 三、推荐的职责边界

## 应该交给大模型的部分

以下内容建议尽量交给 manager model：

- 这是不是该直接回答还是该管理推进
- 是否需要澄清
- 是否复用现有 worker
- 应该选哪个 worker
- 没人合适时是否新建 worker
- follow-up 频率
- 是否继续等待、催办、换人、升级
- 如何向 owner 汇报
- 如何定义任务 objective / deliverable / completion signal

## 应该保留在本地代码的部分

以下内容必须保留为本地轻约束：

- task / assignment / worker 的状态持久化
- tool call schema 校验
- worker 是否存在
- assignment 是否存在
- 状态迁移是否合法
- 运行时权限边界
- timeout / heartbeat 的基础检测

这两层分工是合理的：

- 模型负责判断
- 系统负责执行和兜底

---

## 四、具体改造建议

## 方案 1：把 `assign_worker` 从“执行命令”升级成“管理决策”

当前 `assign_worker` 输入太弱，只有：

- `taskTitle`
- `objective`
- `preferredWorkerId`

建议改成更接近经理派工：

```ts
type ManagerToolCall =
  | {
      kind: "assign_worker";
      taskRef: { id?: string; title?: string };
      objective: string;
      deliverable?: string;
      completionSignal?: string;
      preferredWorkerId?: string;
      selectionReason?: string;
      createIfMissing?: boolean;
      desiredWorkerProfile?: {
        strengths?: string[];
        taskType?: string;
      };
      reason: string;
    }
```

这样做的意义：

- 模型可以说明为什么选这个 worker
- 模型可以要求“没有合适的就新建”
- 模型可以把任务合同一起下发

本地代码只负责：

- 找到 task
- 找到 worker 或创建 worker
- 记录 assignment

不负责“为什么这样选”。

## 方案 2：补一个 `select_worker` 或 `staff_task` 工具调用

如果你希望 manager 更像经理，而不是一步到位直接 assign，我建议加一个更高层动作：

```ts
{
  kind: "staff_task";
  taskRef: { id?: string; title?: string };
  staffingMode: "reuse" | "spawn";
  preferredWorkerId?: string;
  desiredWorkerProfile?: {
    strengths?: string[];
    taskType?: string;
    seniority?: "junior" | "mid" | "senior";
  };
  objective: string;
  completionSignal?: string;
  followupInMinutes?: number;
  reason: string;
}
```

然后本地系统把它翻译成：

- 复用已有 worker
- 或 spawn worker 再 assign
- 再自动设置 follow-up

这比让模型自己拆成三步 tool call 更稳，但仍然是轻约束。

我更推荐这个方案。

原因是：

- 它保留了 manager 的高层管理判断
- 它减少模型在低层编排细节上的脆弱性
- 它不会把本地代码变成复杂的 rule engine

## 方案 3：把 `taskTitle` 匹配改成 `taskId` 优先

当前很多失败就是 title 漂移带来的。

建议所有 manager tool call 改成：

- `taskId` 优先
- `taskTitle` 仅作展示或 fallback

这属于必须保留的本地强约束，不应该交给模型自由发挥。

原因很简单：

- 这是引用完整性问题
- 不是“管理风格”
- 属于系统层 correctness

## 方案 4：把 worker snapshot 做厚一点，把本地规则做薄一点

现在 `buildManagerGrounding()` 给模型的 worker 信息太少。

建议把传给 manager 的 worker 摘要增强到至少包括：

- `workerId`
- `status`
- `strengths`
- `currentAssignmentSummary`
- `lastHeartbeatAgeMs`
- `recentOutcome`
- `recentTaskTypes`
- `reuseHint`

比如：

```ts
workers: [
  {
    workerId: "worker-1",
    status: "idle",
    strengths: ["testing", "typescript"],
    recentOutcome: "succeeded",
    recentTaskTypes: ["server-test", "bug-triage"],
    reuseHint: "Recently completed similar test investigations"
  }
]
```

这样 manager 才能真的“选人”。

本地代码不需要替它做复杂判断，只需要把上下文喂够。

## 方案 5：让 follow-up 由模型决定，本地只负责计时和触发

当前 follow-up 更像静态系统消息。

建议改成两层：

### 第一层：manager 在首轮就设 follow-up 意图

例如模型输出：

- 20 分钟后检查初步结果
- 如果无心跳则先询问 worker
- 两次无响应后升级给主人

### 第二层：本地调度器只负责“时间到了，重新叫 manager 看一眼”

本地系统不直接决定“该不该催”“该不该换人”，而是在到点后再次调用 manager runtime，并提供：

- 当前 task 状态
- worker 最近心跳
- assignment 是否超时
- 历史 follow-up 次数

然后由模型输出：

- `wait`
- `nudge_worker`
- `replace_worker`
- `ask_owner`
- `replan_task`

这才是经理式 follow-up。

## 方案 6：增加针对监督的 manager tool calls

建议新增：

```ts
{ kind: "nudge_worker"; workerId: string; taskId: string; message: string; reason: string }
{ kind: "replace_worker"; taskId: string; fromWorkerId?: string; desiredWorkerProfile?: {...}; reason: string }
{ kind: "mark_task_done"; taskId: string; summary: string; reason: string }
{ kind: "update_task_brief"; taskId: string; summary: string; completionCriteria?: string[]; reason: string }
```

这几个动作都很轻，但能把 manager 从“创建任务 + 指派 + follow-up”升级成真正能管人的经理。

## 方案 7：验收不要写成硬规则，要写成 manager review loop

当前 worker 成功后 task 进入 `reviewing`，这是对的。

但下一步不应由本地代码自动判断 done，而应让 manager 再看一次。

建议流程：

1. worker 回传结果
2. task 进入 `reviewing`
3. 本地系统触发一次 manager review turn
4. manager 决定：
   - `mark_task_done`
   - `assign_worker` 返工
   - `replan_task`
   - `ask_owner`

这一步非常重要，因为它把“经理负责验收”真正落地了。

---

## 五、建议最小实现路径

如果你想尽量轻量，不建议一次性大改。

建议分三阶段。

## 第一阶段：只修数据结构，不改大流程

目标：

- 保持现有 turn-execution 框架
- 增强模型可见上下文
- 提高 tool call 表达能力

建议做：

1. `assign_worker` 改为 `taskId` 优先
2. 扩充 worker grounding 字段
3. 给 assignment 增加 `deliverable`、`completionSignal`
4. 给 worker 增加轻量历史统计字段

这是收益最高、风险最低的一步。

## 第二阶段：让 manager 接管 follow-up 判断

目标：

- 本地代码只负责“到点提醒”
- manager 决定“接下来怎么管”

建议做：

1. 保留 `schedule_followup`
2. 到点时触发一个 manager follow-up turn
3. 给 manager 注入 task/worker 当前状态
4. 允许 manager 输出 `wait / nudge / replace / replan / ask_owner`

这一步之后，manager 才开始有“盯办能力”。

## 第三阶段：引入高层 staffing tool

目标：

- 让 manager 真正像经理，而不是像操作员

建议做：

1. 新增 `staff_task`
2. 本地将其翻译成 spawn/reuse/assign/follow-up
3. 将原始 `assign_worker` 逐渐下沉成内部动作

到这一步，manager 的行为就会更接近“我判断让谁来做，并设好检查点”。

---

## 六、建议保留的本地强约束

虽然总体要轻约束，但以下几条不能放给大模型：

## 1. 引用必须稳定

- `taskId`
- `assignmentId`
- `workerId`

不能只靠 title。

## 2. 状态迁移必须受控

例如：

- `planned -> assigned -> running -> reviewing -> done`
- `running -> blocked`

这必须由本地代码守住。

## 3. 权限边界必须受控

manager 不应直接拿 executor 权限。  
这是角色隔离问题，不是提示词问题。

## 4. 时间和超时检测必须本地化

心跳、超时、follow-up 到期，这些都应由本地调度器保证可靠触发。

---

## 七、我建议的最终架构口径

可以把你要的 manager 架构概括成下面这句话：

> manager 负责管理判断，系统负责可靠执行。  
> manager 决定是否澄清、是否复用现有 worker、是否新建 worker、何时跟进、何时升级；本地代码只负责持久化状态、执行结构化动作、保证引用和状态机正确。

这条线很适合你现在的目标，因为它既保留了大模型的灵活性，也避免本地代码膨胀成复杂流程引擎。

在新的 CEO-COO 口径下，这条原则需要继续上提一层：

- COO 负责多 workstream 的组织判断
- 本地系统负责 workstream / inbox / heartbeat wake 的可靠运行
- 单条任务线上的 `assign / review / follow-up` 只是 COO control plane 的一个子环节

---

## 八、对当前代码的具体建议

优先级最高的几项是：

1. 改 `taskTitle` 为 `taskId` 优先，解决 manager action 引用脆弱问题。
2. 扩充 manager grounding 里的 worker 信息，让模型真正有选人依据。
3. 给 `assign_worker` 增加任务合同字段，而不是只有 objective。
4. 增加 follow-up manager turn，让模型决定催办/换人/升级。
5. 增加 `nudge_worker`、`replace_worker`、`mark_task_done` 这类高价值轻量 tool calls。

如果只做这五项，manager 的做事风格就会明显更像“经理”，而不是“轻量任务路由器”。
