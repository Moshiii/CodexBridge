# AutoAide 测试计划

## 目标

这份文档定义 `AutoAide` 的测试策略，目标是确保系统具备：

- 稳健性
- 可恢复性
- 可审计性
- 管理逻辑正确性

`AutoAide` 的测试重点不是“回答是否聪明”，而是：

- 任务是否会丢
- 状态是否会错
- 调度是否会乱
- worker 异常时系统是否还能稳住

---

## 测试原则

### 原则 1：优先验证状态机和数据一致性

对 `AutoAide` 来说，最重要的是：

- task 状态对不对
- assignment 生命周期对不对
- commitment 有没有漏

### 原则 2：优先验证恢复能力

manager 系统如果重启就忘事，这个项目就不成立。

### 原则 3：优先验证异常路径

worker 卡住、超时、断连、重复回报，这些比 happy path 更重要。

### 原则 4：LLM 行为尽量 mock，系统行为必须可测

测试重点应该放在：

- orchestration
- persistence
- supervision
- channel flow

而不是把智能表现当成主要测试对象。

### 原则 5：每个里程碑都要有明确测试 gate

不能等系统基本做完再补测试。

每个 milestone 进入 `done` 之前，必须满足预先定义的最低测试门槛。

---

## 测试层次

建议拆成 5 层。

### 1. 单元测试

覆盖：

- task 状态机
- assignment 状态机
- heartbeat timeout 计算
- overdue 检测
- dedupe 逻辑
- reassign 逻辑
- memory 索引与过滤

目标：

- 每个纯逻辑模块都能独立验证

### 2. 存储测试

覆盖：

- task store 读写
- assignment store 读写
- progress event append
- restart 后恢复
- 并发写入保护

目标：

- 结构化状态不会损坏

### 3. 服务集成测试

覆盖：

- manager 创建任务并分派 worker
- worker 回报 heartbeat / complete / blocked
- manager 更新任务和承诺
- scheduler 发现 stalled / overdue 并触发 follow-up

目标：

- 管理闭环成立

### 4. Channel 集成测试

覆盖：

- owner 从 channel 发起任务
- manager 回报进展
- clarification / approval 流程

目标：

- owner interface 工作正常

### 5. 端到端测试

覆盖：

- owner 提交目标
- manager 拆任务
- worker 执行
- manager 汇总并回报
- 系统重启后继续跟进

目标：

- 真实使用链路可用

---

## 核心测试对象

### A. task-system

必须测试：

- 新任务创建
- 父子任务拆分
- 状态流转
- 阻塞与取消
- 任务关闭

### B. memory-system

必须测试：

- task memory 写入与读取
- commitment 记录与兑现
- project memory 搜索
- worker memory 更新
- 重启后恢复

### C. worker-orchestrator

必须测试：

- spawn worker
- worker status 更新
- heartbeat 丢失
- 重复回报去重
- worker reassign
- worker cancel

### D. manager-core

必须测试：

- 目标拆解
- 派工决策
- blocked 路由
- overdue 跟进
- 汇总输出

### E. channel-bridge

必须测试：

- owner message ingress
- owner summary delivery
- 重复消息去重
- channel routing 正确性

---

## 关键异常场景

这些是必须覆盖的高优先级异常场景。

### 1. worker 启动失败

期望：

- assignment 标记失败
- task 回到 `planned` 或 `blocked`
- manager 能决定重试或换人

### 2. worker 运行中断

期望：

- heartbeat 超时后进入 stalled 检测
- manager 发起 follow-up
- 不会把任务误判为 done

### 3. worker 重复回报完成

期望：

- manager 去重
- 不重复关闭任务

### 4. owner 重复发送同一任务

期望：

- 系统可 dedupe 或提示复用现有任务

### 5. 系统重启

期望：

- 未完成 task 不丢
- 未完成 commitment 不丢
- 运行中 assignment 恢复为可监督状态

### 6. channel 发送失败

期望：

- 回报进入重试或待发队列
- 任务状态不应因此损坏

### 7. scheduler 重复触发

期望：

- follow-up 动作幂等
- 不会重复 spam owner

---

## 测试数据设计

建议准备标准 fixture。

### 基础 fixture

- 一个 owner
- 一个 project
- 三个 tasks
- 两个 workers
- 一个 overdue commitment

### 异常 fixture

- heartbeat 丢失的 worker
- blocked 的 assignment
- 重复 completion event
- 部分损坏但可恢复的 store

---

## 测试环境建议

### 本地快速测试

用途：

- 单元测试
- 纯逻辑集成测试

要求：

- 全部 mock worker / mock channel

### 仿真测试环境

用途：

- manager + worker + channel 集成

要求：

- worker 用 fake codex adapter
- channel 用内存桥

### 真实集成测试

用途：

- 验证真实 `Codex executor`
- 验证真实 channel

要求：

- 单独测试套件
- 严格控量
- 日志完整

---

## 覆盖重点

### P0 必测

- 任务创建、状态流转、关闭
- assignment 生命周期
- heartbeat timeout
- blocked / overdue 检测
- restart recovery
- dedupe

### P1 必测

- owner ingress -> manager -> worker -> manager -> owner 完整链路
- channel 回报正确性
- worker reassign
- commitment follow-up

### P2 可后补

- 更复杂的多 worker 并发策略
- 更复杂的搜索质量
- 更复杂的记忆摘要质量

---

## 里程碑测试 Gate

### M1 Gate

必须通过：

- workspace / package 编译测试
- 基础配置加载测试
- 基础 logger 初始化测试

### M2 Gate

必须通过：

- `Task` 状态机测试
- `Assignment` 状态机测试
- `ProgressEvent` 追加测试
- `Commitment` 基础状态测试

### M3 Gate

必须通过：

- worker spawn / status / cancel 测试
- heartbeat timeout 测试
- stalled / blocked 检测测试
- reassign 测试

### M4 Gate

必须通过：

- fake codex adapter 集成测试
- worker result schema 测试
- worker failure / timeout 测试

### M5 Gate

必须通过：

- owner ingress 测试
- owner summary delivery 测试
- message dedupe 测试

### M6 Gate

必须通过：

- overdue follow-up 测试
- commitment reminder 测试
- cron supervision 去重测试

### M7 Gate

必须通过：

- restart recovery 测试
- corruption repair / quarantine 测试
- channel failure degradation 测试
- idempotency regression 测试

---

## 工程基线建议

建议从第一版开始固定：

- Node.js 22+
- TypeScript ESM
- `pnpm`
- `vitest`
- colocated `*.test.ts`
- `tests/e2e` 存放端到端专项测试

命令建议：

- `pnpm build`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm check`

---

## 建议的测试目录

```text
tests/
├── unit/
│   ├── task-system/
│   ├── memory-system/
│   ├── manager-core/
│   └── worker-orchestrator/
├── integration/
│   ├── manager-worker/
│   ├── persistence/
│   ├── scheduler/
│   └── channel-bridge/
└── e2e/
    ├── owner-to-manager-to-worker/
    └── restart-recovery/
```

---

## 通过标准

进入下一阶段前，至少要满足：

1. 关键状态机测试通过。
2. restart recovery 测试通过。
3. 重复事件去重测试通过。
4. stalled / blocked / overdue 监督测试通过。
5. owner 不会因为系统错误而“丢任务”。

---

## 当前建议

在 `AutoAide` 早期阶段，测试优先级要高于功能广度。

宁可少做一些功能，也要先把下面几件事做稳：

- 不丢任务
- 不乱派工
- 不忘承诺
- 不把失败伪装成完成
