# AutoAide Agent Kernel 与 Supervisor 落地计划

## Status

Draft

## Purpose

这份文档是对 [AutoAide-Codex化TUI与Manager轻量化设计.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/manager/AutoAide-Codex化TUI与Manager轻量化设计.md) 的工程化补充。

目标是把新的口径收成具体落地项：

- manager 是 supervisor agent
- manager kernel 可插拔
- Codex 是默认参考实现
- TUI 借鉴 Codex Rust TUI
- `tasks/workers/...` 不再是 owner-facing 主体验

## Core Decision

AutoAide 的主架构定义为：

**kernel-agnostic supervisor shell**

这意味着：

- manager 不是某个具体内核
- executor 不是某个具体实现
- Codex 可以是默认实现，但不是唯一实现
- `AGENTS.md` + tools + session bridge 是主要的跨内核共性

## Layer Model

```text
owner
  ->
Rust TUI
  ->
manager bridge
  ->
supervisor session
  ->
agent kernel
  ->
tools / subagents / shell
```

## 1. Agent Kernel Contract

### Goal

定义一个最小统一 contract，让 manager 和 subagents 都可以运行在不同 kernel 上。

### Required Capabilities

任一兼容 kernel 必须支持：

- 读取 `AGENTS.md`
- 读取当前工作目录上下文
- 调用 tools
- 持续会话
- 流式事件输出

### Minimal Interface

```ts
type AgentKernel = {
  startSession(input: {
    sessionId: string;
    cwd: string;
    agentSpecPath?: string;
  }): Promise<void>;

  submitInput(input: {
    sessionId: string;
    text: string;
  }): Promise<void>;

  interrupt(input: {
    sessionId: string;
  }): Promise<void>;

  resumeSession(input: {
    sessionId: string;
  }): Promise<void>;

  streamEvents(input: {
    sessionId: string;
    onEvent: (event: AgentKernelEvent) => void;
  }): Promise<void>;

  shutdown(input: {
    sessionId: string;
  }): Promise<void>;
};
```

### Event Shape

建议统一成这几类事件：

- `user_message`
- `assistant_chunk`
- `assistant_done`
- `tool_call_started`
- `tool_call_finished`
- `warning`
- `error`
- `status`

重点是：

- TUI 只看统一事件
- 不直接感知具体 kernel 内部协议

## 2. Default Kernel: Codex

### Why Codex Stays First

Codex 仍应是默认参考实现，原因很实际：

- 现成 CLI 能力强
- TUI 参考实现最成熟
- `AGENTS.md` 工作模型最接近目标

### Codex Kernel Adapter

建议新增：

```text
packages/
  agent-kernel/
  codex-kernel/
```

其中：

- `agent-kernel`
  - 定义统一 contract
- `codex-kernel`
  - 实现 Codex CLI / Codex API adapter

### Codex Adapter Responsibilities

- 启动 `codex exec --experimental-json`
- 建立 session mapping
- 解析 stdout JSON / stderr
- 转成统一 `AgentKernelEvent`
- 适配 `resume / interrupt / shutdown`

## 3. Supervisor Session

### Definition

supervisor session 是 manager 的真正运行实体。

它不是 task engine，而是：

- 一个 session
- 一个 agent kernel
- 一组 supervision tools
- 一份 `AGENTS.md`

### Responsibilities

- 接收 owner 输入
- 把输入送进 kernel
- 把 kernel 事件转发给 TUI
- 在必要时拉起 subagents
- 用 tools 检查 subagent 进度

### Non-Responsibilities

不应继续成为中心的东西：

- 厚 task graph
- 厚 worker dashboard
- verbose receipts
- owner-facing internal bookkeeping

## 4. Supervisor Tools

### Design Principle

tool surface 要足够小，且对 manager 来说显然可用。

### Minimal Commands

```bash
autoaide-agent spawn <agent-name> --cwd <workspace> --kernel <kernel> --task-file <file>
autoaide-agent status <run-id>
autoaide-agent logs <run-id> --tail 100
autoaide-agent inspect <run-id>
autoaide-agent stop <run-id>
autoaide-agent list
```

### Internal Metadata

每个 run 统一落到：

```text
runs/<run-id>/
  meta.json
  stdout.jsonl
  stderr.log
  workspace/
```

`meta.json` 至少应包含：

- `run_id`
- `agent_name`
- `kernel`
- `cwd`
- `pid`
- `status`
- `started_at`
- `updated_at`

## 5. Manager Policy in `AGENTS.md`

### Why

manager 的高层行为不应继续分散在：

- receipts
- status counters
- custom TUI hints
- scattered runtime heuristics

更合理的是让主要 policy 回到 `AGENTS.md`。

### Recommended Files

```text
agents/
  manager/
    AGENTS.md
  templates/
    researcher/AGENTS.md
    implementer/AGENTS.md
    reviewer/AGENTS.md
```

### Manager `AGENTS.md` Should Define

- 何时直接回答
- 何时追问 owner
- 何时启动 subagent
- 何时中断或替换 subagent
- 如何检查进度
- 如何做 concise progress updates
- 如何避免 transcript spam

## 6. TUI Contract

### TUI Should Receive

Rust TUI 不关心 kernel 类型，只关心统一桥接事件。

建议桥接事件集中成：

- `session_state`
- `history_cell`
- `active_cell_patch`
- `status_update`
- `thread_list`
- `command_result`

### TUI Should Not Receive

不应继续直接把这些内部概念推给 owner-facing 主界面：

- internal task bookkeeping
- worker registry churn
- receipt spam
- synthetic follow-up chatter

## 7. Development Sequence

### Step 1

确定架构口径：

- manager = supervisor agent
- kernel = pluggable
- Codex = default adapter

### Step 2

新增 `agent-kernel` contract 和 `codex-kernel` adapter 设计稿。

### Step 3

写出 `manager/AGENTS.md` 初稿。

### Step 4

把当前 Rust TUI 的 bridge 输出收敛到统一事件，减少旧 manager runtime 术语。

### Step 5

以 Codex Rust TUI 结构为基底重建 `apps/tui-rs`。

### Step 6

最后再决定：

- `manager-runtime`
- `task-system`
- `worker-orchestrator`

哪些仍保留为内部层，哪些继续收缩。

## Immediate Deliverables

建议紧接着补这 3 份文档：

1. `AutoAide-agent-kernel-contract.md`
2. `AutoAide-Manager做事风格设计.md`
3. `AutoAide-Codex-Rust-TUI迁移图.md`

## Summary

如果只保留一句执行口径，应该是：

**TUI can follow Codex; manager should not be locked to Codex.**

更完整地说：

- 交互层借鉴 Codex
- manager 是 supervisor session
- kernel 可插拔
- Codex 只是默认实现
- 主要 policy 放在 `AGENTS.md`
- 主要能力通过 tools 暴露
