# CodexBridge Web Console Phased Development Plan

## Purpose

This document turns the web console design into an execution plan.

It answers:

- what should be built first
- what each phase includes
- what each phase explicitly does not include
- what APIs and backend work are needed
- how to know a phase is done

This plan assumes:

- the current bot-scoped runtime model is the source of truth
- the terminal and CLI flows already exist
- the web console should progressively reach feature parity with the rest of CodexBridge

## Planning Principles

### 1. Build vertical slices

Each phase should produce a usable surface.

Do not build:

- all backend endpoints first
- all frontend components first
- all docs first

Instead, each phase should produce an end-to-end workflow.

### 2. Preserve semantic parity

The web console must reuse the same runtime model as:

- terminal commands
- in-shell CLI
- Telegram bridge

No special web-only state model should be introduced.

### 3. Prioritize visibility before convenience

Before adding sophisticated UI interactions, the console should make system state clear:

- which bot is active
- what is online
- what is configured
- what is failing
- what permissions exist

### 4. Prefer forms over raw JSON for common operations

Raw JSON should remain available for advanced editing.
But normal flows should become guided.

## Delivery Strategy

The work should be delivered in five phases.

Each phase is independently valuable.

## Phase 0: Stabilize the Existing Control Plane

### Goal

Make the current web page reliable enough to extend safely.

### Why this phase exists

The current web surface is very thin and recently changed.
Before expanding it, the baseline should be stable and consistent.

### Scope

- fix HTML/content-type issues
- make startup UX clearer
- improve error handling for bot actions
- ensure current bot and access summaries can be displayed correctly
- ensure Telegram metadata hydration works from existing configs
- confirm current endpoints behave consistently

### Backend work

- harden current `control-plane-web.mjs`
- add/keep tests for:
  - page load
  - bot detail
  - config update
  - access summary

### Frontend work

- keep current layout
- improve feedback messages
- ensure action failures are surfaced in-page

### Out of scope

- no major IA change yet
- no session console
- no goal/schedule UI yet

### Exit criteria

- web home loads correctly in browser
- start/stop/restart works with clear feedback
- access block shows readable Telegram identities where available
- no raw HTML rendering bug

## Phase 1: Fleet and Bot Operations Console

### Goal

Turn the web page into a real multi-bot operations surface.

### User value

Users can manage bots without dropping to the terminal.

### Core workflows

1. View all bots
2. Create a new bot
3. Set the current bot
4. Enable/disable a bot
5. Start/stop/restart a bot
6. Inspect bot overview and recent logs
7. Manage Telegram pairing and access at a basic level

### Scope

#### Fleet rail

- list all bots
- current bot badge
- online/offline badge
- enabled/disabled badge
- Telegram paired badge
- create bot button

#### Bot overview tab

- bot identity
- current bot state
- runtime health
- Telegram health
- bootstrap status
- recent error
- quick actions

#### Basic bot actions

- create
- delete
- set current
- enable
- disable
- start
- stop
- restart

#### Telegram access summary

- private chats
- group chats
- group users
- mention requirement
- pairing status

#### Config editor v1

- common fields as form inputs
- raw JSON fallback below

### Required backend work

New endpoints:

- `GET /api/current-bot`
- `POST /api/bots`
- `DELETE /api/bots/:id`
- `POST /api/bots/:id/use`
- `POST /api/bots/:id/enable`
- `POST /api/bots/:id/disable`

Adjust current payloads to include:

- current bot id
- bootstrap summary
- Telegram access summary

### Required frontend work

- replace simple two-panel page with:
  - fleet rail
  - bot main panel
- add create bot modal
- add action toolbar
- add current bot controls

### Out of scope

- no direct prompt chat yet
- no workspace editor yet
- no goals/schedules editor yet

### Exit criteria

- user can manage multiple bots fully from the web
- current bot can be switched in web
- terminal is no longer required for basic bot lifecycle

## Phase 2: Session and Chat Console

### Goal

Make the web UI capable of replacing most day-to-day CLI usage.

### User value

Users can interact with a bot directly from the browser.

### Core workflows

1. View sessions for the selected bot
2. Create a new session
3. Switch active session
4. Send a prompt to the selected session
5. See run status and final output
6. Stop a running turn

### Scope

#### Sessions tab

- list sessions
- show current session
- show started/not-started
- show resume ref
- create new session
- switch session

#### Chat tab

- prompt input
- run button
- choose target session
- output view
- current run status
- stop current run

#### Session inspection

- last update time
- whether a run is active
- latest output snippet later if easy

### Required backend work

New endpoints:

- `GET /api/bots/:id/sessions`
- `POST /api/bots/:id/sessions`
- `POST /api/bots/:id/sessions/:label/use`
- `POST /api/bots/:id/sessions/:label/stop`
- `POST /api/bots/:id/chat`

Possible implementation note:

- reuse CLI session state
- reuse `startCliTurn`
- add minimal web-safe status/event response model

### Required frontend work

- session list component
- composer panel
- output panel
- run state badge
- stop button

### Out of scope

- no streaming token-by-token requirement yet
- no rich chat history storage requirement yet
- no workspace diff/editor integration yet

### Exit criteria

- user can create/switch sessions in web
- user can execute real turns from web
- user can stop a running turn from web

## Phase 3: Telegram Operations and Debugging Console

### Goal

Make Telegram setup and troubleshooting manageable from the web UI.

### User value

Users no longer have to infer Telegram failures from silent behavior or raw config.

### Core workflows

1. Pair a bot with Telegram
2. Re-pair a bot
3. Inspect access rules
4. See named chats/users instead of raw IDs
5. See recently observed groups/users
6. Understand why a group message was ignored

### Scope

#### Pairing flow

- token entry
- instructions
- result summary
- paired user summary
- runtime pause/restart messaging

#### Access management

- show private chats
- show group users
- show group restrictions
- add/remove allow entries
- toggle mention requirement

#### Seen entities

- recently seen groups
- recently seen users
- convert seen entries into allow entries

#### Troubleshooting panel

- likely privacy mode issue
- sender not allowed
- group not allowed
- bot not mentioned
- runtime offline

### Required backend work

New endpoints:

- `POST /api/bots/:id/telegram/pair`
- `GET /api/bots/:id/telegram/access`
- `POST /api/bots/:id/telegram/access`
- `DELETE /api/bots/:id/telegram/access`
- `GET /api/bots/:id/telegram/seen-chats`
- `GET /api/bots/:id/telegram/seen-users`
- `GET /api/bots/:id/telegram/debug`

### Required frontend work

- pairing modal/wizard
- named access lists
- add/remove access controls
- troubleshooting callouts

### Out of scope

- no webhook mode
- no full Telegram transcript browser yet

### Exit criteria

- pairing can be initiated from web
- access can be managed from web
- Telegram failure causes are visible enough to debug without code reading

## Phase 4: Goals and Schedules Console

### Goal

Bring long-running and scheduled workflows into the web UI.

### User value

Users can operate goals and schedules visually without Telegram commands or raw files.

### Core workflows

1. Create a goal
2. Inspect a running goal
3. Stop/resume a goal
4. Create a schedule
5. Inspect schedule history
6. Run a schedule now
7. Disable a schedule

### Scope

#### Goals tab

- list
- filter by state
- inspect
- show history
- stop/resume

#### Schedules tab

- list
- create
- edit
- disable
- run now
- link to produced goals

### Required backend work

New endpoints:

- `GET /api/bots/:id/goals`
- `GET /api/bots/:id/goals/:goalId`
- `POST /api/bots/:id/goals`
- `POST /api/bots/:id/goals/:goalId/stop`
- `POST /api/bots/:id/goals/:goalId/resume`
- `GET /api/bots/:id/schedules`
- `POST /api/bots/:id/schedules`
- `POST /api/bots/:id/schedules/:scheduleId`
- `POST /api/bots/:id/schedules/:scheduleId/run`
- `POST /api/bots/:id/schedules/:scheduleId/disable`

### Required frontend work

- list/detail split views
- status badges
- history pane
- schedule form

### Out of scope

- no advanced calendar visualization required yet
- no schedule simulation view required yet

### Exit criteria

- user can create, inspect, and control goals and schedules from web

## Phase 5: Workspace and Skills Console

### Goal

Surface the bot workspace and skills system as first-class product objects.

### User value

Users can understand and edit the bot’s persistent operating context visually.

### Core workflows

1. Open key workspace files
2. Edit and save workspace files
3. See bootstrap state
4. View installed skills
5. Install a skill
6. Remove a skill

### Scope

#### Workspace tab

- file tree
- editor
- save action
- bootstrap markers
- key file shortcuts

#### Skills tab

- installed skills list
- skill metadata
- install form
- remove action

### Required backend work

New endpoints:

- `GET /api/bots/:id/workspace/tree`
- `GET /api/bots/:id/workspace/file`
- `POST /api/bots/:id/workspace/file`
- `GET /api/bots/:id/skills`
- `POST /api/bots/:id/skills/install`
- `DELETE /api/bots/:id/skills/:skillId`

### Required frontend work

- file explorer
- text editor
- skill cards
- install modal

### Out of scope

- no full revision history requirement yet
- no collaborative editing

### Exit criteria

- user can manage workspace files and skills entirely from the browser

## Phase Dependencies

### Hard dependencies

- Phase 1 must precede all later phases
- Phase 2 depends on stable current bot and bot detail views
- Phase 3 depends on Phase 1 bot detail and pairing state surfaces
- Phase 4 depends on mature bot detail and navigation
- Phase 5 depends on mature per-bot tab structure

### Soft dependencies

- Telegram metadata and access summary improvements help Phase 3
- current bot persistence is already available and should be reused
- workspace file APIs can be introduced earlier if needed

## Suggested Delivery Order Inside Each Phase

Use this pattern repeatedly:

1. backend endpoint
2. test coverage
3. basic UI rendering
4. happy-path mutation
5. error handling
6. polish and docs

## Milestone Checklist

### Milestone A

- Phase 0 complete
- web is stable enough to use daily for inspection

### Milestone B

- Phase 1 complete
- terminal no longer required for basic bot fleet management

### Milestone C

- Phase 2 complete
- browser can replace most CLI interactions

### Milestone D

- Phase 3 complete
- Telegram pairing and debugging are manageable visually

### Milestone E

- Phase 4 complete
- goals and schedules are first-class in web

### Milestone F

- Phase 5 complete
- workspace and skills are fully surfaced

## Recommended Immediate Next Step

Write a Phase 1 implementation spec with:

- exact route tree
- tab list
- component inventory
- API payload shapes
- first PR slices

That should be the build document used for implementation.
