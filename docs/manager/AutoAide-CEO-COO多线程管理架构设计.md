# AutoAide CEO-COO 多线程管理架构设计

## 一句话定义

在这个模型里：

- 你是 `CEO`
- `manager` 是 `COO`
- `worker agents` 是 COO 管理下的执行团队

`COO` 的职责不是盯一个任务，而是同时管理很多并行 workstreams，并且随时响应 CEO 的追问。

---

## 为什么要改成 CEO-COO 模型

之前的 manager 设计更接近：

- owner 给一个任务
- manager 派给一个 worker
- worker 回来
- manager 判断要不要继续

这适合单条任务线，但不适合你现在说的真实使用方式：

- CEO 可能同时交给 COO 70 条任务线
- COO 要独立推进每一条线
- CEO 可以随时问 A 线怎么样、B 线怎么样
- COO 必须立刻切换并回答，而不是等一个长周期 loop

所以正确模型不是“一个经理盯一个长期任务”，而是“一个 COO 同时经营多个 workstreams”。

---

## 角色模型

## CEO

职责：

- 提出新目标
- 调整优先级
- 追问任意一条任务线的状态
- 批准重大方向变更
- 对需要人类判断的问题拍板

CEO 不直接面对 worker。

## COO

职责：

- 接收 CEO 的任务并建立独立 workstream
- 判断每条线是否需要澄清、分派、换人、升级或收口
- 保持通讯一直畅通
- 在没有 CEO 追问时，也能通过 heartbeat / scheduler 主动盯事
- 在 CEO 随时插入追问时，能快速切换上下文并回答

COO 是一个持续在线的 control plane，不是一次性 turn handler。

## Worker Agents

职责：

- 接收具体 assignment
- 负责执行
- 回传 heartbeat / checkpoint / result / failure

Worker 不负责自己定义 root goal 是否完成，只负责报告事实。

---

## Manager Plane 与 Tool 边界

在 CEO-COO 模型里，COO 仍然必须保持严格边界：

- CEO 只面对 COO
- app 层只接 COO runtime
- COO 只通过结构化 orchestration contract 管理 worker
- worker 才拥有具体执行能力

这意味着：

- COO 不是 executor
- COO 不直接拿 shell、patch、工程执行权限
- COO 的真实动作必须可映射到结构化 tool calls

推荐长期保持的 manager plane 方向是：

- `manager-runtime` 成为 COO plane 的唯一入口
- `owner-interface` 只负责 owner/channel 适配
- `executor-*` 只负责 execution plane
- `task-system` / `memory-system` / 未来的 `workstream-system` 作为可恢复状态底座

---

## COO Tool-First 原则

COO 的最佳形态不是“很会说话的大模型”，而是：

- 智能来自 LLM
- 行动来自结构化 tool calls

自由文本可以用于：

- 解释
- 汇报
- 追问
- 压缩状态

但真正改变系统状态的动作应来自工具调用。

在当前方向下，COO 的高频动作应收敛为：

- `ask_owner`
- `create_tasks`
- `assign_worker`
- `schedule_followup`
- `replan_task`
- `record_decision`
- `nudge_worker`
- `replace_worker`
- `mark_task_done`

长期看，还应补一个更高层的 `staff_task` 或等价动作，让 COO 表达：

- 复用已有 worker
- 新建 worker
- 设定这次 assignment 的任务合同

而不是让本地代码替 COO 做太多低层调度决策。

---

## 核心设计原则

### 原则 1：CEO 和 COO 之间是持续经营关系，不是一次性问答

CEO 不是“发一条消息然后等完整结果”，而是持续经营很多任务线。

这意味着 COO 必须：

- 记住每条线的目标
- 记住最近状态
- 记住每条线现在由谁在做
- 随时可以被 CEO 打断

### 原则 2：COO 的管理对象是 workstream，不是单条消息

每个 CEO 任务都应转化为一个独立 workstream。

一个 workstream 至少要有：

- `workstreamId`
- `rootTaskId`
- `title`
- `goal`
- `status`
- `activeWorkerId`
- `lastManagerJudgment`
- `nextFollowupAt`
- `blockers`
- `summary`

### 原则 3：COO 的通讯必须持续畅通

这意味着 COO 不能被单条长任务“卡住”。

所以 COO 需要同时具备两种模式：

- `orchestration mode`
  推进任务、派工、跟进、验收
- `status query mode`
  快速回答 CEO 对任意 workstream 的追问

### 原则 4：heartbeat 只负责唤醒 COO，不负责替 COO 决策

如果 worker 长时间没有回复：

- scheduler / heartbeat 负责发现
- 负责唤醒 COO
- 由 COO 决定是继续等、催办、换人还是升级

这样才能保持“尽量依赖大模型判断、本地逻辑轻量化”。

### 原则 5：COO 盯的是 root goal，不是单次子任务

worker 回来之后，COO 要看的不是：

- “这个 worker 有没有结束”

而是：

- “这个 root goal 是否已经完成”
- “如果没完成，下一步应该怎么继续推进”

---

## 核心对象模型

## 1. Workstream

这是最关键的新抽象。

建议定义：

```ts
type Workstream = {
  id: string;
  ownerId: string;
  rootTaskId: string;
  title: string;
  goal: string;
  status: "active" | "waiting_owner" | "blocked" | "reviewing" | "done" | "archived";
  priority: "low" | "medium" | "high" | "critical";
  activeWorkerId?: string;
  nextFollowupAt?: number;
  lastManagerJudgment?: string;
  lastManagerReply?: string;
  lastCheckpointAt?: number;
  createdAt: number;
  updatedAt: number;
};
```

task 仍然存在，但 workstream 是 CEO/COO 沟通和切换的第一入口。

## 2. Manager Session

`COO` 不是 stateless request handler，而是一个长期存在的 session。

一个 session 至少要有：

- `sessionId`
- `ownerId`
- `activeWorkstreamId?`
- `lastWakeReason`
- `lastWakeAt`
- `pendingInboxCount`

## 3. Manager Inbox

COO 需要一个 inbox，而不是只靠 conversation turns。

inbox 里会堆这些事件：

- `owner_message`
- `worker_heartbeat`
- `worker_result`
- `followup_due`
- `stalled_assignment`
- `blocked_task`

COO 每次被唤醒，本质上是在处理 inbox。

---

## 运行模型

## 1. CEO 新建任务

流程：

1. CEO 发来一个新任务
2. COO 创建一个 workstream
3. COO 决定是否需要澄清
4. 若不需要澄清，则建立 root task 和当前执行步骤
5. COO 选择 worker 并分派

## 2. CEO 查询任务

流程：

1. CEO 问：“A 任务怎么样了？”
2. COO 先定位 workstream A
3. 读取该线最新状态、最近 worker 结果、最近 manager judgment
4. 直接回答状态摘要

这类查询不应自动重规划，也不应触发大规模编排。

## 3. Worker 回传结果

流程：

1. worker 返回 result
2. task 进入 `reviewing`
3. 唤醒 COO
4. COO 判断：
   - root goal 是否完成
   - 是否继续让当前 worker 推进
   - 是否换 worker
   - 是否 ask owner
   - 是否 mark done

## 4. Worker 长时间无响应

流程：

1. heartbeat timeout / scheduler 到点
2. 产生 `stalled_assignment` 或 `followup_due`
3. 唤醒 COO
4. COO 决定：
   - `wait`
   - `nudge_worker`
   - `replace_worker`
   - `replan_task`
   - `ask_owner`

---

## COO 的两种工作模式

## Mode A: Reactive Query

触发来源：

- CEO 新消息
- CEO 问某条线的状态

目标：

- 立即回答
- 立即切换 workstream
- 不阻塞 CEO 沟通

## Mode B: Proactive Supervision

触发来源：

- heartbeat
- scheduler
- follow-up due
- worker result
- blocked signal

目标：

- 不等 CEO 催
- 主动检查风险
- 主动推进或升级

这两种模式都应进入同一个 COO session，只是 wake reason 不同。

---

## 本地代码与大模型的职责分工

## 交给大模型的部分

- workstream 当前该怎么推进
- 这次是否该澄清
- 该选哪个 worker
- 是否继续使用当前 worker
- 是否应换人
- 是否应 ask owner
- 是否应 mark done
- 如何向 CEO 汇报

## 交给本地代码的部分

- workstream / task / assignment / worker 状态持久化
- inbox 事件存储
- wake scheduling
- heartbeat timeout 检测
- tool call schema 校验
- 状态机正确性
- 权限隔离

---

## 当前实现和目标实现的关系

## 当前已有基础

当前代码已经有：

- manager tool calls
- task / assignment / worker 状态存储
- worker result 后的 manager review turn
- follow-up due / blocked / reviewing 时的自动唤起雏形

这些是好的基础。

## 当前仍然缺的关键层

要完全变成 CEO-COO 模型，还缺：

- `workstream` 抽象
- `manager inbox`
- `manager session tick`
- `wake reason` 统一模型
- COO 对任意 workstream 的快速查询路径

---

## 推荐的实现顺序

### Phase A: 引入 Workstream

先让每个 CEO 任务有稳定 workstream，不再只是 conversation turns + root task。

### Phase B: 引入 COO Inbox

把 owner message、worker result、heartbeat timeout、follow-up due 统一变成 inbox events。

### Phase C: 引入 Session Tick

新增：

```ts
runManagerSessionTick(sessionId, wakeReason)
```

每次只处理一次管理判断，不做长阻塞。

### Phase D: 支持 CEO 任意切换查询

让 CEO 可以随时问：

- “A 任务怎么样了？”
- “B 任务现在卡在哪？”

COO 能直接根据 workstream 回答。

---

## 最终目标口径

最终应该把 `manager` 定义成：

> 一个常驻的 COO agent。  
> 它持续管理多个并行 workstreams，通过 worker 团队推进执行；它既能主动被 heartbeat / scheduler 唤醒进行监督，也能随时响应 CEO 对任意任务线的查询与切换。

这才是你现在真正要的 manager。
