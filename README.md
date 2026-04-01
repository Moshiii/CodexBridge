```text
  ▒▓██████▓▒  ▒▓█▓▒  ▒▓█▓▒ ▒▓████████▓▒ ▒▓██████▓▒   ▒▓██████▓▒  ▒▓█▓▒ ▒▓███████▓▒  ▒▓████████▓▒  
 ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒    ▒▓█▓▒    ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒         
 ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒    ▒▓█▓▒    ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒         
 ▒▓████████▓▒ ▒▓█▓▒  ▒▓█▓▒    ▒▓█▓▒    ▒▓█▓▒  ▒▓█▓▒ ▒▓████████▓▒ ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓██████▓▒    
 ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒    ▒▓█▓▒    ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒         
 ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒    ▒▓█▓▒    ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒ ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒         
 ▒▓█▓▒  ▒▓█▓▒  ▒▓██████▓▒     ▒▓█▓▒     ▒▓██████▓▒  ▒▓█▓▒  ▒▓█▓▒ ▒▓█▓▒ ▒▓███████▓▒  ▒▓████████▓▒ 
```

# AutoAide

Turn Codex into a persistent assistant you can actually work with.

AutoAide gives Codex a home, a shell, and a workspace you can come back to.

Instead of starting from scratch every time, you get a persistent local setup with:

- a dedicated runtime home at `~/.autoaide`
- a persistent workspace at `~/.autoaide/workspace`
- a single background daemon for Telegram and future channels
- a thin execution layer instead of a heavy custom agent runtime

It is built for one thing first:

> make a strong model feel like a usable personal assistant instead of a one-off chat session

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

## Why AutoAide

Strong models are useful.
Most of them still feel temporary.

AutoAide is for people who want to keep working with the same assistant instead of starting over every time.

It does that with:

- a stable runtime home
- a persistent workspace
- a shell you can return to
- a daemon that can manage channels like Telegram

## Features

- CLI-first entrypoint via `autoaide`
- single background daemon per `~/.autoaide`
- Codex CLI as the execution backend
- dedicated runtime home at `~/.autoaide`
- persistent workspace Markdown seeded from built-in templates
- Telegram bridge managed by the daemon
- thin session mapping instead of a custom agent runtime
- Codex launched with `--skip-git-repo-check` so the workspace does not need to be a git repo

## Requirements

Before you start, you need:

- Node.js `>=22`
- Codex CLI installed and available as `codex`
- a local shell environment

Telegram is optional unless you want to pair an external channel.

## Core Model

It is designed around three ideas:

- the repo is the software install directory
- `~/.autoaide` is the runtime home
- `~/.autoaide/workspace` is the assistant's persistent working area

The current backend is Codex CLI. The product shape is intentionally thin so the backend can later be swapped for Gemini or Claude Code.



## How It Works

When you run `autoaide`:

1. AutoAide ensures the daemon is running
2. the daemon owns Telegram and future always-on channels
3. the CLI session connects as a local shell
4. turns are executed through Codex
5. persistent context lives in `~/.autoaide/workspace`

The product stays thin on purpose:

- AutoAide manages runtime, workspace, and channel surfaces
- Codex remains the execution core
- Markdown files provide stable, editable context

## Current Status

AutoAide is early, but already usable.

Implemented now:

- runtime home creation on install
- first-run workspace seeding
- bootstrap flow for identity and user setup
- CLI shell
- single daemon process
- Telegram pairing and listener management
- Codex-backed execution with session resume

Not fully built yet:

- richer progress streaming
- stronger first-task onboarding
- broader channel support
- deeper memory maintenance flows

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

The repository root is the software install directory.
It is not the assistant workspace.

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

AutoAide uses `~/.autoaide/workspace` as its persistent context layer.

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

## Architecture

AutoAide currently has three main layers:

1. install repo
2. runtime home
3. execution backend

The rough shape is:

```text
repo/
  software and source

~/.autoaide/
  daemon state
  logs
  telegram state
  workspace/
    markdown context

Codex CLI
  execution backend
```

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

## Design Notes

- [docs/telegram-codex-bridge.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/telegram-codex-bridge.md)
  - smallest working Telegram-to-Codex bridge
- [docs/telegram-always-on-agent-design.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/telegram-always-on-agent-design.md)
  - always-on channel direction
- [docs/workspace-markdown-system.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/workspace-markdown-system.md)
  - workspace Markdown context model
- [docs/cli-visual-identity.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/cli-visual-identity.md)
  - CLI visual identity
- [docs/cli-logo-blur-fill-animation.md](/Users/moshiwei/Documents/GitHub/AutoAide/docs/cli-logo-blur-fill-animation.md)
  - startup logo animation notes

## Roadmap Direction

The current direction is:

- keep the product thin
- improve first-run onboarding
- make task execution more legible
- strengthen Telegram as an always-on channel
- preserve the workspace Markdown model as the persistent context layer
