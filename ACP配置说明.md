# ACP 配置说明

这份文档讲的是 OpenClaw 里和 ACP 相关的常用配置，重点回答两个问题：

1. 怎么把 IDE 通过 `openclaw acp` 接到 Gateway。
2. 怎么让 OpenClaw 通过 ACP 去拉起 Codex、Claude、Gemini 这类外部 harness。

## 先区分两种 ACP 用法

OpenClaw 里常见的 ACP 有两条线：

- `openclaw acp`
  - 这是一个 ACP bridge。
  - 用途是让 Zed、Codex、Claude Code 这类 ACP client 通过 stdio 连到 OpenClaw Gateway。
- `runtime: "acp"` / `/acp ...`
  - 这是 OpenClaw 自己去启动 ACP harness session。
  - 常见目标是 `codex`、`claude`、`gemini`、`pi`、`opencode`、`kimi`。

如果你只是想“让 IDE 连 OpenClaw”，重点看下面的“场景 1”。

如果你是想“让 OpenClaw 在聊天里启动 Codex/Claude Code”，重点看“场景 2”。

## 场景 1：把 IDE 接到 OpenClaw ACP bridge

最小命令：

```bash
openclaw acp
```

如果 Gateway 是远程的：

```bash
openclaw acp --url wss://gateway-host:18789 --token-file ~/.openclaw/gateway.token
```

常用参数：

- `--url <url>`: Gateway WebSocket 地址
- `--token <token>`: 直接传 token，不推荐
- `--token-file <path>`: 从文件读取 token，推荐
- `--password <password>` / `--password-file <path>`: 如果你的 Gateway 走 password 鉴权
- `--session <key>`: 固定绑定某个 Gateway session key
- `--session-label <label>`: 按 label 绑定已有 session
- `--require-existing`: session 不存在就报错，不自动新建
- `--reset-session`: 首次使用前重置这个 session
- `--no-prefix-cwd`: 不把当前工作目录前缀塞进 prompt
- `--provenance off|meta|meta+receipt`: 是否携带 ACP 来源信息

推荐先把 Gateway 地址和 token 持久化：

```bash
openclaw config set gateway.remote.url wss://gateway-host:18789
openclaw config set gateway.remote.token <token>
```

之后 IDE 里只要跑：

```bash
openclaw acp
```

### 绑定到指定 agent

ACP bridge 自己不直接选 agent，它是靠 session key 路由的。

例如：

```bash
openclaw acp --session agent:main:main
openclaw acp --session agent:design:main
openclaw acp --session agent:qa:bug-123
```

## 场景 2：让 OpenClaw 启动 ACP harness

这类配置的核心在顶层 `acp` 和 `plugins.entries.acpx`。

推荐基线配置：

```json5
{
  acp: {
    enabled: true,
    dispatch: {
      enabled: true
    },
    backend: "acpx",
    defaultAgent: "codex",
    allowedAgents: ["pi", "claude", "codex", "opencode", "gemini", "kimi"],
    maxConcurrentSessions: 8,
    stream: {
      coalesceIdleMs: 300,
      maxChunkChars: 1200
    },
    runtime: {
      ttlMinutes: 120
    }
  }
}
```

字段说明：

- `acp.enabled`
  - ACP 总开关。
  - 设成 `false` 以后，ACP session 整体不可用。
- `acp.dispatch.enabled`
  - 是否允许普通消息路由进 ACP session。
  - 设成 `false` 时，一般 `/acp` 控制命令还能保留，但正常消息不会分发进去。
- `acp.backend`
  - 运行时后端，当前常见是 `acpx`。
- `acp.defaultAgent`
  - 当 `runtime: "acp"` 没显式传 `agentId` 时使用的默认 harness。
- `acp.allowedAgents`
  - 允许启动的 harness 白名单。
- `acp.maxConcurrentSessions`
  - 同时运行的 ACP session 上限。
- `acp.stream.coalesceIdleMs`
  - 流式输出合并空闲时间，越小越实时，越大越省碎片。
- `acp.stream.maxChunkChars`
  - 单次推送的最大文本块长度。
- `acp.runtime.ttlMinutes`
  - ACP runtime session 的 TTL，超时后会清理。

### `agentId` 可用值

如果你走的是 `acpx` backend，内置 alias 一般是这些：

- `pi`
- `claude`
- `codex`
- `opencode`
- `gemini`
- `kimi`

最稳妥的做法是把 `acp.allowedAgents` 和你实际要用的 alias 对齐。

## 场景 3：配置 `acpx` 插件

先安装并启用：

```bash
openclaw plugins install acpx
openclaw config set plugins.entries.acpx.enabled true
```

开发环境也可以直接装本地扩展：

```bash
openclaw plugins install ./extensions/acpx
```

建议再跑一次健康检查：

```text
/acp doctor
```

### `acpx` 插件常用配置

```json5
{
  plugins: {
    entries: {
      acpx: {
        enabled: true,
        config: {
          command: "acpx",
          expectedVersion: "any",
          cwd: "/path/to/workspace",
          permissionMode: "approve-all",
          nonInteractivePermissions: "deny",
          timeoutSeconds: 1800,
          queueOwnerTtlSeconds: 0.1
        }
      }
    }
  }
}
```

字段说明：

- `command`
  - `acpx` 可执行文件路径，也可以是命令名。
  - 不配时默认走插件自己的 bundled binary。
- `expectedVersion`
  - 期望版本。
  - 设成 `"any"` 表示不做严格版本匹配。
- `cwd`
  - ACP harness 的默认工作目录。
- `permissionMode`
  - 权限策略。
  - 可选值：`approve-all`、`approve-reads`、`deny-all`
- `nonInteractivePermissions`
  - 非交互场景下遇到权限请求的处理方式。
  - 可选值：`fail`、`deny`
- `timeoutSeconds`
  - 单次运行超时秒数。
- `queueOwnerTtlSeconds`
  - 队列 owner TTL。

### 权限配置怎么选

ACP session 是非交互的，没有 TTY 给你点批准，所以这里最容易踩坑。

默认行为大致是：

- `permissionMode = approve-reads`
- `nonInteractivePermissions = fail`

这意味着：

- 读文件通常没问题
- 写文件、执行命令如果触发权限提示，session 可能直接失败

常见两种配置：

1. 希望它能真干活，适合 Codex/Claude Code 改代码

```bash
openclaw config set plugins.entries.acpx.config.permissionMode approve-all
openclaw config set plugins.entries.acpx.config.nonInteractivePermissions deny
```

2. 希望保守一点，只允许读

```bash
openclaw config set plugins.entries.acpx.config.permissionMode approve-reads
openclaw config set plugins.entries.acpx.config.nonInteractivePermissions deny
```

如果你把 `nonInteractivePermissions` 设成 `fail`，那遇到无法弹窗确认的权限请求时，很可能直接报错退出。

## 场景 4：给某个 agent 固定 ACP runtime

如果你希望某个 OpenClaw agent 默认就走 ACP，可以这样配：

```json5
{
  agents: {
    list: [
      {
        id: "codex",
        runtime: {
          type: "acp",
          acp: {
            agent: "codex",
            backend: "acpx",
            mode: "persistent",
            cwd: "/workspace/openclaw"
          }
        }
      }
    ]
  }
}
```

这里的含义是：

- OpenClaw 的 agent id 是 `codex`
- 这个 agent 的底层 runtime 类型是 `acp`
- 真正启动的 harness alias 也是 `codex`

常用字段：

- `agents.list[].runtime.type = "acp"`
- `agents.list[].runtime.acp.agent`
- `agents.list[].runtime.acp.backend`
- `agents.list[].runtime.acp.mode`
- `agents.list[].runtime.acp.cwd`

## 场景 5：Discord / Telegram 线程绑定 ACP

如果你想在聊天线程里持续跑 Codex/Claude 这类 session，除了 `acp.enabled` 外，还要开 thread binding。

示例：

```json5
{
  session: {
    threadBindings: {
      enabled: true,
      idleHours: 24,
      maxAgeHours: 0
    }
  },
  channels: {
    discord: {
      threadBindings: {
        enabled: true,
        spawnAcpSessions: true
      }
    },
    telegram: {
      threadBindings: {
        enabled: true,
        spawnAcpSessions: true
      }
    }
  }
}
```

关键点：

- `session.threadBindings.enabled=true`
- Discord 需要 `channels.discord.threadBindings.spawnAcpSessions=true`
- Telegram 需要 `channels.telegram.threadBindings.spawnAcpSessions=true`

否则 `/acp spawn ... --thread auto` 这类流程可能起不来。

## 最小可用配置模板

如果你的目标是“先把 OpenClaw + ACP + Codex 跑起来”，可以先用这个：

```json5
{
  acp: {
    enabled: true,
    dispatch: { enabled: true },
    backend: "acpx",
    defaultAgent: "codex",
    allowedAgents: ["codex", "claude", "gemini"]
  },
  plugins: {
    entries: {
      acpx: {
        enabled: true,
        config: {
          permissionMode: "approve-all",
          nonInteractivePermissions: "deny"
        }
      }
    }
  }
}
```

## 排错

### `ACP runtime backend is not configured`

通常是 `acpx` 插件没装或者没启用。

检查：

```bash
openclaw plugins install acpx
openclaw config set plugins.entries.acpx.enabled true
```

### `ACP is disabled by policy (acp.enabled=false)`

说明 `acp.enabled` 被关掉了。

### `ACP dispatch is disabled by policy (acp.dispatch.enabled=false)`

说明 ACP 能存在，但普通消息不会继续分发到 ACP session。

### `ACP agent "<id>" is not allowed by policy`

说明你传入的 `agentId` 不在 `acp.allowedAgents` 里。

### `AcpRuntimeError: Permission prompt unavailable in non-interactive mode`

这基本就是 `acpx` 权限配置问题。

优先检查：

```bash
openclaw config set plugins.entries.acpx.config.permissionMode approve-all
openclaw config set plugins.entries.acpx.config.nonInteractivePermissions deny
```

然后重启 Gateway。

## 推荐配置建议

如果你现在只是想稳定用起来，我建议这样选：

- IDE 接 OpenClaw：优先用 `openclaw acp --token-file ...`
- OpenClaw 拉 Codex：`acp.backend=acpx`
- 默认 harness：`acp.defaultAgent=codex`
- 权限：`permissionMode=approve-all` + `nonInteractivePermissions=deny`
- 线程工作流：打开 `session.threadBindings.enabled` 和频道侧 `spawnAcpSessions`

## 相关原始文档

- `docs/cli/acp.md`
- `docs/tools/acp-agents.md`
- `extensions/acpx/src/config.ts`
- `src/cli/acp-cli.ts`
