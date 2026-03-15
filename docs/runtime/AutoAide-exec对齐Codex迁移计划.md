# AutoAide exec 对齐 Codex 迁移计划

## Status

Draft

## Purpose

这份文档回答一个具体问题：

**AutoAide 的 `exec` 能不能直接从 Codex 的实现方法上迁移？**

结论是：

- 不能直接原样复制进当前代码库
- 但应该高度对齐 Codex `exec` 的设计方法
- 而且真正该参考的不是 Codex TUI，而是 Codex 独立的 `exec` crate

## What to Read in Codex

本地参考位置：

- `/tmp/openai-codex/codex-rs/exec/src/cli.rs`
- `/tmp/openai-codex/codex-rs/exec/src/exec_events.rs`
- `/tmp/openai-codex/codex-rs/exec/src/event_processor_with_human_output.rs`
- `/tmp/openai-codex/codex-rs/exec/src/event_processor_with_jsonl_output.rs`

## Key Finding

Codex 并不是先做 TUI，再顺便做一个 exec。

它实际上是：

1. 先有独立的非交互 `exec`
2. `exec` 有自己的 CLI 参数模型
3. `exec` 有自己的统一事件模型
4. `exec` 再把同一条事件流交给两种 processor：
   - human output
   - JSONL output

这正是 AutoAide 现在应该模仿的地方。

---

## 当前产品判断

除了参考 Codex 的结构，这份文档还保留一个当前产品判断：

`exec` 不应该只是 TUI 的附庸。

更合理的顺序是：

- 先把 `autoaide exec` 做成清晰、稳定、可增量输出的核心 primitive
- 再把 `tui` 视为这个 primitive 的 richer frontend

一句话：

**TUI is not the core primitive. `exec` is the core primitive. TUI is a richer shell around it.**

这个判断的原因是：

- owner-facing 的最短成功路径需要先清楚
- manager 的增量状态、tool calls、worker 结果需要先有稳定事件流
- 只要 `exec` 路径清楚，TUI 就可以围绕同一条执行流做更丰富的 transcript 呈现

## Codex `exec` 的关键结构

## 1. 独立 CLI

在 [cli.rs](/tmp/openai-codex/codex-rs/exec/src/cli.rs) 里，Codex `exec` 不是 TUI 的附庸，而是一个独立命令入口。

要点：

- 有单独的 CLI 参数
- 支持直接 prompt
- 支持 `--json` / `--experimental-json`
- 支持 resume
- 支持 cwd / sandbox / profile / output schema

这说明：

- `exec` 是 first-class product path
- 不是“把 TUI 的逻辑拿出来一点点”

## 2. 独立事件模型

在 [exec_events.rs](/tmp/openai-codex/codex-rs/exec/src/exec_events.rs) 里，Codex 定义了统一的线程/turn/item 事件：

- `thread.started`
- `turn.started`
- `turn.completed`
- `turn.failed`
- `item.started`
- `item.updated`
- `item.completed`
- `error`

而 item 又是强类型的：

- `agent_message`
- `reasoning`
- `command_execution`
- `file_change`
- `mcp_tool_call`
- `collab_tool_call`
- `web_search`
- `todo_list`
- `error`

这个结构的价值非常大：

- 输出不是字符串拼接
- UI 和 CLI 都能消费同一套语义事件

## 3. 输出处理器分层

Codex 没有把事件流和打印逻辑揉在一起，而是分成两层：

- 事件收集/标准化
- 输出处理器

从源码看：

- [event_processor_with_human_output.rs](/tmp/openai-codex/codex-rs/exec/src/event_processor_with_human_output.rs)
- [event_processor_with_jsonl_output.rs](/tmp/openai-codex/codex-rs/exec/src/event_processor_with_jsonl_output.rs)

它的思想是：

- 同一条执行流
- 可以打印给人看
- 也可以稳定输出 JSONL 给程序消费

这对 AutoAide 尤其重要。

## What AutoAide Should Copy

## 1. `exec` First-Class

AutoAide 应该把 `autoaide exec` 提升为 first-class path。

而不是：

- 先做 TUI
- 再从 TUI 里拆一点逻辑出来

## 2. Unified Event Stream

AutoAide 不应直接从当前 TUI bridge 的 `history_cell` 开始设计 `exec`。

正确顺序应是：

- 先定义统一 `ExecEvent`
- 再让：
  - `exec` 打印 human output
  - `exec --json` 打印 JSONL
  - TUI 把事件映射成 cells

## 3. Human Output and JSON Output as Two Processors

AutoAide 应明确做两个输出处理器：

### Human Output

例子：

```text
Working...
Plan:
- inspect repository
- summarize runtime boundaries

Tool: rg "manager-runtime"
Subagent: reviewer started
Subagent: reviewer completed

Result:
...
```

### JSONL Output

例子：

```json
{"type":"turn.started"}
{"type":"item.started","item":{"type":"reasoning","text":"..."}}
{"type":"item.completed","item":{"type":"agent_message","text":"..."}}
```

这个分层会让：

- scripts 可以消费 `exec --json`
- TUI 可以消费统一流
- CLI 人类输出不会污染程序接口

## What AutoAide Should Not Copy Literally

不能直接照搬的部分：

- Codex 的 Rust crate 结构
- Codex 的 protocol 类型
- Codex 的 core/runtime 依赖
- Codex 的 MCP / collab / app-server 细节

原因很简单：

- AutoAide 现在 manager execution 主链仍在 TypeScript
- 当前 manager/session/persistence 也不是 Codex 原生结构

所以只能借鉴设计，不是生搬代码。

## Mapping to AutoAide Current Code

当前 AutoAide 里最接近 `exec engine` 的地方在：

- [apps/tui/src/bridge.ts](/Users/moshiwei/Documents/GitHub/AutoAide/apps/tui/src/bridge.ts)

尤其是：

- `handleSubmit(...)`
- `processPendingAssignments(...)`

它已经做了：

- owner input append
- active working state
- `executeManagerTurn(...)`
- tool/action emission
- subagent/worker execution
- follow-up

所以更合理的做法是：

## Step 1

从 `apps/tui/src/bridge.ts` 抽出统一执行 primitive。

例如：

```ts
runManagerExec({
  text,
  threadId,
  onEvent,
})
```

## Step 2

定义 AutoAide 自己的 `ExecEvent`，但设计方法对齐 Codex：

- `session_started`
- `turn_started`
- `turn_completed`
- `turn_failed`
- `item_started`
- `item_updated`
- `item_completed`
- `error`

item 可以先做最小子集：

- `assistant_message`
- `reasoning`
- `tool_call`
- `subagent_run`
- `plan`
- `warning`

## Step 3

实现两个 processor：

- `exec_human_output`
- `exec_jsonl_output`

## Step 4

再让 TUI 改成消费同一条执行流。

## Recommended AutoAide Event Shape

建议先不要把 Codex 那套全量 item 种类一次性搬过来。

第一阶段先做这组：

```ts
type AutoAideExecEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "turn.started" }
  | { type: "turn.completed" }
  | { type: "turn.failed"; error: string }
  | { type: "item.started"; item: ExecItem }
  | { type: "item.updated"; item: ExecItem }
  | { type: "item.completed"; item: ExecItem }
  | { type: "error"; message: string };

type ExecItem =
  | { type: "assistant_message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "plan"; text: string }
  | { type: "tool_call"; label: string; text: string; status: "in_progress" | "completed" | "failed" }
  | { type: "subagent_run"; label: string; text: string; status: "in_progress" | "completed" | "failed" }
  | { type: "warning"; text: string };
```

这已经足够支撑：

- `autoaide exec`
- `autoaide exec --json`
- Rust TUI transcript

## Product Decision

如果对齐 Codex 的实现方法，AutoAide 应明确做这个决策：

**`exec` is the canonical streaming execution path.**

这意味着：

- TUI 不再自己定义 manager execution 语义
- CLI 和 TUI 共用同一执行流
- 后续任何 GUI / dashboard 也应共用同一执行流

## Recommended Next Step

后续实现顺序建议是：

1. 从 `apps/tui/src/bridge.ts` 提取 `runManagerExec(...)`
2. 定义 `AutoAideExecEvent`
3. 实现 `autoaide exec`
4. 增加 `autoaide exec --json`
5. 让 TUI 改为消费统一事件流

## Summary

最终结论：

- 可以高度借鉴 Codex `exec`
- 但要借鉴的是它的结构方法
- 真正该抄的是：
  - 独立 exec CLI
  - 统一事件模型
  - human/json 两套输出处理器
- 不是把 TUI 代码或 Codex Rust crate 原样塞进 AutoAide
