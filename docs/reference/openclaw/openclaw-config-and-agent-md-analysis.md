# OpenClaw 配置系统与 Agent Markdown 机制分析

## 1. 结论概览

OpenClaw 里有两套不同的控制机制：

- `~/.openclaw/openclaw.json` 是强结构化配置系统
- `AGENTS.md` / `SOUL.md` / `TOOLS.md` / `USER.md` / `HEARTBEAT.md` / `SKILL.md` 等是 prompt/context 资料系统

它们的核心区别是：

- 配置文件通过 schema、校验、默认值、热重载来驱动程序行为
- Markdown 文件大部分不被程序“解释执行”，而是被注入给模型，由模型做语义理解

少量例外：

- `SKILL.md` 的 frontmatter 会被程序解析
- `IDENTITY.md` 会被程序做半结构化字段提取
- `AGENTS.md` 的特定标题段落会在 compaction 后被程序重新抽取注入

---

## 2. 配置文件系统的设计

### 2.1 入口与主干

配置主类型定义在：

- `src/config/types.openclaw.ts`

根 schema 在：

- `src/config/zod-schema.ts`

读取、写入、缓存、环境变量处理在：

- `src/config/io.ts`

校验逻辑在：

- `src/config/validation.ts`

也就是说，OpenClaw 的配置不是“读一个 JSON 然后散着用”，而是一条完整管线：

1. 读取 `~/.openclaw/openclaw.json`
2. 按 JSON5 解析
3. 解析 `$include`
4. 解析 `${ENV}`
5. 应用 shell env fallback / runtime override
6. 用 Zod schema 做强校验
7. 应用默认值和归一化
8. 缓存为运行时配置快照
9. 业务代码通过 `loadConfig()` 读取

### 2.2 配置格式特征

OpenClaw 的配置具备这些特征：

- 使用 JSON5，支持注释和尾逗号
- 配置对象有严格 schema
- 非法配置会 fail closed，而不是静默忽略
- 支持 secrets redaction / restore
- 支持 `config.get` / `config.set` / `config.patch` / `config.apply`
- 支持文件监听与热重载
- 插件和渠道可以扩展 schema

### 2.3 顶层配置域

`OpenClawConfig` 大致包含这些顶层域：

- `meta`
- `auth`
- `acp`
- `env`
- `wizard`
- `diagnostics`
- `logging`
- `cli`
- `update`
- `browser`
- `ui`
- `secrets`
- `skills`
- `plugins`
- `models`
- `nodeHost`
- `agents`
- `tools`
- `bindings`
- `broadcast`
- `audio`
- `media`
- `messages`
- `commands`
- `approvals`
- `session`
- `web`
- `channels`
- `cron`
- `hooks`
- `discovery`
- `canvasHost`
- `talk`
- `gateway`
- `memory`

它本质上已经是整个 OpenClaw runtime 的控制平面。

---

## 3. 配置能承载什么

### 3.1 `agents`

`agents` 是最核心的配置域之一，承载：

- 默认模型选择
- 图像 / PDF 模型
- workspace 路径
- bootstrap 注入长度限制
- 时间语义
- context pruning
- compaction
- embedded Pi 运行策略
- 默认 thinking / verbose / elevated
- timeout
- heartbeat
- 并发上限
- subagent 行为
- sandbox 行为
- 多 agent 列表

典型字段包括：

- `agents.defaults.model`
- `agents.defaults.imageModel`
- `agents.defaults.pdfModel`
- `agents.defaults.workspace`
- `agents.defaults.repoRoot`
- `agents.defaults.bootstrapMaxChars`
- `agents.defaults.bootstrapTotalMaxChars`
- `agents.defaults.userTimezone`
- `agents.defaults.timeFormat`
- `agents.defaults.contextPruning`
- `agents.defaults.compaction`
- `agents.defaults.thinkingDefault`
- `agents.defaults.timeoutSeconds`
- `agents.defaults.heartbeat`
- `agents.defaults.subagents`
- `agents.defaults.sandbox`
- `agents.list`

对应功能模块主要在：

- `src/agents/*`
- `src/auto-reply/*`
- `src/infra/heartbeat-runner.ts`
- `src/agents/pi-embedded-runner/*`
- `src/agents/sandbox/*`

### 3.2 `tools`

`tools` 决定 agent 可调用什么工具、以什么策略调用。

可承载的内容包括：

- 全局 allow / deny
- 工具 profile
- sender / group 级工具策略
- exec 工具的 host、安全模式、审批模式、safe bins
- browser/web/memory/media 等工具的策略

例如：

- `tools.allow`
- `tools.deny`
- `tools.profile`
- `tools.exec.host`
- `tools.exec.security`
- `tools.exec.ask`
- `tools.exec.node`
- `tools.exec.safeBins`

对应功能模块主要在：

- `src/agents/tool-policy.ts`
- `src/agents/pi-tools.ts`
- `src/agents/bash-tools.ts`
- `src/agents/tools/*`

### 3.3 `channels`

`channels` 决定 OpenClaw 与外部消息渠道如何连通。

能承载的内容包括：

- 各渠道启停
- token / password / webhook
- allowFrom
- DM / group 策略
- guild/channel/thread 级子配置
- per-channel model override
- 默认账号和默认发送目标

例如：

- `channels.telegram.*`
- `channels.discord.*`
- `channels.slack.*`
- `channels.signal.*`
- `channels.imessage.*`
- `channels.whatsapp.*`
- `channels.defaults.groupPolicy`
- `channels.modelByChannel`

对应功能模块主要在：

- `src/telegram/*`
- `src/discord/*`
- `src/slack/*`
- `src/channels/*`
- `src/channels/plugins/*`

### 3.4 `skills`

`skills` 负责 skill 的发现、过滤、安装与运行时限制。

能承载的内容包括：

- 扫描哪些目录
- 是否 watch
- prompt 上限
- 单个 skill 的启停
- skill 的 apiKey/env/config
- bundled allowlist

例如：

- `skills.load.extraDirs`
- `skills.load.watch`
- `skills.limits.maxSkillsInPrompt`
- `skills.limits.maxSkillsPromptChars`
- `skills.limits.maxSkillFileBytes`
- `skills.entries.<skillKey>.enabled`
- `skills.entries.<skillKey>.apiKey`
- `skills.entries.<skillKey>.env`
- `skills.entries.<skillKey>.config`

对应功能模块主要在：

- `src/agents/skills/workspace.ts`
- `src/agents/skills/frontmatter.ts`
- `src/gateway/server-methods/skills.ts`

### 3.5 `plugins`

`plugins` 是扩展机制，不只是启停开关，还能装载每个插件自己的配置 schema。

能承载的内容包括：

- 插件 enable 状态
- 插件 hooks 策略
- 插件自己的 config payload

例如：

- `plugins.entries.<pluginId>.enabled`
- `plugins.entries.<pluginId>.hooks.allowPromptInjection`
- `plugins.entries.<pluginId>.config`

对应功能模块主要在：

- `src/plugins/*`
- `src/config/schema.ts`
- `src/plugins/schema-validator.ts`

### 3.6 `gateway`

`gateway` 负责整个服务进程的运行行为。

能承载的内容包括：

- bind mode
- auth mode
- reload mode
- health check
- tailscale
- channel health monitor

对应功能模块主要在：

- `src/gateway/server.impl.ts`
- `src/gateway/config-reload.ts`
- `src/gateway/server-reload-handlers.ts`

---

## 4. 每条配置是怎么被调用的

OpenClaw 里的配置调用方式大致有四类。

### 4.1 启动基线配置

很多配置在系统启动时被读入，形成运行时基线。

典型读取点：

- `src/gateway/server-chat.ts`
- `src/gateway/server-cron.ts`
- `src/gateway/server-methods/*.ts`
- `src/infra/heartbeat-runner.ts`

这类配置通常影响：

- 默认模型
- 默认工具策略
- 默认渠道策略
- 并发、超时、sandbox

### 4.2 运行时动态读取

也有很多逻辑在执行时现读配置，因此配置修改后可以较快生效。

例如：

- heartbeat 执行时读取 `agents.defaults.heartbeat`
- 发消息时读取 `channels.*` / `messages.*`
- exec approval 流程读取 `approvals.*` / `tools.exec.*`
- 技能管理读取 `skills.*`

### 4.3 配置 API / CLI 写回

配置接口集中在：

- `src/gateway/server-methods/config.ts`

支持：

- `config.get`
- `config.set`
- `config.patch`
- `config.apply`
- `config.schema`

这个层面不是直接字符串替换，而是：

1. 读取 snapshot
2. 校验 base hash
3. 解析/恢复 redacted values
4. 重新校验 schema
5. 写回文件

### 4.4 热重载与重启

配置变化监听在：

- `src/gateway/config-reload.ts`

热重载处理在：

- `src/gateway/server-reload-handlers.ts`

它会根据改动路径决定：

- 直接热重载
- 重启某些 channel
- 延迟整个 gateway 重启

所以配置不只是“静态参数表”，还是进程生命周期管理的一部分。

---

## 5. Agent Markdown 文件是怎么读取的

### 5.1 workspace bootstrap 文件

默认 bootstrap 文件由 `src/agents/workspace.ts` 管理，包括：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`
- `memory.md`

读取链路大致是：

1. `loadWorkspaceBootstrapFiles()`
2. `filterBootstrapFilesForSession()`
3. `resolveBootstrapContextForRun()` in `src/agents/bootstrap-files.ts`
4. `buildBootstrapContextFiles()` in `src/agents/pi-embedded-helpers/bootstrap.ts`
5. `buildAgentSystemPrompt()` in `src/agents/system-prompt.ts`

### 5.2 这些文件读取时的保护与限制

读取时有这些机制：

- workspace boundary 防路径逃逸
- 文件大小限制
- 缺失文件显式标记
- 单文件长度限制
- 总注入长度限制
- hook 可覆盖或追加 bootstrap 文件

关键限制配置：

- `agents.defaults.bootstrapMaxChars`
- `agents.defaults.bootstrapTotalMaxChars`
- `agents.defaults.bootstrapPromptTruncationWarning`

### 5.3 session 类型对注入范围的影响

`filterBootstrapFilesForSession()` 会根据 session 类型裁剪。

对普通 session：

- 注入全部 bootstrap 文件

对 subagent / cron session：

- 仅保留最小白名单

当前代码里的最小白名单是：

- `AGENTS.md`
- `TOOLS.md`
- `SOUL.md`
- `IDENTITY.md`
- `USER.md`

这说明真实代码行为比部分文档里描述的更宽一些。

### 5.4 `HEARTBEAT.md` 的特殊位置

`HEARTBEAT.md` 既是普通 bootstrap 文件，又会被 heartbeat 逻辑特殊引用。

相关逻辑在：

- `src/infra/heartbeat-runner.ts`
- `src/auto-reply/heartbeat.ts`

默认 heartbeat prompt 会要求模型：

- 读取 `HEARTBEAT.md`
- 严格按其执行
- 如果无事可做则返回 `HEARTBEAT_OK`

这意味着：

- `HEARTBEAT.md` 本身不是程序规则文件
- 程序只是用 prompt 明确要求模型优先读它

---

## 6. `SKILL.md` 是怎么读取的

### 6.1 和 bootstrap 文件不同，skill 正文不是自动整包注入

skills 的发现和 prompt 构造主要在：

- `src/agents/skills/workspace.ts`

其机制不是“把所有 `SKILL.md` 全文塞进 prompt”，而是：

1. 扫描各个技能目录
2. 为每个技能生成摘要项
3. 形成 `<available_skills>` 列表
4. 告诉模型：如果判断某个 skill 适用，再用 `read` 工具去读该 skill 的 `SKILL.md`

相关 system prompt 逻辑在：

- `src/agents/system-prompt.ts`

也就是说：

- skill 的“存在、描述、路径”会提前给模型
- skill 的正文是按需读取

### 6.2 skill 的发现来源

OpenClaw 会从多个来源加载 skill，并按优先级覆盖：

- extra
- bundled
- managed
- `~/.agents/skills`
- `<workspace>/.agents/skills`
- `<workspace>/skills`

最终加载逻辑在：

- `src/agents/skills/workspace.ts`

### 6.3 skill prompt 也有硬限制

skills 侧也有 prompt 限制：

- `skills.limits.maxCandidatesPerRoot`
- `skills.limits.maxSkillsLoadedPerSource`
- `skills.limits.maxSkillsInPrompt`
- `skills.limits.maxSkillsPromptChars`
- `skills.limits.maxSkillFileBytes`

这些限制影响：

- 会扫描多少 skill
- 会给模型暴露多少 skill
- skill 列表 prompt 会不会被截断

---

## 7. 哪些 Markdown 内容是语义理解，哪些是形式化约束

### 7.1 纯语义理解的部分

这些文件的大部分正文内容都属于“语义型约束”：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `SKILL.md` 正文

对这类内容，程序通常只做两件事：

- 读取文件
- 注入 prompt，或者把文件路径告诉模型

真正的解释、归纳、执行，依赖模型本身。

这意味着：

- “你必须这样做”
- “这种情况要那样回应”
- “保持这种语气”
- “遇到某类任务优先检查某工具”

这些大多不是规则引擎执行，而是语言模型理解执行。

### 7.2 形式化约束的部分

真正会被程序稳定解析并影响行为的 Markdown 结构不多，主要有三类。

#### 第一类：`SKILL.md` frontmatter

解析逻辑在：

- `src/agents/skills/frontmatter.ts`

关键字段包括：

- `user-invocable`
- `disable-model-invocation`
- OpenClaw manifest 元数据块里的 `always`
- `skillKey`
- `primaryEnv`
- `os`
- `requires`
- `install`

这些字段不是语义参考，而是直接驱动程序逻辑。

例如：

- `disable-model-invocation: true`
  - skill 不进入模型可见的 skills prompt
- `user-invocable: false`
  - 不面向用户命令暴露
- `requires.env` / `requires.bins` / `requires.config`
  - 决定 skill eligibility
- `install`
  - 决定安装建议或安装流程

#### 第二类：`IDENTITY.md` 的半结构化字段

解析逻辑在：

- `src/agents/identity-file.ts`

程序会抓这些 label：

- `Name:`
- `Emoji:`
- `Creature:`
- `Vibe:`
- `Theme:`
- `Avatar:`

所以 `IDENTITY.md` 有双重用途：

- 给模型看，帮助形成 persona
- 给程序读，提取 agent identity 元信息

#### 第三类：`AGENTS.md` 的特定标题段

compaction 后的补充注入逻辑在：

- `src/auto-reply/reply/post-compaction-context.ts`

程序会从 `AGENTS.md` 里抽取特定 H2/H3 标题段，默认是：

- `Session Startup`
- `Red Lines`

兼容旧标题：

- `Every Session`
- `Safety`

这个过程不是语义搜索，而是标题匹配加文本截取。

---

## 8. OpenClaw 是否依赖“关键词抓取”

严格说，OpenClaw 对 agent markdown 的主机制不是关键词抓取，而是：

- 文件名级识别
- frontmatter 字段识别
- 少量标题识别
- 其余内容全部交给模型语义理解

所以如果要分类：

### 8.1 形式化识别

- 文件名：`AGENTS.md` / `SOUL.md` / `TOOLS.md` / `SKILL.md` / `HEARTBEAT.md`
- frontmatter key：如 `disable-model-invocation`
- 标题名：如 `Session Startup`
- `IDENTITY.md` 的 label 行：如 `Name:`

### 8.2 非形式化语义理解

- 人格说明
- 工作规则
- 行为边界
- 执行习惯
- 本地工具说明
- 用户偏好
- checklist 文本

这部分主要靠模型读懂，而不是程序枚举关键词触发动作。

---

## 9. 可以如何理解 OpenClaw 的整体分层

可以把它理解成三层：

### 9.1 硬配置层

也就是 `openclaw.json`。

特点：

- 有 schema
- 有默认值
- 可校验
- 可热重载
- 直接影响 runtime 行为

### 9.2 软配置层

也就是 workspace markdown。

特点：

- 主要是 prompt/context
- 以语义理解为主
- 用来定义 agent 的人格、习惯、规则和长期上下文

### 9.3 半结构化技能层

也就是 `SKILL.md`。

特点：

- 正文是软配置
- frontmatter 是硬约束
- 一部分由模型理解
- 一部分由程序执行

---

## 10. 最关键的代码入口

如果要继续深入，最值得优先读的文件是：

- `src/config/io.ts`
- `src/config/zod-schema.ts`
- `src/config/validation.ts`
- `src/config/types.openclaw.ts`
- `src/agents/workspace.ts`
- `src/agents/bootstrap-files.ts`
- `src/agents/pi-embedded-helpers/bootstrap.ts`
- `src/agents/system-prompt.ts`
- `src/agents/skills/workspace.ts`
- `src/agents/skills/frontmatter.ts`
- `src/agents/identity-file.ts`
- `src/auto-reply/reply/post-compaction-context.ts`
- `src/gateway/config-reload.ts`
- `src/gateway/server-reload-handlers.ts`

---

## 11. 一句话总结

OpenClaw 的设计不是“全部靠配置”，也不是“全部靠 prompt”，而是：

- 用 `openclaw.json` 管系统硬行为
- 用 workspace markdown 管 agent 软行为
- 用 `SKILL.md` frontmatter 在两者之间搭桥

因此在分析某个行为时，必须先判断它属于：

- 配置驱动
- prompt 驱动
- frontmatter/标题等半结构化驱动

否则很容易把“模型语义约束”误判成“程序规则约束”，或者反过来。
