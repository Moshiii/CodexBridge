# Execution Visibility and History Design

## Purpose

This document defines how `CodexBridge` should unify:

- execution visibility
- final output semantics
- task history

across:

- normal chat tasks
- `/goal` tasks
- scheduled goal triggers

The aim is to remove current inconsistencies in Telegram and future-proof the product for CLI and additional channels.

## Problem

Today `CodexBridge` has three different execution experiences:

1. normal Telegram or CLI task
2. `/goal` task with worker / evaluator
3. `/schedule` triggering a goal in the background

These experiences do not share a formal execution model.

### Current issues

#### 1. No unified execution visibility control

There is no single product-level switch that decides whether users should see:

- no execution details
- summary progress
- raw command / tool call events

#### 2. `/goal` has progress but not a fully explicit final output model

`/goal` currently produces:

- worker summaries
- evaluator verdicts
- `lastUserMessage`

but does not yet treat the final user-facing output as a first-class object.

#### 3. Normal task and `/goal` history are split

- normal task continuity mostly lives in Codex thread state
- `/goal` history lives in local goal JSON files
- scheduled triggers live in schedule JSON state
- Telegram session routing lives in router JSON state

There is no single event or transcript layer.

#### 4. Rendering logic is embedded too low

Telegram bridge currently decides too much about:

- what intermediate events are shown
- what is considered final
- how to render system progress

That makes future channels harder to support consistently.

## Product Goals

This design should achieve five things.

### 1. Give users one consistent execution visibility policy

The user should be able to decide whether they want:

- minimal output
- concise progress
- verbose execution details

across both normal tasks and `/goal`.

### 2. Make final output explicit

Every task type that can complete should have a clearly modeled final output.

### 3. Preserve current thin-shell philosophy

This should not turn `CodexBridge` into a giant orchestrator or log platform.

### 4. Keep Telegram as a channel surface, not the source of truth

Telegram should render events and outputs, not define the business model.

### 5. Leave room for a future unified event history

We do not need a full event bus now, but this design should make one natural later.

## Non-Goals

This design does not attempt to:

- replace Codex thread memory
- fully reconstruct all historical conversation locally
- build a complete analytics system
- build a general-purpose workflow engine
- introduce a full event sourcing architecture in one step

## Current State

## Normal Tasks

### Current behavior

For normal Telegram tasks:

1. Telegram bridge receives a message
2. it routes to the active session
3. it sends a running message
4. it runs Codex once
5. it sends one final result

### Current persistence

- active session label is stored
- `cliSessionRef` is stored
- no local structured final output object is stored
- no local event log is stored for the normal task

### Implication

Normal tasks are effectively:

- session-oriented
- thin
- mostly dependent on Codex thread continuity

not:

- locally auditable tasks

## `/goal` Tasks

### Current behavior

`/goal` already has more formal structure:

- goal file
- worker session
- evaluator session
- progress notifications
- stop / resume / status / log

### Current persistence

Goal JSON already stores:

- summaries
- evaluator verdict
- artifacts
- recent history
- worker session ref
- evaluator session ref

### Missing piece

The final output is not yet modeled as clearly as it should be.

The product needs a distinct `finalOutput` concept instead of depending on a mix of:

- worker deliverable
- evaluator message
- `lastUserMessage`

## Scheduled Goals

### Current behavior

Schedules trigger a goal at a matching cron time.

### Current persistence

Schedule state stores:

- cron
- objective
- last trigger metadata

### Missing piece

Schedule-triggered output is not yet normalized into a common final-output and event model.

## Recommendation Summary

### Strong recommendation

Introduce a unified execution model with three layers:

1. visibility mode
2. execution events
3. final output

This should be implemented as a thin shared policy used by:

- normal task execution
- goal execution
- scheduled goal execution

### Do not do this

Do not immediately build:

- a complete global transcript database
- a full event bus
- an overbuilt workflow runtime

The first step should be a small shared execution contract.

## Proposed Execution Visibility Model

## User-facing modes

Use three modes:

- `off`
- `summary`
- `verbose`

### `off`

Show:

- task accepted
- final output
- error if failed

Hide:

- tool calls
- command execution details
- worker/evaluator status chatter

### `summary`

Show:

- high-level execution phases
- worker/evaluator summaries
- important blockers
- final output

Hide:

- raw command execution details
- raw tool call noise

### `verbose`

Show:

- command execution events
- tool call events
- worker/evaluator summaries
- final output

This is the mode closest to the current `/goal` event stream.

## Recommended defaults

Recommended initial defaults:

- normal tasks: `off`
- `/goal`: `summary`
- scheduled goals: `summary`

This keeps regular usage calm while still making longer tasks inspectable.

## Configuration Surface

The execution visibility policy should be configurable centrally.

Recommended shape:

```json
{
  "executionVisibility": {
    "defaultMode": "summary",
    "normalTasks": "off",
    "goalTasks": "summary",
    "scheduledGoals": "summary"
  }
}
```

This can live in `config.json`.

Later it can support per-channel overrides if needed.

## Proposed Execution Event Model

The system should define a small shared event shape used by all task types.

## Minimum event object

```json
{
  "type": "progress",
  "source": "worker",
  "scope": "goal",
  "message": "reading inbox files",
  "at": "2026-04-02T10:00:00Z"
}
```

## Recommended event fields

- `type`
  - `accepted`
  - `progress`
  - `verdict`
  - `final_output`
  - `error`
  - `stop`
  - `schedule_triggered`
- `source`
  - `system`
  - `worker`
  - `evaluator`
  - `scheduler`
- `scope`
  - `normal_task`
  - `goal`
  - `schedule`
- `message`
- `at`

Optional:

- `artifacts`
- `sessionRef`
- `goalId`
- `scheduleId`

## Important constraint

The bridge should not be responsible for inventing event semantics.

The bridge should only:

- receive structured events
- filter them through the visibility mode
- render them for Telegram

## Proposed Final Output Model

Every task that completes should have an explicit final output.

## Required fields

### Normal task

Recommended additions:

- `lastOutput`
- `lastOutputAt`

These do not need a full transcript yet.

### Goal

Recommended additions:

- `finalOutput`
- `finalOutputAt`
- `finalArtifacts`

This should become the source of truth for what the user actually received at completion.

### Schedule

Recommended additions:

- `lastGoalId`
- `lastResultStatus`
- `lastOutputAt`

Schedule records do not need to duplicate the full content, but they should know what happened last.

## History Model

## Current reality

History is currently split across:

- Codex threads
- `sessions.json`
- goal JSON files
- schedule JSON state

That is acceptable for now, but only if we are explicit about it.

## Recommendation

Do not force normal task and goal history into one storage format immediately.

Instead:

1. unify the execution event contract
2. unify final output semantics
3. later introduce a shared event log if still needed

## Future direction

If we later want a single auditable timeline, add:

- `~/.codexbridge/history/events.jsonl`

Each task would append a small normalized event record there.

That would give one history surface without forcing today’s architecture to overgrow.

## Impacted Components

## 1. `src/codex-runner.mjs`

Needs to become the shared event extraction layer for:

- tool call events
- command execution events
- status summaries

This should remain thin, but it should be the canonical place for converting Codex JSON stream into `CodexBridge` execution events.

## 2. normal task execution in Telegram bridge

Needs to stop hardcoding:

- only running + final

and instead:

- request events from the runner
- apply visibility policy
- render filtered results

## 3. `src/goal-runner.mjs`

Needs to:

- emit structured progress events
- persist `finalOutput`
- distinguish:
  - progress summary
  - evaluator judgment
  - final output

## 4. goal state model

`src/goals-state.mjs` should add:

- `finalOutput`
- `finalOutputAt`
- possibly `visibilityMode` if per-goal overrides are desired later

## 5. scheduler state model

`src/schedules-state.mjs` should add:

- `lastResultStatus`
- optionally `lastOutputAt`

So that scheduled work can be inspected without manually reading the goal file every time.

## 6. Telegram bridge

Bridge responsibilities should be clarified:

- parse command or intent
- start task
- render filtered events
- send final output

Bridge should not own the execution semantics.

## 7. CLI

The same visibility model should also be usable in CLI.

Otherwise:

- Telegram will become verbose and inspectable
- CLI will stay ad hoc

That split will become a maintenance burden.

## 8. Documentation

The following docs will need updates:

- `README.md`
- Telegram bridge docs
- `/help` command copy
- `/goal` design docs
- schedule docs when they exist

Because users need to understand:

- what visibility modes mean
- where final output lives
- how normal task and goal histories differ

## 9. Test Plan

Testing needs to expand.

New required areas:

- visibility filtering for `off`
- visibility filtering for `summary`
- visibility filtering for `verbose`
- normal task final output always present
- goal final output always present
- schedule trigger creates goal and preserves output linkage
- restart behavior preserves state without double-delivery

## Proposed Rollout Order

## Phase 1: final output semantics

Implement first:

- `goal.finalOutput`
- `goal.finalOutputAt`
- `normalTask.lastOutput`

This fixes the most important product ambiguity first.

## Phase 2: unified visibility policy

Implement:

- shared visibility modes
- shared event filtering
- Telegram rendering based on filtered events

Keep CLI changes minimal if needed, but do not diverge conceptually.

## Phase 3: scheduler linkage

Implement:

- `lastResultStatus`
- stronger link from schedule to completed goal output

## Phase 4: optional shared history log

Only do this if the product actually needs:

- global auditability
- replay
- one chronological activity feed

This phase is optional, not required for the first serious version.

## Risks

## 1. Overbuilding

The biggest risk is turning this into a large workflow platform.

Avoid:

- global transcript databases too early
- event buses too early
- full observability systems too early

## 2. Mixing rendering with state

If Telegram-specific formatting leaks into the event or output model, future channels will become harder.

## 3. Ambiguous final output

If `finalOutput` is still not explicit, the same confusion will keep reappearing.

## 4. Mode inconsistency

If normal tasks and goals interpret `summary` differently, the product will feel unreliable.

## Expert Recommendation

The right move is to treat this as a product-surface correction, not just a logging tweak.

The essential shift is:

- from ad hoc bridge messaging

to:

- a unified execution contract

That contract should be:

- small
- explicit
- shared

The best implementation path is:

1. make final output explicit
2. introduce shared visibility modes
3. apply the same rules to normal tasks, goals, and scheduled goals
4. delay unified history storage until the product actually needs it

## Final Conclusion

This design is worth doing.

It will improve:

- user trust
- product coherence
- channel consistency
- future maintainability

But it will affect more than one file or one flag.

It touches:

- execution runner behavior
- goal modeling
- schedule modeling
- Telegram rendering
- CLI consistency
- documentation
- tests

So it should be implemented deliberately as a cross-cutting design change, not as a single local patch.
