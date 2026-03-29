# AutoAide

This repository now contains a lightweight CLI-first AutoAide prototype.

## Quickstart

```bash
git clone <this-repo>
cd AutoAide
npm install
npm link
autoaide
```

This opens the interactive CLI.

After `npm install`, AutoAide creates a local working area at:

```bash
~/.autoaide/
~/.autoaide/workspace/
~/.autoaide/logs/
~/.autoaide/telegram/
```

Important:

- the repository root is the install/source directory only
- `~/.autoaide/workspace` is the AI assistant working directory
- `~/.autoaide/telegram` stores Telegram offsets and session-routing state
- AutoAide should operate inside `~/.autoaide/workspace`, not directly inside the repo source tree
- starter workspace Markdown is seeded automatically, but bootstrap is still considered incomplete until identity and user details are filled in

If you do not want to use `npm link`, you can still run:

```bash
npx autoaide
```

## CLI

- natural language input goes to the local `main` session
- `/channel` starts Telegram pairing
- `/status` shows home/workspace paths, the current model, and whether the Telegram daemon is online
- `/where` shows the current CLI session
- `/help` shows commands

## Bootstrap

On first launch, AutoAide seeds starter files into:

```bash
~/.autoaide/workspace
```

This does not mean bootstrap is complete.

AutoAide still considers itself uninitialized until the first-run identity setup is actually finished.

The initial workspace includes starter files such as:

- `AGENTS.md`
- `BOOTSTRAP.md`
- `IDENTITY.md`
- `SOUL.md`
- `USER.md`
- `TOOLS.md`
- `HEARTBEAT.md`

## Current Layout

- `bin/autoaide.mjs`
  - CLI entrypoint
- `src/cli.mjs`
  - interactive CLI
- `plugins/telegram-codex/telegram-codex-bridge.mjs`
  - Telegram bridge worker
- `docs/telegram-codex-bridge.md`
  - bridge behavior and setup
- `docs/telegram-always-on-agent-design.md`
  - product and architecture direction
- `docs/workspace-markdown-system.md`
  - workspace Markdown model and file responsibilities
- `docs/reference/templates/`
  - starter workspace Markdown templates

## Current Product Shape

- CLI-first
- thin session mapping
- Telegram pairing through `/channel`
- local Codex CLI for execution
- dedicated local workspace at `~/.autoaide/workspace`
- Telegram worker started from the CLI when configured
- Codex is launched with `--skip-git-repo-check` by default so `~/.autoaide/workspace` does not need to be a git repo
