# AutoAide

Turn Codex into a persistent local assistant with a real runtime home.

AutoAide gives you:

- a runtime home at `~/.autoaide`
- a default bot at `~/.autoaide/bots/default`
- a persistent workspace at `~/.autoaide/bots/default/workspace`
- a Telegram-capable bot runtime you can start, stop, and inspect
- a local CLI shell via `autoaide`

## Quickstart

```bash
git clone https://github.com/Moshiii/AutoAide.git
cd AutoAide
npm install
npm link
autoaide
```

If you do not want to link globally:

```bash
npx autoaide
```

## Requirements

- Node.js `>=22`
- Codex CLI installed and available as `codex`
- a local shell environment

Telegram is optional until you want to pair a bot.

## Getting Started

The shortest real setup flow is:

1. Install and launch:

```bash
git clone https://github.com/Moshiii/AutoAide.git
cd AutoAide
npm install
npm link
autoaide
```

2. Complete first-run bootstrap inside the CLI.
This writes your identity and preference files under:

- `~/.autoaide/bots/default/workspace/IDENTITY.md`
- `~/.autoaide/bots/default/workspace/USER.md`
- `~/.autoaide/bots/default/workspace/SOUL.md`

3. Start using the local shell immediately.
Type plain text to run a normal Codex turn.

Example:

```text
> summarize this repo
> create a plan for cleaning the config model
```

4. Pair Telegram when you want the bot online remotely.
Inside `autoaide`, run:

```text
/channel
```

That flow will:

- ask for your Telegram bot token
- wait for you to send one message to the bot
- save the Telegram config to `~/.autoaide/bots/default/config.json`
- start the default bot runtime

5. Check status anytime:

```text
/status
```

Or from another shell:

```bash
autoaide bot health default
autoaide bot logs default
```

## Daily Use

Use `autoaide` for the local shell:

```bash
autoaide
```

Useful in-shell commands:

- `/help`
- `/status`
- `/where`
- `/sessions`
- `/new <label>`
- `/switch <label>`
- `/skills`
- `/channel`
- `/restart`

Useful out-of-shell commands:

```bash
autoaide bot current
autoaide bot create research --name Research
autoaide bot use research
autoaide bot config default
autoaide bot start default
autoaide bot stop default
autoaide bot restart default
autoaide bot health default
autoaide bot logs default
autoaide web
```

If Telegram has already been paired and the default bot is enabled, launching `autoaide` will also bring the default bot runtime online automatically.

## Bot Management

AutoAide now supports a persistent current bot selection.

From the terminal:

```bash
autoaide bots
autoaide bot current
autoaide bot create research --name Research
autoaide bot use research
autoaide bot show research
autoaide bot start research
autoaide bot stop research
```

From inside `autoaide`:

```text
/bots
/bot create research Research
/bot use research
/bot show
/bot show research
```

After `autoaide bot use <id>` or `/bot use <id>`, the next `autoaide` launch opens that bot's workspace and sessions, and auto-start checks also target that selected bot.

## Current Runtime Model

AutoAide now uses a bot-scoped runtime layout.

```text
~/.autoaide/
  control/
    registry.json
  logs/
  bots/
    default/
      config.json
      cli-sessions.json
      bootstrap-state.json
      schedules.json
      goals/
      skills/
      logs/
      telegram/
      workspace/
      memory/
```

Important paths:

- `~/.autoaide/control/registry.json`
  - control plane registry for all bots
- `~/.autoaide/bots/default/config.json`
  - canonical config for the default bot
- `~/.autoaide/bots/default/workspace`
  - persistent assistant workspace
- `~/.autoaide/bots/default/telegram`
  - Telegram runtime state
- `~/.autoaide/bots/default/logs`
  - bot runtime and bridge logs

## What `npm install` Does

`npm install` runs `postinstall` and prepares the runtime skeleton:

- `~/.autoaide/control`
- `~/.autoaide/bots/default`
- `~/.autoaide/bots/default/workspace`
- `~/.autoaide/bots/default/telegram`
- `~/.autoaide/bots/default/logs`
- `~/.autoaide/bots/default/goals`
- `~/.autoaide/bots/default/skills`
- `~/.autoaide/bots/default/memory`
- `~/.autoaide/logs`

It does not start a background daemon.

## What `autoaide` Does

When you run `autoaide`:

1. AutoAide ensures the `default` bot exists.
2. It seeds the bot workspace if needed.
3. It enters the local interactive CLI.
4. You can bootstrap identity and preferences on first run.
5. You can pair Telegram from inside the CLI with `/channel`.

Telegram runtime management is bot-scoped:

- `/channel` pairs Telegram and writes bot config
- `/status` shows bot-scoped paths and runtime status
- `/restart` restarts the default bot runtime

## Bot Commands

Useful commands outside the interactive shell:

```bash
autoaide bots
autoaide bot show default
autoaide bot config default
autoaide bot health default
autoaide bot start default
autoaide bot stop default
autoaide bot restart default
autoaide bot logs default
autoaide web
```

## First Launch

On first launch, AutoAide seeds workspace files for the default bot and checks whether bootstrap is complete.

The relevant workspace lives here:

- `~/.autoaide/bots/default/workspace/AGENTS.md`
- `~/.autoaide/bots/default/workspace/IDENTITY.md`
- `~/.autoaide/bots/default/workspace/USER.md`
- `~/.autoaide/bots/default/workspace/SOUL.md`
- `~/.autoaide/bots/default/workspace/TOOLS.md`

Bootstrap completion is tracked separately in:

- `~/.autoaide/bots/default/bootstrap-state.json`

## Channels

Telegram is currently the most complete external channel.

Feishu is now available as an experimental channel using the official Node SDK in long connection mode.

Inside the CLI:

- `/channel` can configure Telegram or Feishu
- `/status` shows runtime paths, model, and Telegram status
- `/where` shows the current CLI session
- `/skills` lists or installs bot-scoped skills

When a channel is configured, AutoAide runs the channel bridge under the bot runtime instead of a global daemon.

Current Feishu scope:

- receives plain text messages through `im.message.receive_v1`
- runs a normal Codex turn per chat
- sends plain text replies back to the chat
- keeps per-chat session continuity

Not yet mirrored from Telegram:

- `/goal`
- schedules
- file bridge
- rich control commands beyond `/where`

## Architecture

The current shape is:

```text
repo/
  software install and source

~/.autoaide/
  control plane state
  shared logs
  bots/
    default/
      bot config
      bot runtime state
      workspace

Codex CLI
  execution engine
```

Key files:

- [bin/autoaide.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/bin/autoaide.mjs)
  - CLI entrypoint
- [src/bots.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/bots.mjs)
  - bot lifecycle and runtime management
- [src/config.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/config.mjs)
  - bot-scoped paths and config I/O
- [src/cli.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/cli.mjs)
  - interactive shell
- [src/control-plane-web.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/control-plane-web.mjs)
  - minimal bot control plane UI
- [src/workspace-bootstrap.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/workspace-bootstrap.mjs)
  - first-run bootstrap and workspace seeding
- [src/workspace-context.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/workspace-context.mjs)
  - workspace context loading
- [plugins/telegram-codex/telegram-codex-bridge.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/plugins/telegram-codex/telegram-codex-bridge.mjs)
  - Telegram bridge runtime

## Notes

- The old single-daemon model has been removed.
- The canonical config is now bot-scoped.
- AutoAide only reads bot-scoped state under `~/.autoaide/bots/<id>`.
