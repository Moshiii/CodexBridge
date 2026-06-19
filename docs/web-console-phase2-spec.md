# CodexBridge Web Console Phase 2 Spec

## Purpose

Phase 2 turns the web console from a bot operations surface into a daily interaction surface.

After Phase 2, a user should be able to use the browser for most current CLI session work:

- inspect sessions
- create sessions
- switch sessions
- send prompts
- inspect outputs
- stop running turns

## Goal

Deliver a browser-based session and chat console for the selected bot.

## Non-Goals

Phase 2 does not include:

- goals UI
- schedules UI
- workspace editing
- skills management
- rollout operations
- full Telegram admin/debugging UI

## User Stories

- As a user, I can see all sessions for the selected bot.
- As a user, I can create a new session from web.
- As a user, I can switch the active session from web.
- As a user, I can send a prompt to the selected bot/session from web.
- As a user, I can see command status and final output.
- As a user, I can stop the active run.

## Deliverable

Phase 2 extends the Phase 1 tabs with:

- `Sessions`
- `Chat`

## Screen Layout

```text
+----------------------------------------------------------------------------------+
| current bot: Astock | current session: main | run: idle                         |
+----------------------------------------------------------------------------------+
| Fleet rail            | Main panel                                                 |
|-----------------------|-----------------------------------------------------------|
| bots...               | Tabs: Overview | Telegram | Sessions | Chat | Logs | ... |
|                       |                                                           |
|                       | Sessions tab or Chat tab                                  |
+----------------------------------------------------------------------------------+
```

## Sessions Tab

### Purpose

Let the user manage the selected bot's session state.

### Sections

#### Session list

Each row shows:

- session label
- active yes/no
- started/not-started
- running yes/no
- resume ref if present
- updated at

#### Actions

- `Create Session`
- `Use Session`
- `Stop Turn`

### Behavior

- active session is visually highlighted
- running session shows active badge
- main session is pinned or clearly marked

## Chat Tab

### Purpose

Let the user run direct prompts against the selected bot.

### Sections

#### Chat toolbar

- selected session
- current bot
- run state
- stop button

#### Composer

- multi-line input
- run button
- optional session selector

#### Output area

- status updates
- final rendered output
- failure output

### Required behavior

- use the same workspace context model as CLI
- use the same session resume model as CLI
- use the same bot-scoped config
- support one active run per selected session

## Backend API Spec

### `GET /api/bots/:id/sessions`

Response:

```json
{
  "botId": "astock",
  "activeSessionLabel": "main",
  "sessions": [
    {
      "label": "main",
      "cliSessionRef": "abc123",
      "running": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### `POST /api/bots/:id/sessions`

Request:

```json
{
  "label": "research"
}
```

### `POST /api/bots/:id/sessions/:label/use`

Purpose:

- set active session for web/CLI-shared state

### `POST /api/bots/:id/sessions/:label/stop`

Purpose:

- stop the running turn in that session if one exists

### `POST /api/bots/:id/chat`

Request:

```json
{
  "sessionLabel": "main",
  "message": "summarize this repo"
}
```

Response model v1:

```json
{
  "runId": "run_123",
  "status": "started"
}
```

### `GET /api/bots/:id/chat/:runId`

Purpose:

- poll run status and result

Response:

```json
{
  "runId": "run_123",
  "status": "running",
  "sessionLabel": "main",
  "output": "",
  "stderr": "",
  "result": null
}
```

## Frontend Components

- `SessionsTab`
- `SessionList`
- `SessionRow`
- `CreateSessionModal`
- `ChatTab`
- `PromptComposer`
- `RunStatusBar`
- `OutputPanel`

## State Model

Add:

- `selectedSessionLabel`
- `sessionList`
- `activeRun`
- `activeRunPollState`

## Interaction Flows

### Create session

```text
User -> open create session modal
User -> enter label
Frontend -> POST /api/bots/:id/sessions
Frontend -> refresh sessions
Frontend -> select new session
```

### Send prompt

```text
User -> enter prompt
Frontend -> POST /api/bots/:id/chat
Backend -> start Codex turn
Frontend -> poll run status
Frontend -> render final output
```

### Stop run

```text
User -> click stop
Frontend -> POST /api/bots/:id/sessions/:label/stop
Backend -> stop turn
Frontend -> refresh run state
```

## Testing

### Backend

- list sessions
- create session
- switch session
- stop session run
- create chat run
- poll chat run status

### Manual acceptance

1. open bot
2. create new session
3. switch session
4. run prompt
5. inspect output
6. stop a run

## PR Breakdown

### PR 1

- session list/create/use endpoints
- tests

### PR 2

- chat run backend
- run status polling endpoint
- tests

### PR 3

- Sessions tab UI

### PR 4

- Chat tab UI
- polling and stop flow

## Exit Criteria

- web can manage sessions
- web can run prompts
- web can stop active runs
- browser can replace most current CLI session work
