# AutoAide 基于 OpenClaw 的模块化迁移分析

## 结论

这个方向是合理的，但前提是你要把 `AutoAide` 定位成：

- 一个多渠道消息网关
- 一个调度与状态编排系统
- 一个 tools / cron / session / channel / multi-agent orchestration 平台
- 而不是一个“自己实现完整 agent runtime”的系统

如果目标是保留：

- 多智能体自动创建
- channel 能力
- cron 能力
- tools 调用能力

同时把“核心 Agent 执行”完全交给 Claude 或 Codex，那么工程上可行，但不适合用“删掉 OpenClaw agent 核心再直接接第三方 CLI”这种硬切方式实施。

更合理的做法是：

1. 保留 OpenClaw 的 `gateway + routing + sessions + channels + cron + tools surface + ACP orchestration`。
2. 把 `src/agents/pi-embedded-runner` 从“默认执行内核”降级为一个可替换 backend。
3. 在 `AutoAide` 里定义统一的 `AgentExecutor` / `ExecutionKernel` 接口。
4. 先接 `claude` / `codex` executor，再逐步剥离原生 OpenClaw agent runtime。

一句话说：

**合理，但应该做“执行内核替换”，不应该做“整块 agent 平面删除”。**

---

## 为什么这个方向合理

从你给的几篇文档合并看，OpenClaw 最稳定的系统边界其实不是“聊天 agent”，而是这四层：

1. Shell / CLI
2. Gateway / Messaging Plane
3. Routing / Sessions / State
4. Agent Execution Plane

其中真正适合复用到 `AutoAide` 的，是前 3 层，以及第 4 层里和工具、会话、调度相关但不依赖特定模型执行器的部分。

### 能长期保值的部分

- `src/gateway`
  - 这是系统编排层，不是某个模型专用逻辑。
- `src/channels` + 各渠道实现
  - 这是适配器资产，迁移价值很高。
- `src/routing` + `src/sessions`
  - 这是统一会话寻址层，是多渠道系统最难重新做对的部分。
- `src/cron`
  - 这是独立业务能力，和底层执行器可以解耦。
- `src/gateway/server-methods/*`
  - 这是控制面 API，天然适合被保留。
- `src/acp`
  - 这是 OpenClaw 已经存在的“外部 agent runtime 接入层”，非常适合当成替换执行内核的桥梁。

### 不一定要原样保留的部分

- `src/agents/pi-embedded-runner/*`
- `src/agents/model*.ts`
- `src/agents/auth-profiles/*`
- 大量 provider 兼容、fallback、prompt 构造、compaction、streaming 兼容逻辑

这些模块的核心价值在于：

- OpenClaw 自己跑 agent
- OpenClaw 自己选模型
- OpenClaw 自己管理 provider auth / failover / tool loop

如果 `AutoAide` 的策略改成：

- “让 Claude/Codex 成为主执行器”

那么这部分就不是产品核心了。

---

## 为什么这个方向也有明显风险

### 风险 1：你会失去 OpenClaw 自己对执行过程的细粒度控制

OpenClaw 当前的 `pi-embedded-runner` 不只是“调用模型”，它还负责：

- 工具回路
- provider 兼容
- fallback
- session 修复
- context compaction
- streaming assembly
- result truncation
- tool policy pipeline

如果交给 Claude/Codex，意味着这些控制权部分转移给外部 runtime。

结果是：

- 可控性下降
- 行为可预测性下降
- provider 独立性下降
- 调试复杂度上升

### 风险 2：OpenClaw 的 tools 体系和原生 agent runtime 绑定很深

现状不是“gateway 调一下 tool service”，而是很多链路直接依赖：

- `runEmbeddedPiAgent`
- `agentCommandFromIngress`
- `runReplyAgent`
- `createOpenClawCodingTools`

这意味着 channel / auto-reply / cron 并不是天然和执行器解耦的。

### 风险 3：多智能体自动创建不等于“多开几个 Claude/Codex 进程”

多智能体自动创建真正依赖的是：

- session key 体系
- agent identity
- spawn / focus / route / bind
- 生命周期管理
- 线程或会话绑定

这些是 OpenClaw 的 orchestration 资产，不是 Claude/Codex 自带能力。

所以你保留“多智能体自动创建”时，真正保留的是 OpenClaw 的 orchestration control plane，而不是它的 native LLM execution。

### 风险 4：如果你完全切到 Claude/Codex，产品会更像 vendor-hosted orchestration shell

这不是坏事，但要认清定位变化：

- 优点：开发快、能力强、代码少
- 缺点：强依赖第三方 agent 能力边界

---

## 最重要的判断

### 这个计划可以做

前提是你接受 `AutoAide` 变成：

- “OpenClaw orchestration shell + external agent kernels”

### 这个计划不适合直接做成“大规模删代码重写”

更好的路径是：

- 先抽象执行接口
- 再挂 Claude/Codex adapter
- 再把原生 runner 变成 fallback / legacy backend
- 最后再决定要不要彻底移除 native runtime

---

## 对 AutoAide 的推荐目标架构

建议 `AutoAide` 最终拆成 7 个 package / module。

```text
AutoAide
├── packages/core-config
├── packages/core-sessions
├── packages/gateway-core
├── packages/channel-runtime
├── packages/cron-runtime
├── packages/tool-runtime
├── packages/agent-contract
├── packages/agent-executor-acp
├── packages/agent-executor-codex
├── packages/agent-executor-claude
├── packages/plugins-sdk
└── apps/server
```

### 1. `core-config`

保留：

- config schema
- secrets / config loading
- runtime flags

### 2. `core-sessions`

保留：

- session key
- routing identity
- transcript / store
- thread bindings
- delivery target resolution

### 3. `gateway-core`

保留：

- transport
- server-methods dispatcher
- gateway auth / scopes
- health / logs / reload / ops

### 4. `channel-runtime`

保留：

- Discord / Telegram / Slack / Signal / WhatsApp / iMessage adapters
- channel lifecycle manager
- inbound/outbound normalization

### 5. `cron-runtime`

保留：

- cron store
- scheduler
- run queue
- delivery integration

### 6. `tool-runtime`

保留并重构：

- tool catalog
- tool policy
- tool execution wrappers
- sandbox / workspace boundaries

### 7. `agent-contract` + 各 executor

新建：

- `AgentExecutor` interface
- `NativeOpenClawExecutor`
- `AcpExecutor`
- `CodexExecutor`
- `ClaudeExecutor`

你的新世界里，核心不是 `pi-embedded-runner`，而是：

- 一个稳定的 `AgentExecutor` 契约

---

## 推荐的执行器接口

`AutoAide` 应该先定义统一契约，再迁移代码。

示意：

```ts
export interface AgentExecutor {
  id: string;
  canHandle(params: AgentRunRequest): boolean;
  run(params: AgentRunRequest): Promise<AgentRunResult>;
  abort(runId: string): Promise<void>;
  resume?(sessionId: string, params?: ResumeParams): Promise<AgentRunResult>;
}
```

配套输入输出：

```ts
export type AgentRunRequest = {
  sessionKey: string;
  agentId: string;
  prompt: string;
  attachments?: NormalizedAttachment[];
  toolContext: ToolExecutionContext;
  deliveryContext?: DeliveryContext;
  mode?: "reply" | "command" | "cron" | "acp";
};

export type AgentRunResult = {
  text?: string;
  payloads: ReplyPayload[];
  usage?: UsageSummary;
  toolCalls?: ToolCallRecord[];
  sessionMeta?: Record<string, unknown>;
};
```

这样以后：

- channel
- cron
- auto-reply
- gateway `agent` method

都不应该直接依赖 `runEmbeddedPiAgent`。

它们应该只依赖 `AgentExecutorRegistry.resolve(...).run(...)`。

---

## OpenClaw 到 AutoAide 的搬运原则

### 原则 1：优先搬“系统边界”，不要先搬“模型细节”

优先级应该是：

1. session / routing
2. gateway method dispatcher
3. channels
4. cron
5. tool surface
6. agent contract
7. claude/codex executor

而不是：

1. 先搬 `src/agents`
2. 再想办法删掉

### 原则 2：先做兼容层，再做替换

在 `AutoAide` 第一阶段，推荐：

- `NativeOpenClawExecutor` 先包住 `runEmbeddedPiAgent`
- `CodexExecutor` / `ClaudeExecutor` 并存
- 配置上允许 per-agent 或 per-session 选择 executor

这样可以逐步切流，不会一次性打碎现有逻辑。

### 原则 3：multi-agent orchestration 必须留在 AutoAide，不要外包给 Claude/Codex

你真正要保留的“多智能体自动创建”包括：

- agent identity
- session spawn
- session binding
- child session lifecycle
- thread focus / unfocus
- cron-to-agent orchestration

这部分属于 `AutoAide` 平台，不应该依赖第三方 agent CLI 自己管理。

---

## 具体代码搬运建议

下面按“建议原样迁移 / 建议抽取重构 / 建议放弃或后移”三类写。

### A. 建议优先原样迁移

#### 1. Gateway 控制面

- `src/gateway/server-methods.ts`
- `src/gateway/server-methods/*`
- `src/gateway/method-scopes.ts`
- `src/gateway/auth.ts`
- `src/gateway/startup-auth.ts`
- `src/gateway/protocol/*`

原因：

- 这是控制面能力总线
- 和底层具体 agent 执行器可以解耦

#### 2. Session / Routing

- `src/routing/*`
- `src/sessions/*`
- `src/config/sessions/*`
- 相关 session utils

原因：

- 这是多渠道系统最值钱的资产之一
- 重写风险很高

#### 3. Cron

- `src/cron/*`

原因：

- `cron` 是独立能力
- 只需要把最终执行入口换成 executor contract

#### 4. Channel adapters

- `src/telegram/*`
- `src/discord/*`
- `src/slack/*`
- `src/signal/*`
- `src/imessage/*`
- `src/web/*`
- `src/channels/*`

原因：

- 这是成熟接入资产
- 迁移成本低于重写

### B. 建议抽取后迁移

#### 1. Tools 层

重点文件：

- `src/agents/openclaw-tools.ts`
- `src/agents/pi-tools.ts`
- `src/agents/tool-policy.ts`
- `src/agents/tool-policy-pipeline.ts`
- `src/agents/tool-catalog.ts`
- `src/agents/sandbox/*`

原因：

- 这些能力有价值
- 但现在挂在 `agents` 目录下，语义上太像“原生 runner 的一部分”
- 实际上它们应该升级成 `tool-runtime`

建议动作：

- 把 tool definitions、tool policy、sandbox policy、workspace boundary 全部提到独立 package
- 让 Claude/Codex executor 通过统一 tool bridge 调用

#### 2. ACP 层

- `src/acp/*`
- `extensions/acpx/*`

原因：

- 这是接外部 agent runtime 的现成桥
- 对 `AutoAide` 非常关键

建议动作：

- 先保留 ACP 作为第一代 executor bridge
- `CodexExecutor` / `ClaudeExecutor` 优先通过 ACP 适配
- 不要第一版就直接手搓 CLI 交互协议

### C. 建议后移或放弃

#### 1. 原生 provider 编排层

- `src/agents/model.ts`
- `src/agents/model-selection.ts`
- `src/agents/model-fallback.ts`
- `src/agents/model-auth.ts`
- `src/agents/models-config*`
- `src/agents/auth-profiles/*`

原因：

- 如果核心执行交给 Claude/Codex，这部分不再是核心竞争力

建议：

- 第一阶段不要搬全量
- 只保留 executor 还需要的最小配置子集

#### 2. `pi-embedded-runner` 的大部分实现

- `src/agents/pi-embedded-runner/*`

原因：

- 这是原生 agent kernel
- 你的目标正是替换它

建议：

- 不要直接搬成核心模块
- 只做 `NativeOpenClawExecutor` 兼容层

---

## 哪些耦合必须先拆

这是整个计划最关键的工程点。

### 当前的主要耦合

从代码依赖看，下面几条链路都直接依赖原生 runner：

- `src/commands/agent.ts` -> `runEmbeddedPiAgent`
- `src/auto-reply/reply/*` -> `runEmbeddedPiAgent`
- `src/cron/isolated-agent/run.ts` -> `runEmbeddedPiAgent`
- `src/gateway/server-methods/agent.ts` -> `agentCommandFromIngress`

这说明：

- `channel`
- `cron`
- `gateway agent ingress`
- `auto-reply`

都默认把 `runEmbeddedPiAgent` 当成事实标准执行器。

### 要先拆成什么样

你需要先把下面这个接口层做出来：

```text
gateway / channel / cron / auto-reply
-> agent ingress service
-> executor registry
-> concrete executor (codex / claude / acp / native)
```

只要这层没出来，迁移就会陷入“表面模块化，实际还是绑死在 OpenClaw runner”。

---

## 推荐实施路径

### Phase 0：建立 AutoAide 新仓库骨架

目标：

- 建 monorepo 或多 package 结构
- 放入最小 app server
- 定义 package boundary

建议先建立：

- `packages/gateway-core`
- `packages/core-sessions`
- `packages/channel-runtime`
- `packages/cron-runtime`
- `packages/tool-runtime`
- `packages/agent-contract`
- `apps/server`

### Phase 1：先搬不依赖原生执行器的模块

先搬：

- config
- sessions
- routing
- gateway protocol
- server-methods dispatcher
- channel lifecycle manager
- cron store / scheduler

目标：

- 先让 `AutoAide` 成为一个“没有真正 agent 执行器，但已有控制面和状态面”的系统壳

### Phase 2：引入执行器接口，兼容 OpenClaw 原生 runner

新增：

- `AgentExecutor`
- `ExecutorRegistry`
- `NativeOpenClawExecutor`

动作：

- 把 `runEmbeddedPiAgent` 包进 `NativeOpenClawExecutor`
- 改掉 `agentCommand` / `runReplyAgent` / `cron isolated run` 的直接调用

目标：

- 先完成“逻辑入口和执行内核解耦”

### Phase 3：接入 ACP executor

新增：

- `AcpExecutor`

复用：

- `src/acp/*`
- `extensions/acpx/*`

目标：

- 通过 ACP 跑 `codex` / `claude` / `gemini`
- 让多智能体自动创建仍由 `AutoAide` orchestration 控制

### Phase 4：做 Codex / Claude 专用 executor

如果 ACP 足够稳定，这一步甚至可以延后。

如果要做专用 executor，建议它们仍然遵循：

- 统一 session contract
- 统一 tool bridge
- 统一 run result schema

目标：

- 外部执行器替换底层，不影响 gateway / channel / cron / tools / sessions

### Phase 5：清理原生 runner 依赖

此时再决定：

- 保留 `NativeOpenClawExecutor` 作为 fallback
- 或者从核心产品中移除

---

## 对多智能体自动创建功能的建议

你的需求里“保留多智能体自动创建”是完全可做的，但建议明确它属于哪一层。

它应该属于：

- `orchestration layer`

而不是：

- `Claude/Codex executor layer`

建议在 `AutoAide` 里保留：

- session spawn API
- session bind / thread bind
- parent-child session lineage
- focus / unfocus / close
- executor selection by policy

执行器只做：

- 跑这一轮任务
- 返回文本、工具调用、状态和错误

不要让 Claude/Codex 负责：

- session topology
- channel thread ownership
- cron ownership
- multi-agent lifecycle

---

## 对 tools 的建议

如果你要保留 tools，这里不能只保留“工具函数”，必须保留完整的：

- tool schema
- tool policy
- permission model
- sandbox / workspace boundary
- execution audit / result shaping

否则把工具交给外部 agent 后，你会失去平台层控制。

建议：

- `tool-runtime` 属于 `AutoAide`
- executor 只能通过 tool bridge 访问工具
- 不让 Claude/Codex 直接绕过平台去操作宿主环境

如果做不到这一点，系统很容易退化成：

- “一个渠道外壳 + 外部 CLI 代理”

这就不是你要的模块化平台了。

---

## 对 cron 的建议

`cron` 非常适合保留，而且应该尽量独立。

建议做法：

- 保留 `src/cron/*`
- 把当前 cron job 的最终执行入口改成 `ExecutorRegistry.run(...)`

也就是说：

- `cron` 不应该知道自己跑的是 native、Claude、Codex 还是 ACP

它只关心：

- schedule
- retry
- timeout
- delivery
- job state

---

## 对 channel 的建议

channel 层可以高度保留，但要注意不要把 agent runtime 逻辑继续埋在 channel handler 里。

目标依赖方向应该是：

```text
Channel Adapter
-> Inbound normalization
-> Session routing
-> Reply orchestration service
-> Agent ingress
-> Executor registry
```

不要保留成：

```text
Channel Adapter
-> runEmbeddedPiAgent
```

---

## 最小可行迁移方案

如果你想最快做出 `AutoAide` 第一版，我建议：

### 第一版保留

- Gateway
- Sessions / Routing
- Channels
- Cron
- ACP
- Tool policy + sandbox

### 第一版不做

- OpenClaw 全量 provider 兼容
- OpenClaw 原生完整 prompt / fallback / compaction 体系

### 第一版执行器

- `AcpExecutor`
- `CodexExecutor` 先通过 ACP 落地
- `ClaudeExecutor` 先通过 ACP 落地
- `NativeOpenClawExecutor` 仅作 fallback

这会是最稳、最省时间、同时最接近你目标的落地路径。

---

## 最终建议

如果我是按工程风险来排优先级，我会这样建议：

1. 不要把“删除 OpenClaw agent 核心”作为第一步。
2. 先把 OpenClaw 重构成“可插拔执行内核”。
3. 优先复用 `gateway + sessions + channels + cron + acp + tools policy`。
4. 让 `Claude/Codex` 成为 executor，而不是让它们接管整个平台。
5. `AutoAide` 的真正核心应该是 orchestration，不是模型调用本身。

最终判断：

**这个计划是合理的，而且从产品定位上看是更清晰的。**

但实施方式必须是：

**先抽象，再替换；先保留 orchestration，再外接 execution。**

而不是：

**先砍 runtime，再试图把 channel / cron / tools 拼回去。**

---

## 可执行的下一步

如果你接下来要继续推进，我建议下一份文档直接写成：

- `AutoAide 架构蓝图`

里面只做三件事：

1. 列出 package 边界
2. 列出每个 package 从 OpenClaw 搬哪些目录
3. 定义 `AgentExecutor` / `ToolBridge` / `SessionOrchestrator` 三个核心接口

这样就能直接进入实现阶段，而不是继续停留在概念讨论。
