# AutoAide CLI 与 TUI 使用指南

## 目标用法

`AutoAide` 的目标形态是安装后直接使用 CLI：

```bash
autoaide tui
```

也就是说，日常入口应该是：

- `autoaide help`
- `autoaide status`
- `autoaide tasks`
- `autoaide workers`
- `autoaide codex check`
- `autoaide tui`

## 当前两种使用方式

当前项目支持两种用法：

### 1. 安装后直接使用

开发期推荐先做全局 link：

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

安装完成后，直接输入：

```bash
autoaide help
autoaide status
autoaide tui
```

本地代码更新后刷新：

```bash
cd ~/Documents/GitHub/AutoAide
pnpm build
pnpm link --global
rehash
```

### 2. 在仓库里验证

如果你还在仓库开发阶段，可以用：

```bash
cd ~/Documents/GitHub/AutoAide
pnpm install
pnpm build
pnpm test
pnpm exec autoaide help
pnpm exec autoaide status
pnpm exec autoaide tui
```

## 顶层命令

当前 CLI 顶层命令包括：

- `autoaide help`
- `autoaide tui`
- `autoaide status`
- `autoaide tasks`
- `autoaide workers`
- `autoaide cron`
- `autoaide memory`
- `autoaide codex check`

## 常用命令说明

### `autoaide help`

查看顶层帮助：

```bash
autoaide help
```

### `autoaide status`

打印当前 operator dashboard：

```bash
autoaide status
```

当前会输出：

- `Overview`
- `Tasks`
- `Workers`
- `Alerts`
- `Reminders`

### `autoaide tasks`

只看任务区块：

```bash
autoaide tasks
```

### `autoaide workers`

只看 worker 区块：

```bash
autoaide workers
```

### `autoaide codex check`

检查 `Codex` 执行链路：

```bash
autoaide codex check
```

### `autoaide tui`

启动本地全屏 terminal UI：

```bash
autoaide tui
```

当前会进入一个全屏 TUI，包含：

- 对话优先的 manager terminal
- 一行 compact status
- 底部状态栏
- 命令输入区

## TUI 当前支持的命令

进入 `autoaide tui` 之后，目前支持：

- `/help`
- `/status`
- `/tasks`
- `/workers`
- `/clear`
- `/quit`

## 真实 Codex 验证

如果要验证真实 `Codex` 链路，也可以直接跑测试：

```bash
AUTOAIDE_REAL_CODEX=1 pnpm exec vitest run apps/tui/src/index.test.ts
AUTOAIDE_REAL_CODEX=1 pnpm exec vitest run packages/executor-codex/src/index.test.ts
```

## 当前已验证的能力

目前已经验证：

- 开发期全局 link 后 CLI 可以直接执行
- `autoaide help` 可正常输出
- `autoaide status` 可正常输出
- TUI 可以作为正式子命令启动
- `Codex` 连通性可以通过正式 CLI 子命令检查

## 当前还没完成的部分

当前 CLI/TUI 还没完成：

- 更成熟的长期 steward loop
- 更完整的命令树
- 真正的输入编辑器能力
- task detail panel
- 更长期的历史会话管理

## 故障排查

### 1. `autoaide` 命令不存在

说明当前环境里还没有安装好 CLI，或者 bin 没进入 `PATH`。

先确认你已经执行：

```bash
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"
cd ~/Documents/GitHub/AutoAide
pnpm build
pnpm link --global
rehash
```

然后再确认你是在：

- 安装后的环境里直接运行
- 或者仓库里用 `pnpm exec autoaide ...`

### 2. `codex` 命令不存在

先确认：

```bash
which codex
codex --version
```

### 3. `codex check` 失败

先确认登录态：

```bash
codex login status
```

再检查：

- 当前网络是否能访问 Codex 后端
- 本机是否存在临时 DNS / websocket 问题

## 推荐顺序

建议按这个顺序使用：

1. `autoaide help`
2. `autoaide status`
3. `autoaide codex check`
4. `autoaide tui`

如果你还在仓库里开发，就用：

1. `pnpm build`
2. `pnpm test`
3. `pnpm exec autoaide help`
4. `pnpm exec autoaide status`
5. `pnpm exec autoaide codex check`
6. `pnpm exec autoaide tui`
