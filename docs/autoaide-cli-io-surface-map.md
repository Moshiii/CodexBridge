# AutoAide CLI I/O Surface Map

## 一、文档目的

这份文档用于穷举 AutoAide 当前 CLI 与 in-shell 的输入输出面。

它回答的问题是：

- 用户现在到底能输入什么
- 每种输入会触发什么代码路径
- 每种输入可能产生哪些输出
- 当前 CLI 与 in-shell 的能力边界在哪里

这份文档描述的是：

- 当前代码现状

而不是：

- 理想中的未来产品形态

## 二、总览

当前 AutoAide 的用户输入面一共分为两层：

1. 系统 shell 层
   - 例如 `autoaide bot show default`

2. AutoAide 交互 shell 层
   - 例如在 `autoaide:default>` 里输入 `/status` 或普通文本

## 三、系统 shell 层输入

入口文件：

- [autoaide.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/bin/autoaide.mjs)

### 3.1 `autoaide`

输入：

```bash
autoaide
```

行为：

- 启动交互式 CLI
- 自动检查当前 bot
- 可能自动启动已配置且启用的当前 bot runtime

输出可能包括：

- 启动 banner
- bootstrap 提示
- 交互式 prompt

### 3.2 `autoaide web ...`

支持输入：

- `autoaide web`
- `autoaide web run`
- `autoaide web status`
- `autoaide web stop`
- `autoaide web restart`

可选参数：

- `--host <host>`
- `--port <port>`

输出可能包括：

- `AutoAide control plane web running at ...`
- web runtime 状态 JSON
- stop/restart 结果

### 3.3 `autoaide skills ...`

支持输入：

- `autoaide skills`
- `autoaide skills list`
- `autoaide skills install <zip-or-path>`

输出可能包括：

- skills 列表
- 安装结果
- usage 错误

### 3.4 `autoaide bots`

支持输入：

- `autoaide bots`

输出：

- 所有 bot 的 JSON 列表

### 3.5 `autoaide bot ...`

支持输入：

- `autoaide bot create <id> [--name <name>] [--enabled true|false]`
- `autoaide bot show <id>`
- `autoaide bot use <id>`
- `autoaide bot current`
- `autoaide bot run <id>`
- `autoaide bot start <id>`
- `autoaide bot stop <id>`
- `autoaide bot restart <id>`
- `autoaide bot enable <id>`
- `autoaide bot disable <id>`
- `autoaide bot delete <id>`
- `autoaide bot logs <id>`
- `autoaide bot config <id>`
- `autoaide bot set-config <id> --json '<json>'`
- `autoaide bot health <id>`

输出可能包括：

- bot JSON
- health JSON
- logs JSON
- pid / stopped 状态 JSON
- usage 错误

### 3.6 `autoaide rollout ...`

支持输入：

- `autoaide rollout restart-all`
- `autoaide rollout canary --bots <id1,id2> --version <version>`
- `autoaide rollout rollback <id> --to <version>`

输出可能包括：

- rollout 结果 JSON
- usage 错误

## 四、进入交互 shell 后的输入分类

交互 shell 入口：

- [cli.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/cli.mjs)

prompt 形式：

```text
autoaide:<botId>>
```

进入交互 shell 后，所有输入只分成四类：

1. 空行
2. slash command
3. 普通文本
4. `/channel` 或 bootstrap 流程中的回答性输入

## 五、空行输入

输入：

- 空字符串
- 仅空格

行为：

- 忽略

输出：

- 无

## 六、交互 shell slash commands

当前 in-shell 支持的命令如下。

### 6.1 `/help`

输入：

```text
/help
```

输出：

- Commands 列表卡片

### 6.2 `/bots`

输入：

```text
/bots
```

输出：

- bot 列表卡片

### 6.3 `/bot`

支持输入：

- `/bot`
- `/bot list`
- `/bot create <id> [name]`
- `/bot use <id>`
- `/bot show [id]`

输出可能包括：

- bot 列表
- Bot Created
- Bot Switched
- Bot Show
- usage 错误
- Bot Create Failed
- Bot Switch Failed
- Bot Show Failed

### 6.4 `/channel`

输入：

```text
/channel
```

行为：

- 进入 channel onboarding 子流程

输出可能包括：

- Available Channels
- Telegram Pairing
- Feishu Setup
- Channel Selection error

### 6.5 `/home`

输入：

```text
/home
```

输出：

- `Switched to main.`

### 6.6 `/sessions`

输入：

```text
/sessions
```

输出：

- 当前本地 session 列表

说明：

- 这是当前代码现状
- 不代表未来产品建议保留

### 6.7 `/skills`

支持输入：

- `/skills`
- `/skills list`
- `/skills install <zip-or-path>`

输出可能包括：

- skills 列表
- skill install 结果
- usage 错误
- install failed

### 6.8 `/new <label>`

输入：

```text
/new research
```

输出可能包括：

- 切换到新 session
- usage 错误

说明：

- 当前代码保留
- 未来产品决策建议移除用户侧 session 管理能力

### 6.9 `/switch <label>`

输入：

```text
/switch research
```

输出可能包括：

- 切换成功
- Unknown Session
- usage 错误

### 6.10 `/status`

输入：

```text
/status
```

输出：

两块状态卡：

1. `AutoAide Status`
2. `Run State`

当前可能显示的字段包括：

- home
- bot
- workspace
- bootstrap state
- runtime pid file
- telegram state
- feishu state
- active channel
- owner user id
- admin count
- model
- bootstrap completed
- active session
- bot runtime online
- telegram paired
- telegram bridge online
- feishu enabled
- feishu bridge online
- feishu app id
- feishu mention required
- Telegram private/group access 相关字段

### 6.11 `/where`

输入：

```text
/where
```

输出：

- 当前 session 的简要信息卡

### 6.12 `/stop`

输入：

```text
/stop
```

输出可能包括：

- `Stop requested for <session>.`
- `No running task for <session>.`
- `Unable to stop <session>.`

### 6.13 `/restart`

输入：

```text
/restart
```

输出：

- `Restarting bot <id>...`
- `Runtime Restarted`

### 6.14 `/exit`

输入：

```text
/exit
```

行为：

- 退出 CLI

输出：

- 无额外结果卡，直接结束交互

### 6.15 未知 slash command

输入：

```text
/whatever
```

输出：

- `Unknown Command`

## 七、普通文本输入

在交互 shell 中，任何不是 slash command 的输入都会被当作一次普通 Codex turn。

例如：

```text
summarize this repo
```

### 7.1 正常情况

行为：

- 基于当前 active session 构建 workspace prompt
- 启动一次本地 Codex turn

输出：

- 最终正常回答文本

### 7.2 当前 session 正在运行

行为：

- 不启动新 turn

输出：

- `Session Busy`
- 提示先 `/stop`

### 7.3 执行失败

输出：

- `Turn Failed`

### 7.4 运行中被 `/stop`

输出可能包括：

- stop 请求成功提示
- 后续 turn 异步返回中断结果

## 八、`/channel` 子流程输入输出穷举

`/channel` 是当前交互 shell 中最复杂的多步输入流程。

### 8.1 第一步：选择 channel

输入可能是：

- 空
- `1`
- `telegram`
- `2`
- `feishu`
- 任意其他值

输出可能是：

- Telegram 配对流程
- Feishu 配置流程
- `Unknown channel selection.`

### 8.2 Telegram 配对流程

后续输入：

- `Telegram bot token:`
- 然后按回车确认你已经去 Telegram 发过消息

输出可能包括：

- Telegram Pairing 引导卡
- Pausing current bot runtime 提示
- `Now send one message to your bot in Telegram...`
- `Telegram Paired`
- `Telegram Pairing Failed`
- `Pairing cancelled.`

成功时当前还会写入：

- `ownerUserId`
- `adminUserIds`

### 8.3 Feishu 配置流程

后续输入：

- `Feishu app id:`
- `Feishu app secret:`

输出可能包括：

- Feishu Setup 引导卡
- Feishu Checklist
- `Feishu Enabled`
- `Feishu Setup Failed`
- `Setup cancelled.`

成功时当前会尝试自动识别：

- `ownerUserId`
- `adminUserIds`

识别来源：

- 飞书应用信息接口 `creator_id`

## 九、bootstrap 流程输入

首次启动或 bootstrap 未完成时，还存在一类特殊输入：

- bootstrap 问答输入

这些输入的用途是：

- 写入 `IDENTITY.md`
- 写入 `USER.md`
- 写入 `SOUL.md`
- 完成 bootstrap state

输出可能包括：

- Bootstrap Pending 提示
- bootstrap 问答引导
- bootstrap 完成后的提示

## 十、当前所有输出类型穷举

从表现形式看，当前 CLI / in-shell 的输出基本只有以下几种：

### 10.1 Banner

例如：

- 启动 banner

### 10.2 Key-value card

例如：

- `AutoAide Status`
- `Run State`
- `Bot`
- `Telegram Paired`
- `Feishu Enabled`

### 10.3 List card

例如：

- Commands
- Bots
- Sessions
- Skills
- Feishu Checklist

### 10.4 Message card

例如：

- Turn Failed
- Unknown Command
- Pairing Failed
- Session Busy
- Bot Switch Failed

### 10.5 Raw text / Codex final text

例如：

- 普通 Codex 回答
- 安装结果文本
- usage 文本

### 10.6 JSON

仅出现在系统 shell 层命令中，例如：

- `autoaide bot show ...`
- `autoaide bots`
- `autoaide bot health ...`
- `autoaide web status`

## 十一、当前 CLI 的“隐藏状态依赖”

虽然用户只看到输入输出，但当前 CLI 实际还依赖这些内部状态：

- 当前 bot
- 当前 bot config
- 当前 active session
- 当前 running turn map
- 当前 runtime pid
- bootstrap state

因此同一条命令在不同内部状态下会输出不同结果。

例如 `/stop`：

- 没有任务时输出 `No running task`
- 有任务时输出 `Stop requested`

例如 `/channel`：

- 有运行中 runtime 时先尝试停 runtime
- 无运行中 runtime 时直接进入 pairing / setup

## 十二、当前 CLI 现状与未来方向的差异

这里需要明确一点：

当前 CLI 仍然保留明显的“用户可见 session 管理能力”，包括：

- `/home`
- `/new`
- `/switch`
- `/sessions`

这属于当前代码现状。

但根据最新产品决策，这些能力未来应逐步从用户产品面移除，转为：

- session 仅作为内部路由实现细节存在

所以本文件的结论是“现状穷举”，不是“最终产品建议”。

## 十三、总结

当前 AutoAide CLI / in-shell 的所有用户输入，本质上可以完整归纳为：

1. 系统 shell 外部命令
2. 交互 shell slash commands
3. 交互 shell 普通文本
4. `/channel` onboarding 参数输入
5. bootstrap 问答输入

而所有输出则可以归纳为：

1. banner
2. key-value 状态卡
3. list 列表卡
4. message 错误/结果卡
5. 普通文本回答
6. JSON

这就是当前 AutoAide CLI I/O Surface 的完整轮廓。

