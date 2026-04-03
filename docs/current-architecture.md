# AutoAide Current Architecture

## Purpose

AutoAide is a local, bot-scoped runtime wrapper around Codex CLI.

The project currently provides:

- a local CLI shell via `autoaide`
- a bot control plane with registry + per-bot state
- a persistent workspace per bot
- a Telegram bridge that runs inside a bot runtime
- a goal/schedule layer on top of Codex sessions
- a thin web control plane for inspection and operations

It no longer uses the old single global daemon model.

## Runtime Layout

```text
repo/
  bin/autoaide.mjs
  scripts/postinstall.mjs
  src/
  plugins/telegram-codex/
  docs/

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
        runtime.log
        telegram-bridge.log
      telegram/
        runtime.pid
        bridge.pid
        offset.json
        sessions.json
      workspace/
      memory/
```

## Core Components

### Entrypoints

- `bin/autoaide.mjs`
  - top-level CLI entrypoint
  - routes `autoaide`, `autoaide bot ...`, `autoaide bots`, `autoaide skills ...`, `autoaide rollout ...`, `autoaide web`
- `scripts/postinstall.mjs`
  - prepares the bot-scoped runtime skeleton under `~/.autoaide`

### State and Paths

- `src/config.mjs`
  - canonical path resolver
  - bot config normalization
  - registry/config/bootstrap/session IO

### Runtime Management

- `src/bots.mjs`
  - bot CRUD
  - start/stop/restart lifecycle
  - bot runtime wrapper process management
  - runtime/bridge health and log access

### Local Interactive UX

- `src/cli.mjs`
  - interactive shell
  - first-run bootstrap conversation
  - Telegram pairing
  - local session switching
  - local turn execution through Codex

### Workspace and Prompting

- `src/workspace-bootstrap.mjs`
  - seeds workspace templates
  - decides whether bootstrap is pending
- `src/workspace-context.mjs`
  - injects `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md` into prompts
- `src/codex-runner.mjs`
  - runs `codex exec` / `codex exec resume`
  - parses Codex JSON events

### Telegram Runtime

- `plugins/telegram-codex/telegram-codex-bridge.mjs`
  - long-polling Telegram worker
  - chat/session router
  - command handling
  - file upload/download bridge
  - goal launch + schedule tick loop

### Goals and Schedules

- `src/goal-runner.mjs`
  - worker/evaluator loop on top of Codex
- `src/goals-state.mjs`
  - goal persistence
- `src/schedules-state.mjs`
  - schedule persistence
- `src/schedule-intents.mjs`
  - natural-language schedule parsing
- `src/cron-utils.mjs`
  - cron matching + tick helpers

### Web Ops Surface

- `src/control-plane-web.mjs`
  - thin HTTP API + HTML UI
  - inspect/start/stop/restart/config-update/rollout calls into `bots.mjs`

### Skills

- `src/skills.mjs`
  - skill discovery
  - skill install from directory or zip
  - bot-scoped skill storage

## Architecture Layers

```text
+--------------------------------------------------------------+
| User Surfaces                                                 |
|  - local shell: autoaide                                      |
|  - Telegram bot messages                                      |
|  - web control plane                                          |
+--------------------------------------------------------------+
| AutoAide Orchestration                                         |
|  - bin/autoaide.mjs                                           |
|  - src/cli.mjs                                                |
|  - src/bots.mjs                                               |
|  - src/control-plane-web.mjs                                  |
+--------------------------------------------------------------+
| Bot State + Workspace                                          |
|  - src/config.mjs                                             |
|  - src/workspace-bootstrap.mjs                                |
|  - src/workspace-context.mjs                                  |
|  - goals/schedules/skills state                               |
+--------------------------------------------------------------+
| Execution Backend                                              |
|  - src/codex-runner.mjs                                       |
|  - Codex CLI                                                  |
+--------------------------------------------------------------+
| External Service                                               |
|  - Telegram Bot API                                           |
+--------------------------------------------------------------+
```

## Main Data Objects

### Registry Entry

`control/registry.json` tracks:

- bot id
- home path
- enabled flag
- desired/running version
- status
- bot username
- last error

### Bot Config

`bots/<id>/config.json` tracks:

- bot identity and lifecycle
- runtime model
- Telegram config
- observability timestamps/errors

### CLI State

`cli-sessions.json` tracks:

- local session labels
- active session
- Codex resume thread ids per session

### Telegram Router State

`telegram/sessions.json` tracks:

- chat -> active session label
- Telegram-side session metadata

### Goal Record

`goals/<goal>.json` tracks:

- objective
- status/phase/iteration
- worker/evaluator session refs
- artifacts
- history
- final output / errors

### Schedule Record

`schedules.json` tracks:

- cron expression
- timezone
- objective
- last trigger state
- last goal id / last error

## Feature Inventory

### Local CLI

- `autoaide`
- `/help`
- `/home`
- `/new <label>`
- `/switch <label>`
- `/sessions`
- `/skills`
- `/skills install <zip-or-path>`
- `/channel`
- `/status`
- `/where`
- `/stop`
- `/restart`
- `/exit`
- freeform prompt execution

### Bot Lifecycle CLI

- `autoaide bots`
- `autoaide bot create <id>`
- `autoaide bot show <id>`
- `autoaide bot config <id>`
- `autoaide bot set-config <id> --json ...`
- `autoaide bot health <id>`
- `autoaide bot start <id>`
- `autoaide bot stop <id>`
- `autoaide bot restart <id>`
- `autoaide bot enable <id>`
- `autoaide bot disable <id>`
- `autoaide bot delete <id>`
- `autoaide bot logs <id>`

### Rollout and Ops

- `autoaide rollout restart-all`
- `autoaide rollout canary --bots ... --version ...`
- `autoaide rollout rollback <id> --version ...`
- `autoaide web`

### Telegram Commands

- `/start` or `/home`
- `/where`
- `/help`
- `/status`
- `/stop`
- `/restart`
- `/sessions`
- `/skills`
- `/skills install ...`
- `/new`
- `/switch`
- `/goal`
- `/goals`
- `/goal-status`
- `/goal-log`
- `/goal-stop`
- `/goal-resume`
- `/schedule`
- `/schedules`
- `/schedule-stop`
- `/schedule-run`
- non-command freeform execution
- document upload flow

## Call Sequence Diagrams

### 1. Install / Runtime Skeleton

```text
User             npm              postinstall.mjs          ~/.autoaide
 |                |                      |                      |
 | npm install    |                      |                      |
 |--------------->| run postinstall      |                      |
 |                |--------------------->| mkdir control        |
 |                |                      | mkdir bots/default   |
 |                |                      | mkdir workspace/...  |
 |                |                      |--------------------->|
 |                |                      | print ready paths    |
 |                |<---------------------|                      |
```

### 2. `autoaide` No-Arg Launch

```text
User           bin/autoaide        bots.mjs          config.mjs        cli.mjs
 |                  |                 |                  |               |
 | autoaide         |                 |                  |               |
 |----------------->| ensureDefault   |----------------->|               |
 |                  | maybe autostart |---- getBot ----->|               |
 |                  | maybe startBot  |----------------->|               |
 |                  | startCli()      |                                     
 |                  |----------------------------------------------------->|
 |                  |                                   ensureAutoAideHome |
 |                  |                                   ensureWorkspaceBoot |
 |                  |                                   readConfig/state    |
 |                  |                                   show banner         |
```

### 3. Local First-Run Bootstrap

```text
User            cli.mjs              workspace-bootstrap        workspace files
 |                 |                         |                        |
 | launch CLI      | ensureWorkspaceBootstrap|                        |
 |---------------->|------------------------>| seed templates         |
 |                 |<------------------------| pending?               |
 | answer prompts  |                         |                        |
 |---------------> | completeBootstrap()     |----------------------->|
 |                 | write IDENTITY/USER/SOUL                         |
 |                 | remove BOOTSTRAP.md                              |
 |                 | write bootstrap-state                            |
```

### 4. Local Freeform Prompt Execution

```text
User         cli.mjs            workspace-context     codex-runner      Codex CLI
 |              |                     |                    |               |
 | type prompt  |                     |                    |               |
 |------------->| buildWorkspacePrompt|------------------->|               |
 |              |<--------------------| prefix + message   |               |
 |              | startCliTurn ------------------------------------------>|
 |              |                                         stream statuses |
 |              |<--------------------------------------------------------|
 |              | persist session ref                                     |
 |              | render output                                           |
```

### 5. Local Session Management

```text
User           cli.mjs                cli-sessions.json
 |                |                          |
 | /new foo       | create session          |
 |--------------->|------------------------>|
 | /switch foo    | update active label     |
 |--------------->|------------------------>|
 | /sessions      | read + render           |
 |--------------->|                          |
```

### 6. Telegram Pairing from CLI

```text
User         cli.mjs          telegram-pairing     bots.mjs         Telegram API
 |              |                    |                |                 |
 | /channel     | ask token          |                |                 |
 |------------->|                    |                |                 |
 | enter token  | pairTelegram ------> getUpdates --------------------->|
 |              |<------------------- paired chat id                    |
|              | updateBotConfig(enabled=true, telegram config)        |
 |              |------------------------------->|                      |
 |              | startBot(default)             |---------------------> |
 |              |<------------------------------| pid                   |
```

### 7. Bot Runtime Start

```text
Caller           bots.mjs            bot runtime process        telegram bridge
 |                  |                        |                        |
 | startBot(id)     | validate config        |                        |
 |----------------->| spawn "autoaide bot run id" ------------------->|
 |                  | wait for runtime.pid   | write runtime pid      |
 |                  |<-----------------------|                        |
 |                  | return runtime pid     | spawn bridge --------->|
```

### 8. Bot Runtime Stop / Restart

```text
Caller           bots.mjs           runtime wrapper         telegram bridge
 |                  |                     |                      |
 | stopBot(id)      | kill runtime pid    |                      |
 |----------------->|-------------------->| shutdown()           |
 |                  |                     | kill child bridge -->|
 |                  |                     | clear runtime.pid    |
 |                  |<--------------------| exit                 |
 |
 | restartBot(id) = stopBot(id) + startBot(id)
```

### 9. Telegram Bridge Startup

```text
runtime wrapper     telegram-bridge         config/workspace        Telegram API
 |                        |                        |                    |
 | spawn bridge           |                        |                    |
 |----------------------->| resolveBotRuntimeCtx   |                    |
 |                        | read bot config ------>|                    |
 |                        | read workspace paths   |                    |
 |                        | write bridge.pid       |                    |
 |                        | long poll getUpdates ---------------------->|
```

### 10. Telegram Freeform Message

```text
Telegram User    Telegram API    telegram-bridge    workspace-context   codex-runner
 |                    |                |                  |                 |
 | send message       |                |                  |                 |
 |------------------->| update         |                  |                 |
 |                    |--------------->| route chat       |                 |
 |                    |                | build prompt ---->|                 |
 |                    |                |<-----------------|                 |
 |                    |                | startCliTurn --------------------->|
 |                    |                |<----------------------------------|
 |                    |<---------------| send result message               |
```

### 11. Telegram File Upload

```text
Telegram User    Telegram API     telegram-bridge        workspace/inbox
 |                    |                 |                      |
 | upload document    |                 |                      |
 |------------------->| file metadata   |                      |
 |                    |---------------> | download file        |
 |                    |                 |--------------------->|
 |                    |                 | send saved path msg  |
 |                    |<----------------|                      |
 |                    |                 | optional caption -> normal run
```

### 12. Goal Command Flow

```text
Telegram User   telegram-bridge      goals-state       goal-runner       Codex worker/evaluator
 |                   |                    |                |                    |
 | /goal ...         | createGoalRecord   |                |                    |
 |------------------>|------------------->| write goal     |                    |
 |                   | launchGoal         |                |                    |
 |                   |------------------------------------>| worker prompt ---->|
 |                   |                                     |<-------------------|
 |                   |                                     | evaluator prompt ->|
 |                   |                                     |<-------------------|
 |                   | update goal history/results ------->|                    |
 |                   | send progress/final msg             |                    |
```

### 13. Schedule Creation and Tick

```text
Telegram User   telegram-bridge      schedules-state      cron loop        goal-runner
 |                   |                    |                  |                 |
 | /schedule ...     | parse intent       |                  |                 |
 |------------------>| create record ---->| write schedule   |                 |
 |                   |<-------------------|                  |                 |
 |                   | every poll tick    |                  |                 |
 |                   | read schedules --->|                  |                 |
 |                   | cronMatchesDate    |                  |                 |
 |                   | if due -> create goal                                  |
 |                   |-----------------------------------------------> launch  |
```

### 14. Skills Install

```text
User/Telegram     cli or bridge         skills.mjs              bot skills dir
 |                    |                     |                         |
 | install skill      |                     |                         |
 |------------------->| installSkillFromPath| unzip/copy             |
 |                    |-------------------->|------------------------>|
 |                    |<--------------------| metadata/result         |
 |                    | render installed msg                          |
```

### 15. Web Control Plane Inspect

```text
Browser         control-plane-web        bots.mjs          config/log files
 |                    |                     |                    |
 | GET /api/bots      |                     |                    |
 |------------------->| listBots ---------->|                    |
 |                    | healthCheckBot ---->|------------------->|
 |                    |<--------------------|                    |
 |<-------------------| snapshot JSON       |                    |
```

### 16. Web Control Plane Update Config

```text
Browser         control-plane-web        deepMerge          bots.mjs         config.json
 |                    |                    |                  |                 |
 | POST /config       | read JSON body     |                  |                 |
 |------------------->| merge patch ------>|                  |                 |
 |                    | updateBotConfig --------------------->| writeConfig --->|
 |<-------------------| updated config                        |                 |
```

### 17. Web / CLI / Telegram Restart Paths

```text
Caller            surface layer          bots.mjs              runtime wrapper
 |                    |                     |                       |
 | /restart           |                     |                       |
 | CLI / Web / TG --->| restartBot(id) ---->| stopBot + startBot    |
 |                    |                     | kill runtime           |
 |                    |                     | respawn wrapper        |
```

### 18. Rollout Operations

```text
Operator         bin/web API            bots.mjs                target bots
 |                  |                      |                        |
 | restart-all      |--------------------->| rollingRestartBots     |
 | canary           |--------------------->| canaryRollout          |
 | rollback         |--------------------->| rollbackBot            |
 |                  |                      | sequential restart --->|
 |<-----------------| structured results   |                        |
```

## Command-to-Module Map

### `autoaide`

- `bin/autoaide.mjs`
- `src/cli.mjs`
- `src/workspace-bootstrap.mjs`
- `src/workspace-context.mjs`
- `src/codex-runner.mjs`

### `autoaide bot ...`

- `bin/autoaide.mjs`
- `src/bots.mjs`
- `src/config.mjs`

### `autoaide web`

- `bin/autoaide.mjs`
- `src/control-plane-web.mjs`
- `src/bots.mjs`

### Telegram command path

- `src/bots.mjs` spawns runtime
- runtime spawns `plugins/telegram-codex/telegram-codex-bridge.mjs`
- bridge uses:
  - `src/workspace-context.mjs`
  - `src/codex-runner.mjs`
  - `src/goals-state.mjs`
  - `src/schedules-state.mjs`
  - `src/goal-runner.mjs`
  - `src/skills.mjs`

## Current Design Strengths

- thin wrapper around Codex instead of a custom agent engine
- clear bot-scoped filesystem boundaries
- shared orchestration code reused by CLI, web, and Telegram paths
- persistent workspace model is explicit and inspectable
- operations surface is scriptable from CLI and HTTP

## Current Design Constraints

- `default` bot is still the main product path; multi-bot exists but is lightly surfaced
- local CLI session model and Telegram session model are separate state stores
- the Telegram bridge is large and mixes transport, routing, goals, schedules, and file handling
- many paths still assume Codex CLI as the only execution engine
- workspace/global constants are module-level defaults, so fully dynamic multi-bot context is still coupled to process env

## Recommended Next Refactors

1. Split the Telegram bridge into transport, router, goals, schedules, and file-transfer modules.
2. Move bot command parsing into a dedicated command layer shared by CLI and Telegram.
3. Introduce a typed config schema boundary instead of ad hoc normalization.
4. Isolate runtime lifecycle events into an event/log model rather than only flat log files.
5. Make multi-bot UX first-class in the local CLI, not only in low-level `bot ...` commands and the web control plane.
