# AutoAide / OpenClaw / Codex TUI 技术架构拆解

## 目标

这份文档回答 3 个问题：

1. 这类 CLI/TUI 工具为什么看起来很像
2. `OpenClaw` 当前 TUI 的技术架构是什么
3. `AutoAide` 如果要做到接近 `OpenClaw` / `Codex CLI` 的体验，应该怎么拆

---

## 一、这类工具的共性是什么

像 `Codex CLI`、`Claude Code`、`OpenClaw TUI` 这类工具，虽然产品不同，但在交互层有很强共性。

共性不是“颜色像不像”，而是这 6 个结构：

### 1. thread-first

主对象不是 dashboard，而是 thread / session。

### 2. transcript-first

主视图是持续增长的时间线，而不是表格或卡片面板。

### 3. event-driven

UI 按事件增量更新，而不是整轮结束再刷新。

### 4. block-based history

消息不是单纯字符串，而是：

- message
- plan
- command
- file change
- tool call
- search
- wait
- failure

### 5. persistent history

thread 有稳定保存位置，可以恢复和切换。

### 6. input remains live

任务执行时，输入区依然活着，用户可以继续观察、滚动、取消、补充。

---

## 二、公开 Codex 资料里能确认的东西

从 OpenAI 官方公开资料能确认：

- Codex 已经是统一产品体验，贯通 terminal / IDE / web / app
- session history 和 configuration 会跨界面共享
- app 和 CLI 都强调多个 agent 并行、thread 组织、diff review、长任务协作

可直接参考的公开资料：

- https://openai.com/index/introducing-upgrades-to-codex/
- https://openai.com/index/introducing-the-codex-app/

从开源协议层可确认：

- Codex 使用结构化 thread item，而不是只有纯文本消息
- 常见 item 包括：
  - `userMessage`
  - `agentMessage`
  - `plan`
  - `reasoning`
  - `commandExecution`
  - `fileChange`
  - `webSearch`
  - 以及其他 tool/review/context 类 item

结论：

真正需要对齐的不是某一个 UI 截图，而是：

- thread model
- item model
- event model
- persistence model

---

## 三、OpenClaw TUI 的关键架构

## 1. 顶层是完整 TUI runtime

入口：

- `src/cli/tui-cli.ts`
- `src/tui/tui.ts`

说明：

- `tui` 是正式 CLI 子命令
- 不是测试壳，也不是一次性打印器

---

## 2. 有真正的聊天日志容器

来自：

- `src/tui/components/chat-log.ts`

核心能力：

- `addUser(...)`
- `startAssistant(...)`
- `updateAssistant(...)`
- `finalizeAssistant(...)`
- `startTool(...)`
- `updateToolResult(...)`

这说明 OpenClaw 的 transcript 不是静态字符串，而是：

- 可启动
- 可更新
- 可结束

的 UI block 生命周期。

---

## 3. 有真正的编辑器组件

来自：

- `src/tui/components/custom-editor.ts`

说明：

- 输入不是 readline
- 有独立 key handling
- 能支持更复杂的交互键位和编辑行为

---

## 4. 有专门的网关事件层

来自：

- `src/tui/gateway-chat.ts`
- `src/tui/tui-event-handlers.ts`

说明：

- TUI 不是直接 await 一整轮结果
- 它通过 gateway event 持续接收：
  - delta
  - final
  - aborted
  - tool events
- 然后把这些事件映射成 transcript block 更新

这正是 streaming 体验的来源。

---

## 5. 已经把终端基础设施抽出来了

来自：

- `src/cli/progress.ts`
- `src/terminal/table.ts`
- `src/terminal/palette.ts`
- `src/terminal/theme.ts`

说明：

- 进度条有 TTY / non-TTY 路径
- 表格是 ANSI-safe
- palette/theme 是统一的
- 终端 UI 基建不是散落在业务代码里

---

## 四、AutoAide 当前和目标之间的差距

## 当前 AutoAide 已经有

- 正式 CLI 入口
- owner-facing TUI
- thread jsonl 持久化
- snapshots 持久化
- `/threads`
- `/thread <id>`
- 初步的 `threadItemType`
- transcript-first 视图

## 当前 AutoAide 还缺

- 真正事件驱动 runtime
- 真正 editor 组件
- scrollable transcript
- assistant/tool/worker 的 streaming block lifecycle
- 独立的 progress / theme / table seam
- 更成熟的 thread navigation

---

## 五、建议的 AutoAide 目标架构

```text
autoaide tui
  -> TuiApp
     -> InputController
     -> TranscriptViewport
     -> ThreadStore
     -> EventBus
     -> RenderScheduler
     -> Keymap

manager / worker events
  -> TuiEventBus
     -> ThreadItemAssembler
        -> TranscriptBlocks
           -> render

persistence
  -> ~/.autoaide/threads/*.jsonl
  -> ~/.autoaide/snapshots/*.json
  -> thread index / summary
```

---

## 六、建议的模块拆分

## 1. `packages/tui-core`

职责：

- event bus
- render scheduler
- keymap
- viewport state

## 2. `packages/tui-thread`

职责：

- thread item model
- thread item assembler
- block lifecycle

## 3. `packages/tui-render`

职责：

- command block
- file change block
- tool call block
- transcript viewport

## 4. `packages/tui-persistence`

职责：

- thread index
- thread summary
- event log restore
- snapshot binding

## 5. `apps/tui`

职责：

- CLI glue
- manager/worker wiring
- first-use onboarding

---

## 七、推荐的 thread item profile

manager 首批必须支持：

- `userMessage`
- `agentMessage`
- `plan`
- `reasoning`
- `commandExecution`
- `fileChange`
- `webSearch`
- `contextCompaction`

manager 次级可选：

- `dynamicToolCall`
- `mcpToolCall`
- `imageView`

当前不必纳入 manager 首批：

- `collabAgentToolCall`
- `imageGeneration`
- `enteredReviewMode`
- `exitedReviewMode`

---

## 八、推荐的交互验收标准

如果要做到“和 OpenClaw / Codex CLI 的交互细节体验基本一样”，至少要满足：

### A. 线程体验

- thread-first
- transcript-first
- thread 可恢复
- thread 可切换
- 有 thread summary

### B. 流式体验

- manager 回复可 streaming
- worker 执行可 streaming
- tool call 可 streaming
- 不需要等整轮结束才看到反馈

### C. 浏览体验

- 上下滚动
- PageUp / PageDown
- Home / End
- follow tail

### D. 结构化历史

- `Ran`
- `Edited`
- `Explored`
- `Searched`
- `Waited`
- `Failed`

这些不是简单标题，而是对应真实 block。

### E. 信任体验

- manager 做了什么必须可见
- manager 为什么这么做必须可解释
- 不应默认把纯问答误转成管理任务

---

## 九、对 AutoAide 的现实建议

不要先继续抠视觉皮肤。

先按顺序做：

1. manager 输入分流
2. scrollable transcript
3. event-driven runtime
4. streaming manager/worker/tool blocks
5. thread summary / picker
6. diff / command / tool-call 高保真渲染

这样才会真的接近 `OpenClaw` / `Codex CLI`，而不是只像一个套皮版本。

---

## 参考

- OpenAI Codex upgrades:
  - https://openai.com/index/introducing-upgrades-to-codex/
- OpenAI Codex app:
  - https://openai.com/index/introducing-the-codex-app/
- OpenClaw 本地代码：
  - `src/tui/tui.ts`
  - `src/tui/components/chat-log.ts`
  - `src/tui/components/custom-editor.ts`
  - `src/tui/gateway-chat.ts`
  - `src/tui/tui-event-handlers.ts`
  - `src/cli/tui-cli.ts`
  - `src/cli/progress.ts`
  - `src/terminal/table.ts`
  - `src/terminal/palette.ts`
  - `src/terminal/theme.ts`

