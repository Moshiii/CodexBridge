# AutoAide 保留可替代性的简化重构方案

## 目标

`AutoAide` 应该简化，但不能把真正重要的替换边界砍掉。

正确原则是：

- 保留未来可能替换的边界
- 合并只是为了概念完整而拆出来的层

一句话：

**做保留可替代性的简化，而不是无边界的大一统。**

## 必须保留的边界

### 1. `manager-runtime`

原因：

- 未来可能把 `Codex` 换成 `Claude Code`
- 也可能换成普通大模型 + tools

所以 manager runtime seam 必须保留。

### 2. `executor-runtime`

原因：

- worker 底座未来可能变化

当前至少要保留：

- `executor-codex`

未来可扩展：

- `executor-claude`
- `executor-generic`

### 3. `task + memory persistence`

原因：

- 你明确要支持跨设备恢复 manager 状态
- 也要支持把 memory 迁移到别的设备

所以必须保留：

- 领域状态模型
- snapshot / jsonl
- repository contract

### 4. `tool contract`

原因：

- 不管 manager runtime 是谁
- 最终都应通过同一套 manager tools 行动

## 可以收缩的部分

### 1. `terminal-ui`

当前只服务 `apps/tui`，不是独立替换边界。  
应吸收到 `apps/tui`。

### 2. `owner-interface`

当前更像：

- manager ingress/egress
- tool application layer
- follow-up glue

可逐步并入 `manager-runtime`。

### 3. `manager-core`

当前它是 policy layer，但和 `manager-runtime` 已经高度耦合。  
可保留概念，逐步收进 `manager-runtime/policy` 子层。

### 4. `supervision-core`

当前不是 first-value 核心。  
建议保留逻辑，但作为 manager policy 子层后置收拢。

### 5. `apps/server`

当前产品价值较低。  
建议后置，不作为当前主链路中心。

## 推荐目标结构

```text
packages/
  task-system
  manager-runtime
  worker-orchestrator
  executor-codex

apps/
  cli
  tui
```

## 分阶段重构顺序

### Phase 1

安全收缩：

- 吸收 `terminal-ui` 到 `apps/tui`

### Phase 2

收紧 `owner-interface`：

- 逐步把 manager ingress/egress 和 tool application 收进 `manager-runtime`

### Phase 3

把 `manager-core` / `supervision-core` 变成 `manager-runtime` 内部子层

### Phase 4

重新评估 `apps/server`

## 当前建议

当前状态：

- Phase 1 `terminal-ui -> apps/tui`：`done`
- Phase 2 `owner-interface -> manager-runtime`：`done`
- Phase 3 `manager-core / supervision-core -> manager-runtime`：`done`
- Phase 4 `apps/server` 重新评估：`done`

现在最适合立即执行的是：

1. 保持 `manager-runtime` / `executor-codex` / `task-system` 的替换边界不动
2. 保持 app 层继续只通过 `manager-runtime` 进入 manager plane，不回流直接依赖
3. 保持 `apps/server` 作为未来 web/channel ingress 的后置入口，不再把它当作当前主链路中心
