# AutoAide TUI 体验问题与改进方案

## 当前结论

当前 TUI 已经完成了第一轮向 `OpenClaw` / `Codex CLI` 靠拢的大改，但还没有达到最终形态。

已经解决的点：

- 已支持 scrollable transcript viewport
- 已支持 manager / worker / follow-up 的事件流式增量刷新
- 已把输入主循环切到 raw-mode keypress runtime

当前剩下的 3 个主要差距是：

- 还没有 token-level assistant streaming
- 还没有真正的 assistant/tool/diff block 组件模型
- editor 能力仍弱于 Codex CLI 的成熟输入器

这会让 owner 觉得：

- 看历史很痛苦
- 等待时没有反馈
- manager 和 worker 像“黑箱运行”

---

## 代码层证据

来自 `apps/tui/src/index.ts`：

### 1. transcript 已有 scroll offset，但 block model 仍不够强

`renderInteractiveScreen(...)` 现在已经有：

- `selectViewportLines(...)`
- `scrollOffset`
- `followTail`
- `PageUp / PageDown / Up / Down / Home / End`

这意味着：

- 可以滚动历史
- 可以跟随 live tail
- 但仍然是“文本行渲染”，不是 block runtime

### 2. 当前已经不是 readline 问答循环，但 editor/runtime 仍偏轻

`runInteractiveTui()` 里现在核心是：

- `emitKeypressEvents(...)`
- `stdin.setRawMode(true)`
- `waitForKeypress()`

然后：

- `await submitOwnerMessage(...)`

这意味着：

- 输入不再是 blocking question loop
- 提交后 transcript 可以继续刷新
- 期间 owner 仍可滚动和编辑输入
- 但 editor 还不是完整的组件化输入器

### 3. 当前已经是事件流 transcript，但还不是 token streaming

当前已经有：

- `pushMessage(...)`
- `appendConversationTurn(...)`

但 `submitOwnerMessage(...)` 里是：

- `TuiEvent`
- `emitTuiEvent(...)`
- manager / worker / follow-up 的增量投递

所以当前用户已经能感受到：

- manager 行为边做边显示
- worker start / complete / fail 边做边显示

但还不能感受到：

- assistant token 一边生成一边流出
- tool block 在同一 block 内持续更新

---

## 和 OpenClaw / Codex 的关键差距

## 1. 事件驱动 vs 回合驱动

### 当前 AutoAide

- readline
- 一次提交
- 一次完整处理
- 一次 redraw

### OpenClaw / Codex 风格

- 全屏 TUI runtime
- editor 与 transcript 同时在线
- 事件一到就更新 UI
- 工具事件、assistant token、tool result、状态变化都能增量渲染

---

## 2. transcript container 能力不足

### 当前 AutoAide

- 自己把消息渲染成字符串数组
- 最后整屏输出

### OpenClaw

从 `src/tui/components/chat-log.ts` 可以看到，它有明确的 log 容器：

- `addUser(...)`
- `startAssistant(...)`
- `updateAssistant(...)`
- `finalizeAssistant(...)`
- `startTool(...)`
- `updateToolResult(...)`

也就是说：

- assistant message 可以先 start，再 update，再 finalize
- tool call 也有独立组件和生命周期

这正是 streaming UI 的基础。

---

## 3. 编辑器和交互键位更完整

从 `src/tui/components/custom-editor.ts` 看，OpenClaw 已经有：

- `Esc`
- `Ctrl+C`
- `Ctrl+D`
- `Ctrl+L`
- `Ctrl+O`
- `Ctrl+P`
- `Ctrl+G`
- `Ctrl+T`
- `Shift+Tab`
- `Alt+Enter`

这说明它不是普通 readline，而是：

- 真正的 editor 组件
- 真正的按键事件系统

当前 AutoAide 还没有这层。

---

## 4. 工具和流式消息是 first-class object

OpenClaw 的 `ChatLog` 里明确区分：

- 用户消息
- assistant 流式消息
- tool execution block

当前 AutoAide 虽然已经有：

- `threadItemType`
- `commandExecution`
- `fileChange`
- `webSearch`

但本质上仍然是：

- 先构造成文本消息
- 再渲染成 transcript 行

还不是事件级 block runtime。

---

## 为什么你会觉得“很难受”

你的感受是对的，因为现在 TUI 还缺少这 4 个最关键的交互手感：

1. 可滚动历史
2. 流式更新
3. 执行中的持续反馈
4. 输入时 UI 仍然活着，而不是卡在 `question()`

---

## 正确的重构方向

## 方向一：把 TUI 从 readline loop 改成 event-driven app

不要再靠：

- `createInterface(...)`
- `await readline.question(...)`

应改成：

- 输入组件
- transcript 组件
- status/footer 组件
- keymap
- render loop
- event bus

至少需要：

- `TuiApp`
- `TranscriptStore`
- `InputController`
- `RenderScheduler`
- `EventBus`

---

## 方向二：引入 scrollable transcript viewport

新增：

- `scrollOffset`
- `followTail`
- `PageUp/PageDown`
- `Up/Down`
- `Home/End`

行为：

- 默认 follow tail
- 用户一滚动就退出 follow tail
- 一旦回到底部再自动恢复

---

## 方向三：把 manager / worker / tool 事件改成 streaming event pipeline

当前不应该等 `submitOwnerMessage(...)` 整轮结束。

应拆成：

1. owner 发消息
2. manager 开始 thinking
3. manager 先回一段可见解释
4. plan event 到达
5. tool call event 到达
6. worker started
7. worker partial progress
8. worker completed / failed
9. manager final reply

也就是说，TUI 应该消费的是：

- `TuiEvent`

而不是“整轮处理后的最终文本集合”。

---

## 方向四：把 transcript item 做成真正的 block model

建议把现在的 `TuiMessage` 升级成：

- `UserTurnBlock`
- `ManagerTurnBlock`
- `PlanBlock`
- `ReasoningBlock`
- `CommandExecutionBlock`
- `FileChangeBlock`
- `ToolCallBlock`
- `StatusBlock`

每个 block 都要支持：

- `pending`
- `streaming`
- `final`
- `error`

---

## 推荐实施顺序

### Step 1

- 已完成：scrollable transcript
- 已完成：不改变 manager 核心语义，只先改 TUI 消费方式

### Step 2

- 已完成：把输入层从 readline 改成 raw-mode editor/runtime

### Step 3

- 已完成：把 manager 事件和 worker 事件改成 `TuiEvent` 驱动的 event bus

### Step 4

- 进行中：做 assistant/tool/worker 的 streaming block

### Step 5

- 未完成：做更像 Codex 的 diff、command、tool block 细节

---

## 验收标准

做到接近 OpenClaw / Codex CLI 的最低标准应该是：

- 可以滚动看历史
- 长任务过程中 transcript 持续更新
- worker 开始后 owner 不需要等到最终结束才看到反馈
- manager 的 reasoning / plan / tool / worker progress 都能分块可见
- 输入框在任务执行期间依然可交互
