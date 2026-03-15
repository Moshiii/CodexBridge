# AutoAide Agent Kernel Contract

## Status

Draft

## Goal

定义一个最小而稳定的 `agent kernel` contract，让 AutoAide 的 manager 和 subagents 都可以运行在不同内核之上，而不把系统绑死到 Codex。

这个 contract 的设计目标是：

- 支持 `AGENTS.md`
- 支持 tool use
- 支持持续会话
- 支持流式事件
- 支持 supervisor shell 统一接入

## Non-Goals

这个 contract 不负责：

- 定义具体 TUI 渲染
- 定义具体 prompt 内容
- 定义高级 orchestration policy
- 定义 task graph

这些属于：

- Rust TUI
- `AGENTS.md`
- supervisor session

## Required Capabilities

任一兼容 kernel 必须支持：

- 在指定 `cwd` 启动会话
- 加载指定的 `AGENTS.md` 或等效 agent spec
- 接收新的 owner input
- 触发 tool use
- 输出流式事件
- 被 interrupt / resume / shutdown

## Core Types

```ts
export type KernelId = string;
export type SessionId = string;

export type AgentKernelStartInput = {
  kernelId: KernelId;
  sessionId: SessionId;
  cwd: string;
  agentSpecPath?: string;
  env?: Record<string, string>;
};

export type AgentKernelSubmitInput = {
  sessionId: SessionId;
  text: string;
};

export type AgentKernelInterruptInput = {
  sessionId: SessionId;
};

export type AgentKernelResumeInput = {
  sessionId: SessionId;
};

export type AgentKernelShutdownInput = {
  sessionId: SessionId;
};
```

## Event Model

TUI 和 bridge 不应该直接依赖某个具体内核的原生事件，而应该只看统一事件。

```ts
export type AgentKernelEvent =
  | {
      type: "session_started";
      sessionId: SessionId;
      kernel: string;
      cwd: string;
      at: number;
    }
  | {
      type: "user_message";
      sessionId: SessionId;
      text: string;
      at: number;
    }
  | {
      type: "assistant_chunk";
      sessionId: SessionId;
      text: string;
      at: number;
    }
  | {
      type: "assistant_done";
      sessionId: SessionId;
      text: string;
      at: number;
    }
  | {
      type: "tool_call_started";
      sessionId: SessionId;
      toolName: string;
      inputSummary?: string;
      at: number;
    }
  | {
      type: "tool_call_finished";
      sessionId: SessionId;
      toolName: string;
      ok: boolean;
      outputSummary?: string;
      at: number;
    }
  | {
      type: "status";
      sessionId: SessionId;
      message: string;
      at: number;
    }
  | {
      type: "warning";
      sessionId: SessionId;
      message: string;
      at: number;
    }
  | {
      type: "error";
      sessionId: SessionId;
      message: string;
      at: number;
    }
  | {
      type: "session_finished";
      sessionId: SessionId;
      outcome: "completed" | "failed" | "interrupted";
      at: number;
    };
```

## Interface

```ts
export type AgentKernel = {
  startSession(input: AgentKernelStartInput): Promise<void>;
  submitInput(input: AgentKernelSubmitInput): Promise<void>;
  interrupt(input: AgentKernelInterruptInput): Promise<void>;
  resumeSession(input: AgentKernelResumeInput): Promise<void>;
  shutdown(input: AgentKernelShutdownInput): Promise<void>;
  streamEvents(input: {
    sessionId: SessionId;
    onEvent: (event: AgentKernelEvent) => void | Promise<void>;
  }): Promise<void>;
};
```

## Behavioral Requirements

### 1. `startSession`

必须：

- 在目标 `cwd` 中建立一个真实会话
- 尝试加载 `agentSpecPath`
- 在成功启动后发出 `session_started`

不必须：

- 在 `startSession` 时就立刻产生 assistant output

### 2. `submitInput`

必须：

- 把输入送进现有 session
- 尽快开始发出流式事件

建议：

- 在内核实际开始工作前，先尽快发出一个 `status`，例如 `Working...`

### 3. `streamEvents`

必须：

- 提供 session 的持续事件流
- 不丢失关键 assistant/tool/status 事件
- 不把内核私有实现细节直接泄漏给上层

### 4. `interrupt`

必须：

- 尝试中断当前正在进行的模型/tool loop
- 发出可见状态事件

### 5. `resumeSession`

必须：

- 让上层重新连回已有 session
- 能继续收到后续事件或读到最终状态

### 6. `shutdown`

必须：

- 优雅结束 session
- 在必要时清理资源

## Adapter Responsibilities

每个具体 kernel adapter 应负责：

- 进程/API 启动
- 协议解析
- 事件标准化
- 会话 ID 映射
- 中断/恢复/结束适配

它不应负责：

- manager policy
- TUI 渲染
- run registry 主逻辑

## Default Implementation

默认实现建议：

- `packages/codex-kernel`

职责：

- 调用 `codex exec --experimental-json`
- 解析 Codex stdout JSON / stderr
- 转换成 `AgentKernelEvent`

## Supervisor Expectations

supervisor shell 对 kernel 的假设应尽量少，只假设下面这些能力：

- 能接 owner 输入
- 能执行 agent spec
- 能调 tools
- 能发流

supervisor 不应假设：

- 必然有 task graph
- 必然有 worker 概念
- 必然有 Codex 风格内部术语

## TUI Mapping

Rust TUI 应只消费经过 bridge 进一步整理后的 UI 事件，例如：

- `history_cell`
- `active_cell_patch`
- `status_update`

不应该直接依赖 `AgentKernelEvent` 的所有细节。

## Error Handling

所有 adapter 至少应处理：

- kernel 启动失败
- session 不存在
- stream 中断
- malformed event payload
- interrupt 超时
- shutdown 超时

建议统一转换成：

- `warning`
- `error`
- `session_finished`

## Compatibility Bar

一个内核只有在满足下面 4 条时才算兼容：

1. 能读取 `AGENTS.md` 或等效 agent spec
2. 能进行 tool use
3. 能被 supervisor 以 session 方式管理
4. 能输出足够稳定的流式事件

## Recommendation

先只实现 1 个正式 adapter：

- `codex-kernel`

但从第一天起就让上层依赖 `agent-kernel contract`，而不是直接依赖 Codex。
