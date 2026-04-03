# `/goal` Implementation Plan

> Historical draft. This plan references daemon-era internals that are no longer part of the current implementation.

## Purpose

This document turns the `/goal` long-task design into a practical implementation plan for the current `AutoAide` repo.

It answers:

- what to build first
- which files should change
- what state needs to be added
- how to keep the implementation thin

## Implementation Principle

Do not build a new agent runtime.

Build a thin goal layer that reuses:

- daemon lifecycle
- Telegram bridge
- Codex session resume
- workspace context injection

## Phase 0: Constraint Lock

Before writing code, lock these constraints:

1. one goal maps to one worker session and one evaluator session
2. no parallel workers in v1
3. no autonomous recurring goals in v1
4. Telegram and CLI are front-ends, not the long-task engine
5. goal state is file-backed first, database later

This prevents scope drift.

## Phase 1: Goal State

## Deliverable

Add persistent goal state under `~/.autoaide/goals/`.

### Recommended new paths

- `~/.autoaide/goals/`
- `~/.autoaide/goals/index.json`
- `~/.autoaide/goals/<goal-id>.json`

### Why file-backed first

- easy to debug
- matches the current product stage
- consistent with existing JSON state files
- easy to migrate later

### Recommended state helpers

Create a new module:

- `src/goals-state.mjs`

Responsibilities:

- create goal IDs
- read and write goal files
- list goals
- update status
- append short goal log events

### Suggested goal structure

```json
{
  "id": "goal_20260401_001",
  "objective": "turn notes into a project brief",
  "status": "running",
  "chatId": "6994248212",
  "createdFrom": "telegram",
  "sessionLabel": "main",
  "workerSessionLabel": "goal:goal_20260401_001:worker",
  "evaluatorSessionLabel": "goal:goal_20260401_001:evaluator",
  "workerSessionRef": null,
  "evaluatorSessionRef": null,
  "iteration": 0,
  "artifacts": [],
  "lastWorkerSummary": null,
  "lastEvaluatorVerdict": null,
  "createdAt": "2026-04-01T12:00:00.000Z",
  "updatedAt": "2026-04-01T12:00:00.000Z",
  "log": []
}
```

## Phase 2: Command Surface

## Deliverable

Teach Telegram bridge and later CLI to understand goal commands.

### v1 command set

- `/goal <objective>`
- `/goals`
- `/goal-status <id>`
- `/goal-stop <id>`
- `/goal-resume <id>`

### File to update first

- `plugins/telegram-codex/telegram-codex-bridge.mjs`

### What each command should do

#### `/goal <objective>`

- validate input
- create goal record
- reply with goal ID and initial state
- trigger goal runner

#### `/goals`

- list active goals
- include short status line

#### `/goal-status <id>`

- return:
  - objective
  - current status
  - current iteration
  - latest worker summary
  - latest evaluator verdict

#### `/goal-stop <id>`

- mark `stopped`
- if current run is active, request cancellation

#### `/goal-resume <id>`

- move `stopped` or `blocked` goal back to `running`
- enqueue next worker iteration

## Phase 3: Goal Runner

## Deliverable

Add a separate goal execution module.

### Recommended new module

- `src/goal-runner.mjs`

Responsibilities:

- fetch a goal
- run worker iteration
- run evaluator iteration
- persist updates
- schedule the next step

### Why a dedicated module matters

Do not let Telegram bridge become the orchestration engine.

Telegram bridge should remain:

- input router
- output notifier

The goal runner should own:

- execution logic
- iteration sequencing
- persistence updates

## Goal runner API suggestion

```js
startGoalRun(goalId, options)
stopGoalRun(goalId)
getGoalStatus(goalId)
listGoals()
```

## Phase 4: Worker Iteration

## Deliverable

Run a worker Codex turn in a dedicated worker session.

### Reuse

Reuse:

- `buildWorkspacePrompt()`
- `startCliTurn()`
- `runCliTurn()`
- Codex `resume` support

### Prompt contract

The worker prompt should include:

- objective
- current iteration number
- known artifacts
- previous evaluator guidance
- any user-provided workspace file paths

### New helper module

Recommended:

- `src/goal-prompts.mjs`

Responsibilities:

- build worker prompt
- build evaluator prompt

This avoids polluting Telegram bridge with prompt logic.

### Worker output capture

From each worker run, capture:

- final text
- session ref
- any output files in known directories
- a compact summary

The summary should be explicitly generated or extracted, not inferred from raw stdout later.

## Phase 5: Evaluator Iteration

## Deliverable

Run a separate Codex turn in the evaluator session.

### Evaluator contract

Evaluator should return one of:

- `continue`
- `complete`
- `blocked`
- `retry`
- `failed`

And one short summary:

- what the worker achieved
- what should happen next

### Important constraint

Evaluator should not become a second planner.

It should only answer:

1. Is the current result enough?
2. If not, what is the next step?

## Phase 6: Progress Notifications

## Deliverable

Expose the worker/evaluator split to the user.

### Telegram messages should look like

- `Goal started: <objective>`
- `Worker: reading inbox/meeting.txt`
- `Worker: wrote outbox/project-brief.md`
- `Evaluator: continue - add risks and timeline`
- `Evaluator: complete`

### Why this matters

This gives users:

- trust
- visibility
- control

Without this, `/goal` will feel like hidden automation.

## Phase 7: Stop and Cancellation

## Deliverable

Allow a running goal to stop cleanly.

### Practical v1 approach

Start with cooperative cancellation:

- mark the goal as `stopped_requested`
- if a worker iteration is currently running, let the current turn finish
- do not schedule the next step

This is enough for v1.

Do not start with process-kill based cancellation unless necessary.

## Phase 8: Queueing and Concurrency

## Deliverable

Prevent multiple conflicting runs for the same goal or session.

### v1 rule

- one active run per goal
- one active goal run per chat by default

### Why this matters

Without this, users can easily create:

- overlapping worker iterations
- session corruption
- confusing Telegram updates

### Recommended new state

Add an in-memory run registry in `goal-runner.mjs`:

- `goalId -> active child process / run promise`

## File-Level Change Plan

## New files

- `src/goals-state.mjs`
- `src/goal-runner.mjs`
- `src/goal-prompts.mjs`

## Existing files to update

### `src/config.mjs`

Add:

- `GOALS_PATH`

Ensure:

- goal directory creation

### `src/codex-runner.mjs`

Likely no major redesign needed.

May add:

- slightly cleaner status hooks for goal progress

### `plugins/telegram-codex/telegram-codex-bridge.mjs`

Add:

- `/goal`
- `/goals`
- `/goal-status`
- `/goal-stop`
- `/goal-resume`

Remove responsibility for:

- running the long-task loop directly

### `src/daemon.mjs`

Eventually add:

- goal runner lifecycle ownership

But for v1, a module-level goal runner may be enough without a separate child process.

## Recommended Build Order

Build in this order:

1. `goals-state.mjs`
2. command parsing in Telegram bridge
3. `goal-prompts.mjs`
4. worker run path
5. evaluator run path
6. progress notifications
7. stop/resume
8. concurrency guard

This order ensures each stage is testable.

## Testing Plan

### Unit tests

Add tests for:

- goal ID generation
- state read/write
- allowed transitions
- prompt assembly

### Integration tests

Add tests for:

- `/goal` creates a goal
- worker session starts
- evaluator session follows
- `/goal-status` reflects progress
- `/goal-stop` halts next iteration

### Manual smoke

Test with Telegram:

1. `/goal summarize inbox/test.txt`
2. wait for worker update
3. wait for evaluator update
4. inspect artifacts in workspace
5. test `/goal-status`
6. test `/goal-stop`

## Expert Review

This is the correct level of ambition for the current repo:

- serious enough to create real long-task behavior
- thin enough to stay consistent with the product philosophy

The biggest mistake would be to jump straight to:

- multi-worker orchestration
- heavy planners
- recursive agent trees
- generalized autonomous scheduling

The current repo is not ready for that, and it does not need to be.

## Final Recommendation

Implement `/goal` as:

- a thin goal object
- one worker session
- one evaluator session
- file-backed state
- explicit user controls

That is the smallest real long-task system that fits `AutoAide` today.
