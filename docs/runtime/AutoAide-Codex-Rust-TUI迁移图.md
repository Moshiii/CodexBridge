# AutoAide Codex Rust TUI 迁移图

## Status

Draft

## Purpose

这份文档定义 `apps/tui-rs` 如何从当前自定义壳迁移到更接近 Codex Rust TUI 的结构。

目标不是“继续微调现有 TUI”，而是：

- 停止在当前壳上持续修补
- 以 Codex Rust TUI 的模块和状态机为参考重建
- 让 AutoAide 的 Rust TUI 真正成为 Codex-style front-end

## Source Reference

本地参考源码：

- `/tmp/openai-codex/codex-rs/tui/src/chatwidget.rs`
- `/tmp/openai-codex/codex-rs/tui/src/bottom_pane/*`
- `/tmp/openai-codex/codex-rs/tui/src/history_cell.rs`
- `/tmp/openai-codex/codex-rs/tui/src/insert_history.rs`
- `/tmp/openai-codex/codex-rs/tui/src/tui.rs`
- `/tmp/openai-codex/codex-rs/tui/src/status_indicator_widget.rs`
- `/tmp/openai-codex/codex-rs/tui/src/resume_picker.rs`

## Current AutoAide TUI Shape

当前 `apps/tui-rs/src`：

```text
app.rs
bridge.rs
composer.rs
footer.rs
history.rs
main.rs
ui.rs
```

问题是：

- 模块粒度太粗
- 结构不是 Codex 的结构
- transcript/history/footer/composer 仍然是自定义拼起来的
- 很多交互 bug 本质来自结构不对，不是细节参数不对

## Target Shape

建议逐步迁移到下面这个结构：

```text
apps/tui-rs/src/
  app.rs
  bridge.rs
  chatwidget.rs
  history_cell.rs
  insert_history.rs
  status_indicator.rs
  resume_picker.rs
  slash_command.rs
  tui.rs
  streaming/
    mod.rs
    controller.rs
    chunking.rs
  bottom_pane/
    mod.rs
    chat_composer.rs
    footer.rs
    textarea.rs
    slash_commands.rs
    list_selection_view.rs
    bottom_pane_view.rs
```

注意：

- 不要求一次把 Codex 所有文件都搬进来
- 但主结构要对齐

## Migration Principle

### Principle 1

先迁移结构，再调样式。

### Principle 2

先迁移 transcript / bottom pane / active streaming cell，再迁移次级 overlay。

### Principle 3

Rust TUI 只负责交互和渲染，不承担 manager business policy。

### Principle 4

Node bridge 和 kernel contract 可以继续演进，但 TUI 结构不再依赖当前自定义 `history/footer/composer` 壳。

## Direct Mapping

### AutoAide `history.rs`

当前职责：

- committed cells
- active cell
- scroll
- formatting

迁移目标：

- 拆成 `history_cell.rs + streaming/* + insert_history.rs`

原因：

- `history.rs` 现在把模型、格式化、scroll、truncation 都揉在一起
- Codex 把 transcript cell 和终端插入行为分开

### AutoAide `composer.rs` + `footer.rs`

当前职责：

- 输入
- footer mode
- shortcuts

迁移目标：

- 拆成 `bottom_pane/mod.rs + bottom_pane/chat_composer.rs + bottom_pane/footer.rs`

原因：

- Codex 的 bottom pane 是一个独立容器，不是两个小文件拼起来

### AutoAide `ui.rs`

当前职责：

- transcript 渲染
- scrollbar
- bottom pane 绘制
- cursor

迁移目标：

- 逐步让 `ui.rs` 退化为 `tui.rs` / frame orchestration
- 真正的视图状态和渲染逻辑交给 `chatwidget` 和 `bottom_pane`

### AutoAide `app.rs`

当前职责：

- bridge message apply
- key handling
- scroll
- slash commands
- submit flow

迁移目标：

- 留下 app shell
- transcript 行为迁到 `chatwidget`
- composer 路由迁到 `bottom_pane`
- streaming 行为迁到 `streaming`

## Migration Phases

## Phase T1: Freeze Current Shell

目标：

- 停止在当前 `app.rs + ui.rs + history.rs + composer.rs + footer.rs` 壳上持续加功能

动作：

- 只修 blocker bugs
- 不再新增新的自定义 UI 模型

完成标准：

- 当前壳只作为过渡运行

## Phase T2: Introduce `history_cell`

目标：

- 把当前 `BridgeCell -> Lines` 的自定义渲染，替换成更接近 Codex `HistoryCell` 的模型

动作：

- 新增 `history_cell.rs`
- 为这些 cell 建 first-class 类型：
  - `UserCell`
  - `AssistantCell`
  - `StatusCell`
  - `PlanCell`
  - `ToolCallCell`
  - `ExecCell`
  - `FileChangeCell`

完成标准：

- transcript 不再主要依赖 `kind: string`
- 每类 cell 有自己的 render logic

## Phase T3: Introduce `bottom_pane`

目标：

- 用真正的 `bottom_pane` 容器替换当前的 `composer + footer`

动作：

- 新增 `bottom_pane/mod.rs`
- 新增 `bottom_pane/chat_composer.rs`
- 新增 `bottom_pane/footer.rs`
- 新增最小 `bottom_pane_view.rs`

完成标准：

- 输入和 footer 不再由 `ui.rs` 手工拼
- shortcuts、working state、draft state 在 bottom pane 内切换

## Phase T4: Introduce `chatwidget`

目标：

- 把 transcript、active cell、bottom pane、overlay 管理收敛到一个主控对象

动作：

- 新增 `chatwidget.rs`
- 把当前 `app.rs` 中 owner-facing UI 控制迁过去

完成标准：

- `app.rs` 不再直接管理大部分 UI 细节
- `chatwidget` 成为主视图状态机

## Phase T5: Introduce `insert_history`

目标：

- 尽量靠近 Codex 的终端历史插入模型，减少当前自定义滚动/重绘复杂度

动作：

- 研究 `/tmp/openai-codex/codex-rs/tui/src/insert_history.rs`
- 先做最小等效实现
- 如果一次做不到，至少把 transcript rendering 和 viewport behavior 改到更接近其模型

完成标准：

- transcript scrolling / viewport behavior 更接近 Codex
- 不再大量依赖当前自定义 paragraph slicing

## Phase T6: Add Resume Picker and Secondary Views

目标：

- 把 `/threads` 和 resume 行为从“纯命令输出”升级成更像 Codex 的 picker

动作：

- 新增 `resume_picker.rs`
- 新增 selection popup 最小实现

完成标准：

- thread resume/new 不再只依赖 transcript 文本

## What to Delay

以下内容不要在第一波迁移时优先做：

- voice
- image attachments
- mcp-specific overlays
- complex onboarding
- notifications
- theme system

原因：

- 这些不是 AutoAide 当前 blocker
- 会拖慢主结构迁移

## What to Preserve

迁移过程中应保留：

- `bridge.rs`
- Node/Rust bridge protocol
- thread persistence
- kernel-agnostic architecture

也就是说：

- TUI 结构大改
- 上层 runtime 边界尽量不乱

## What to Remove from the Center

迁移后，不应继续让这些成为主界面的核心：

- manager/task counters
- worker counters
- reminders
- receipts
- verbose internal state chatter

主界面应优先呈现：

- transcript
- active working state
- concise tool / subagent summaries
- composer

## Suggested Testing Strategy

### Snapshot Tests

像 Codex 一样，把大量 UI 行为转成 snapshot coverage：

- `history_cell` snapshots
- multiline wrap snapshots
- command/tool/diff snapshots
- working status snapshots
- picker snapshots

### Render Behavior Tests

至少覆盖：

- active cell streaming
- bottom pane mode changes
- transcript wrap behavior
- long command truncation
- plan block rendering
- resume picker rendering

### Interaction Tests

至少覆盖：

- submit
- interrupt
- page up / page down
- home / end
- slash command dispatch
- resume/new thread flow

## Recommended First Execution Order

如果马上开始做，我建议顺序就是：

1. 新增 `history_cell.rs`
2. 新增 `bottom_pane/mod.rs` 和 `chat_composer.rs`
3. 新增 `chatwidget.rs`
4. 把 `ui.rs` 和 `app.rs` 收薄
5. 最后才碰更深的 `insert_history`

## Summary

一句话说：

**AutoAide 不该继续修当前自定义 TUI 壳，而应该按 Codex Rust TUI 的结构重建 `apps/tui-rs`。**

更具体地说：

- 先迁 `history_cell`
- 再迁 `bottom_pane`
- 再迁 `chatwidget`
- 最后再处理 `insert_history` 和 picker
