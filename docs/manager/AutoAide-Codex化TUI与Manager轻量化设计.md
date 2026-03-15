# AutoAide Codex化 TUI 与 Manager 轻量化设计

## Status

Draft

## Why This Doc Exists

AutoAide 当前有两个明显问题：

1. `apps/tui-rs` 仍然不像 Codex Rust TUI。
2. `manager` 这层做得过重，导致 TUI、状态、任务面板和中间 receipts 都显得啰嗦。

这份文档的目标不是继续修补当前实现，而是重新定义一条更直接的路线：

- TUI 层尽量按 Codex Rust TUI 的结构和交互模型重建。
- Manager 层尽量轻量化，接近“一个专门负责编排其他子代理的 supervisor agent”。

## Current Diagnosis

### TUI Problem

当前 `apps/tui-rs` 是 AutoAide 自己做的一层简化壳，虽然已经切到了 Rust + `ratatui`，但本质上仍然不是 Codex 那套结构：

- 不是 `chatwidget + bottom_pane + history_cell + insert_history`
- transcript 仍然是 AutoAide 自定义 cell，而不是 Codex 的 history cell 体系
- bottom pane 只是轻量模仿，不是 Codex 的 composer/status/footer/popup 状态机
- 交互 bug 容易反复出现，因为实现路径不是 Codex 的原始路径

结果是：

- 视觉不像
- 行为不像
- 交互 bug 多
- 修补成本高

### Manager Problem

当前 AutoAide 的 manager plane 仍然保留了太多“系统自定义管理语义”：

- `tasks`
- `workers`
- `alerts`
- `reminders`
- behavior receipts
- action receipts
- follow-up receipts

这些机制并不是都错，但对当前产品阶段来说太重了。

从使用体验看，用户真正想要的不是看一套自定义 manager dashboard，而是：

- 一个像 Codex 一样简洁的主代理
- 能理解 owner 的目标
- 能决定何时拉起子代理
- 能监督子代理进度
- 能整合结果继续推进

也就是说，用户更需要“Codex 风格的 supervisor agent”，而不是“一个自定义任务系统 UI”。

## Core Hypothesis

AutoAide 的正确方向不是继续发明自己的 manager UI 和 manager domain model，而是：

1. 把 TUI 直接向 Codex Rust TUI 靠拢。
2. 把 manager 简化成一个 kernel-agnostic supervisor agent。
3. 把“管理其他 agent executor”的能力实现成 manager 可调用的一组 CLI tools。
4. 把 orchestration policy 主要写进 `AGENTS.md` 或 `manager/AGENTS.md`，而不是写进大量 runtime-specific receipts 和 UI 状态字段。

一句话说：

**Manager should behave like a supervisor agent running on a pluggable kernel, not like a separate product-specific workflow engine.**

## Proposed Product Model

### New Mental Model

AutoAide 可以重新定义成下面这套模型：

- `owner`
  - 用户
- `manager`
  - 一个主 supervisor agent
  - 在 TUI 中和 owner 持续对话
  - 通过工具启动、检查、恢复、终止其他子代理
- `subagents`
  - 在独立工作目录中运行的 agent executor
  - executor 可以是 Codex，也可以是其他能读取 `AGENTS.md` 和调用 tools 的 LLM kernel
- `workspace state`
  - 文件系统、日志、run records、session metadata

这样之后，AutoAide 的本质会更接近：

- 一个 Codex supervisor shell
- 而不是一个独立 manager framework

### New Manager Definition

Manager 不再定义成“维护复杂 task graph 和 worker registry 的系统内核”，而定义成：

**一个加载了特定 `AGENTS.md` 的 supervisor agent。**

它的特殊能力来自两部分：

1. Prompt / policy
   - 通过 `AGENTS.md` 告诉它如何分解任务、何时拉子代理、如何检查进度、何时追问 owner
2. Tools
   - 通过 CLI 命令让它能操作其他 agent runs
3. Kernel
   - 通过一个可插拔 agent kernel 来完成 reasoning / tool use / session handling

例如 manager 可拥有如下工具能力：

- `codex exec --experimental-json`
- `codex resume`
- `codex status`
- 其他兼容 kernel 的 `exec/resume/status` 命令
- `ps` / `pgrep`
- `tail -f` / structured log read
- `git diff`
- `rg`
- workspace inspection commands

也就是说，manager 本身并不需要先有一套很重的内建 task runtime 才能工作，也不应该被绑定到单一 executor。

## Proposed Architecture

## 1. TUI Layer

### Target

`autoaide tui` 直接变成一个 Codex-style Rust TUI front-end。

### Direction

不要再以当前 `apps/tui-rs` 的自定义模块为中心继续演进，而是以 Codex Rust TUI 的结构为模板重组：

- `chatwidget`
- `bottom_pane`
- `history_cell`
- `insert_history`
- `status_indicator`
- `resume_picker`
- `slash_command`

### Integration Boundary

Rust TUI 不负责 manager business logic，只负责：

- 渲染
- 输入
- history cell
- active streaming cell
- bottom pane
- overlays / pickers

它通过 bridge 接受上层 runtime 事件。

### Why the TUI Can Still Follow Codex

即使 manager kernel 是可插拔的，TUI 仍然可以优先借鉴 Codex。

原因不是因为 manager 必须是 Codex，而是因为 Codex Rust TUI 目前是最成熟的参考交互：

- transcript-first
- active streaming cell
- bottom pane
- picker / overlay
- insert-history behavior

也就是说：

- `kernel` 决定智能和 tool use
- `TUI` 决定交互和呈现

这两层应该解耦。

## 2. Manager Layer

### Current Direction to Reduce

下面这些最好从“产品主模型”里降级，不再作为最显著的一层：

- 自定义 `tasks` 面板
- 自定义 `workers` 计数
- 大量 receipts
- manager-specific synthetic transcript events

这些可以保留在内部实现中作为过渡，但不应该成为用户主体验中心。

### New Direction

Manager 改成：

- 一个专门的 supervisor agent profile
- 使用 `manager/AGENTS.md`
- 通过工具控制多个子代理目录
- 通过日志/状态命令监督子代理

从实现上看，这意味着：

- `manager-runtime` 应该收缩
- `task-system` / `worker-orchestrator` 不再是 owner-facing center
- manager plane 应该优先表现为 Codex-style transcript，而不是 AutoAide dashboard
- manager kernel 应该是可替换的

## 3. Subagent Execution Layer

### Target Model

每个子代理是一个标准 agent run，而不是 AutoAide 自定义 executor protocol first。

推荐模型：

- manager 维护一个 `runs/` 或 `agents/` 目录
- 每个子代理有独立 working directory
- manager 用 CLI 直接启动兼容的 agent kernel：
  - `codex exec --experimental-json ...`
  - 或其他兼容 kernel 的 `exec` 命令
- manager 通过日志、stdout JSON、pid、workspace outputs 监督其状态

### Why This Is Better

- 更接近真实 agent shell 工作模式
- 降低 AutoAide 自定义 executor 逻辑
- manager 的能力更多来自 prompt + tools，而不是框架硬编码
- 更容易测试，因为可以直接对着 CLI 行为做集成测试

## What Should Stay

下面这些仍然有价值，不需要全部推翻：

- persistence
- thread/session restore
- state directories
- bridge protocol
- Rust TUI shell entry

但它们的职责应该变化：

- 保留为基础设施
- 不再强行暴露成“manager 产品语义”

## Recommended Simplification

### Remove from Primary UX

以下内容不建议继续作为主界面固定展示：

- `manager/tasks/workers/busy/alerts/reminders`
- 过多 system receipts
- task lifecycle chatter
- worker lifecycle chatter

这些在 Codex 风格界面里都过重。

### Keep in Internal State or Debug Mode

如果确实还需要，可以保留为：

- debug overlay
- `/status`
- `/runs`
- `/threads`
- `/inspect`

而不是默认在主界面常驻。

### Make Transcript First-Class

主界面只应重点呈现：

- owner input
- manager reasoning or concise working state
- subagent launch summary
- subagent result summary
- manager final response

这更像 Codex，也更可读。

## Concrete New Design

## A. Manager as Supervisor Agent

建议新增一个 manager profile，例如：

- `agents/manager/AGENTS.md`

里面定义：

- 什么时候需要拆子任务
- 什么时候直接自己做
- 什么时候启动子代理
- 如何验证子代理是否在推进
- 如何检查工作目录、log、git diff、stdout JSON
- 如何决定 interrupt / retry / replace

这份 `AGENTS.md` 应该承载主要 orchestration policy。

### Recommended Decision

这里建议明确做一个强决策：

- manager 默认就是一个 agent session
- AutoAide 不再给 manager 发明一套单独的人格和工作流协议
- AutoAide 只提供：
  - 启动入口
  - 工作目录
  - 监督工具
  - thread persistence
  - Rust TUI
  - kernel adapter

也就是说：

**manager should be a supervisor agent running on a pluggable kernel, not a custom manager engine with an LLM on top.**

### Kernel Abstraction

这里应该显式引入一个概念：

- `agent kernel`

它表示任何满足下面条件的内核：

- 能读取 `AGENTS.md`
- 能调用 tools
- 能维持会话
- 能以 CLI 或 API 方式被启动和监督

Codex 是默认参考实现，但不是唯一实现。

兼容目标可以包括：

- Codex CLI / Codex API
- 其他支持 tool use 的 LLM agent runtime
- 未来的 OpenAI Responses-style tool loop kernel

### Recommended Interface

建议把 manager kernel 抽象成统一接口：

- `start_session`
- `submit_input`
- `interrupt`
- `resume_session`
- `stream_events`
- `shutdown`

只要某个内核能满足这组接口，它就可以承载 manager。

## B. Supervision Tools

建议把 manager tools 明确成一套非常具体的 CLI surface。

例如：

- `autoaide-agent spawn <name> --cwd <path> -- <kernel exec command>`
- `autoaide-agent status <run-id>`
- `autoaide-agent logs <run-id>`
- `autoaide-agent stop <run-id>`
- `autoaide-agent list`
- `autoaide-agent inspect <run-id>`

或者更激进一点，尽量直接复用 Codex CLI 和基础 shell 命令，而不是发明太多 wrapper。

关键原则是：

- tool surface should be small
- semantics should be obvious
- everything should be testable from the shell

### Recommended Tool Contract

建议把 supervisor tool surface 收到下面这组最小命令。

#### Spawn

```bash
autoaide-agent spawn <agent-name> \
  --cwd <workspace> \
  --task-file <path> \
  -- codex exec --experimental-json
```

输出：

- `run_id`
- `pid`
- `cwd`
- `log_path`
- `started_at`

#### Status

```bash
autoaide-agent status <run-id>
```

输出：

- `starting | running | completed | failed | interrupted`
- 最后更新时间
- 最后心跳
- 最近一段摘要

#### Logs

```bash
autoaide-agent logs <run-id> --tail 100
```

输出：

- 结构化事件
- 或标准输出摘要

#### Inspect

```bash
autoaide-agent inspect <run-id>
```

输出：

- 当前工作目录
- 最近文件变化
- 最近 git diff 摘要
- 最近日志摘要

#### Stop

```bash
autoaide-agent stop <run-id>
```

输出：

- 是否成功
- 停止时间
- 停止原因

#### List

```bash
autoaide-agent list
```

输出：

- 所有活动 run
- 每个 run 的状态、cwd、最近更新时间

### Why a Wrapper Still Helps

虽然可以直接调用 kernel 原生命令，但我仍然建议保留一个非常薄的 `autoaide-agent` wrapper。

原因：

- 统一 run metadata
- 统一日志路径
- 统一状态检查方式
- 统一 PID 和退出码处理
- 便于 TUI 读取

注意这层 wrapper 必须很薄，不能重新长成一个厚 executor framework。

### Wrapper Responsibility Boundary

`autoaide-agent` 只做：

- 标准化启动参数
- 标准化 run metadata
- 标准化日志/状态输出
- 适配不同 kernel 的命令差异

它不做：

- 自己的 planning
- 自己的 task graph
- 自己的高级 orchestration policy

## C. Rust TUI Presentation

目标不是“像 AutoAide”，而是“像 Codex”：

- transcript-first
- light bottom pane
- concise working indicator
- picker overlays
- insert-history scroll behavior
- active streaming cell

建议 UI 默认只显示：

- transcript
- working indicator
- composer

把 manager diagnostics 降级到命令里，而不是常驻底栏。

### Recommended Default Screen

默认屏幕建议只保留：

- committed transcript
- active streaming cell
- working/status row
- composer

不建议默认常驻展示：

- task counters
- worker counters
- alerts
- reminders
- receipts

### Recommended Optional Views

如果需要，可以保留这些 secondary views：

- `/threads`
- `/runs`
- `/agents`
- `/status`
- `/inspect <run-id>`

这些更像 Codex 的补充命令，而不是主 UI 家具。

## Minimal Manager Runtime

### What Should Still Exist

即便 manager 轻量化，也不代表完全没有 runtime。

建议保留一个很薄的 manager runtime，只做下面这些事：

- 把 owner 输入交给 manager session
- 提供 supervision tools
- 维护 thread/session persistence
- 维护 run registry
- 向 Rust TUI 输出统一 bridge events

### What Should Be Removed from the Center

下面这些不应该继续成为系统中心：

- task graph as primary UX
- worker registry as primary UX
- verbose receipts as primary transcript
- synthetic manager state chatter

### Resulting Shape

新的 manager runtime 更像：

- `session launcher`
- `kernel adapter`
- `tool adapter`
- `run registry`
- `event bridge`

而不像：

- 全功能 manager operating system

## Proposed Directory Shape

建议逐步朝下面这个目录结构收：

```text
apps/
  cli/
  tui-rs/
agents/
  manager/
    AGENTS.md
  templates/
    researcher/
    implementer/
    reviewer/
runs/
  <run-id>/
    meta.json
    stdout.jsonl
    stderr.log
    workspace/
packages/
  manager-bridge/
  agent-kernel/
  codex-kernel/
  codex-supervision/
```

说明：

- `agents/manager/AGENTS.md` 定义 manager 行为
- `agents/templates/*` 提供子代理模板
- `runs/` 存运行记录
- `manager-bridge` 负责 Node/Rust TUI 事件桥接
- `agent-kernel` 定义通用 kernel contract
- `codex-kernel` 是 Codex 默认实现
- `codex-supervision` 或未来的 `agent-supervision` 负责最小 supervisor wrapper

## Suggested `AGENTS.md` Shape

建议先写一版非常直接的 manager policy，不要抽象。

```md
# Manager Agent

You are the supervising agent for AutoAide.

Your job is to:
- clarify the owner goal when needed
- decide whether to solve directly or spawn subagents
- keep the number of concurrent subagents low by default
- inspect progress using CLI tools
- summarize progress concisely
- integrate finished work into a clear next step

When to spawn a subagent:
- the task is separable
- independent workspace execution is useful
- long-running implementation or research is needed

When not to spawn:
- the answer is short
- the owner is asking for clarification
- no independent execution is needed

Always prefer:
- concise updates
- observable progress
- shell-verifiable facts
- explicit completion criteria

Never:
- spam the transcript with internal state
- invent fake progress
- keep many idle subagents alive
- expose implementation detail unless it helps the owner
```

## Recommended Iteration Strategy

## Kernel Strategy

### Default

默认内核仍然可以是 Codex。

原因：

- 现成 CLI 能力最强
- 最接近目标 TUI 参考实现
- tool use 和 `AGENTS.md` 兼容思路最清楚

### But Not a Lock-In

架构上不应把下面这些写死：

- manager must be Codex
- subagents must be Codex
- supervision protocol must be Codex-only

正确口径应该是：

- Codex is the default kernel
- AutoAide is kernel-agnostic by architecture

### Practical Consequence

这意味着后续代码应该区分：

- `agent kernel contract`
- `codex kernel adapter`
- `supervision wrapper`
- `Rust TUI`

而不是把这四件事混成一个系统。

## Recommended Iteration Strategy

### Iteration 1

先不要推翻整个 Node side。

只做：

- 明确 manager policy in `AGENTS.md`
- 明确 `agent-kernel` contract
- 明确 `autoaide-agent` minimal wrapper
- TUI 降噪

### Iteration 2

切到 Codex TUI structure-first migration：

- `history_cell`
- `bottom_pane`
- `chatwidget`
- `insert_history`

### Iteration 3

再逐步去掉当前重 runtime 的部分：

- heavy task UI
- heavy worker UI
- heavy receipts

### Iteration 4

最后再决定以下模块是否还保留：

- `task-system`
- `worker-orchestrator`
- `manager-runtime`

如果它们仍然需要存在，也应该退居内部实现层。

## Recommended Architecture Decision

如果现在要做一个明确口径，我建议定成下面这句：

**AutoAide is a kernel-agnostic supervisor shell with Codex as the default reference implementation.**

这句话会直接决定：

- TUI 怎么做
- manager 怎么定义
- kernel 怎么抽象
- tool surface 怎么收缩
- 哪些系统状态不该再放大

## Migration Plan

## Phase 1: Write Down the New Architecture

输出一份明确的 architecture contract：

- manager is a Codex-style supervisor agent
- subagents are Codex runs
- TUI is Codex-style Rust TUI
- thread/task/debug info is secondary, not primary

This document is that first step.

## Phase 2: Stop Investing in the Old TUI Shape

做法：

- freeze current custom TUI shell logic
- stop refining custom footer/dashboard concepts
- stop adding new manager-specific UI furniture

## Phase 3: Rebase `apps/tui-rs` on Codex TUI Structure

优先级：

1. history cell model
2. bottom pane / composer model
3. active cell streaming model
4. insert-history behavior
5. picker / overlays

注意：

- 不是抄外观
- 是抄结构和状态机

## Phase 4: Simplify Manager Runtime

做法：

- reduce owner-facing task receipts
- reduce worker-specific transcript spam
- move orchestration policy into `AGENTS.md`
- make CLI tools the primary supervision surface

## Phase 5: Introduce Manager Agent Profile

落地项：

- `agents/manager/AGENTS.md`
- sample subagent workspace layout
- supervision tool inventory
- manager operating rules

## Phase 6: Replace Task-Centric UI with Transcript-Centric UI

TUI 默认不再强调：

- tasks
- workers
- alerts
- reminders

而改成：

- transcript
- working status
- optional run list or picker

## Decision

建议采纳下面这条路线：

1. `apps/tui-rs` 不再基于当前自定义壳继续演化，直接改成 Codex TUI structure-first migration。
2. AutoAide manager 重新定义为一个 Codex-native supervisor agent。
3. orchestration policy 尽量移入 `AGENTS.md`。
4. subagent execution 尽量基于 `codex exec --experimental-json` 和 shell-observable process state。
5. `tasks/workers/...` 降级成 secondary or debug-only information。

## Risks

### Risk 1

完全依赖 prompt + CLI tools，可能让 manager 行为不够稳定。

Mitigation:

- 用 very explicit `AGENTS.md`
- 保留少量最小 runtime constraints
- 用 structured JSON outputs where possible

### Risk 2

Codex TUI 的结构本身比较复杂，移植工作量不小。

Mitigation:

- 先移植 UI shell and history cell model
- 再逐步接 bridge
- 不再为旧壳继续投时间

### Risk 3

现有 `task-system` / `worker-orchestrator` 可能和新模型重叠。

Mitigation:

- 不一定立即删除
- 先把它们降级为 implementation detail
- 等新 supervisor model 稳定后再决定保留还是收缩

## Open Questions

1. manager 是否直接就是一个 Codex session，还是一个带最小 AutoAide wrapper 的 Codex session？
2. subagent 的标准运行目录结构应该是什么？
3. 是否要保留一层 `autoaide-agent` wrapper，还是尽量直接调用 `codex exec --experimental-json`？
4. 现有 `manager-runtime` 要收缩到什么程度？
5. 当前 `task-system` 是否保留为 internal bookkeeping，还是逐步退出主架构？

## Immediate Next Step

建议下一步不是继续修现有 TUI，而是再补一份更具体的技术实施文档：

- `Codex Rust TUI migration map`
- `Manager AGENTS.md draft`
- `subagent supervision CLI contract`

这样后续重构会更稳，不会继续在旧实现上反复返工。
