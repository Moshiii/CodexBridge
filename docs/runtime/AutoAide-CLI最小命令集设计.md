# AutoAide CLI 最小命令集设计

## Status

Draft

## Purpose

这份文档定义 AutoAide 对外暴露的最小 CLI 命令面。

核心原则：

- 顶层命令必须少
- 主体验必须集中
- 大部分交互细节应收进 TUI
- 不把 thread/run/agent 内部操作全铺成顶层命令

## Command List

`autoaide tui`：进入交互式 manager TUI，作为主入口。  
`autoaide exec`：以非交互方式把一个目标交给 manager 执行，适合脚本、CI 和快速调用。  
`autoaide status`：查看当前 AutoAide 系统摘要状态。  
`autoaide models`：列出当前已挂载、可用的 LLM / agent kernels。  
`autoaide dashboard`：为未来 GUI / dashboard server 预留入口。  
`autoaide stop`：停止当前本地 AutoAide manager / supervisor 服务。  
`autoaide doctor`：检查本地环境、kernel、配置、状态目录和依赖。

## Why Only These

这组命令的设计逻辑是：

- `tui`
  - owner 的主入口
- `exec`
  - 非交互脚本入口
- `status`
  - operator 摘要入口
- `models`
  - kernel 可用性入口
- `dashboard`
  - GUI 演进入口
- `stop`
  - 生命周期管理入口
- `doctor`
  - 诊断入口

它们分别覆盖了：

- 交互
- 自动化
- 观测
- 内核
- GUI 预留
- 关停
- 排障

## What Should Not Be Top-Level

下面这些能力不建议作为顶层命令暴露：

- `threads`
- `resume`
- `new`
- `runs`
- `run`
- `logs`
- `inspect`
- `agents`
- `tasks`
- `workers`
- `cron`
- `memory`
- `codex`

这些要么：

- 过早暴露内部实现
- 增加用户心智负担
- 更适合做成 TUI 内部 slash command / picker / overlay

## TUI-Internal Operations

以下内容建议收进 TUI：

- thread 新建与恢复
- transcript 浏览
- run 列表
- run inspection
- logs tail
- agent profile 选择
- debug / inspect views

也就是说，TUI 应承担一部分原本可能放在 CLI 顶层的交互复杂度。

## Command Semantics

## `autoaide tui`

作用：

- 进入交互式 Rust TUI
- 作为 owner 主要入口
- 承载 thread/runs/inspect 等二级交互

## `autoaide exec`

作用：

- 向 manager 提交一次性目标
- 适合脚本和批处理

建议形式：

```bash
autoaide exec "review this repo and tell me the next step"
```

## `autoaide status`

作用：

- 查看本地 AutoAide 是否正在运行
- 查看当前 manager 摘要
- 查看当前是否存在活跃 supervisor session

注意：

- `status` 只应给摘要，不应变成 detailed dashboard

## `autoaide models`

作用：

- 列出当前已挂载的 kernels / models / adapters
- 显示默认 kernel
- 显示可用性和健康状态

它解决的问题是：

- “现在到底挂了哪些 LLM 内核”
- “默认用的是哪个”

## `autoaide dashboard`

作用：

- 作为未来 GUI / dashboard server 的统一入口
- 当前可以只是保留命令面和占位说明

## `autoaide stop`

作用：

- 停止当前本地 AutoAide manager / supervisor 运行实例
- 用于退出常驻模式或后台服务

注意：

- 这是停系统，不是停单个 subagent run
- 单个 run 的 stop 更适合放进 TUI 或内部工具

## `autoaide doctor`

作用：

- 检查本地环境是否可运行
- 检查 kernels 是否可用
- 检查状态目录/日志目录
- 检查配置与依赖

## Design Decision

如果只保留一句口径：

**AutoAide CLI should expose only the system surface; workflow detail belongs inside the TUI.**

## Recommended Next Step

后续实现时，应同步做两件事：

1. 顶层 CLI 只保留这 7 个命令
2. 把原本计划暴露为顶层的 `threads/runs/inspect/logs` 全部转进 TUI slash commands
