# CodexBridge Capability Overview

## Purpose

This document is a current-state panorama of CodexBridge.

It summarizes:

- the core product model
- local CLI and runtime capabilities
- bot management and control-plane capabilities
- Telegram channel capabilities
- Feishu channel capabilities
- shared goal and schedule capabilities
- major current gaps and channel differences

It is intended to answer one question clearly:

What ca CodexBridge do today, and through which surface?

## 1. Product Model

CodexBridge is a persistent local assistant runtime built around bot-scoped state under `~/.codexbridge`.

At a high level, it provides:

- a bot-scoped workspace
- persistent CLI sessions
- a bot runtime that can be started, stopped, restarted, and inspected
- external chat-channel bridges
- a web control plane
- goal and schedule orchestration

Current architecture is organized around:

- bot home
- session state
- workspace context
- channel bridge
- goal/schedule state
- control plane registry

## 2. Runtime Layout

Per bot, CodexBridge maintains:

- `config.json`
- `cli-sessions.json`
- `bootstrap-state.json`
- `goals/`
- `schedules.json`
- `workspace/`
- `memory/`
- `<channel>/` state directories such as `telegram/` and `feishu/`
- `logs/`

Shared control-plane state lives under:

- `~/.codexbridge/control/registry.json`
- `~/.codexbridge/control/active-bot.json`

## 3. Core Surfaces

CodexBridge currently has four main operating surfaces:

1. Local interactive CLI
2. Bot-scoped background runtime
3. Web control plane
4. External channels
   - Telegram
   - Feishu

## 4. Local CLI

The local `codexbridge` CLI is the primary operator surface.

### 4.1 Plain-text Codex chat

Inside the CLI, typing normal text runs a Codex turn against the active local session.

Supported behavior:

- persistent session continuity via `cliSessionRef`
- stop current local run with `/stop`
- create and switch named sessions
- workspace prompt injection via workspace context files

### 4.2 CLI commands

Current CLI command set includes:

- `/help`
- `/bots`
- `/bot create <id> [name]`
- `/bot use <id>`
- `/bot show [id]`
- `/channel`
- `/home`
- `/new <label>`
- `/switch <label>`
- `/sessions`
- `/skills`
- `/skills install <zip-or-path>`
- `/stop`
- `/restart`
- `/status`
- `/where`
- `/exit`

### 4.3 CLI channel onboarding

`/channel` supports:

- Telegram pairing
- Feishu setup

Telegram onboarding:

- asks for BotFather token
- waits for first Telegram message
- persists Telegram config and known chat/user metadata

Feishu onboarding:

- walks user through self-built app checklist
- explains that Feishu-side bot capability, IM permissions, and `im.message.receive_v1` event subscription must be configured first
- asks for `appId` and `appSecret`
- switches active bot channel to `feishu`
- restarts runtime so Feishu bridge takes over

### 4.4 CLI skill operations

The CLI can:

- list installed skills
- install a skill from a zip or local path

## 5. Bot Management

CodexBridge supports multiple persistent bots.

Current bot-management capabilities include:

- create bots
- switch current bot
- inspect bot config
- start bot runtime
- stop bot runtime
- restart bot runtime
- list bots
- view bot health and logs

Available operator commands outside the interactive shell include:

- `codexbridge bots`
- `codexbridge bot current`
- `codexbridge bot create <id> --name ...`
- `codexbridge bot use <id>`
- `codexbridge bot show <id>`
- `codexbridge bot config <id>`
- `codexbridge bot start <id>`
- `codexbridge bot stop <id>`
- `codexbridge bot restart <id>`
- `codexbridge bot health <id>`
- `codexbridge bot logs <id>`

## 6. Workspace And Bootstrap

Each bot has a persistent workspace.

The workspace is used for:

- assistant identity bootstrap
- user preference context
- injected prompt context for Codex turns
- file ingress/egress for supported channels

Bootstrap seeds and tracks:

- `AGENTS.md`
- `IDENTITY.md`
- `USER.md`
- `SOUL.md`
- `TOOLS.md`

## 7. Web Control Plane

CodexBridge includes a local web console.

### 7.1 Current web capabilities

The web control plane currently supports:

- bot list and bot detail
- bot health and log inspection
- session listing and session switching
- running local turns against selected sessions
- chat stop
- goal creation and goal listing
- schedule creation and schedule listing
- schedule enable / disable
- workspace file listing
- workspace file read / edit / save
- Telegram pairing and Telegram metadata refresh
- config editing for core bot and Telegram fields

### 7.2 Current web bias

The web console is still Telegram-first in presentation and controls.

It is not yet a full multi-channel control plane.

Specifically:

- Telegram has dedicated UI sections
- Feishu does not yet have equivalent dedicated UI
- terminology in several places still assumes Telegram

## 8. Channel System

CodexBridge now has a channel-adapter model.

Current registered channels:

- `telegram`
- `feishu`

The channel adapter layer is responsible for:

- readiness checks
- bridge script resolution
- channel summary output
- bot runtime bridge selection

This means the runtime is no longer hard-coded to Telegram only.

## 9. Telegram Channel

Telegram is currently the most complete external channel.

### 9.1 Transport model

Telegram uses a bot bridge process that:

- polls Telegram updates
- persists Telegram routing state under the bot home
- maps Telegram chats to CodexBridge sessions

### 9.2 Access control

Telegram supports:

- allowed private chats
- allowed group chats
- allowed group users
- explicit bot mention requirement in groups

### 9.3 Telegram chat model

Telegram maintains:

- per-chat active session label
- multiple named sessions per chat
- a main session per chat
- session continuity through `cliSessionRef`

### 9.4 Telegram slash commands

Telegram currently supports:

- `/start`
- `/home`
- `/where`
- `/help`
- `/status`
- `/stop`
- `/restart`
- `/sessions`
- `/new <label>`
- `/switch <label>`
- `/skills`
- `/skills install <zip-or-path>`
- `/files [inbox|outbox|exports]`
- `/get <relative-path>`
- `/goal <objective>`
- `/goals`
- `/goal-status <id>`
- `/goal-log <id>`
- `/schedule <cron> <objective>`
- `/schedules`
- `/schedule-stop <id>`
- `/schedule-run <id>`

Telegram also supports a natural-language schedule shortcut:

- for example messages like `每天9点帮我做xxx`

### 9.5 Telegram file bridge

Telegram currently supports a useful file bridge MVP.

Inbound:

- Telegram `document` uploads are downloaded into workspace `inbox/`

Outbound:

- `/files [root]` lists files from `inbox/`, `outbox/`, or `exports/`
- `/get <relative-path>` sends a workspace file back to Telegram

Current file constraints:

- only Telegram `document` uploads are handled
- download roots are restricted to `inbox/`, `outbox/`, and `exports/`

### 9.6 Telegram runtime behavior

Telegram normal chat currently supports:

- reply-to-message behavior
- immediate `Running ...` acknowledgment
- single running task per active session
- `/stop` for normal tasks
- shared goal supervision model
- schedule-triggered goal creation

### 9.7 Telegram goal support

Telegram is currently the only external channel with shared goal integration.

Supported Telegram goal flows:

- create goal with `/goal`
- inspect goals with `/goals`
- inspect one goal with `/goal-status`
- inspect recent goal history with `/goal-log`
- stop running goal with `/stop`

### 9.8 Telegram schedule support

Telegram currently supports:

- create cron schedules
- create natural-language schedules
- list schedules
- disable schedules
- manually trigger schedules
- automatic schedule tick processing in the bridge

### 9.9 Telegram maturity

Telegram is currently:

- the most complete remote operating surface
- the only channel with full goal and schedule flows
- the only channel with file bridge support

## 10. Feishu Channel

Feishu is now available as an experimental but working external channel.

### 10.1 Transport model

Feishu uses the official Node SDK with long connection mode.

Current SDK usage includes:

- `Lark.Client`
- `Lark.WSClient`
- `EventDispatcher`

Current event source:

- `im.message.receive_v1`

### 10.2 Feishu onboarding

Feishu can be configured from the CLI.

The setup flow currently expects:

- a self-built Feishu app
- bot ability enabled
- IM message permissions enabled for receiving and sending messages
- event subscription enabled
- long-connection mode enabled
- `im.message.receive_v1` subscribed
- app installed or published in the tenant
- `appId` and `appSecret` pasted into CLI

### 10.3 Feishu normal chat behavior

Feishu currently supports:

- plain-text inbound messages
- normal Codex conversation turns
- per-chat session continuity
- immediate `Running ...` acknowledgment
- queued processing per chat instead of dropping concurrent requests
- replying directly to the source message using Feishu reply API
- `/where`

### 10.4 Feishu mention behavior

Current behavior is:

- private chat can talk directly
- group chat requires explicit `@机器人自己`
- `@别人` should not trigger a response

The bridge currently tries to identify “@机器人自己” using:

- bot `open_id` once learned from sent-message responses
- bot mention names derived from app identity and config

### 10.5 Feishu queueing model

In a Feishu group chat:

- the whole chat shares one ongoing session
- only explicit `@机器人` triggers response
- multiple incoming requests queue by chat
- each queued request gets a `Queued on [...]` acknowledgment
- when execution starts it gets a `Running ...` acknowledgment

### 10.6 Feishu prompt shaping

The Feishu bridge currently does extra cleanup for group-chat inputs:

- strips Feishu mention markup
- frames the message as an actual user request
- nudges the model to answer naturally
- avoids “teaching the user how to phrase it” unless the user explicitly asked for copywriting

### 10.7 Feishu current limitations

Feishu does not yet support:

- `/goal`
- schedule delivery
- file upload/download bridge
- rich slash-command parity with Telegram
- dedicated web-control-plane onboarding and management

### 10.8 Feishu maturity

Feishu is currently:

- ready for experimental normal chat use
- suitable for live group and private reply flows
- not yet feature-complete versus Telegram

## 11. Shared Goal System

CodexBridge has already undergone a goal-model refactor.

### 11.1 Current goal model

The old “separate worker product” model has been replaced by:

- main conversation thread execution
- a separate supervisor evaluation thread

Conceptually:

- conversation thread does the work
- supervisor checks whether the goal is complete, blocked, failed, or needs another follow-up user message

### 11.2 Shared goal layers

Current shared goal components:

- `src/goals-state.mjs`
- `src/goal-prompts.mjs`
- `src/goal-runner.mjs`
- `src/goal-controller.mjs`

### 11.3 Current goal behavior

Goals currently support:

- persistent goal records
- iteration state
- history log
- supervisor verdicts
- stop requests
- shared orchestration via goal controller

User-facing current goal control model is intentionally simplified:

- `/goal <objective>`
- `/stop`
- read-only inspection commands

### 11.4 Current channel coverage for goals

Current goal support by surface:

- CLI local shell: no dedicated `/goal` flow
- Telegram: yes
- Feishu: not yet
- Web: yes, via control plane APIs and UI

## 12. Shared Schedule System

CodexBridge also has a schedule subsystem.

### 12.1 Current schedule model

Schedules currently store:

- schedule id
- chat id
- cron expression
- objective
- timezone
- enabled state
- last trigger information
- last goal id
- last error

### 12.2 Current schedule behavior

Current capabilities:

- create schedule records
- list schedules
- enable/disable schedules
- manual run
- automatic cron matching
- skip conflicting trigger if a goal or normal task is already running in that chat

### 12.3 Current channel coverage for schedules

Current schedule support by surface:

- Telegram: yes
- Feishu: not yet
- Web: partial control-plane support for create/list/toggle
- CLI local shell: no first-class schedule management

## 13. Skills System

CodexBridge can discover and install skills.

Current skills functionality includes:

- skill listing
- skill installation from local path or archive
- skill usage through workspace / Codex prompt context

Skill operations are available through:

- CLI
- Telegram

## 14. Feature Matrix

### 14.1 Shared platform

| Capability | Status |
| --- | --- |
| Multi-bot management | Yes |
| Bot-scoped runtime | Yes |
| Persistent workspace | Yes |
| Persistent CLI sessions | Yes |
| Web control plane | Yes |
| Channel-adapter model | Yes |
| Shared goal controller | Yes |
| Shared schedule state | Yes |

### 14.2 Local CLI

| Capability | Status |
| --- | --- |
| Plain-text Codex turns | Yes |
| Session create/switch | Yes |
| Stop active turn | Yes |
| Restart current bot runtime | Yes |
| Bot management | Yes |
| Channel onboarding | Yes |
| Skill install/list | Yes |

### 14.3 Telegram

| Capability | Status |
| --- | --- |
| Normal chat | Yes |
| Session continuity | Yes |
| Group mention gating | Yes |
| Reply-to-message | Yes |
| File upload bridge | Yes |
| File download bridge | Yes |
| Goal support | Yes |
| Schedule support | Yes |
| Natural-language schedules | Yes |
| Skill operations | Yes |

### 14.4 Feishu

| Capability | Status |
| --- | --- |
| Normal chat | Yes |
| Session continuity | Yes |
| Group mention gating | Yes |
| Reply-to-message | Yes |
| Per-chat queueing | Yes |
| `/where` | Yes |
| Goal support | No |
| Schedule support | No |
| File bridge | No |
| Web onboarding parity | No |

## 15. Current Gaps

The biggest current product gaps are:

1. Feishu still lacks parity with Telegram on goals, schedules, and files.
2. Web control plane is still heavily Telegram-oriented.
3. CLI local shell does not expose first-class goal/schedule commands comparable to Telegram.
4. Feishu identity and user-memory handling can be made more human-readable.
5. Channel behavior is not yet fully normalized across Telegram, Feishu, CLI, and Web.

## 16. Recommended Reading

For channel-specific details:

- [feishu-channel-current-state.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/feishu-channel-current-state.md)
- [telegram-file-bridge.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/telegram-file-bridge.md)

For implementation context:

- [README.md](/Users/moshiwei/Documents/GitHub/CodexBridge/README.md)
