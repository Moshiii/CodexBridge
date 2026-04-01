# Goal Handoff and Execution Visibility Plan

## Purpose

This document defines a lightweight implementation plan for three connected product needs:

1. unified execution visibility modes
2. `/goal` session handoff from normal chat
3. final output reinjection back into the origin session

It also breaks the work into small implementation units with minimal interference between tasks.

## Problem Summary

The product now has:

- normal chat tasks
- `/goal` tasks
- scheduled goal triggers

But it does not yet have a unified model for:

- what execution details are shown
- how `/goal` inherits context from the current chat
- how `/goal` returns value to the user’s original session

## Product Requirements

## 1. Unified visibility modes

Both `/goal` and normal chat should support:

- `off`
- `summary`
- `verbose`

### `off`

Show:

- task accepted
- final output
- failures

Hide:

- command execution
- tool events
- worker/evaluator progress

### `summary`

Show:

- phase-level progress
- worker/evaluator summaries
- blockers
- final output

Hide:

- raw command execution events
- noisy tool-call detail

### `verbose`

Show:

- command execution events
- tool call events
- worker/evaluator summaries
- final output

## 2. `/goal` should inherit some context from the current session

When a user launches `/goal` during normal chat, the goal should not start blind.

But it also should not inherit the entire session transcript.

So the correct model is:

- take a lightweight snapshot from the origin session
- use that snapshot to start the goal
- keep goal execution isolated afterward

## 3. `/goal` should return a clear final output

`/goal` must produce:

- a user-facing final output
- optional artifacts
- a completion state

This should be explicitly modeled, not inferred from worker history.

## 4. `/goal` should return to the origin session

After the goal finishes:

- the active session should return to the session from which `/goal` was launched
- the final output should be injectable into that origin session’s local state

## Design Principle

Keep this lightweight.

The implementation should avoid:

- a global transcript engine
- a complete event bus
- merging all task types into one heavy runtime

The correct approach is:

- shared execution visibility policy
- minimal final output fields
- lightweight goal handoff snapshot
- lightweight goal result reinjection

## Current State

## Normal chat

Current local state is thin:

- active session label
- Codex session ref

There is no formal:

- local execution history
- local final output object
- visibility mode filtering

## Goal

Current goal state already has:

- worker session ref
- evaluator session ref
- summaries
- artifacts
- local history

But it still needs:

- explicit `finalOutput`
- explicit origin-session linkage

## Proposed State Additions

## A. Config

Recommended `config.json` additions:

```json
{
  "executionVisibility": {
    "normalTasks": "off",
    "goalTasks": "summary",
    "scheduledGoals": "summary"
  }
}
```

This should be the single source of truth for visibility policy.

## B. Normal session state

Recommended additions to session records:

- `lastOutput`
- `lastOutputAt`
- `lastGoalResult`

Keep this deliberately small.

`lastGoalResult` can be:

```json
{
  "goalId": "goal_...",
  "objective": "...",
  "finalOutput": "...",
  "artifacts": ["..."],
  "completedAt": "..."
}
```

Do not add a full transcript yet.

## C. Goal state

Recommended additions:

- `originSessionLabel`
- `originContextSummary`
- `finalOutput`
- `finalOutputAt`
- `finalArtifacts`

### Meaning

- `originSessionLabel`
  - the session from which `/goal` was launched
- `originContextSummary`
  - lightweight handoff context from normal chat
- `finalOutput`
  - the final user-facing output of the goal
- `finalOutputAt`
  - completion timestamp
- `finalArtifacts`
  - final artifact list for reinjection or follow-up

## Handoff Model

## At `/goal` start

When a user launches `/goal` from normal chat:

1. capture the active session label
2. create a lightweight origin context snapshot
3. store both in the goal record
4. run the goal in its own worker/evaluator sessions

## What the snapshot should contain

The first version should stay small.

Recommended fields:

- `originSessionLabel`
- last user message
- last assistant output
- optional one-line synthesized context summary

Do not try to copy the full Codex thread.

## Handoff prompt strategy

The worker prompt can include:

- goal objective
- origin session label
- origin context summary
- any user-specified files or references

This is enough to make `/goal` feel context-aware without making it heavy.

## Final Output Reinjection Model

When `/goal` completes:

1. write `goal.finalOutput`
2. write `goal.finalOutputAt`
3. restore the active session pointer to `originSessionLabel`
4. add a lightweight result record to the origin session local state

This result record should not include:

- worker history
- evaluator history
- raw progress events

It should only include:

- objective
- final output
- artifacts
- completion time

## Why this is the right compromise

This gives the user:

- continuity
- usable context transfer
- usable result handback

without:

- polluting the main session
- forcing a global history engine
- making the product architecture too heavy

## Visibility Design

## Shared event categories

All task types should normalize to a small set of event categories:

- `accepted`
- `progress`
- `verdict`
- `final_output`
- `error`
- `stop`

Goal can still have worker/evaluator sources, but rendering policy should be shared.

## Rendering rules

### Normal chat

- `off`
  - accepted + final output + error
- `summary`
  - accepted + summary progress + final output + error
- `verbose`
  - accepted + tool/command events + summary progress + final output + error

### Goal

- `off`
  - goal started + final output + error
- `summary`
  - goal started + worker/evaluator summaries + final output + blocker/error
- `verbose`
  - goal started + worker/evaluator summaries + raw command/tool events + final output + blocker/error

### Scheduled goal

Recommended default:

- `summary`

This is a strong default because scheduled tasks should not spam raw event noise by default.

## Impacted Files

The design will touch these areas.

## Core runner and state

- `src/codex-runner.mjs`
- `src/goals-state.mjs`
- `src/goal-runner.mjs`
- `src/config.mjs`

## Telegram execution surface

- `plugins/telegram-codex/telegram-codex-bridge.mjs`

## Schedule support

- `src/schedules-state.mjs`
- `src/cron-utils.mjs`
- `src/schedule-intents.mjs`

## Optional later CLI parity

- `src/cli.mjs`

## Work Breakdown

The plan below is intentionally decomposed into small units with minimal overlap.

## Phase 0: state model changes

These are low-risk and mostly independent.

### Task 0.1

Add config shape for execution visibility.

Files:

- `src/config.mjs`

Output:

- config defaults for `normalTasks`, `goalTasks`, `scheduledGoals`

Dependencies:

- none

### Task 0.2

Add goal state fields:

- `originSessionLabel`
- `originContextSummary`
- `finalOutput`
- `finalOutputAt`
- `finalArtifacts`

Files:

- `src/goals-state.mjs`

Dependencies:

- none

### Task 0.3

Add session state fields:

- `lastOutput`
- `lastOutputAt`
- `lastGoalResult`

Files:

- Telegram router session state handling
- CLI session state handling if parity is desired now

Dependencies:

- none

## Phase 1: visibility policy

### Task 1.1

Create a small execution visibility policy helper.

Files:

- new helper module, or a small utility inside `src/codex-runner.mjs`

Responsibilities:

- accept event category + task type + mode
- decide whether to emit or suppress

Dependencies:

- Task 0.1

### Task 1.2

Normalize normal task event emission.

Files:

- `src/codex-runner.mjs`
- `plugins/telegram-codex/telegram-codex-bridge.mjs`

Responsibilities:

- normal task should emit shared event categories
- bridge should filter by visibility mode

Dependencies:

- Task 1.1

### Task 1.3

Normalize goal event emission.

Files:

- `src/goal-runner.mjs`
- `plugins/telegram-codex/telegram-codex-bridge.mjs`

Responsibilities:

- worker/evaluator status should map cleanly into:
  - summary events
  - verbose events
- final output should always be emitted once

Dependencies:

- Task 1.1
- Task 0.2

## Phase 2: goal handoff

### Task 2.1

Capture origin session and context summary when `/goal` starts.

Files:

- `plugins/telegram-codex/telegram-codex-bridge.mjs`
- `src/goals-state.mjs`

Responsibilities:

- store `originSessionLabel`
- store a minimal `originContextSummary`

Dependencies:

- Task 0.2

### Task 2.2

Inject handoff snapshot into goal prompt.

Files:

- `src/goal-prompts.mjs`
- `src/goal-runner.mjs`

Responsibilities:

- include lightweight session handoff context in worker prompt

Dependencies:

- Task 2.1

## Phase 3: final output semantics

### Task 3.1

Explicitly persist `goal.finalOutput`.

Files:

- `src/goal-runner.mjs`
- `src/goals-state.mjs`

Responsibilities:

- define the exact final output string
- persist it separately from history

Dependencies:

- Task 0.2

### Task 3.2

Persist normal task final output.

Files:

- `plugins/telegram-codex/telegram-codex-bridge.mjs`
- normal session state handling

Responsibilities:

- save the latest visible final output for normal tasks

Dependencies:

- Task 0.3

## Phase 4: goal result reinjection

### Task 4.1

Restore origin session when goal completes.

Files:

- `plugins/telegram-codex/telegram-codex-bridge.mjs`

Responsibilities:

- after completion, switch active session pointer back to `originSessionLabel`

Dependencies:

- Task 2.1
- Task 3.1

### Task 4.2

Write a lightweight goal result summary into the origin session local state.

Files:

- Telegram router session state handling

Responsibilities:

- store `lastGoalResult`
- avoid copying internal goal history

Dependencies:

- Task 0.3
- Task 3.1
- Task 4.1

## Phase 5: schedule consistency

### Task 5.1

Make scheduled goal output follow the same final output semantics.

Files:

- `src/goal-runner.mjs`
- `src/schedules-state.mjs`
- `plugins/telegram-codex/telegram-codex-bridge.mjs`

Responsibilities:

- ensure schedule-triggered goals persist final output correctly
- link schedule last run state to goal result

Dependencies:

- Task 3.1

### Task 5.2

Apply schedule-specific visibility defaults.

Files:

- `plugins/telegram-codex/telegram-codex-bridge.mjs`

Dependencies:

- Task 1.1

## Recommended Implementation Order

To keep the work as non-overlapping as possible:

1. Task 0.1
2. Task 0.2
3. Task 0.3
4. Task 1.1
5. Task 1.2
6. Task 1.3
7. Task 2.1
8. Task 2.2
9. Task 3.1
10. Task 3.2
11. Task 4.1
12. Task 4.2
13. Task 5.1
14. Task 5.2

This order minimizes collisions and makes it easy to validate each layer.

## Suggested Teaming / Parallelism

If multiple developers or agents work in parallel, the lowest-conflict split is:

### Track A: state models

- Task 0.1
- Task 0.2
- Task 0.3

### Track B: visibility rendering

- Task 1.1
- Task 1.2
- Task 1.3

### Track C: goal handoff and reinjection

- Task 2.1
- Task 2.2
- Task 4.1
- Task 4.2

### Track D: schedule integration

- Task 5.1
- Task 5.2

Track B depends on Track A.
Track C depends partly on Track A and Task 3.1.
Track D depends on Task 3.1 and Task 1.1.

## Risks

## 1. Over-inheriting normal session context

If `/goal` inherits too much session history, it will become noisy and heavy.

## 2. Over-writing goal internals back into normal chat

If goal worker/evaluator internals are reinjected into the origin session, the product will feel polluted.

## 3. Divergent interpretation of visibility modes

If normal chat and `/goal` treat `summary` differently, users will lose trust.

## 4. Hidden coupling between session state and goal state

Keep the linkage thin:

- origin session label
- origin context summary
- final result reinjection

Not:

- deep shared mutable history

## Expert Recommendation

The correct lightweight design is:

- separate runtime sessions
- lightweight handoff snapshot
- explicit final output
- lightweight reinjection into origin session
- shared visibility policy

This gives the user the behavior they want without turning `AutoAide` into a heavy conversation database.

## Final Conclusion

This work should be treated as a coordinated but lightweight product refinement.

The guiding rule is:

> unify semantics, not storage

That means:

- unify visibility
- unify final output semantics
- unify user experience

while keeping:

- separate sessions
- thin state
- minimal reinjection

This is the most defensible path for `AutoAide`.
