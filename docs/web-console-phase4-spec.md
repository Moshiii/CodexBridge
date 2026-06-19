# CodexBridge Web Console Phase 4 Spec

## Purpose

Phase 4 brings goals and schedules into the web console.

After Phase 4, long-running and scheduled work should be manageable visually.

## Goal

Deliver goal and schedule operations in the browser.

## Non-Goals

- no advanced calendar UI required
- no cross-bot orchestration UI required

## User Stories

- As a user, I can inspect all goals for a bot.
- As a user, I can inspect a single goal's status, history, and artifacts.
- As a user, I can stop or resume a goal.
- As a user, I can create a schedule from the browser.
- As a user, I can run a schedule now.
- As a user, I can disable a schedule.

## Deliverable

Two new tabs:

- `Goals`
- `Schedules`

## Goals Tab

### List view

Columns:

- id
- objective
- status
- phase
- session label
- updated at

### Detail view

Sections:

- summary
- history
- artifacts
- result/error

Actions:

- stop
- resume
- rerun later if supported

## Schedules Tab

### List view

Columns:

- id
- cron
- timezone
- objective
- enabled
- last run
- last goal id

### Detail/editor view

Fields:

- cron
- timezone
- objective
- enabled

Actions:

- save
- run now
- disable

## Backend API Spec

### `GET /api/bots/:id/goals`

### `GET /api/bots/:id/goals/:goalId`

### `POST /api/bots/:id/goals`

### `POST /api/bots/:id/goals/:goalId/stop`

### `POST /api/bots/:id/goals/:goalId/resume`

### `GET /api/bots/:id/schedules`

### `POST /api/bots/:id/schedules`

### `POST /api/bots/:id/schedules/:scheduleId`

### `POST /api/bots/:id/schedules/:scheduleId/run`

### `POST /api/bots/:id/schedules/:scheduleId/disable`

## Frontend Components

- `GoalsTab`
- `GoalList`
- `GoalDetail`
- `ScheduleTab`
- `ScheduleList`
- `ScheduleEditor`

## Interaction Flows

### Create schedule

```text
User -> open create schedule form
User -> fill cron/timezone/objective
Frontend -> POST /schedules
Frontend -> refresh schedule list
```

### Inspect goal

```text
User -> click goal row
Frontend -> GET /goals/:goalId
Frontend -> render detail
```

## Testing

- goal list/detail
- stop/resume goal
- schedule create/update/run/disable

## PR Breakdown

### PR 1

- goal APIs

### PR 2

- schedule APIs

### PR 3

- goals tab UI

### PR 4

- schedules tab UI

## Exit Criteria

- goals visible and controllable in web
- schedules creatable and operable in web
