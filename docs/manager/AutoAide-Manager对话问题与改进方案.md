# AutoAide Manager 对话问题与改进方案

## 结论

当前 `manager` 的最大问题不是“不会说话”，而是：

- 把普通问答误判成管理任务
- 把内部编排动作暴露成了用户可感知噪音
- 回复节奏偏“回合制”，不像一个持续在线的管家

这会直接损害 owner 对 manager 的信任。

---

## 证据

来自当前本地 thread：

- `~/.autoaide/threads/terminal-owner-local.jsonl`

关键片段：

1. owner 先问：

- `what can you do?`

2. manager 正常回答后，紧接着又生成了：

- `plan_created: manager created 4 planned task(s)`
- `tool_calls_emitted: manager emitted 1 orchestration tool call(s)`
- `record_decision: [applied] Owner asked for a capability overview...`

3. owner 明确质疑：

- `我没有要求你创建任务啊`

4. manager 虽然口头承认误判，但同一轮又继续生成了：

- `plan_created: manager created 3 planned task(s)`
- `tool_calls_emitted: manager emitted 1 orchestration tool call(s)`

这说明问题不是一次偶发误判，而是当前默认策略就偏向“凡是输入都进管理流”。

---

## 根因判断

### 1. 缺少输入分流

当前系统没有先做强分流：

- 普通问答
- 管理请求
- 执行委派
- 状态查询
- 澄清补充

所以 manager 容易把：

- “你能做什么”
- “为什么刚才这样做”
- “解释一下”

误当成：

- 需要规划
- 需要建任务
- 需要发 orchestration tool

### 2. “内部思考”与“外部动作”没有强隔离

manager 当前即使只是解释，也可能顺手：

- `plan_created`
- `record_decision`
- `tool_calls_emitted`

这会让 owner 觉得 manager 在“背地里乱做事”。

### 3. 默认策略过于 orchestration-first

当前产品定义是：

- manager 是管家
- worker 才是执行器

但现在对话策略更像：

- 先把所有输入转成管理对象
- 再决定如何回复

正确顺序应该反过来：

- 先判断这是不是纯对话
- 只有明确进入管理场景时，才触发任务和派工

---

## 应该如何改

## 一、先加输入意图闸门

在 manager runtime 前增加一层 `owner intent gate`，至少分成：

- `qa`
- `clarification`
- `task_request`
- `coordination_request`
- `status_request`
- `meta_request`

规则：

- `qa`
  - 直接回答
  - 不创建 task
  - 不发 orchestration tools
- `meta_request`
  - 解释行为或系统状态
  - 不创建 task
  - 允许记录极少量会话摘要，但不应 visible 地跑 plan/tool
- `task_request` / `coordination_request`
  - 才允许进入 planning / worker orchestration

### 最小产品规则

以下输入默认禁止建任务：

- “what can you do”
- “你为什么刚才这么做”
- “解释一下”
- “现在什么情况”
- “帮我总结一下”

除非 owner 明确表达：

- 去做
- 安排
- 拆解
- 跟进
- 派给下属
- 帮我推进

---

## 二、区分 owner 可见事件和内部事件

现在很多 event 虽然技术上有用，但 owner 不应该默认看到。

建议分三层：

### A. owner 默认可见

- `manager understood your request`
- `manager needs clarification`
- `manager created a plan`
- `manager assigned a worker`
- `worker started`
- `worker completed`
- `worker failed`
- `manager is waiting for you`
- `manager replanned`
- `manager escalated`

### B. owner 按需可见

- 结构化 plan 细节
- tool call 细节
- decision records

这些通过：

- `/why`
- `/plan`
- `/timeline`

再展开。

### C. 内部默认不可见

- 纯内部 decision bookkeeping
- prompt shaping
- non-user-facing reasoning scaffolding

否则 owner 会觉得 manager 一直在“后台偷偷操作系统”。

---

## 三、把 manager 的默认说话方式改成“管家式”，不是“编排器式”

当前 manager 的回复更像系统说明和过程播报。

应改成两段式：

1. 先对 owner 说人话
2. 再在 timeline 里显示必要动作

示例：

### 当前不理想

- `plan_created: manager created 4 planned task(s)`

### 更合适

- `我可以帮你理解需求、安排 worker、跟进进展，并在遇到阻塞时回来找你。`

如果确实进入管理流，再补 timeline：

- `• Updated plan`
- `• Ran assign_worker`

---

## 四、增加“只回答，不建任务”模式

建议给 manager 增加一个明确运行分支：

- `conversation_only`

触发时机：

- owner 问能力
- owner 问解释
- owner 问状态
- owner 问“刚才为什么这样”

行为：

- 允许读 memory
- 允许总结当前状态
- 禁止 `create_tasks`
- 禁止 `assign_worker`
- 禁止 `schedule_followup`

这样可以大幅降低误触发。

---

## 五、把“解释行为”当成一等能力

你这个产品里，manager 要取得信任，必须能解释：

- 我刚才为什么这样做
- 我现在在等什么
- 为什么没有派工
- 为什么派工失败

所以建议显式加入 3 个 owner-facing 能力：

- `/why`
- `/what-are-you-doing`
- `/what-do-you-need-from-me`

---

## 推荐实施顺序

### Phase A

- 加 `owner intent gate`
- 让纯问答默认不建任务

### Phase B

- 把 owner 可见事件分级
- 默认隐藏内部 orchestration 噪音

### Phase C

- 做 `conversation_only` 模式
- 做 `/why` 和 `/what-do-you-need-from-me`

### Phase D

- 再继续优化 manager persona 和多轮对话质量

---

## 最终目标

owner 对 manager 的感受应该是：

- 它先听懂我
- 不会乱建任务
- 只有真要推进事情时才派工
- 做了关键动作会告诉我
- 卡住了会回来找我

而不是：

- 它好像每次都在背后偷偷开流程

