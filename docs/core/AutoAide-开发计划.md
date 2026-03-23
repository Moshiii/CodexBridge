# AutoAide 开发计划

## 使用方式

这份文档是 `AutoAide` 的主开发计划。

要求：

- 每完成一个阶段就更新状态
- 每出现新的风险或架构变更就补充
- 任何实现工作都应该能映射到这里的某一项

状态约定：

- `pending`: 未开始
- `in_progress`: 进行中
- `done`: 已完成
- `blocked`: 被阻塞

## 当前可展示能力

当前已可展示：

- 一个可运行的 `pnpm` TypeScript workspace
- 一个最小 `AutoAide server`
- `GET /healthz` 健康检查接口
- 基础配置解析：`AUTOAIDE_APP_NAME`、`AUTOAIDE_HOST`、`AUTOAIDE_PORT`
- 基础结构化日志能力
- 一个本地 `AutoAide TUI` owner-facing conversation terminal
- 一个正式的 `Codex` 连通性检查入口
- 真实 `Codex` CLI 连通性验证
- owner-facing 路径默认走真实 `Codex CLI`

当前最应该优先打磨的展示路径：

- 用户安装或链接后，直接运行 `autoaide tui`
- 在 TUI 里直接给 manager 一个真实需求
- 看见 manager 的理解、追问、派工、worker 执行和结果回报
- 如果真实执行失败，再转入诊断

这条路径是否顺滑，决定用户能否在 5 分钟内理解 `AutoAide` 的价值。

当前还不能展示：

- 更成熟的长期 steward loop
- 真实 channel 对话
- 更完整的持久化后端
- 长时间运行的生产级 manager session
- 真正的 CEO-COO 多 workstream 控制面

---

## 当前产品目标

`AutoAide` 是一个轻量化的管理型 AI 系统。

它的职责是：

- 面向真人用户接收目标
- 为一个常驻的 `manager agent` 提供运行底座
- 让 `manager agent` 规划与拆分任务
- 搜索历史信息
- 管理长期记忆
- spawn 和调度 `Codex worker`
- 跟踪任务进展
- 先通过本地 terminal UI 向用户汇报
- channel 作为后置扩展入口，而不是当前主入口

`AutoAide` 不负责实际工程执行。

补充定义：

- `owner`: 真人用户，当前更准确地说是 `CEO`
- `manager`: 一个由 `Codex` 驱动的常驻管家 agent，当前更准确地说是 `COO`
- `worker`: 多个由 `Codex` 驱动的执行器
- `AutoAide core`: manager 与 worker 的记忆、任务图、调度、权限和监督底座

当前新的目标口径补充：

- CEO 可以持续给 COO 多条并行任务线
- COO 应同时经营多个 workstreams
- COO 既能主动被 heartbeat / scheduler 唤醒，也能随时响应 CEO 对任意任务线的查询
- 未来的核心抽象不应只是单个 task，而应包括 `workstream`、`manager session`、`manager inbox`

manager 对齐定义：

- `manager` 的使命：代表 owner 持续盯事，直到事情被推进、澄清、升级或完成
- `manager` 的职责：沟通、理解、规划、追问、派工决策、催办、升级、汇报
- `manager` 的业务范围：manager plane，不包含 execution plane
- `manager` 的能力边界：只能通过 orchestration contract 行动，不能直接获得执行权

关键原则：

- `manager` 不是一组写死规则
- `manager` 是一个受 `AutoAide` 结构化约束的 agent runtime
- `AutoAide` 不替代 manager 思考，而是约束 manager 的事实来源、权限边界和可恢复状态
- `manager` 的智能来自 `LLM`
- `manager` 的行动来自 `tool calls`
- 任何真实管理动作都应优先通过 tool-first workflow 落地

## 当前策略调整

从当前阶段开始，交互优先级调整为：

- 第一优先级：首次上手体验和价值理解
- 第二优先级：`autoaide cli` 与 `autoaide tui` 的最短成功路径
- 第三优先级：稳健性与测试收口
- 第四优先级：更深的 Codex/OpenClaw 风格对齐
- 第五优先级：channel adapter 实装

原因：

- 当前最大风险不是“功能不够多”，而是“用户第一次用时看不懂价值”
- `AutoAide` 当前最需要的是一条 5 分钟内可成功体验的 manager-first 路径
- `autoaide tui -> 提一个真实需求 -> 看见 manager 管理 worker` 应该成为产品主体验
- `codex check` 更适合作为失败后的诊断命令，而不是首推入口
- 更深的 Codex/OpenClaw 风格对齐很重要，但它属于体验精修，不应压过 first-value 闭环
- channel 更适合作为本地 first-value 路径稳定后的外延入口，而不是当前主入口

## 当前阶段北极星

当前阶段的北极星不是“做更多能力”，而是：

- 新用户能否在 5 分钟内安装、启动并理解 `AutoAide` 在做什么
- 新用户能否在第一次会话里清楚看到 manager 的价值
- 新用户能否在不读大量文档的情况下完成一次真实任务委派

当前阶段所有实现，都优先服务这 3 个问题。

## 参考 OpenClaw CLI 的迁移判断

参考 `OpenClaw` 的 CLI 组织方式，`AutoAide` 下一步应先建立：

- 顶层 `autoaide` 命令
- 子命令分组
- 统一 help / runtime / command registration 结构

适合照搬的设计思路：

- 顶层命令树，而不是只有单个 `tui` 入口
- `tui` 作为一个子命令，而不是产品唯一入口
- `status` / `doctor` 这类 operator-facing 命令组
- 统一的 CLI 注册层、帮助输出、运行时封装
- lazy subcommand registration 的思路

不适合直接照搬的命令组：

- `models`
- `channels`
- `devices`
- `pairing`
- `nodes`
- `browser`
- `dns`
- `sandbox`
- `plugins`

原因：

- 这些命令大多服务于 `OpenClaw` 的 channel/gateway/device/plugin 产品边界
- `AutoAide` 的核心不是多渠道设备平台，而是 kernel-agnostic supervisor shell
- `AutoAide` 现阶段应把复杂 workflow 隐藏在 TUI 内，而不是铺成很多顶层命令

## 工程基线

- Runtime: Node.js 22+
- Language: TypeScript ESM
- Package manager: `pnpm`
- Test framework: `vitest`
- Lint/format: `oxlint` / `oxfmt` 或等价组合
- Source layout: `src/`
- Test naming: colocated `*.test.ts`，端到端为 `*.e2e.test.ts`

建议基础命令：

- `pnpm install`
- `pnpm build`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm check`

---

## 当前全局状态

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 产品定位 | `done` | 已明确 AutoAide 是 manager-agent substrate，不是 executor 本体 |
| 架构设计 | `done` | 已产出首版架构设计文档 |
| 仓库骨架 | `done` | 已建立 workspace、基础 package、logger 和最小 server |
| 任务系统 | `done` | 已建立 task-system 包、状态机、内存 store、snapshot 和 repair 基线 |
| 记忆系统 | `done` | 已建立 memory-system 包、摘要查询层、commitment 查询和 snapshot repository contract |
| manager policy core | `done` | 已建立 manager-core 包，具备 planner / scheduler / task graph update / escalation actions，作为 manager agent 的结构化约束层 |
| manager runtime | `in_progress` | 已建立 manager-runtime 包，默认走 `CodexManagerRuntime`，并已接入 conversation memory、memory grounding、tool-first orchestration contract 与 owner intent gate |
| worker 编排 | `done` | 已建立 worker-orchestrator 包，具备 registry / assign / heartbeat / result / stalled 检测 |
| Codex executor 集成 | `done` | 已建立 executor-codex 包、统一执行入口、command adapter 和本地进程 runner，并已真实验证 Codex CLI 连通性 |
| owner-interface 基础 | `done` | 已建立 owner-interface 包和 owner -> manager -> reply 链路 |
| CLI 主入口 | `done` | 已建立 `apps/cli`，具备 `autoaide` 顶层命令、子命令注册与正式入口验证 |
| terminal UI | `in_progress` | 已建立 thread-first 的 `apps/tui`，并已完成第一阶段简化重构：将仅服务 TUI 的 dashboard 构建逻辑从 `packages/terminal-ui` 收回 `apps/tui`，但仍未完成对 Codex thread item 模型、timeline、diff 和 step 渲染体验的系统对齐 |
| channel 集成 | `pending` | 具体渠道实现后置，基于 owner-interface 抽象再接 Telegram/Discord/Slack |
| cron 跟进系统 | `done` | 已建立 supervision-core 包、scheduler 抽象和 supervision -> owner reply 链路 |
| 稳健性设计 | `done` | 已明确幂等、恢复、审计、降级要求 |
| 测试计划 | `done` | 已产出首版测试计划文档 |

---

## 里程碑

### M0. 定义阶段

目标：

- 把产品边界写清楚
- 明确 manager / worker / owner 角色
- 明确 manager 是 Codex 驱动的管家 agent，而不是规则引擎
- 明确哪些能力不放进 AutoAide

交付物：

- `AutoAide-架构设计.md`
- `AutoAide-开发计划.md`
- `AutoAide-任务与记忆系统设计.md`
- `AutoAide-测试计划.md`

状态：`done`

### M1. 核心骨架阶段

目标：

- 建立最小可运行仓库结构
- 建立 manager-policy-core / task-system / memory-system / worker-orchestrator 基本边界

交付物：

- package 目录骨架
- 基础 TypeScript 工程
- 统一配置和日志基础
- 基础 build / test / check 命令

状态：`done`

### M2. 任务与记忆阶段

目标：

- 建立任务模型
- 建立 assignment 和 progress event 模型
- 建立最小可用管理记忆系统

交付物：

- task store
- project memory store
- worker memory store
- commitment memory store
- schema version / migration 基线

状态：`done`

### M3. 调度与 worker 编排阶段

目标：

- 实现 worker spawn / assign / status / cancel / reassign
- 实现 heartbeat 跟踪
- 实现 stalled / blocked 检测

交付物：

- worker registry
- assignment pipeline
- supervisor loop

状态：`done`

### M4. Codex runtime 集成阶段

目标：

- 接入 `Codex manager runtime`
- 接入 `Codex worker executor`
- 能让 manager 和 worker 都以 Codex 作为底层 runtime
- 能接收结构化结果和状态

交付物：

- `manager-codex-adapter`
- `executor-codex`
- worker result schema
- executor lifecycle adapter
- executor security boundary

状态：`done`

### M5. 用户交互与 channel 阶段

目标：

- 先完成 owner interface 抽象
- 让 owner 默认对接 manager agent，而不是规则型接口
- 暂不把具体 channel adapter 作为当前里程碑核心

交付物：

- owner interface contract
- owner conversation loop
- summary / notify flow

状态：`done`

### M5A. Manager Tool Call 阶段

目标：

- 把 manager 的核心职责收敛到结构化 tool-first workflow
- 降低自由文本直接驱动系统行为的比例
- 让 manager 的关键动作更可控、可测、可见

交付物：

- manager tool taxonomy
- read tools / write tools 分层
- manager tool policy
- owner 可见 tool call 映射
- owner intent gate

状态：`in_progress`

### M5B. 保留可替代性的简化重构阶段

目标：

- 在不破坏未来替换能力的前提下收缩项目复杂度
- 保留 `manager-runtime`、`executor-runtime`、`task/memory persistence`、`tool contract`
- 合并仅为内部实现服务、且不构成长期替换边界的层

交付物：

- `AutoAide-保留可替代性的简化重构方案.md`
- 第一阶段安全收缩

状态：`in_progress`

当前阶段判断：

- Phase 1 `terminal-ui -> apps/tui` 已完成
- Phase 2 `owner-interface -> manager-runtime` 已完成
- Phase 3 `manager-core / supervision-core -> manager-runtime` 已完成
- Phase 4 `apps/server` 的角色重评估与后置判断已完成
- `apps/server` 当前作为未来 web/channel ingress 的占位 app 保留，但不再作为当前主产品主链路
- 在这一步开始前，应继续保持 `manager-runtime`、`executor-codex`、`task/memory persistence`、`tool contract` 四条边界稳定
- 当前目标架构口径见：`AutoAide-Manager-Plane目标架构.md`
- 当前架构口径已更新：`AutoAide-Codex化TUI与Manager轻量化设计.md`
- 新判断：AutoAide 应逐步从 “Codex-only manager + 重 task/workers UX” 调整为 “kernel-agnostic supervisor shell + Codex-style TUI + transcript-first UX”
- 新原则：Codex 是默认参考实现，不是唯一 manager / executor kernel

### M6. CLI 主入口阶段

目标：

- 建立 `autoaide` 顶层 CLI
- 建立面向 operator 的命令树
- 把 TUI、cron、status、logs、worker orchestration 等能力挂到统一 CLI 入口

交付物：

- `autoaide` 顶层程序入口
- 子命令注册层
- help / usage / runtime 封装
- 首批 manager-first 命令组

状态：`done`

### M6A. 首次上手与价值验证阶段

目标：

- 建立一条新用户最短可成功路径
- 让用户几乎不需要理解内部架构，就能看见 manager 的价值
- 压缩首次使用的认知负担和报错成本

交付物：

- 清晰的 `README` 快速开始路径
- `autoaide tui` 作为默认 owner 入口
- 一条推荐的首次体验流程
- 首次失败时的明确诊断和下一步建议

状态：`in_progress`

### M7. 本地 terminal UI 阶段

目标：

- 建立本地 terminal-first owner interface
- 让 owner 在一个沉浸式终端界面里直接和 manager agent 对话
- 把 TUI 做成类似 Codex / OpenClaw 的 thread-first transcript 界面
- 把 manager 的计划/追问/汇报优先体现在时间线里，而不是默认铺开的状态面板
- 让 task / worker / alerts / reminders 通过 slash 命令按需展开
- 当前补充目标：直接以 Codex Rust TUI 为结构参考重建 `apps/tui-rs`，不再继续投资旧的自定义 TUI 壳
- 当前补充原则：主界面只突出 transcript / active working state / composer，`tasks/workers/alerts/reminders` 降级到 secondary 或 debug-only

交付物：

- terminal UI shell
- manager conversation loop
- compact status line
- command bar
- quick actions
- TTY / non-TTY 降级行为

状态：`in_progress`

### M7B. Codex-style Rust TUI 迁移阶段

目标：

- 以 Codex Rust TUI 的结构和状态机为参考重建 `apps/tui-rs`
- 停止继续修补当前自定义 transcript/footer/composer 壳
- 把 TUI 的主体验收敛为 transcript-first、active streaming cell、bottom pane、picker/overlay

交付物：

- `chatwidget` 风格主控层
- `history_cell` 风格 transcript 单元
- `bottom_pane` 风格 composer/footer/popup 状态机
- `insert_history` 风格终端历史插入行为或足够接近的等效实现
- 与 Node bridge 对接的稳定 Rust TUI 前端

状态：`in_progress`

### M7C. Manager 轻量化与 Kernel 抽象阶段

目标：

- 把 manager 从 “Codex-only manager runtime” 调整为 “kernel-agnostic supervisor agent”
- 降低 `tasks/workers/receipts` 在 owner-facing 主体验中的权重
- 把主要 orchestration policy 移入 `AGENTS.md`
- 引入统一 `agent kernel` contract 和最小 supervisor wrapper

交付物：

- `AutoAide-Codex化TUI与Manager轻量化设计.md`
- `agent-kernel` contract
- `manager/AGENTS.md` 初稿
- 最小 `autoaide-agent` CLI wrapper 设计

状态：`in_progress`

### M7D. Manager 经理式行为对齐阶段

目标：

- 让 manager 更像一线经理，而不是规则式任务路由器
- 尽量把判断权交给大模型，把本地代码收缩到轻约束执行层
- 强化 manager 的选人、派工合同、跟进、验收和升级能力
- 保持 manager 不直接下场执行，只通过结构化 orchestration contract 行动

交付物：

- `AutoAide-Manager做事风格设计.md`
- `AutoAide-Manager轻约束落地方案.md`
- `manager-runtime` 的 task ref / staffing / follow-up contract 升级
- manager grounding 的 worker 能力画像增强
- manager review / follow-up turn 机制

状态：`in_progress`

### M8. 主动跟进与 cron 阶段

目标：

- manager 能自动盯进展
- manager 能根据超时或阻塞自动 follow-up

交付物：

- cron-driven supervision
- overdue tracking
- pending commitment follow-up

状态：`done`

### M9. 稳健性与测试阶段

目标：

- 建立完整的测试分层
- 明确恢复、幂等、异常降级行为
- 给关键状态机建立回归测试

交付物：

- 单元测试骨架
- 集成测试骨架
- 恢复测试
- 异常路径测试
- milestone test gates

状态：`in_progress`

---

## 开发阶段细分

## Phase 1: 仓库骨架

状态：`done`

任务：

- [x] 建立 `packages/` 和 `apps/` 目录结构
- [x] 建立 TypeScript workspace
- [x] 建立统一 lint / format / test 配置
- [x] 建立基础配置加载模块
- [x] 建立基础 logger 模块
- [x] 固定 Node / pnpm / vitest 工程基线

完成标准：

- 可以在本地启动一个空的 `apps/server`
- 各 package 可独立编译
- 当前进展：最小 `core-config` 包和 `server` app 已可 build/test
- 当前进展：已补充 `core-logger` 包，Phase 1 所有条目已完成
- 当前说明：`apps/server` 保留为未来 web/channel ingress 占位 app，但当前已明确后置，不再作为 first-value 主链路

## Phase 2: 领域模型

状态：`done`

任务：

- [x] 定义 `Task`
- [x] 定义 `Assignment`
- [x] 定义 `ProgressEvent`
- [x] 定义 `Worker`
- [x] 定义 `Project`
- [x] 定义 `Commitment`
- [x] 实现基础状态迁移辅助函数
- [x] 建立最小内存 store 和基础查询接口
- [x] 建立领域对象创建约束的进一步校验
- [x] 建立 `schemaVersion` 和 store snapshot 基线
- [x] 建立 migration / repair 具体实现

完成标准：

- 所有核心类型稳定
- 任务与 worker 关系可表达
- 当前进展：`packages/task-system` 已落地，基础状态机测试已通过
- 当前进展：已具备 `Task` / `Assignment` / `Commitment` 的内存 store 和查询能力
- 当前进展：已具备 snapshot 导出/恢复和 schema version 检查
- 当前进展：已具备创建参数校验、legacy snapshot 迁移和 repair 基线

## Phase 3: 持久化与记忆

状态：`done`

任务：

- [x] 建立 task store
- [x] 建立 project memory store
- [x] 建立 worker memory store
- [x] 建立 decision log
- [x] 建立 commitment memory
- [x] 建立统一 search API
- [x] 建立 schemaVersion / migration 机制
- [x] 建立 repair / quarantine 基线
- [x] 建立独立 `memory-system` 包
- [x] 建立 task / commitment / worker / project 摘要查询层
- [x] 将当前内存摘要层拆分为持久化 memory store contract

完成标准：

- manager 可查询历史任务、worker、承诺和项目上下文
- 当前进展：已建立基于 `task-system` 的 memory snapshot 和查询接口
- 当前进展：已具备 project / worker / decision record 的最小内存 store
- 当前进展：已具备 memory-system 的 schemaVersion、migration 和 repair 基线
- 当前进展：已具备 commitment 查询能力和 memory store 持久化边界抽象
- 当前进展：已具备 snapshot repository contract 和 manager memory 的 load/save 流程
- 当前进展：`task-system` 和 `memory-system` 已统一为 repository-based restore/persist 模式

## Phase 4: manager-policy-core

状态：`done`

任务：

- [x] 建立 planner
- [x] 建立 task graph updater
- [x] 建立 scheduler
- [x] 建立 progress supervisor
- [x] 建立 escalation policy

完成标准：

- manager agent 可以基于结构化 policy 生成任务并决定派工
- 当前进展：已建立 `packages/manager-core`
- 当前进展：已具备确定性的 owner goal planning、work plan apply 和 next-task scheduling
- 当前进展：已具备 blocked / overdue / stalled 的基础 supervisor alerts
- 当前进展：已具备 task graph updater 和 alert -> escalation action 映射

说明：

- 这一层不再被视为最终 manager
- 这一层是 `Codex manager agent` 的结构化约束与事实层

## Phase 4A: manager-runtime

状态：`in_progress`

任务：

- [x] 定义 `manager runtime` interface
- [x] 建立 `Codex manager` prompt/runtime adapter
- [x] 明确 manager 可读取的 memory grounding 范围
- [x] 明确 manager 可调用的 orchestration tools
- [x] 建立 manager reply -> task graph update 的最小闭环
- [x] 建立 owner intent gate，避免普通问答默认触发任务编排
- [ ] 将 manager 的高频职责收敛为 tool-first workflow
- [ ] 明确 owner 可见 tool calls 与内部 bookkeeping 的分层

完成标准：

- owner 面对的是一个常驻的 `Codex manager agent`
- manager 的每次规划、追问和汇报都基于结构化状态，而不是自由漂移
- manager 不直接拥有执行工具权限，只能通过 orchestration contract 派工
- 当前进展：已建立 `packages/manager-runtime`
- 当前进展：已具备 `ManagerRuntime` interface；`CodexManagerRuntime` 为默认产品运行时，`DeterministicManagerRuntime` 仅用于测试和显式 fallback
- 当前进展：`owner-interface` 和 `apps/tui` 已通过 runtime seam 使用 manager 回复链路
- 当前进展：已具备 `CodexManagerRuntime`、结构化 manager response 协议和命令结果解码
- 当前进展：默认 manager runtime 已切到 `CodexManagerRuntime`，`DeterministicManagerRuntime` 仅保留给测试和显式 fallback
- 当前进展：已为 `Codex manager runtime` 接入 tasks / commitments / workers / decision records 的结构化 memory grounding
- 当前进展：已定义 manager 可调用的 orchestration tools contract，当前包括 `ask_owner`、`create_tasks`、`assign_worker`、`schedule_followup`、`replan_task`、`record_decision`
- 当前进展：`owner-interface` 已能执行 `record_decision`、`schedule_followup`、`assign_worker`、`replan_task` 的最小闭环，TUI 已可看到对应 manager action events
- 当前进展：已具备 manager conversation context，包含最近对话、active task、pending clarification 和 rolling summary
- 当前进展：已加入 `owner intent gate`，普通问答默认进入 `conversation_only`，不再默认创建任务或发派工工具
- 当前原则：manager 的智能来自 `Codex`，manager 的真实动作优先通过 tool calls 落地
- 当前限制：下一步重点是做输入分流、tool-first 行为约束，以及让 manager 更系统地利用长期会话记忆做持续 follow-up、replan 和 steward loop

## Phase 5: worker-orchestrator

状态：`done`

任务：

- [x] 建立 worker registry
- [x] 建立 worker spawn 流程
- [x] 建立 assignment 路由
- [x] 建立 heartbeat 接收
- [x] 建立 status 聚合
- [x] 建立 stalled 检测

完成标准：

- manager 能创建 worker 并持续跟踪它们
- 当前进展：已建立 `packages/worker-orchestrator`
- 当前进展：已具备 worker spawn、registry 和 assignment routing
- 当前进展：已具备 heartbeat / result 聚合和 stalled assignment 检测

## Phase 6: executor-codex

状态：`done`

任务：

- [x] 定义 worker run contract
- [x] 接入 Codex executor
- [x] 统一 result schema
- [x] 统一 error schema
- [x] 支持取消和重试
- [x] 定义凭据隔离和工作区隔离边界
- [x] 限定 manager 可见的 worker 回报层级

完成标准：

- 能把一个真实任务派给 Codex worker 并收到结构化结果
- 当前进展：已建立 `packages/executor-codex`
- 当前进展：已具备 run request、result schema、retry/cancel adapter 和 manager redaction
- 当前进展：已具备 workspace / tools / runtime / visibility 的 execution policy 边界
- 当前进展：已具备 assignment -> codex run -> worker result 回写的整合链路
- 当前进展：已具备 codex run lifecycle registry、取消记录和 retry 基础设施
- 当前进展：已具备统一 execution entry，可组合 policy、lifecycle、orchestrator 和 manager redaction
- 当前进展：已具备 CLI invocation builder、result parser 和 command-based executor adapter
- 当前进展：已具备基于 Node 子进程的本地 command runner，支持 stdout/stderr、timeout 和 cancel
- 当前进展：已具备命令结果解码层，可将 noisy stdout、process exit 和 timeout 映射为结构化结果
- 当前进展：worker 侧和 manager 侧都已具备 Codex runtime 接入能力
- 当前进展：owner-facing CLI/TUI 默认走真实 `Codex CLI`，不再以内存假执行器作为产品默认路径
- 当前原则：mock executor 只保留给测试和显式注入，不作为用户可感知的正常运行模式

## Phase 7: owner-interface

状态：`done`

任务：

- [x] 建立 owner message ingress
- [x] 建立 manager reply flow
- [x] 建立 summary 模板
- [x] 建立 clarification flow
- [x] 建立 channel adapter contract，避免 manager-core 依赖具体渠道

完成标准：

- owner 可以通过 channel 发任务并收到 manager 回报
- 当前进展：已建立 `packages/owner-interface`
- 当前进展：已具备统一 owner message contract、task intent 解析和 clarification reply
- 当前进展：已具备 channel bridge / adapter contract 和 summary / escalation reply 模板
- 当前进展：已具备 owner message -> work plan -> summary reply 的整合链路
- 当前进展：当前 owner 入口默认已切到 `Codex manager agent`

## Phase 6A: autoaide-cli

状态：`done`

任务：

- [x] 建立 `apps/cli` 或等价的顶层 CLI 入口
- [x] 建立顶层 `autoaide` program
- [x] 建立子命令注册层
- [x] 建立统一 help / usage / runtime 包装
- [x] 建立 `autoaide tui`
- [x] 建立 `autoaide status`
- [x] 建立 `autoaide models`
- [x] 建立 `autoaide doctor`
- [x] 建立 `autoaide dashboard`
- [x] 建立 `autoaide stop`

完成标准：

- 安装后，用户可以像 `openclaw` 一样通过 `autoaide` 顶层命令进入系统
- 当前 TUI 不再只是 `pnpm tui` 脚本，而是正式挂到 `autoaide tui`
- manager-first 的系统入口都可以从 CLI 直接调用
- 当前进展：已建立 `apps/cli`
- 当前目标命令面已收敛为 `tui / exec / status / models / dashboard / stop / doctor`
- 当前原则：`threads / runs / inspect / logs` 等 workflow 细节应隐藏到 TUI 内部，而不是继续暴露为顶层命令

推荐首批命令组：

- `autoaide tui`
- `autoaide exec`
- `autoaide status`
- `autoaide models`
- `autoaide dashboard`
- `autoaide stop`
- `autoaide doctor`

当前明确不做的 OpenClaw 式命令组：

- `autoaide channels`
- `autoaide devices`
- `autoaide pairing`
- `autoaide nodes`
- `autoaide browser`
- `autoaide dns`
- `autoaide sandbox`
- `autoaide plugins`

## Phase 6B: first-value experience

状态：`in_progress`

任务：

- [ ] 把 `README` 的第一屏改成 5 分钟快速上手
- [ ] 明确唯一推荐的首次体验路径：`autoaide tui`
- [ ] 在 `autoaide tui` 首屏给出极短引导，而不是依赖用户先读文档
- [ ] 把 `autoaide doctor` 作为失败后的统一诊断入口
- [ ] 为真实 Codex 不可用、未登录、连通失败提供明确诊断文案
- [ ] 给出 3 到 5 个推荐的首次提示词，帮助用户快速看到 manager 价值
- [ ] 让 `/help`、`README`、`TUI` 三处的首上手说明完全一致
- [ ] 建立一次真实成功链路的验收标准

完成标准：

- 新用户不需要先理解架构，也能在 5 分钟内完成第一次成功体验
- 新用户可以清楚看见 manager 的职责：理解、追问、派工、跟进、汇报
- 首次失败时，用户能明确知道问题出在 `Codex`、网络、配置还是当前任务本身
- 当前原则：first-value 路径优先于深度风格精修

## Phase 7A: terminal-ui

状态：`in_progress`

任务：

- [x] 建立本地 terminal UI app shell
- [x] 建立 owner -> manager 的自然语言输入入口
- [x] 将默认视图改为 transcript-first / thread-first，状态信息压缩到一行
- [x] 建立 `~/.autoaide/threads/*.jsonl` 会话事件流持久化
- [x] 建立 `~/.autoaide/snapshots/*.json` 状态恢复基线
- [ ] 建立 command bar 和 quick actions
- [ ] 建立 manager summary panel
- [ ] 建立 TTY / non-TTY 降级行为
- [ ] 建立 palette / theme seam，避免样式散落
- [ ] 建立 ANSI-safe 表格和日志渲染边界
- [ ] 建立本地状态刷新与长任务 progress 呈现
- [ ] 按 manager profile 建立结构化 thread timeline
- [ ] 对齐 manager 首批核心 thread item：
- [ ] `userMessage`
- [ ] `agentMessage`
- [ ] `plan`
- [ ] `reasoning`
- [ ] `commandExecution`
- [ ] `fileChange`
- [ ] `webSearch`
- [ ] `contextCompaction`
- [ ] 对齐 manager 次级可选 thread item：
- [ ] `dynamicToolCall`
- [ ] `mcpToolCall`
- [ ] `imageView`
- [ ] 明确不纳入当前 manager 首批范围：
- [ ] `collabAgentToolCall`
- [ ] `imageGeneration`
- [ ] `enteredReviewMode`
- [ ] `exitedReviewMode`
- [ ] 在渲染层建立 Codex 风格的人类可读 step 标题映射
- [ ] 建立 `Edited / Ran / Explored / Waited / Failed / Searched / Viewed Image` 等 step block
- [ ] 建立 diff / command / tool-call 专用渲染块
- [ ] 建立 thread header 和 thread/history 切换
- [x] 建立 manager 追问 / 澄清 / 继续派工的最小对话闭环

完成标准：

- owner 不依赖外部 channel，就能在本地 terminal 中直接与 manager agent 对话
- terminal UI 默认是 Codex/OpenClaw 风格的 thread-first transcript，而不是 dashboard
- task、worker、alerts、reminders 通过 slash 命令按需查看
- UI 交互层与 transport / orchestration 分离，不把业务逻辑塞进视图层
- 设计要求参考 OpenClaw：
  - 使用统一 palette / theme token，而不是零散硬编码颜色
  - progress 必须有 TTY / non-TTY 双路径
  - 表格和状态输出必须 ANSI-safe、可复制、可粘贴
  - 输入交互要优先支持和 manager 的自然语言对话，同时保留 slash command
  - TUI transport 要和 manager / gateway state 解耦
- 当前进展：已完成第一阶段简化重构：将原 `packages/terminal-ui` 的 dashboard 构建逻辑收回 `apps/tui/src/dashboard.ts`
- 当前进展：已建立交互式 `apps/tui`
- 当前进展：当前 TUI 支持 `/help`、`/status`、`/tasks`、`/workers`、`/clear`、`/quit`
- 当前进展：已支持直接输入自然语言 owner 需求
- 当前进展：默认视图已调整为 thread-first transcript，仅保留一行 compact status
- 当前进展：`submitOwnerMessage(...)` 已改成事件流驱动的 transcript 更新，不再等整轮 manager/worker 处理完再一次性刷出日志
- 当前进展：transcript 已具备最小 viewport / follow-tail 能力，可通过 `/pageup`、`/pagedown`、`/tail` 浏览历史与返回实时尾部
- 当前进展：已真实验证 `apps/tui` 可并发拉起多个 Codex worker，并完成结构化结果回写
- 当前进展：已具备全屏 alternate-screen 终端渲染骨架
- 当前进展：当前 TUI 默认由 `Codex manager runtime` 驱动，普通 owner 输入已可触发 manager action execution 和事件回显
- 当前进展：当前 TUI 默认以真实 `Codex worker` 为执行路径，真实执行失败时会显式报错并进入 blocked / follow-up
- 当前进展：已具备同一 terminal 会话内的 clarification continuity，owner 后续补充会被并入同一条需求链继续处理
- 当前进展：TUI 已具备最小 worker follow-through loop，manager 派工后可在同一对话内看到 `worker_started`、`worker_completed` 和 manager result summary
- 当前进展：`memory-system` 已增加 manager conversation memory，包含 conversation state、turn log 和 rolling summary
- 当前进展：TUI 已将对话线程落盘到 `~/.autoaide/threads/terminal-owner-local.jsonl`
- 当前进展：TUI 已将 task/memory/worker 状态快照落盘到 `~/.autoaide/snapshots/*.json`
- 当前进展：TUI 消息模型已开始携带 manager thread item type，不再只靠 `Ran / Edited / Explored` 这类显示标题表达结构
- 当前进展：`commandExecution`、`fileChange`、`webSearch` 已开始走专用渲染路径，而不是继续复用单一通用 step 模板
- 当前进展：transcript 已开始采用更接近 Codex 的 header 内联和消息空行分隔语法，减少自定义 dashboard / panel 感
- 当前进展：已增加 `/threads`，可查看 `~/.autoaide/threads/*.jsonl` 下的已保存线程，thread history 已开始可见
- 当前进展：已增加 `/resume <id>`，可切换到已保存 thread 并恢复对应 transcript 与状态
- 当前进展：`apps/tui` 已不再直接依赖 `manager-core` / `supervision-core`，改由 `manager-runtime` 统一暴露 manager overview / supervision policy 入口
- 当前进展：`packages/manager-runtime/src/` 已按 `runtime/`、`policy/`、`application/`、`contracts.ts` 正式拆层，`index.ts` 只保留稳定出口
- 当前进展：manager 的关键行为已显式投递到 TUI，包括 intent interpretation、clarification、plan creation、tool call emission 和 action execution
- 当前进展：manager 基于 conversation memory 的 follow-up decisions 已显式投递到 TUI，包括 waiting-owner 和 reviewing-result 两类后续动作
- 当前进展：worker 失败后的 blocked follow-up 也已显式投递到 TUI，owner 可直接看到任务为何被阻塞
- 当前进展：blocked 后的 replan 和 escalate-owner follow-up 也已显式投递到 TUI，owner 可看到 manager 的下一步处理意图
- 当前原则：一切关键 manager 行为都必须在 TUI 中可见，否则会损害 owner 对 manager 的信任
- 当前对齐结论：Codex 官方公开资料没有单独公布 `stepType` 枚举，但开源协议层存在 15 类 `ThreadItem`
- 当前对齐结论：`Ran / Edited / Explored / Waited` 这类是 TUI 渲染标题，不是协议层真枚举
- 当前策略：AutoAide 不机械照搬 15 类，而是先对齐 manager 真正需要的 thread item profile
- 当前限制：当前还缺少对 manager 首批 thread item 的完整覆盖，以及 Codex 风格的 step timeline、diff 渲染、tool-call block、thread/history 切换和 todo/progress 表达
- 当前进展：当前已切到 raw editor / keypress event loop，输入层不再依赖 readline question loop，owner 在任务执行期间仍可滚动 transcript 和继续编辑输入
- 当前进展：当前 editor 已支持 Tab slash completion、多行输入、Ctrl+P/Ctrl+N prompt history、Ctrl+A/Ctrl+E 光标移动、Ctrl+L 刷新和 Esc 清空输入
- 当前限制：当前还没有做到真正的 token-level assistant streaming，也还没有形成 Codex 风格的 tool block / diff block / todo timeline 组件体系

## Phase 8: 主动跟进系统

状态：`done`

任务：

- [x] 建立 overdue detector
- [x] 建立 blocked task detector
- [x] 建立 commitment reminder
- [x] 建立 cron supervision jobs

完成标准：

- manager 会主动盯住未完成事项
- 当前进展：已建立 `packages/supervision-core`
- 当前进展：已具备 overdue / blocked / follow-up due 检测
- 当前进展：已具备 commitment reminder 和 cron-style supervision job planning
- 当前进展：已具备 supervision cycle，可产出 alerts、actions 和 reminders
- 当前进展：已具备 supervision -> owner reply 分发链路
- 当前进展：已具备 supervision scheduler，可执行 due jobs 并驱动监督循环

## Phase 9: 稳健性与测试

状态：`in_progress`

任务：

- [x] 建立测试目录结构
- [x] 建立 task 状态机测试
- [x] 建立 assignment 状态机测试
- [x] 建立 restart recovery 测试
- [x] 建立 dedupe 测试
- [x] 建立 stalled / blocked / overdue 测试
- [x] 建立 channel 回报失败降级测试
- [x] 建立 migration / repair 回归测试
- [ ] 建立 milestone test gate 检查表

完成标准：

- 关键管理逻辑均有自动化测试覆盖
- 重启和异常场景可回归验证
- 当前进展：已补充跨模块 restart recovery 测试
- 当前进展：已补充 supervision reply dedupe 和 channel failure degradation 测试

---

## 当前优先级

### P0

- manager 的 tool-first 行为收口
- `owner-interface -> manager-runtime -> worker-orchestrator` 主链路稳定化
- Phase 9 稳健性与测试收口
- `autoaide tui` 的 first-value 路径
- 首次上手文档、TUI 引导和失败诊断的一致性
- manager 价值的可见性与可理解性
- Codex executor 生产化回归

### P1

- CEO-COO 多 workstream 控制面底座
- `workstream / manager session / manager inbox` 三个核心抽象
- scheduler / heartbeat 驱动的 manager wake loop
- CEO 对任意任务线的即时状态查询

### P2

- terminal UI 深度对齐 Codex/OpenClaw 风格
- manager 汇报与提醒优化
- 更完整持久化后端
- Telegram / Discord / Slack channel adapter
- 外部投递渠道上的格式优化

---

## 风险清单

### 风险 1：manager 和 worker 边界被打破

表现：

- manager 开始直接调用执行工具

防范：

- 从接口层禁止 manager 拥有执行能力

### 风险 1A：manager 被错误实现成规则引擎而不是管家 agent

表现：

- owner 以为自己在和管家对话，实际面对的是一堆硬编码 reply
- manager 无法持续追问、澄清和组织长期上下文

防范：

- 明确 `manager runtime` 必须是 `Codex-driven`
- `manager-core` 只保留结构化约束、记忆和调度能力
- 在文档、接口和实现上区分 `manager-runtime` 与 `manager-policy-core`

### 风险 2：任务系统退化成聊天历史

表现：

- 任务状态只存在 prompt 中，没有显式结构化存储

防范：

- 所有任务、assignment、承诺都必须结构化持久化

### 风险 3：worker 太多导致调度混乱

表现：

- 并发过高
- 没有 worker 生命周期约束

防范：

- 建立 worker registry、配额、超时、回收机制

### 风险 4：owner 看不到真实进度

表现：

- worker 实际在跑，但 manager 无法汇总或无法解释

防范：

- 强制 heartbeat 和 progress event 标准化

### 风险 5：terminal UI 退化成普通聊天窗

表现：

- 只剩普通聊天气泡，没有按 Codex `ThreadItem` 分层的 timeline、step、diff、tool-call 结构
- manager 的管理价值无法在本地界面里体现
- 看起来不像 Codex/OpenClaw，而像一个自制聊天壳

防范：

- terminal UI 必须以 thread transcript 为主轴
- 关键动作必须渲染成结构化 step，而不只是普通文本
- task / worker / alerts / reminders 作为按需展开视图，而不是默认主画面
- 聊天输入只是其中一个操作面，不是全部界面

### 风险 8：manager 过度依赖自由文本而不是 tool calls

表现：

- 普通问答也误触发任务编排
- 自然语言回复和真实状态改变混在一起
- owner 看不懂 manager 到底做了什么
- 测试和恢复都只能依赖文本猜测

防范：

- 加 owner intent gate
- 将 manager 高频职责收敛为 tool-first workflow
- 区分 owner 可见 tool calls 与内部 bookkeeping
- 让关键行为默认都可映射到 thread event 和状态变化

---

## Manager 专项对齐计划

这个专项用于把 manager 从“规则式任务路由器”推进到“经理式 agent”，并坚持以下约束：

- 尽量把判断交给大模型
- 本地代码只保留轻约束执行层
- manager 不直接获得 executor 权限
- owner-facing transcript 以经理判断和结果汇报为主，不退化成流水账

当前补充说明：

- 这条专项目前主要覆盖“单条任务线上的 manager 行为升级”
- 新的产品口径已经进一步升级为 `CEO -> COO -> multi-workstream control plane`
- 因此在 Phase 10 之后，需要追加一个更高层的 workstream / inbox / session tick 里程碑

## 依赖顺序重排

从当前仓库状态开始，后续开发顺序按真实依赖关系推进，而不再按历史写作顺序推进：

1. 先收口单条任务线的 manager tool-first 闭环。
2. 再补 first-value 路径和 milestone test gates。
3. 然后引入 `workstream` 抽象。
4. 再引入 `manager session` 和 `manager inbox`。
5. 然后实现 `session tick / wake loop`。
6. 最后再做 TUI/Rust TUI 的深度风格对齐和 channel 扩展。

当前建议的剩余主线顺序：

- 第一主线：`Phase 10A -> Phase 10B -> Phase 10C -> M9 -> M6B`
- 第二主线：`Phase 11A Workstream`
- 第三主线：`Phase 11B Manager Session + Inbox`
- 第四主线：`Phase 11C Session Tick + Wake Loop + CEO Query`
- 第五主线：`M7A / M7B / M7C` 体验精修
- 第六主线：channel 扩展

### Phase 10: Manager 经理式行为对齐

状态：`in_progress`

目标：

- 对齐 `manager` 的岗位定义、代码实现和 owner 体验
- 让 manager 的核心价值从“规则式派工”升级为“经理式判断 + 轻约束执行”
- 优先增强模型上下文和 tool contract，而不是增加本地 if/else

范围边界：

- 要做：增强 manager grounding、tool contract、follow-up turn、review turn、worker 画像
- 不做：把 manager 写成厚规则引擎
- 不做：让 manager 直接拿 executor 权限
- 不做：把 owner-facing transcript 退化成后台 bookkeeping 面板

### Phase 10A: 引用与合同升级

状态：`done`

任务：

- [x] `manager-runtime` 的 tool call 从 `taskTitle` 匹配升级为 `taskId` 优先、`taskTitle` 仅 fallback
- [x] 扩充 `assign_worker` 输入，增加 `deliverable`、`completionSignal`、`selectionReason`
- [x] 为 assignment 保留更完整的任务合同字段
- [x] 更新 manager prompt schema，使模型知道应优先输出稳定引用和任务合同
- [x] 补充回归测试，覆盖 title 漂移、task not found、taskId 优先命中

涉及文件：

- `packages/manager-runtime/src/contracts.ts`
- `packages/manager-runtime/src/runtime/codex.ts`
- `packages/manager-runtime/src/application/turn-execution.ts`
- `packages/task-system/src/index.ts`
- `packages/manager-runtime/src/index.test.ts`

完成标准：

- manager tool call 默认使用稳定 task 引用
- worker assignment 带有明确 objective / deliverable / completion signal
- 已有 “task not found” 类问题转化为可测的少数兜底路径

### Phase 10B: Worker 画像与模型选人

状态：`done`

任务：

- [x] 扩充 worker registry / memory snapshot，加入最近结果、最近任务类型、心跳年龄等摘要
- [x] 增强 `buildManagerGrounding()`，把选人所需信息暴露给 manager model
- [x] 保持本地代码只做最轻的 worker availability 校验，不内置复杂打分器
- [x] 让 prompt 明确要求 manager 优先复用合适的现成 worker，不合适时再创建新 worker
- [x] 为“复用 worker / 新建 worker”补充集成测试

涉及文件：

- `packages/task-system/src/index.ts`
- `packages/worker-orchestrator/src/index.ts`
- `packages/manager-runtime/src/policy/manager-state.ts`
- `packages/manager-runtime/src/runtime/codex.ts`
- `apps/tui/src/exec.ts`

完成标准：

- manager 能看到足够的 worker 画像信息做 staffing 判断
- 本地系统不再通过硬编码“第一个 idle worker”模拟经理判断
- 复用现有 worker 成为默认路径，而不是隐式偶然行为

### Phase 10C: Follow-up 与 Review Turn

状态：`in_progress`

任务：

- [x] 将 follow-up 从静态 receipt 升级为真正的 manager follow-up turn
- [x] 到达 follow-up 时间点时，重新调用 manager runtime，让模型决定 wait / nudge / replace / escalate
- [x] 新增轻量 orchestration actions，例如 `nudge_worker`、`replace_worker`、`mark_task_done`
- [x] worker 完成后默认进入 manager review，而不是由本地代码直接暗含完成
- [ ] 补充 stalled worker、blocked task、reviewing task 的集成测试

涉及文件：

- `packages/manager-runtime/src/contracts.ts`
- `packages/manager-runtime/src/policy/manager-state.ts`
- `packages/manager-runtime/src/application/turn-execution.ts`
- `apps/tui/src/exec.ts`
- `packages/owner-interface/src/index.ts`

完成标准：

- follow-up 的下一步动作由 manager model 判断
- manager 具备“催办、换人、升级、验收”四类基本管理动作
- owner 能看到高价值管理结论，而不是仅看到状态回显
- 当前进展：已具备自动 review/follow-up turn，但尚未升级为完整的 `session tick / wake loop`

### Phase 10D: AGENTS.md 与 CLI 对齐

状态：`pending`

任务：

- [ ] 将 manager 的岗位定义、沟通风格、授权边界沉到正式 `AGENTS.md`
- [ ] 对齐 `apps/tui` / `exec` 事件文案，让 transcript 更像经理汇报而不是工具流水账
- [ ] 明确最小 CLI/tool surface，避免 manager 通过冗余低层命令做过度细节编排
- [ ] 对齐主展示路径：`autoaide tui -> owner 提需求 -> manager 判断 -> worker 执行 -> manager 验收/汇报`

涉及文件：

- `AutoAide-manager-AGENTS草案.md`
- `apps/tui/src/exec.ts`
- `apps/tui/src/index.ts`
- `packages/manager-runtime/src/runtime/codex.ts`

完成标准：

- manager 行为规范和代码实现不再分裂
- transcript 主要体现经理判断、进展、风险和结论
- 首次体验路径能清楚展示 manager 的管理价值

### Phase 11: CEO-COO 多 Workstream 控制面

状态：`in_progress`

目标：

- 把 manager 从“单任务经理”升级成“多线程 COO”
- 让 CEO 可以同时交给 COO 多条任务线，并随时切换追问任意一条线
- 让 COO 被 worker result / heartbeat / follow-up due 主动唤醒，而不是只在 owner 新消息时工作

任务：

- [x] 引入 `workstream` 抽象，作为 CEO/COO 沟通和切换的第一对象
- [x] 引入 `manager inbox` 持久化 schema，作为 wake event 的存储基线
- [x] 引入 `runManagerSessionTick(sessionId, wakeReason)` 模型
- [x] 支持 CEO 对任意 workstream 的即时状态查询
- [x] 将现有 review/follow-up 自动补偿逻辑升级为 session-level wake loop

交付物：

- `AutoAide-CEO-COO多线程管理架构设计.md`
- workstream schema
- manager inbox schema
- session tick / wake reason 设计
- CEO 查询任意任务线的状态路径

完成标准：

- CEO 可同时管理多条线，不会把上下文混在单一 turn 里
- COO 可在任意时刻快速回答某条线状态
- worker 长时间无响应时，COO 会被 heartbeat / scheduler 唤醒再判断下一步

### Phase 11A: Workstream 抽象

状态：`in_progress`

任务：

- [x] 引入 `workstream` schema，作为 CEO/COO 沟通和切换的第一对象
- [x] 为 `task-system` 建立 `workstream` store / snapshot / restore 基线
- [x] 为 `memory-system` 建立 `workstream summary` 与最小查询接口
- [x] 建立 `task -> workstream` 关联关系在 owner-facing 主链路中的写入逻辑
- [x] 让现有 active task / conversation state 能稳定映射到 workstream

当前进展：

- `packages/task-system` 已具备 `Workstream`、`createWorkstream()`、store、snapshot、restore
- `packages/memory-system` 已具备 `WorkstreamSummary` 和 `searchWorkstreams()`
- `apps/tui/src/index.ts` 与 `apps/tui/src/exec.ts` 已在 owner 消息处理后同步 `activeWorkstreamId`
- conversation state 已开始持久化 `activeWorkstreamId` / `activeWorkstreamTitle`

完成标准：

- 系统可以稳定表达“这是一条独立任务线”
- CEO 追问某条线状态时，不需要再依赖模糊自然语言匹配

### Phase 11B: Manager Session 与 Inbox

状态：`in_progress`

任务：

- [x] 引入 `manager session` schema
- [x] 引入 `manager inbox` schema
- [ ] 将 `owner_message`、`worker_result`、`worker_heartbeat`、`followup_due`、`blocked_task` 统一成 wake event
- [x] 为 session / inbox 建立最小持久化边界

当前进展：

- `packages/memory-system` 已具备 `ManagerSessionRecord` 与 `ManagerInboxEvent`
- `InMemoryMemoryStore` 已支持 session / inbox 的 upsert、append、list 和 snapshot restore
- `apps/tui/src/index.ts` 与 `apps/tui/src/exec.ts` 已开始写入真实 wake event：
  - `owner_message`
  - `worker_result`
  - `blocked_task`
  - `followup_due`
- `stalled_assignment` 已进入 session-level wake source，manager 可在 assignment 长时间无心跳时被动发现异常
- `apps/tui/src/index.ts` 与 `apps/tui/src/exec.ts` 现已把 pending inbox event 接入 `session tick`，并在 tick 完成后标记为 `processed`
- 当前还缺 `worker_heartbeat` 写入

完成标准：

- manager 不再只是“收到一条消息跑一轮”
- 每次 manager 被唤醒都有明确的 session 和 wake reason

### Phase 11C: Session Tick 与 Wake Loop

状态：`in_progress`

任务：

- [x] 引入 `runManagerSessionTick(sessionId, wakeReason)`
- [~] 让 scheduler / heartbeat 唤醒 manager，而不是只在 owner 新消息时触发
- [x] 支持 CEO 对任意 workstream 的即时状态查询
- [x] 将 reviewing / blocked / follow-up due 的自动补偿逻辑迁入 session-level wake loop

当前进展：

- `apps/tui/src/index.ts` 与 `apps/tui/src/exec.ts` 已新增 session-level wake loop
- 已新增显式 `scheduler tick` 入口，可在没有 owner 新消息时扫描并写入 wake event
- 已新增本地 `scheduler loop`，TUI 与 exec 都可以周期性触发 manager wake loop
- CLI 已新增 `autoaide supervise`，可以以前台 supervisor/service 方式运行 manager scheduler
- `owner_message` 在主 manager turn 消费后会被标记为 `processed`
- `worker_result`、`blocked_task`、`followup_due`、`worker_heartbeat` 会被 `runManagerSessionTick(...)` 统一纳入 wake source
- `stalled_assignment` 现已进入同一条 wake loop，作为 heartbeat/scheduler 前的过渡检测源
- `reviewing / blocked / follow-up due` 不再只是局部补偿逻辑，而是通过 inbox event 驱动 manager 再次判断
- CEO 现在可以直接对 workstream 发起即时状态查询，系统会走本地快速状态路径而不是重新规划
- 当前还缺真正的后台守护进程与 install/start/stop 管理

完成标准：

- manager 成为真正持续在线的 COO control plane
- CEO 可以在多条并行任务线之间灵活切换追问
- worker 长时间无回复时，manager 会被主动唤醒并再次判断

---

## 文档索引

- [README.md](../../README.md)
- [AutoAide-文档索引.md](./AutoAide-文档索引.md)
- [AutoAide-架构设计.md](./AutoAide-架构设计.md)
- [AutoAide-开发计划.md](./AutoAide-开发计划.md)
- [AutoAide-任务与记忆系统设计.md](./AutoAide-任务与记忆系统设计.md)
- [AutoAide-测试计划.md](./AutoAide-测试计划.md)
- [AutoAide-Manager做事风格设计.md](../manager/AutoAide-Manager做事风格设计.md)
- [AutoAide-Manager轻约束落地方案.md](../manager/AutoAide-Manager轻约束落地方案.md)
- [AutoAide-CEO-COO多线程管理架构设计.md](../manager/AutoAide-CEO-COO多线程管理架构设计.md)

---

## 参考项目 

  OpenClaw文件夹： ~/Documents/GitHub/openclaw
---

## 更新记录

### 2026-03-15

- 按真实依赖关系重排后续开发顺序：先单线 manager 闭环，再多线程 COO 控制面
- 将 `Phase 10A`、`Phase 10B` 标记为完成
- 将 `Phase 10C` 明确为进行中，并记录自动 review/follow-up turn 已落地
- 将 `Phase 11` 标记为进行中
- 为 `Phase 11A` 补充当前进展：`workstream` 已进入 `task-system`、`memory-system`、`apps/tui`
- 新增 `Phase 11B` 与 `Phase 11C`，分别追踪 `manager session/inbox` 和 `session tick/wake loop`
- 同步修正文档索引路径到 `docs/` 结构

### 2026-03-12

- 建立首版开发计划
- 明确产品目标是 manager-first，不做实际执行
- 明确默认 worker 为 `Codex executor`
- 补充任务与记忆系统设计
- 补充测试计划
- 把稳健性纳入正式开发里程碑
- 建立 pnpm workspace、TypeScript 基线、最小 server 和基础测试
- 运行 `pnpm build` 和 `pnpm test`，当前 5 个测试通过
- 建立 `packages/task-system`，实现核心领域模型与状态迁移
- 运行 `pnpm build` 和 `pnpm test`，当前 10 个测试通过
- 为 `task-system` 增加最小内存 store 和基础查询接口
- 运行 `pnpm build` 和 `pnpm test`，当前 12 个测试通过
- 为 `task-system` 增加 snapshot/export/import 和 schema version 校验
- 运行 `pnpm build` 和 `pnpm test`，当前 14 个测试通过
- 为 `task-system` 增加创建校验、legacy migration 和 repair 基线
- 运行 `pnpm build` 和 `pnpm test`，当前 16 个测试通过
- 建立 `packages/memory-system`，实现 manager 记忆摘要和查询接口
- 运行 `pnpm build` 和 `pnpm test`，当前 19 个测试通过
- 为 `memory-system` 增加 project / worker / decision record 内存 store
- 为 `memory-system` 增加 schemaVersion、legacy migration 和 repair 基线
- 运行 `pnpm build` 和 `pnpm test`，当前 22 个测试通过
- 为 `memory-system` 增加 commitment 查询能力和 owner 视角检索
- 为 `memory-system` 增加 memory store contract 和 snapshot 恢复入口
- 运行 `pnpm build` 和 `pnpm test`，当前 24 个测试通过
- 为 `memory-system` 增加 snapshot repository contract 和 manager memory 持久化流程
- 运行 `pnpm build` 和 `pnpm test`，当前 25 个测试通过
- 为 `task-system` 增加 snapshot repository contract 和 restore/persist 流程
- 运行 `pnpm build` 和 `pnpm test`，当前 26 个测试通过
- 建立 `packages/manager-core`，实现最小 planner、scheduler 和 manager overview
- 为 `manager-core` 增加 blocked / overdue / stalled supervisor alerts
- 运行 `pnpm build` 和 `pnpm test`，当前 31 个测试通过
- 为 `manager-core` 增加 task graph updater 和结构化 escalation actions
- 运行 `pnpm build` 和 `pnpm test`，当前 33 个测试通过
- 建立 `packages/worker-orchestrator`，实现 worker registry、spawn 和 assignment routing
- 为 `worker-orchestrator` 增加 heartbeat / result 聚合和 stalled assignment 检测
- 运行 `pnpm build` 和 `pnpm test`，当前 39 个测试通过
- 建立 `packages/executor-codex`，实现 run contract、result schema 和 execution policy
- 为 `executor-codex` 增加 retry / cancel adapter 和 manager redaction
- 运行 `pnpm build` 和 `pnpm test`，当前 45 个测试通过
- 为 `executor-codex` 接通 orchestrator 执行回写链路
- 运行 `pnpm build` 和 `pnpm test`，当前 46 个测试通过
- 为 `executor-codex` 增加 run lifecycle registry、cancel controller 和 retry 基础设施
- 运行 `pnpm build` 和 `pnpm test`，当前 48 个测试通过
- 为 `executor-codex` 增加统一 execution entry，组合 lifecycle 和 manager view
- 运行 `pnpm build` 和 `pnpm test`，当前 49 个测试通过
- 为 `executor-codex` 增加 CLI invocation builder、result parser 和 command adapter
- 运行 `pnpm build` 和 `pnpm test`，当前 52 个测试通过
- 为 `executor-codex` 增加基于 Node 子进程的本地 command runner
- 运行 `pnpm build` 和 `pnpm test`，当前 54 个测试通过
- 为 `executor-codex` 增加命令结果解码层和异常路径映射
- 运行 `pnpm build` 和 `pnpm test`，当前 56 个测试通过
- 建立 `packages/owner-interface`，实现 owner ingress、channel contract 和 reply flow
- 运行 `pnpm build` 和 `pnpm test`，当前 60 个测试通过
- 为 `owner-interface` 接通 owner message -> work plan -> summary reply 的整合链路
- 运行 `pnpm build` 和 `pnpm test`，当前 61 个测试通过
- 建立 `packages/supervision-core`，实现 overdue / blocked / reminder / cron supervision 规则层
- 运行 `pnpm build` 和 `pnpm test`，当前 65 个测试通过
- 为 `owner-interface` 接通 supervision reminders / escalation replies 分发链路
- 运行 `pnpm build` 和 `pnpm test`，当前 67 个测试通过
- 为 `supervision-core` 增加 scheduler 抽象和 due-job 执行链路
- 运行 `pnpm build` 和 `pnpm test`，当前 68 个测试通过
- 为 `owner-interface` 增加 supervision reply dedupe 和 channel failure degradation
- 为 `worker-orchestrator` 增加跨模块 restart recovery 测试
- 运行 `pnpm build` 和 `pnpm test`，当前 71 个测试通过
