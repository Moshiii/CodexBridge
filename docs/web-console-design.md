# AutoAide Web Console Design

## Purpose

This document defines the target web console for AutoAide.

The goal is to move the current thin control plane from:

- bot list
- basic start/stop/restart
- raw config editing

to a full product console that can cover nearly every capability that AutoAide already exposes through:

- terminal commands
- in-shell slash commands
- Telegram flows

The web console should become the main visual operations surface for:

- multi-bot management
- runtime operations
- Telegram channel operations
- session and turn management
- goals and schedules
- workspace inspection and editing
- skills management
- logs, health, and debugging

## Product Goal

The web console should feel like a multi-bot operations desktop, not a debug HTML page.

It should answer four user questions clearly:

1. What bots do I have, and which one is current?
2. Is this bot healthy, online, paired, and usable right now?
3. What is this bot doing across CLI, Telegram, goals, and schedules?
4. How do I change config, workspace, permissions, and runtime state without touching raw files?

## Design Principles

### 1. Replace raw JSON with task-oriented UI

Raw JSON should still exist for advanced users, but it must not be the only management path.

Examples:

- Telegram access should be shown as named users/chats with toggles and actions
- runtime controls should be buttons with visible health state
- session switching should be a list, not manual JSON editing

### 2. Bot-first navigation

The whole console is organized around bots.

Every operational surface should clearly answer:

- which bot is selected
- where its files live
- whether it is the current bot
- whether it is enabled and online

### 3. One console, multiple operating modes

The web console must support three kinds of work:

- fleet control
- per-bot operations
- direct interaction

This means it cannot just be an admin panel.

### 4. Progressive disclosure

The default surfaces should be understandable quickly.
Advanced details should still be available.

Examples:

- show named Telegram access entries by default
- expand to raw IDs only when needed
- show overview cards first, logs/config second

### 5. Preserve terminal truth

The web console must sit on top of the existing runtime model, not invent a different system.

It should reflect:

- bot-scoped config
- bot-scoped workspace
- bot-scoped sessions
- bot-scoped goals and schedules

## Scope

This design assumes the current AutoAide architecture:

- bot-scoped runtime
- current bot selection
- terminal commands for bot lifecycle
- in-shell slash commands for sessions and pairing
- Telegram bridge
- goals and schedules
- workspace bootstrap files

The web console should surface all of that.

## Information Architecture

### Top-Level Areas

The console should have these top-level areas:

- `Fleet`
- `Bot`
- `Chat`
- `Sessions`
- `Goals`
- `Schedules`
- `Workspace`
- `Skills`
- `Logs`
- `Config`

### Global Layout

```text
+----------------------------------------------------------------------------------+
| AutoAide Web Console                                                             |
| current bot: Astock | runtime: online | telegram: paired | sessions: 3 | errors |
+----------------------------------------------------------------------------------+
| Fleet rail            | Main workspace                                             |
|-----------------------|-----------------------------------------------------------|
| current: Astock       | tab bar: Overview | Chat | Sessions | Goals | Schedules |
| Default               |         Workspace | Skills | Logs | Config                |
| Astock                |                                                           |
| Research              | active tab content                                        |
|                       |                                                           |
| + New Bot             |                                                           |
+----------------------------------------------------------------------------------+
```

### Fleet Rail

The left rail should always show:

- all bots
- current bot badge
- status badge
- enabled/disabled state
- Telegram paired state
- runtime online/offline
- create bot action

Clicking a bot changes the main panel context.

## Page Tree

### 1. Fleet Overview

Purpose:

- show all bots at a glance
- manage lifecycle and current selection

Main functions:

- list bots
- create bot
- delete bot
- duplicate bot
- set current bot
- start / stop / restart
- enable / disable
- quick health summary

Suggested cards:

- total bots
- online bots
- paired bots
- bots with last error

### 2. Bot Overview

Purpose:

- summarize the selected bot

Main functions:

- show current bot metadata
- show runtime health
- show Telegram pairing state
- show active session
- show bootstrap status
- show last error
- quick actions

Suggested sections:

- identity
- runtime state
- Telegram state
- workspace state
- quick links

ASCII wireframe:

```text
+--------------------------------------------------------------+
| Astock                                                      |
| current bot | enabled | runtime online | telegram paired    |
+--------------------------------------------------------------+
| Runtime      | Telegram      | Workspace      | Sessions     |
| online       | paired        | bootstrap done | main active  |
| pid 63494    | @botname      | 6 files        | 3 sessions   |
+--------------------------------------------------------------+
| Quick Actions                                                |
| [Start] [Stop] [Restart] [Set Current] [Open Chat] [Logs]   |
+--------------------------------------------------------------+
| Recent Error                                                 |
| none                                                         |
+--------------------------------------------------------------+
```

### 3. Chat

Purpose:

- manage Telegram pairing and channel access
- inspect who can use the bot
- debug group/private behavior

Main functions:

- pair Telegram
- replace token
- show bot username
- show private chat allow list
- show group allow list
- show allowed users
- show recent seen chats and users
- add/remove access entries
- explain why group messages may be ignored

Required UX behavior:

- usernames and titles first
- raw IDs second
- copy raw ID when needed

Key views:

- `Pairing`
- `Access`
- `Seen Chats`
- `Seen Users`
- `Troubleshooting`

ASCII wireframe:

```text
+------------------------------------------------------------------+
| Telegram                                                         |
+------------------------------------------------------------------+
| Pairing                                                          |
| status: paired                                                   |
| bot username: @astock_bot                                        |
| paired user: @moshiwei                                           |
| [Re-pair] [Update Token]                                         |
+------------------------------------------------------------------+
| Private Access                                                   |
| @moshiwei (6994248212)                                           |
+------------------------------------------------------------------+
| Group Access                                                     |
| groups: any group                                                |
| users: @moshiwei (6994248212)                                    |
| mention required: yes                                            |
| [Add User] [Restrict Groups]                                     |
+------------------------------------------------------------------+
| Seen Groups                                                      |
| Astock Research Group (-100...) [Allow]                          |
| Trading Ops (-100...)         [Allow]                            |
+------------------------------------------------------------------+
| Troubleshooting                                                  |
| - Group Privacy may block updates                                |
| - Bot must be explicitly mentioned in groups                     |
| - Sender must be in allowed users                                |
+------------------------------------------------------------------+
```

### 4. Sessions

Purpose:

- replace session-related CLI commands with a visual surface

Main functions:

- list sessions
- create session
- switch active session
- show session resume ref
- show whether session is running
- stop active turn
- optionally rename/delete non-main sessions

Should also include:

- current session status
- per-session last activity

### 5. Chat Console

Purpose:

- let the user interact with the selected bot directly from the web UI

Main functions:

- input prompt
- send prompt to current session
- choose target session
- create new session from composer
- stream or incrementally render run status
- render final output
- stop current turn

This is the web equivalent of local CLI freeform interaction.

It should reuse:

- workspace context
- current bot config
- current session resume flow

### 6. Goals

Purpose:

- provide lifecycle control for goal execution

Main functions:

- list goals
- filter by status
- inspect a goal
- show phase / iteration / timestamps
- show history
- show artifacts
- rerun / resume / stop

Suggested list columns:

- id
- objective
- status
- phase
- session
- started at
- updated at

### 7. Schedules

Purpose:

- make schedule creation and operation manageable without chat commands

Main functions:

- list schedules
- create schedule
- edit cron and timezone
- edit objective
- disable / enable
- run now
- show next run / last run
- show linked goal history

Suggested UX:

- form-first schedule creation
- raw cron still allowed
- natural-language helper optional later

### 8. Workspace

Purpose:

- surface the bot workspace as an editable product object

Main functions:

- file tree
- open files
- edit files
- save files
- show bootstrap completion state
- highlight key files

Critical default files:

- `AGENTS.md`
- `IDENTITY.md`
- `USER.md`
- `SOUL.md`
- `TOOLS.md`
- `HEARTBEAT.md`

Optional later:

- memory browser
- diff view
- revision history

### 9. Skills

Purpose:

- surface installed skills and installation flows

Main functions:

- list installed skills
- inspect metadata
- install from path/zip
- show source and compatibility
- remove skill

### 10. Logs

Purpose:

- centralize runtime and bridge debugging

Main functions:

- runtime log view
- telegram bridge log view
- tail mode
- search
- copy selected logs

Optional later:

- structured event timeline
- error-only filter

### 11. Config

Purpose:

- provide advanced configuration editing

Main functions:

- form-based config editing for common fields
- raw JSON view for advanced edits
- save / validate
- compare current vs last saved

Common editable fields:

- bot name
- enabled
- desired version
- model
- Telegram token
- mention requirement
- allow lists

## Feature Coverage Matrix

The web console should eventually cover all current AutoAide actions.

### Terminal command coverage

Should cover:

- `autoaide bots`
- `autoaide bot current`
- `autoaide bot create`
- `autoaide bot use`
- `autoaide bot show`
- `autoaide bot config`
- `autoaide bot start`
- `autoaide bot stop`
- `autoaide bot restart`
- `autoaide bot enable`
- `autoaide bot disable`
- `autoaide bot logs`
- `autoaide web`
- rollout commands

### In-shell command coverage

Should cover:

- `/channel`
- `/status`
- `/where`
- `/sessions`
- `/new`
- `/switch`
- `/skills`
- `/restart`
- `/stop`
- direct freeform prompt execution

### Telegram operational coverage

Should cover:

- pairing state
- access policy
- recent seen chats/users
- group troubleshooting
- goal and schedule visibility

## API Surface Needed

The current web API is too thin.
It will need expansion.

### Existing endpoints

- `GET /api/bots`
- `GET /api/bots/:id`
- `GET /api/bots/:id/logs`
- `POST /api/bots/:id/start`
- `POST /api/bots/:id/stop`
- `POST /api/bots/:id/restart`
- `POST /api/bots/:id/config`

### New endpoints needed

#### Fleet

- `POST /api/bots`
- `DELETE /api/bots/:id`
- `POST /api/bots/:id/use`
- `GET /api/current-bot`

#### Sessions

- `GET /api/bots/:id/sessions`
- `POST /api/bots/:id/sessions`
- `POST /api/bots/:id/sessions/:label/use`
- `POST /api/bots/:id/sessions/:label/stop`
- `POST /api/bots/:id/chat`

#### Telegram

- `POST /api/bots/:id/telegram/pair`
- `POST /api/bots/:id/telegram/refresh-metadata`
- `GET /api/bots/:id/telegram/access`
- `POST /api/bots/:id/telegram/access`
- `DELETE /api/bots/:id/telegram/access`
- `GET /api/bots/:id/telegram/seen-chats`
- `GET /api/bots/:id/telegram/seen-users`

#### Goals

- `GET /api/bots/:id/goals`
- `GET /api/bots/:id/goals/:goalId`
- `POST /api/bots/:id/goals`
- `POST /api/bots/:id/goals/:goalId/stop`
- `POST /api/bots/:id/goals/:goalId/resume`

#### Schedules

- `GET /api/bots/:id/schedules`
- `POST /api/bots/:id/schedules`
- `POST /api/bots/:id/schedules/:scheduleId`
- `POST /api/bots/:id/schedules/:scheduleId/run`
- `POST /api/bots/:id/schedules/:scheduleId/disable`

#### Workspace

- `GET /api/bots/:id/workspace/tree`
- `GET /api/bots/:id/workspace/file?path=...`
- `POST /api/bots/:id/workspace/file`

#### Skills

- `GET /api/bots/:id/skills`
- `POST /api/bots/:id/skills/install`
- `DELETE /api/bots/:id/skills/:skillId`

## State Model

The web console should treat these as canonical:

- `~/.autoaide/control/registry.json`
- current active bot state
- `~/.autoaide/bots/<id>/config.json`
- `cli-sessions.json`
- `bootstrap-state.json`
- `schedules.json`
- bot-scoped logs
- workspace files

The web console should not invent a parallel state store.

## UX Requirements

### Required

- current bot always visible
- every destructive action confirmed
- online/offline state visually obvious
- raw JSON available but secondary
- names shown before raw Telegram IDs
- copy raw IDs easily
- errors surfaced inline, not buried only in logs

### Nice to have

- keyboard shortcuts
- quick search across bots
- dark mode later
- optimistic updates for start/stop/restart
- event activity rail

## Implementation Phases

### Phase 1: Real Control Plane

Goal:

- replace current thin admin page with a proper bot operations console

Include:

- fleet rail
- current bot selection
- create/delete/use bot
- overview tab
- Telegram access display
- improved logs
- form-based config editing

### Phase 2: Interactive Console

Goal:

- let web substitute for most local CLI use

Include:

- session tab
- chat tab
- prompt composer
- stop current turn
- session creation and switching
- workspace browser/editor

### Phase 3: Full Operations Desktop

Goal:

- web covers the rest of AutoAide product operations

Include:

- goals tab
- schedules tab
- skills tab
- rollout tools
- event timeline
- Telegram debugging views

## Risks

### 1. Scope explosion

If implemented without phases, the console will become a giant partial rewrite.

Mitigation:

- build in phases
- keep each tab tied to existing runtime APIs

### 2. Divergent semantics vs CLI

If web invents new concepts, users will get inconsistent behavior.

Mitigation:

- use the same bot/session/config/runtime model everywhere

### 3. Too much raw JSON

If raw JSON stays the dominant surface, the product still feels unfinished.

Mitigation:

- convert common operations into forms and named entities first

### 4. Weak troubleshooting

Telegram issues are hard to diagnose without clear explanation.

Mitigation:

- build explicit debug and access explanation surfaces

## Recommended Next Step

Start with a concrete Phase 1 implementation spec.

That follow-up spec should define:

- exact tab structure
- exact card layout
- API contracts for fleet, bot use, and Telegram access
- component list
- one implementation PR slice at a time
