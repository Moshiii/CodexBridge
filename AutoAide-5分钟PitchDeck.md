# AutoAide 5 分钟 Pitch Deck

## Slide 1. Title

### AutoAide

**The management layer for AI teams**

一句话：

`AutoAide` 是一个面向多智能体协作的 AI 管理中枢，用来补齐 `OpenClaw` 没有真正做好的 team coordination layer。

---

## Slide 2. Problem

### 问题不是 agent 不够强

今天的问题已经越来越不是：

- agent 会不会写代码
- agent 会不会调用工具
- agent 能不能完成单次任务

真正的问题变成了：

- 多个 agent 启动起来之后，谁来拆任务
- 谁来决定分工和优先级
- 谁来跟踪阻塞、心跳、超时和返工
- 谁来保证对用户的承诺不会被忘掉
- 谁来把多个执行过程汇总成一个稳定结果

结论：

**AI 执行器越来越强，但 AI 团队管理层几乎还是空白。**

---

## Slide 3. Why OpenClaw Is Not Enough

### OpenClaw 解决了 runtime，没解决协作

`OpenClaw` 很强的地方在于：

- 多渠道接入
- gateway / sessions / routing
- tools 与 cron orchestration
- agent runtime 和外部执行器接入

但当任务变成多智能体协作时，缺口会暴露出来：

- 多个 agent 可以被拉起，但不等于形成稳定团队
- 并行执行可以发生，但责任边界并不清晰
- 有执行过程，但缺少强约束的任务树和承诺系统
- 有 agent 输出，但缺少持续监督、升级和恢复机制

一句话：

**OpenClaw 让 agent 跑起来，AutoAide 让 agent 团队真正协作起来。**

---

## Slide 4. Insight

### 多智能体系统真正缺的是 manager plane

我们认为，多 agent 系统下一阶段的关键不是更强的 worker，而是更强的 manager。

这个 manager 不应该亲自下场做执行工作。

它应该专门负责：

- 接收 owner 目标
- 拆分成任务树
- 分配 worker
- 监控进展和心跳
- 发现 blocked / stalled / overdue
- 维护长期任务记忆
- 汇总结果并向 owner 汇报

核心判断：

**AI 团队需要经理，不只是更多员工。**

---

## Slide 5. Solution

### AutoAide = AI Team Manager

`AutoAide` 不是另一个 coding agent。

它是一个位于执行器之上的管理层。

它不直接：

- 改代码
- 跑 shell
- 调工程工具
- 代替 worker 完成生产工作

它只做管理动作：

- planning
- task graph management
- memory
- scheduling
- supervision
- owner communication

实际执行交给外部 worker，例如 `Codex executor`。

---

## Slide 6. How It Works

### 一个任务如何在 AutoAide 中流动

```text
Owner
-> AutoAide Manager
-> Task Tree
-> Worker Assignment
-> Progress / Heartbeat / Result
-> Manager Supervision
-> Owner Update
```

更具体地说：

1. owner 提出目标
2. `AutoAide` 检索历史上下文和已有承诺
3. `AutoAide` 生成任务树并定义优先级
4. `AutoAide` 将叶子任务派发给 worker
5. worker 回传 heartbeat、blocker、result
6. `AutoAide` 持续检测 stalled、blocked、overdue
7. `AutoAide` 汇总进展并在关键点请求 owner 决策

---

## Slide 7. Core Product Assets

### 我们真正构建的不是聊天入口，而是组织真相层

`AutoAide` 最有价值的不是模型接入，而是这些结构化资产：

- Task Store
- Assignment Store
- Progress Event Log
- Commitment Store
- Worker Registry
- Manager Memory

这意味着系统记住的不是“说过什么”，而是：

- 在做什么
- 谁负责
- 卡在哪
- 承诺了什么
- 下一步该盯谁

---

## Slide 8. Differentiation

### AutoAide 和常见方案的区别

**相比单 agent：**

- 不只会执行一个任务
- 能长期管理多任务和多 worker

**相比聊天式 AI 助手：**

- 不以对话为真相层
- 以任务、分派、进展、承诺为真相层

**相比 OpenClaw：**

- 不重点做 runtime breadth
- 重点做 coordination depth

一句话：

**Others focus on execution. AutoAide focuses on coordination.**

---

## Slide 9. Why Now

### 时机已经成熟

现在做这件事的窗口已经出现，因为：

- 单 agent 的能力已经足够强
- 外部执行器生态正在成熟
- 多 agent 工作流开始变得常见
- 但 team coordination 仍然严重缺位

这意味着一个新的层级开始有价值：

**不是更强的单体 agent，而是更可靠的 AI 团队管理系统。**

---

## Slide 10. Vision

### 让 AI 从“会做事”变成“能负责”

`AutoAide` 的长期目标不是成为另一个大而全 agent runtime。

它的目标是成为：

- 面向 owner 的统一控制面
- 面向 worker 的任务管理中枢
- 面向长期项目的组织记忆系统

最终让 AI 协作从“几个 agent 同时跑”升级为：

**一个真正可管理、可恢复、可审计、可持续推进的 AI 团队。**

---

## 5 分钟讲法总结

如果只用一段话讲完整个故事，可以这样说：

`OpenClaw` 已经证明了 agent runtime、channel、session 和 orchestration shell 很有价值，但它并没有真正解决多智能体协作这件事。`AutoAide` 的切入点不是再做一个执行器，而是补上 manager plane: 它接收用户目标，拆成任务树，分配 worker，跟踪心跳、阻塞和承诺，把多个 agent 的执行过程变成一个稳定、持续、可管理的工作系统。换句话说，`OpenClaw` 解决的是 agent 能跑起来，`AutoAide` 解决的是 agent 团队怎么真正协作起来。
