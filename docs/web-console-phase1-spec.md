# AutoAide Web Console Phase 1 Spec

## Purpose

This document specifies Phase 1 of the AutoAide web console build.

Phase 1 is the point where the current thin control plane becomes a real bot operations console.

This spec is implementation-oriented.
It is intended to support direct execution work.

## Phase 1 Goal

Deliver a web console that allows a user to manage the bot fleet and inspect the selected bot without needing the terminal for normal bot operations.

After Phase 1, the user should be able to do all of the following from the browser:

- see all bots
- create a bot
- delete a non-default bot
- set the current bot
- enable or disable a bot
- start, stop, restart a bot
- inspect bot overview
- inspect Telegram access summary
- inspect recent logs
- edit common config values

## Non-Goals

Phase 1 does not include:

- prompt/chat execution from web
- session creation/switching
- goals UI
- schedules UI
- workspace file editing
- skills management UI
- rollout UI

Those belong to later phases.

## User Stories

### Fleet management

- As a user, I can see all bots and which bot is current.
- As a user, I can create a new bot without using terminal commands.
- As a user, I can switch the current bot from the web UI.
- As a user, I can delete a bot that I no longer want.

### Runtime operations

- As a user, I can start, stop, or restart a bot from the browser.
- As a user, I can see whether a bot is healthy and online.
- As a user, I can see the last known error.

### Bot inspection

- As a user, I can inspect a selected bot’s runtime state, Telegram state, and workspace status.
- As a user, I can inspect named Telegram access instead of only raw IDs.

### Config operations

- As a user, I can update common bot config fields through a form.
- As a power user, I can still inspect and edit raw config JSON.

## Deliverable

Phase 1 should deliver a single browser console with:

- a persistent fleet rail
- a selected bot main panel
- a tabbed detail area
- basic modal flows for bot creation and destructive confirmation

## Page Structure

Phase 1 uses one primary route:

- `/`

The entire console is a single-page application with local tab state.

## Screen Layout

```text
+------------------------------------------------------------------------------------+
| AutoAide Web Console                                                               |
| current bot: Astock | runtime: online | telegram: paired | enabled | no errors    |
+------------------------------------------------------------------------------------+
| Fleet rail                  | Main panel                                            |
|----------------------------|-------------------------------------------------------|
| + New Bot                  | Bot header                                             |
|                            | Astock | current | running | paired                   |
| Default                    | [Start] [Stop] [Restart] [Enable/Disable] [Set Current]|
| current, running           |                                                       |
|                            | Tabs: Overview | Telegram | Logs | Config             |
| Astock                     |                                                       |
| running, paired            | selected tab content                                  |
|                            |                                                       |
| Research                   |                                                       |
| stopped                    |                                                       |
|                            |                                                       |
+------------------------------------------------------------------------------------+
```

## Tabs

Phase 1 tabs:

- `Overview`
- `Telegram`
- `Logs`
- `Config`

## Overview Tab

### Purpose

Show the selected bot’s operational state in a compact way.

### Sections

#### Bot identity card

Fields:

- id
- name
- current bot yes/no
- enabled yes/no
- channel
- desired version
- running version

#### Runtime card

Fields:

- status
- runtime pid
- healthy yes/no
- last started at
- last stopped at
- log path

#### Telegram card

Fields:

- paired yes/no
- bot username
- private access summary
- group access summary
- mention required yes/no

#### Workspace/bootstrap card

Fields:

- workspace path
- bootstrap completed yes/no
- bootstrap state path

#### Error card

Fields:

- last error

Behavior:

- hidden when no error
- visible and highlighted when error exists

## Telegram Tab

### Purpose

Surface Telegram pairing and access as named entities.

### Sections

#### Pairing section

Fields:

- paired yes/no
- bot username
- token presence yes/no
- paired private user if known

Actions:

- `Pair / Re-pair`
- `Refresh Metadata`

#### Private Access section

Display:

- named private chats
- raw ID secondary

#### Group Access section

Display:

- named allowed users
- named allowed groups
- mention required yes/no

Actions:

- toggle mention requirement

Phase 1 note:

- no full add/remove access editor yet
- summary only plus metadata refresh

## Logs Tab

### Purpose

Let the user quickly inspect runtime logs without leaving the browser.

### Sections

#### Runtime log

- recent runtime log content
- refresh action

#### Bridge log

- recent telegram bridge log content
- refresh action

### Behavior

- default to showing the most recent N lines
- preserve scroll within panel
- simple plain text display is acceptable in Phase 1

## Config Tab

### Purpose

Allow common bot config changes without editing raw JSON manually.

### Structure

Two sections:

1. Form editor
2. Raw JSON editor

### Form fields

#### General

- name
- enabled
- desired version
- model

#### Telegram

- Telegram enabled
- bot username
- mention required

Phase 1 note:

- token should be displayed with caution
- token editing may remain raw or masked text input

### Raw editor

Display:

- full normalized bot config

Actions:

- save raw config
- reload

Validation:

- invalid JSON should not be saved
- save errors displayed inline

## Fleet Rail Spec

### Each bot row should show

- name
- id
- current badge if selected current bot
- status badge
- enabled badge
- paired badge if Telegram enabled

### Bot row actions

Phase 1 can keep actions in the main panel only.

Required row behavior:

- clicking row selects bot
- selected row is visibly highlighted

### Fleet rail global action

- `+ New Bot`

Opens create bot modal.

## Create Bot Modal

### Fields

- bot id
- bot name
- enabled on create yes/no

### Validation

- id required
- id normalized using current bot id rules
- duplicate ids rejected

### Success behavior

- create bot
- refresh fleet
- select new bot
- optionally set current later via explicit action, not automatically

## Main Header Actions

For selected bot:

- `Start`
- `Stop`
- `Restart`
- `Enable` or `Disable`
- `Set Current`
- `Delete` for non-default bot only

### Action behavior

All mutations should:

1. call backend
2. refresh selected bot detail
3. refresh fleet summary
4. show success or error message

## Data Model Requirements

The frontend will need these data shapes.

### Fleet item

```json
{
  "id": "research",
  "name": "Research",
  "status": "running",
  "enabled": true,
  "runtimePid": 12345,
  "botUsername": "research_bot",
  "lastError": null,
  "isCurrent": false,
  "telegramPaired": true
}
```

### Bot detail

```json
{
  "detail": {
    "bot": {},
    "config": {},
    "paths": {}
  },
  "health": {},
  "logs": {},
  "access": {
    "privateChats": [],
    "groupChats": [],
    "groupUsers": []
  },
  "currentBotId": "research",
  "bootstrap": {
    "completed": true
  }
}
```

## Backend API Spec

### 1. `GET /api/bots`

Purpose:

- load fleet rail

Response:

```json
{
  "generatedAt": "2026-04-03T00:00:00.000Z",
  "currentBotId": "astock",
  "bots": [
    {
      "id": "default",
      "name": "Default",
      "status": "running",
      "enabled": true,
      "runtimePid": 123,
      "botUsername": "default_bot",
      "lastError": null,
      "isCurrent": false,
      "telegramPaired": true
    }
  ]
}
```

### 2. `POST /api/bots`

Purpose:

- create bot

Request:

```json
{
  "id": "research",
  "name": "Research",
  "enabled": false
}
```

Response:

- created bot summary

### 3. `DELETE /api/bots/:id`

Purpose:

- delete bot

Rules:

- default bot cannot be deleted

### 4. `GET /api/current-bot`

Purpose:

- get currently selected bot

Response:

```json
{
  "currentBotId": "astock"
}
```

### 5. `POST /api/bots/:id/use`

Purpose:

- set current bot

Response:

```json
{
  "currentBotId": "astock"
}
```

### 6. `POST /api/bots/:id/enable`

Purpose:

- enable bot

### 7. `POST /api/bots/:id/disable`

Purpose:

- disable bot

### 8. `GET /api/bots/:id`

Purpose:

- load selected bot detail

Must include:

- bot detail
- health
- logs
- access summary
- currentBotId

### 9. `POST /api/bots/:id/start`

Existing, keep.

### 10. `POST /api/bots/:id/stop`

Existing, keep.

### 11. `POST /api/bots/:id/restart`

Existing, keep.

### 12. `POST /api/bots/:id/config`

Existing, keep.

### 13. `POST /api/bots/:id/telegram/refresh-metadata`

Purpose:

- force Telegram name/title hydration

Response:

- updated config or updated access summary

## Frontend Component Inventory

### App shell

- `WebConsoleApp`
- `HeaderBar`
- `FleetRail`
- `MainPanel`

### Fleet

- `BotList`
- `BotListItem`
- `CreateBotModal`

### Bot detail

- `BotHeader`
- `BotActionBar`
- `BotTabs`
- `OverviewTab`
- `TelegramTab`
- `LogsTab`
- `ConfigTab`

### Reusable UI

- `StatusBadge`
- `KeyValueGrid`
- `NamedAccessList`
- `ConfirmDialog`
- `Toast`
- `JsonEditor`
- `LogPanel`

## State Management Spec

Phase 1 should use simple local state, not heavy client architecture.

Recommended state buckets:

- `fleet`
- `selectedBotId`
- `currentBotId`
- `selectedBotDetail`
- `activeTab`
- `ui`
  - create modal open/closed
  - pending action
  - error/success toast

### Fetch strategy

- load fleet on app boot
- default selected bot:
  - current bot if available
  - otherwise first bot in fleet
- load detail whenever selected bot changes
- after mutation:
  - refresh fleet
  - refresh selected bot detail

## Interaction Flows

### Flow 1: Create Bot

```text
User -> open create bot modal
User -> enter id/name
User -> submit
Frontend -> POST /api/bots
Backend -> create bot + bot home + config
Frontend -> refresh fleet
Frontend -> select new bot
Frontend -> load detail
```

### Flow 2: Set Current Bot

```text
User -> click "Set Current"
Frontend -> POST /api/bots/:id/use
Backend -> update current bot state
Frontend -> refresh fleet
Frontend -> refresh detail header
```

### Flow 3: Restart Bot

```text
User -> click restart
Frontend -> POST /api/bots/:id/restart
Backend -> stopBot + startBot
Frontend -> refresh fleet
Frontend -> refresh detail
Frontend -> show success or error
```

### Flow 4: Save Config Form

```text
User -> edit form fields
User -> save
Frontend -> build patch
Frontend -> POST /api/bots/:id/config
Backend -> deep-merge config and persist
Frontend -> refresh detail
Frontend -> refresh fleet if summary fields changed
```

## Error Handling Spec

### Mutation errors

Must display inline or toast:

- create failed
- delete failed
- start/stop/restart failed
- config save failed
- metadata refresh failed

### Load errors

Must not blank the whole app.

Behavior:

- fleet load failure: show reload card
- detail load failure: show error panel in main area

## Design Requirements

Phase 1 should look productized, not like a raw admin page.

### Requirements

- persistent left rail
- clear selected state
- strong status badges
- obvious action grouping
- named Telegram entities before raw IDs
- visually distinct error state

### Avoid

- giant raw JSON blobs as the primary UI
- tiny unlabeled icon-only buttons
- hidden current bot state

## Testing Plan

### Backend tests

Add coverage for:

- create bot endpoint
- delete bot endpoint
- use bot endpoint
- current bot endpoint
- enable/disable endpoints
- metadata refresh endpoint

### Manual web acceptance

1. open web console
2. confirm fleet loads
3. create bot
4. select bot
5. set current bot
6. enable/disable bot
7. start/stop/restart bot
8. inspect logs
9. edit config form and save
10. confirm access summary displays names where available

## Suggested PR Breakdown

### PR 1

- backend endpoints for current bot, create, use, enable, disable, delete
- tests

### PR 2

- replace current web layout with app shell + fleet rail + selected bot panel
- load fleet and bot detail

### PR 3

- bot action bar
- start/stop/restart/use/enable/disable/delete flows

### PR 4

- overview and telegram tabs
- named access lists
- metadata refresh

### PR 5

- config tab with form editor + raw JSON fallback
- save flows and validation

### PR 6

- logs tab polish
- UX cleanup
- docs update

## Exit Criteria

Phase 1 is complete when:

- the user can manage bots fully from the browser
- the current bot is visible and switchable
- the selected bot can be started, stopped, restarted, enabled, and disabled
- Telegram access is visible in named form
- common config editing is available without raw JSON
- the console is stable enough to be used daily for bot operations

## Immediate Next Step

Implement PR 1 first.

That is the minimum backend needed before the frontend can evolve from the current thin page into the intended fleet console.
