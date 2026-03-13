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
- manager core
- worker orchestrator
- supervision core
- minimal server and config/logging foundation

The full owner-facing product experience is still in progress:

- real channel integrations are not complete
- real executor protocol integration is not complete
- long-running follow-up loops are still being built out

## CLI

The intended install shape is a direct CLI:

```bash
autoaide help
autoaide status
autoaide tui
```

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
pnpm exec autoaide help
pnpm exec autoaide status
pnpm exec autoaide codex check
pnpm exec autoaide tui
```

## Docs

- [Pitch Deck](./AutoAide-定位与发现.md)
- [Architecture](./AutoAide-架构设计.md)
- [Development Plan](./AutoAide-开发计划.md)
- [Product Comparison](./AutoAide-vs-OpenClaw-优劣势对比.md)
- [Task and Memory Design](./AutoAide-任务与记忆系统设计.md)
- [Testing Plan](./AutoAide-测试计划.md)
- [TUI Guide](./AutoAide-TUI使用指南.md)
