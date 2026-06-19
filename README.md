# CodexBridge

Turn Codex into a persistent local assistant with a real runtime home.

CodexBridge gives you:

- a runtime home at `~/.codexbridge`
- a default bot at `~/.codexbridge/bots/default`
- a persistent workspace at `~/.codexbridge/bots/default/workspace`
- a Telegram-capable bot runtime you can start, stop, and inspect
- a local CLI shell via `codexbridge`

## Quickstart

```bash
git clone https://github.com/Moshiii/CodexBridge.git
cd CodexBridge
npm install
npm link
codexbridge
```

If you do not want to link globally:

```bash
npx codexbridge
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
git clone https://github.com/Moshiii/CodexBridge.git
cd CodexBridge
npm install
npm link
codexbridge
```

2. Complete first-run bootstrap inside the CLI.
This writes your identity and preference files under:

- `~/.codexbridge/bots/default/workspace/IDENTITY.md`
- `~/.codexbridge/bots/default/workspace/USER.md`
- `~/.codexbridge/bots/default/workspace/SOUL.md`

3. Start using the local shell immediately.
Type plain text to run a normal Codex turn.

Example:

```text
> summarize this repo
> create a plan for cleaning the config model
```

4. Pair Telegram when you want the bot online remotely.
Inside `codexbridge`, run:

```text
/channel
```

That flow will:

- ask for your Telegram bot token
- wait for you to send one message to the bot
- save the Telegram config to `~/.codexbridge/bots/default/config.json`
- start the default bot runtime

5. Check status anytime:

```text
/status
```

Or from another shell:

```bash
codexbridge bot health default
codexbridge bot logs default
```

## Daily Use

Use `codexbridge` for the local shell:

```bash
codexbridge
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
codexbridge bot current
codexbridge bot create research --name Research
codexbridge bot use research
codexbridge bot config default
codexbridge bot start default
codexbridge bot stop default
codexbridge bot restart default
codexbridge bot health default
codexbridge bot logs default
codexbridge web
```

If Telegram has already been paired and the default bot is enabled, launching `codexbridge` will also bring the default bot runtime online automatically.

## Bot Management

CodexBridge now supports a persistent current bot selection.

From the terminal:

```bash
codexbridge bots
codexbridge bot current
codexbridge bot create research --name Research
codexbridge bot use research
codexbridge bot show research
codexbridge bot start research
codexbridge bot stop research
```

From inside `codexbridge`:

```text
/bots
/bot create research Research
/bot use research
/bot show
/bot show research
```

After `codexbridge bot use <id>` or `/bot use <id>`, the next `codexbridge` launch opens that bot's workspace and sessions, and auto-start checks also target that selected bot.

## Current Runtime Model

CodexBridge now uses a bot-scoped runtime layout.

```text
~/.codexbridge/
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

- `~/.codexbridge/control/registry.json`
  - control plane registry for all bots
- `~/.codexbridge/bots/default/config.json`
  - canonical config for the default bot
- `~/.codexbridge/bots/default/workspace`
  - persistent assistant workspace
- `~/.codexbridge/bots/default/telegram`
  - Telegram runtime state
- `~/.codexbridge/bots/default/logs`
  - bot runtime and bridge logs

## What `npm install` Does

`npm install` runs `postinstall` and prepares the runtime skeleton:

- `~/.codexbridge/control`
- `~/.codexbridge/bots/default`
- `~/.codexbridge/bots/default/workspace`
- `~/.codexbridge/bots/default/telegram`
- `~/.codexbridge/bots/default/logs`
- `~/.codexbridge/bots/default/goals`
- `~/.codexbridge/bots/default/skills`
- `~/.codexbridge/bots/default/memory`
- `~/.codexbridge/logs`

It does not start a background daemon.

## What `codexbridge` Does

When you run `codexbridge`:

1. CodexBridge ensures the `default` bot exists.
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
codexbridge bots
codexbridge bot show default
codexbridge bot config default
codexbridge bot health default
codexbridge bot start default
codexbridge bot stop default
codexbridge bot restart default
codexbridge bot logs default
codexbridge web
```

## First Launch

On first launch, CodexBridge seeds workspace files for the default bot and checks whether bootstrap is complete.

The relevant workspace lives here:

- `~/.codexbridge/bots/default/workspace/AGENTS.md`
- `~/.codexbridge/bots/default/workspace/IDENTITY.md`
- `~/.codexbridge/bots/default/workspace/USER.md`
- `~/.codexbridge/bots/default/workspace/SOUL.md`
- `~/.codexbridge/bots/default/workspace/TOOLS.md`

Bootstrap completion is tracked separately in:

- `~/.codexbridge/bots/default/bootstrap-state.json`

## Channels

Telegram is currently the most complete external channel.

Feishu is now available as an experimental channel using the official Node SDK in long connection mode.

Feishu setup is not just pasting `appId` and `appSecret`. The Feishu app also needs:

- bot capability enabled in the app settings
- IM message permissions enabled for message receive/send
- `im.message.receive_v1` added in Event Subscriptions
- the app installed or published into the tenant where you want to use it

This bridge uses long connection mode, so no public webhook URL is required.

Inside the CLI:

- `Enter` opens a quick action menu
- `/bots` opens an interactive bot picker with arrow-key navigation
- `/new` creates a bot with guided prompts
- `/connect` configures Telegram or Feishu
- `/me` shows a compact current-bot summary
- `/status full` shows detailed runtime paths and channel state
- `/where` shows the current CLI session
- `/skills` lists or installs bot-scoped skills

When a channel is configured, CodexBridge runs the channel bridge under the bot runtime instead of a global daemon.

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

~/.codexbridge/
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

- [bin/codexbridge.mjs](/Users/moshiwei/Documents/GitHub/CodexBridge/bin/codexbridge.mjs)
  - CLI entrypoint
- [src/bots.mjs](/Users/moshiwei/Documents/GitHub/CodexBridge/src/bots.mjs)
  - bot lifecycle and runtime management
- [src/config.mjs](/Users/moshiwei/Documents/GitHub/CodexBridge/src/config.mjs)
  - bot-scoped paths and config I/O
- [src/cli.mjs](/Users/moshiwei/Documents/GitHub/CodexBridge/src/cli.mjs)
  - interactive shell
- [src/control-plane-web.mjs](/Users/moshiwei/Documents/GitHub/CodexBridge/src/control-plane-web.mjs)
  - minimal bot control plane UI
- [src/workspace-bootstrap.mjs](/Users/moshiwei/Documents/GitHub/CodexBridge/src/workspace-bootstrap.mjs)
  - first-run bootstrap and workspace seeding
- [src/workspace-context.mjs](/Users/moshiwei/Documents/GitHub/CodexBridge/src/workspace-context.mjs)
  - workspace context loading
- [plugins/telegram-codex/telegram-codex-bridge.mjs](/Users/moshiwei/Documents/GitHub/CodexBridge/plugins/telegram-codex/telegram-codex-bridge.mjs)
  - Telegram bridge runtime

## Notes

- The old single-daemon model has been removed.
- The canonical config is now bot-scoped.
- CodexBridge only reads bot-scoped state under `~/.codexbridge/bots/<id>`.
