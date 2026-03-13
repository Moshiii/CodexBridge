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

当前还不能展示：

- 更成熟的长期 steward loop
- 真实 channel 对话
- 更完整的持久化后端
- 长时间运行的生产级 manager session

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

- `owner`: 真人用户
- `manager`: 一个由 `Codex` 驱动的常驻管家 agent
- `worker`: 多个由 `Codex` 驱动的执行器
- `AutoAide core`: manager 与 worker 的记忆、任务图、调度、权限和监督底座

manager 对齐定义：

- `manager` 的使命：代表 owner 持续盯事，直到事情被推进、澄清、升级或完成
- `manager` 的职责：沟通、理解、规划、追问、派工决策、催办、升级、汇报
- `manager` 的业务范围：manager plane，不包含 execution plane
- `manager` 的能力边界：只能通过 orchestration contract 行动，不能直接获得执行权

关键原则：

- `manager` 不是一组写死规则
- `manager` 是一个受 `AutoAide` 结构化约束的 agent runtime
- `AutoAide` 不替代 manager 思考，而是约束 manager 的事实来源、权限边界和可恢复状态

## 当前策略调整

从当前阶段开始，交互优先级调整为：

- 第一优先级：`autoaide cli`
- 第二优先级：本地 `terminal UI`
- 第三优先级：稳健性与测试收口
- 第四优先级：channel adapter 实装

原因：

- `OpenClaw` 的交互入口首先是完整 CLI，而不是单独一个 TUI
- `AutoAide` 也需要先建立稳定的顶层命令树，才能承载后续 TUI、cron、worker、memory 等操作
- `AutoAide` 的安装目标形态应该是直接输入 `autoaide tui`，而不是依赖仓库内脚本
- `AutoAide` 当前最缺的是一个强管理感的本地 owner-facing manager terminal，而不是更多渠道外壳
- `OpenClaw` 的 TUI 证明了 terminal-first 可以先把状态、进度、反馈和操作密度做对
- channel 更适合作为 terminal UI 稳定后的投递层，而不是当前产品主界面

## 参考 OpenClaw CLI 的迁移判断

参考 `OpenClaw` 的 CLI 组织方式，`AutoAide` 下一步应先建立：

- 顶层 `autoaide` 命令
- 子命令分组
- 统一 help / runtime / command registration 结构

适合照搬的设计思路：

- 顶层命令树，而不是只有单个 `tui` 入口
- `tui` 作为一个子命令，而不是产品唯一入口
- `cron` 作为独立命令组
- `config` / `status` / `logs` 这类 operator-facing 命令组
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
- `AutoAide` 的核心不是多渠道设备平台，而是 manager-first orchestration system
- `AutoAide` 现阶段应该围绕任务、worker、记忆、监督、TUI 建立 CLI

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
| manager runtime | `in_progress` | 已建立 manager-runtime 包，默认走 `CodexManagerRuntime`，并已接入 conversation memory、memory grounding 与 orchestration tools contract |
| worker 编排 | `done` | 已建立 worker-orchestrator 包，具备 registry / assign / heartbeat / result / stalled 检测 |
| Codex executor 集成 | `done` | 已建立 executor-codex 包、统一执行入口、command adapter 和本地进程 runner，并已真实验证 Codex CLI 连通性 |
| owner-interface 基础 | `done` | 已建立 owner-interface 包和 owner -> manager -> reply 链路 |
| CLI 主入口 | `done` | 已建立 `apps/cli`，具备 `autoaide` 顶层命令、子命令注册与正式入口验证 |
| terminal UI | `in_progress` | 已建立 conversation-first 的 `apps/tui`，默认对接 `Codex manager` 与真实 `Codex worker`，但长期 steward loop 仍在补强 |
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

### M7. 本地 terminal UI 阶段

目标：

- 建立本地 terminal-first owner interface
- 让 owner 在一个沉浸式终端界面里直接和 manager agent 对话
- 把 manager 的计划/追问/汇报优先体现在对话界面里，而不是默认铺开的状态面板
- 让 task / worker / alerts / reminders 通过 slash 命令按需展开

交付物：

- terminal UI shell
- manager conversation loop
- compact status line
- command bar
- quick actions
- TTY / non-TTY 降级行为

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

状态：`pending`

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
- 当前限制：下一步重点是让 manager 更系统地利用长期会话记忆做持续 follow-up、replan 和 steward loop

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
- [x] 建立 `autoaide tasks`
- [x] 建立 `autoaide workers`
- [x] 建立 `autoaide cron`
- [x] 建立 `autoaide memory`
- [x] 建立 `autoaide codex`

完成标准：

- 安装后，用户可以像 `openclaw` 一样通过 `autoaide` 顶层命令进入系统
- 当前 TUI 不再只是 `pnpm tui` 脚本，而是正式挂到 `autoaide tui`
- manager-first 的核心能力都可以从 CLI 直接调用
- 当前进展：已建立 `apps/cli`
- 当前进展：已具备 `autoaide status / tasks / workers / cron / memory / codex / tui`
- 当前进展：已通过正式 CLI 入口验证 `status`、`codex check` 和 `tui`

推荐首批命令组：

- `autoaide tui`
- `autoaide status`
- `autoaide tasks`
- `autoaide workers`
- `autoaide cron`
- `autoaide memory`
- `autoaide codex`

当前明确不做的 OpenClaw 式命令组：

- `autoaide models`
- `autoaide channels`
- `autoaide devices`
- `autoaide pairing`
- `autoaide nodes`
- `autoaide browser`
- `autoaide dns`
- `autoaide sandbox`
- `autoaide plugins`

## Phase 7A: terminal-ui

状态：`in_progress`

任务：

- [x] 建立本地 terminal UI app shell
- [x] 建立 `task list` / `worker list` / `alerts` 主视图
- [x] 建立 owner -> manager 的自然语言输入入口
- [x] 将默认视图改为 conversation-first，状态信息压缩到一行
- [ ] 建立 command bar 和 quick actions
- [ ] 建立 manager summary panel
- [ ] 建立 TTY / non-TTY 降级行为
- [ ] 建立 palette / theme seam，避免样式散落
- [ ] 建立 ANSI-safe 表格和日志渲染边界
- [ ] 建立本地状态刷新与长任务 progress 呈现
- [x] 建立 manager 追问 / 澄清 / 继续派工的最小对话闭环

完成标准：

- owner 不依赖外部 channel，就能在本地 terminal 中直接与 manager agent 对话
- terminal UI 默认是对话沉浸式界面，而不是 dashboard
- task、worker、alerts、reminders 通过 slash 命令按需查看
- UI 交互层与 transport / orchestration 分离，不把业务逻辑塞进视图层
- 设计要求参考 OpenClaw：
  - 使用统一 palette / theme token，而不是零散硬编码颜色
  - progress 必须有 TTY / non-TTY 双路径
  - 表格和状态输出必须 ANSI-safe、可复制、可粘贴
  - 输入交互要优先支持和 manager 的自然语言对话，同时保留 slash command
  - TUI transport 要和 manager / gateway state 解耦
- 当前进展：已建立 `packages/terminal-ui`
- 当前进展：已具备 operator snapshot builder 和本地 dashboard renderer
- 当前进展：已建立交互式 `apps/tui`
- 当前进展：当前 TUI 支持 `/help`、`/status`、`/tasks`、`/workers`、`/clear`、`/quit`
- 当前进展：已支持直接输入自然语言 owner 需求
- 当前进展：默认视图已调整为 conversation-first，仅保留一行 compact status
- 当前进展：已真实验证 `apps/tui` 可并发拉起多个 Codex worker，并完成结构化结果回写
- 当前进展：已具备全屏 alternate-screen 终端渲染骨架，含 manager conversation panel
- 当前进展：当前 TUI 默认由 `Codex manager runtime` 驱动，普通 owner 输入已可触发 manager action execution 和事件回显
- 当前进展：当前 TUI 默认以真实 `Codex worker` 为执行路径，真实执行失败时会显式报错并进入 blocked / follow-up
- 当前进展：已具备同一 terminal 会话内的 clarification continuity，owner 后续补充会被并入同一条需求链继续处理
- 当前进展：TUI 已具备最小 worker follow-through loop，manager 派工后可在同一对话内看到 `worker_started`、`worker_completed` 和 manager result summary
- 当前进展：`memory-system` 已增加 manager conversation memory，包含 conversation state、turn log 和 rolling summary
- 当前进展：manager 的关键行为已显式投递到 TUI，包括 intent interpretation、clarification、plan creation、tool call emission 和 action execution
- 当前进展：manager 基于 conversation memory 的 follow-up decisions 已显式投递到 TUI，包括 waiting-owner 和 reviewing-result 两类后续动作
- 当前进展：worker 失败后的 blocked follow-up 也已显式投递到 TUI，owner 可直接看到任务为何被阻塞
- 当前进展：blocked 后的 replan 和 escalate-owner follow-up 也已显式投递到 TUI，owner 可看到 manager 的下一步处理意图
- 当前原则：一切关键 manager 行为都必须在 TUI 中可见，否则会损害 owner 对 manager 的信任
- 当前限制：下一步重点是让 manager 更系统地利用这层长期会话记忆做 follow-up 和 replan

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

- `autoaide cli` 主入口
- terminal UI 设计与实现
- Phase 9 稳健性与测试收口
- Codex executor 生产化回归

### P1

- 更完整持久化后端
- cron 主动跟进增强
- manager 汇报与提醒优化

### P2

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

- 只剩消息流，没有任务、worker、提醒三类核心状态面板
- manager 的管理价值无法在本地界面里体现

防范：

- terminal UI 必须先围绕 `task / worker / alerts / reminders` 组织
- 聊天输入只是其中一个操作面，不是全部界面

---

## 文档索引

- [README.md](./README.md)
- [AutoAide-架构设计.md](./AutoAide-架构设计.md)
- [AutoAide-开发计划.md](./AutoAide-开发计划.md)
- [AutoAide-任务与记忆系统设计.md](./AutoAide-任务与记忆系统设计.md)
- [AutoAide-测试计划.md](./AutoAide-测试计划.md)

---

## 更新记录

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
