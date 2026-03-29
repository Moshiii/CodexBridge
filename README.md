# AutoAide

AutoAide is a lightweight CLI-first personal AI shell.

It is designed around three ideas:

- the repo is the software install directory
- `~/.autoaide` is the runtime home
- `~/.autoaide/workspace` is the assistant's persistent working area

The current backend is Codex CLI. The product shape is intentionally thin so the backend can later be swapped for Gemini or Claude Code.

## Quickstart

```bash
git clone https://github.com/Moshiii/AutoAide.git
cd AutoAide
npm install
npm link
autoaide
```

If you do not want to use `npm link`, you can run:

```bash
npx autoaide
```

What happens when you run `autoaide`:

1. AutoAide ensures the single background daemon is running
2. the daemon manages Telegram and future channels
3. the CLI connects as an interactive shell

You can open multiple `autoaide` CLI windows.
They all reuse the same daemon and the same Telegram listener.

## What Happens On Install

`npm install` runs a setup script that creates:

```text
~/.autoaide/
  config.json
  bootstrap-state.json
  logs/
  telegram/
  workspace/
```

This is the product runtime home.

The repository root is not the assistant workspace and should not be treated as the place where the assistant thinks, stores memory, or runs day-to-day work.

Important runtime files:

```text
~/.autoaide/autoaide.pid
~/.autoaide/logs/daemon.log
~/.autoaide/telegram/bridge.pid
```

- `autoaide.pid`
  - the single background daemon
- `bridge.pid`
  - the single Telegram listener managed by that daemon

## First Launch

When you launch `autoaide` for the first time:

1. starter Markdown files are seeded into `~/.autoaide/workspace`
2. AutoAide checks whether bootstrap is actually complete
3. if not, it runs a short first-run conversation
4. your answers are written into workspace files like `IDENTITY.md`, `USER.md`, and `SOUL.md`

Seeding files does not count as bootstrap completion by itself.

## Telegram

Telegram is currently the first supported external channel.

Inside the CLI:

- `/channel` starts Telegram pairing
- `/status` shows the current model, runtime paths, daemon status, and Telegram status
- `/where` shows the current CLI session
- `/help` shows commands

Telegram is managed by the daemon, not by each individual CLI process.

That means:

- opening a second `autoaide` window does not create a second Telegram listener
- Telegram messages still route through the same background service
- one bot message should only be processed once

## Workspace Model

AutoAide uses `~/.autoaide/workspace` as a persistent context layer.

Today, the product uses these files in two ways:

- `AGENTS.md`
  - read natively by Codex when turns run inside `~/.autoaide/workspace`
- `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`
  - read by AutoAide and injected as workspace context before sending a turn to Codex

Bootstrap and long-term context files are also present in the workspace model:

- `BOOTSTRAP.md`
- `HEARTBEAT.md`
- `MEMORY.md`
- `memory/YYYY-MM-DD.md`

See [workspace-markdown-system.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/workspace-markdown-system.md) for the design.

## Current Product Shape

- CLI-first entrypoint via `autoaide`
- single background daemon per `~/.autoaide`
- Codex CLI as the execution backend
- thin session mapping instead of a custom agent runtime
- dedicated runtime home at `~/.autoaide`
- Telegram bridge managed by the daemon
- workspace Markdown seeded from built-in templates
- Codex started with `--skip-git-repo-check` so the workspace does not need to be a git repo

## Repo Map

- [bin/autoaide.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/bin/autoaide.mjs)
  - CLI entrypoint and daemon subcommand
- [src/cli.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/cli.mjs)
  - interactive shell
- [src/daemon.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/daemon.mjs)
  - single background daemon
- [src/launcher.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/launcher.mjs)
  - ensures the daemon is running before CLI startup
- [src/codex-runner.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/codex-runner.mjs)
  - Codex backend adapter
- [src/workspace-bootstrap.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/workspace-bootstrap.mjs)
  - first-run bootstrap and template seeding
- [src/workspace-context.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/workspace-context.mjs)
  - Markdown context loading and prompt assembly
- [plugins/telegram-codex/telegram-codex-bridge.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/plugins/telegram-codex/telegram-codex-bridge.mjs)
  - Telegram worker
- [docs/telegram-codex-bridge.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/telegram-codex-bridge.md)
  - Telegram bridge behavior
- [docs/telegram-always-on-agent-design.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/telegram-always-on-agent-design.md)
  - product direction
- [docs/workspace-markdown-system.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/workspace-markdown-system.md)
  - workspace Markdown model
- [docs/reference/templates](/Users/moshiwei/Documents/GitHub/AutoAide/docs/reference/templates)
  - starter Markdown templates
