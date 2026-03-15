# AutoAide

AutoAide is a digital adjutant for the owner.

It is designed to live inside chat surfaces such as Feishu, Telegram, WhatsApp, Slack, and Web, where it can hold context, coordinate workers, and keep work moving until there is a result.

AutoAide does not do execution work itself. It stays loyal to the owner, manages information, dispatches worker executors, tracks progress, and reports back through channels.

## Product Idea

AutoAide is built around a simple product shape:

- the owner talks to one persistent AI counterpart
- multiple people can talk to the same AutoAide in shared chats
- AutoAide keeps each person, thread, and task separate
- AutoAide routes concrete execution work to workers such as Codex
- AutoAide returns with progress, blockers, and results

In short:

- `owner`: gives goals, priorities, and approvals
- `manager`: a persistent Codex-driven butler agent that talks to the owner and manages work
- `AutoAide core`: the substrate that gives the manager memory, orchestration, supervision, and interfaces
- `worker`: the executor that does concrete work

## Current Status

The repository already has the core manager-side skeleton:

- task system
- memory system
- manager runtime and policy skeleton
- worker orchestrator
- minimal config/logging foundation
- a postponed minimal server placeholder for future web/channel ingress

The full owner-facing product experience is still in progress:

- real channel integrations are not complete
- real executor protocol integration is not complete
- long-running follow-up loops are still being built out

## CLI

The intended install shape is a direct CLI.

The default first-use path is:

```bash
autoaide tui
```

The intended minimal command surface is:

```bash
autoaide tui
autoaide exec "<goal>"
autoaide status
autoaide models
autoaide dashboard
autoaide stop
autoaide doctor
```

If the first real run fails, use:

```bash
autoaide doctor
```

The point of the product is to let the owner talk to the manager immediately, not to make diagnostics the primary entrypoint.

`apps/server` is intentionally postponed.
For current product and development work, default to `autoaide tui`.

For local development, use a global `pnpm link`:

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

After local code changes, refresh with:

```bash
cd ~/Documents/GitHub/AutoAide
pnpm build
pnpm link --global
rehash
```

Inside the repo, you can verify the same command surface with:

```bash
pnpm exec autoaide tui
pnpm exec autoaide help
pnpm exec autoaide status
```

## Docs

Start here:

- [Docs Index](./docs/core/AutoAide-文档索引.md)
- [Development Plan](./docs/core/AutoAide-开发计划.md)
- [Architecture](./docs/core/AutoAide-架构设计.md)
- [CEO-COO Multi-Workstream Architecture](./docs/manager/AutoAide-CEO-COO多线程管理架构设计.md)
- [Task and Memory Design](./docs/core/AutoAide-任务与记忆系统设计.md)
- [Testing Plan](./docs/core/AutoAide-测试计划.md)
