# AutoAide

AutoAide 是面向 owner 的数字副官。

它被设计为运行在飞书、Telegram、WhatsApp、Slack 和 Web 等聊天界面中，在这些界面里它可以保持上下文、协调 worker，并持续推进工作直到产出结果。

AutoAide 本身不直接执行具体工作。它忠于 owner，负责管理信息、分派 worker 执行者、跟踪进度，并通过各类渠道回传结果。

## 产品构想

AutoAide 围绕一个简单的产品形态构建：

- owner 与一个持续存在的 AI 对应体对话
- 多个人可以在共享聊天中与同一个 AutoAide 对话
- AutoAide 会将每个人、每个线程和每项任务彼此隔离
- AutoAide 将具体执行工作路由给 Codex 等 worker
- AutoAide 返回进度、阻塞项和结果

简而言之：

- `owner`：给出目标、优先级和审批
- `manager`：由 Codex 驱动、持续存在的管家代理，负责与 owner 交流并管理工作
- `AutoAide core`：为 manager 提供记忆、编排、监督和接口能力的底层基座
- `worker`：执行具体工作的执行者

## 当前状态

这个仓库已经具备 manager 侧的核心骨架：

- 任务系统
- 记忆系统
- manager 运行时与策略骨架
- worker 编排器
- 最小配置与日志基础设施
- 一个已延期的最小 server 占位，用于未来的 web/渠道接入

完整的 owner 端产品体验仍在推进中：

- 真实的渠道集成尚未完成
- 真实的执行器协议集成尚未完成
- 长时运行的后续跟进循环仍在持续构建

## CLI

预期的安装形态是直接提供一个 CLI。

默认的首次使用路径是：

```bash
autoaide tui
```

预期的最小命令集合是：

```bash
autoaide tui
autoaide exec "<goal>"
autoaide status
autoaide models
autoaide dashboard
autoaide stop
autoaide doctor
```

如果首次真实运行失败，请使用：

```bash
autoaide doctor
```

这个产品的重点是让 owner 能立即与 manager 对话，而不是把诊断做成主要入口。

`apps/server` 被有意延后。
对于当前的产品和开发工作，默认使用 `autoaide tui`。

本地开发请使用全局 `pnpm link`：

```bash
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"
mkdir -p "$PNPM_HOME"

cd ~/Documents/GitHub/AutoAide
pnpm install
pnpm build
pnpm link --global
rehash
```

本地代码修改后，可通过以下命令刷新：

```bash
cd ~/Documents/GitHub/AutoAide
pnpm build
pnpm link --global
rehash
```

在仓库内部，你也可以通过以下命令验证同一套命令入口：

```bash
pnpm exec autoaide tui
pnpm exec autoaide help
pnpm exec autoaide status
```

## 文档

从这里开始：

- [Docs Index](./docs/core/AutoAide-文档索引.md)
- [Development Plan](./docs/core/AutoAide-开发计划.md)
- [Architecture](./docs/core/AutoAide-架构设计.md)
- [CEO-COO Multi-Workstream Architecture](./docs/manager/AutoAide-CEO-COO多线程管理架构设计.md)
- [Task and Memory Design](./docs/core/AutoAide-任务与记忆系统设计.md)
- [Testing Plan](./docs/core/AutoAide-测试计划.md)
