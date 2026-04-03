# `/goal` Long-Task Design

> Historical draft. This document was written for the removed daemon-based runtime and does not describe the current bot-scoped implementation.

## Purpose

This document proposes how `AutoAide` should evolve from:

- long-lived shell
- thin session routing
- Codex session resume

into:

- explicit long-task execution
- worker / evaluator separation
- Telegram-friendly progress and control

The proposal is designed to fit the current `AutoAide` architecture instead of replacing it.

## Current State

Today, `AutoAide` already has:

- a single daemon
- a Telegram bridge
- thin chat-to-session routing
- Codex session resume
- status extraction from streamed JSON events

What it does **not** yet have is a real long-task model.

Right now, a Telegram or CLI message is still basically:

1. receive one input
2. optionally reply `Running ...`
3. run one foreground Codex turn
4. send final result

This is:

- a long-lived session model

but not yet:

- a long-running task system

## Product Goal

The product goal of `/goal` should be:

> let the user define a durable objective that AutoAide works on over multiple turns, with visible worker progress and explicit evaluator judgment

This is not the same as:

- one long prompt
- one giant blocking run
- a hidden autonomous loop

`/goal` should feel like:

- a managed objective
- with explicit structure
- with observable progress
- and controllable boundaries

## Recommendation Summary

### Strong recommendation

Build `/goal` as a **goal orchestration layer** on top of the current shell.

That means:

- reuse daemon
- reuse Telegram bridge
- reuse session mapping
- reuse Codex resume

Add only:

- goal state
- worker loop
- evaluator loop
- job control commands

### Avoid

Do not turn this into:

- a second general-purpose agent runtime
- a giant planner DSL
- a hidden infinite autonomous system

## Mental Model

`/goal` should create a task object with two logical roles:

1. `worker`
2. `evaluator`

### Worker

The worker advances the task.

Responsibilities:

- interpret the current goal state
- produce the next step
- execute via Codex
- update artifacts and state
- emit progress notes

### Evaluator

The evaluator judges whether the worker's output is:

- good enough
- on track
- blocked
- complete
- or needs another worker iteration

The evaluator should be more conservative than the worker.

## Why Worker and Evaluator Must Be Separate

This separation is good product design for three reasons.

### 1. It improves trust

Users are much more comfortable with:

- one role doing
- another role checking

than with a single opaque loop.

### 2. It improves long-task quality

A worker tends to optimize for momentum.
An evaluator can optimize for correctness and stopping conditions.

### 3. It gives better UX

Telegram and CLI can display:

- worker is doing X
- evaluator says Y

That is much easier to understand than a black-box background process.

## `/goal` Command Design

## Primary command

```text
/goal <objective>
```

Examples:

- `/goal turn the notes in inbox/meeting.txt into a clean project brief`
- `/goal review this repo and produce a release checklist`
- `/goal process the uploaded PDF and draft a follow-up email`

## Expected behavior

When `/goal` is created:

1. AutoAide creates a goal record
2. the goal is attached to the current session or a dedicated goal session
3. AutoAide starts a worker iteration
4. evaluator reviews output
5. goal either:
   - continues
   - pauses on blocker
   - finishes

## Supporting commands

Recommended command set:

- `/goal <objective>` create and start a goal
- `/goals` list active goals
- `/goal-status <id>` show current state
- `/goal-stop <id>` stop a running goal
- `/goal-resume <id>` resume a paused goal
- `/goal-log <id>` show recent worker/evaluator summaries

Do **not** overload `/goal` with too many subcommands in the first version.

## State Model

The new thing AutoAide needs is a proper goal state file.

Recommended storage:

- JSON files under `~/.autoaide/goals/`

Later this can move to SQLite if needed.

## Minimal goal object

```json
{
  "id": "goal_20260331_001",
  "objective": "turn notes into a project brief",
  "status": "running",
  "chatId": "6994248212",
  "sessionLabel": "main",
  "workerSessionRef": "codex-thread-id",
  "evaluatorSessionRef": "codex-thread-id",
  "iteration": 3,
  "createdAt": "2026-03-31T10:00:00Z",
  "updatedAt": "2026-03-31T10:03:00Z",
  "lastWorkerSummary": "Drafted brief sections",
  "lastEvaluatorVerdict": "continue",
  "artifacts": [
    "outbox/project-brief.md"
  ]
}
```

## Recommended execution states

- `pending`
- `running`
- `awaiting_evaluation`
- `blocked`
- `completed`
- `failed`
- `stopped`

These are enough for an MVP.

## Architecture Recommendation

## 1. Keep daemon as the always-on shell

The daemon should remain responsible for:

- process lifetime
- bridge lifetime
- restarting child components

Do not move goal logic into the CLI process.

## 2. Add a lightweight goal runner inside the daemon domain

Recommended new component:

- `goal-runner`

Responsibilities:

- load active goals
- run worker iterations
- trigger evaluator iterations
- persist updates
- emit status messages back to channel adapters

This can be a child process later, but it can start as a module inside the daemon runtime.

## 3. Keep Telegram as a front-end, not the runtime

Telegram bridge should:

- create goals
- query goals
- stop/resume goals
- relay progress

It should not own the long-task execution logic directly.

That separation matters.

## Session Strategy

This is one of the most important design choices.

### Recommendation

Each goal should have:

- one worker Codex session
- one evaluator Codex session

Do not reuse the user's conversational `main` session as the worker.

Why:

- goal runs need cleaner continuity
- user chat and goal execution should not contaminate each other too much
- evaluator must not share the same thread as the worker

### Session naming

Use stable labels like:

- `goal:<id>:worker`
- `goal:<id>:evaluator`

This fits the existing thin session mapping philosophy.

## Worker Loop

Each worker iteration should:

1. load goal state
2. build a prompt containing:
   - goal objective
   - current iteration
   - prior evaluator verdict
   - relevant workspace paths
3. run Codex in the worker session
4. capture:
   - summary
   - artifacts produced
   - status notes
5. persist results
6. hand off to evaluator

## Evaluator Loop

Each evaluator iteration should:

1. read the objective
2. inspect worker output and artifacts
3. decide one of:
   - `continue`
   - `complete`
   - `blocked`
   - `retry`
   - `failed`
4. produce a short verdict summary
5. persist verdict
6. notify the user if needed

## Prompt Design Recommendation

Do not make evaluator prompts too smart or too open-ended.

Evaluator should answer a small contract:

1. Did the worker make measurable progress?
2. Is the current output good enough to count as complete?
3. If not, what is the next worker direction in one short instruction?

That keeps the loop bounded.

## Progress UX

This is where the design can become very good.

Telegram should receive concise updates such as:

- `Goal started: draft project brief from inbox/meeting.txt`
- `Worker: reading notes and drafting sections`
- `Evaluator: draft is incomplete, continue with risks and timeline`
- `Worker: wrote outbox/project-brief.md`
- `Evaluator: complete`

This gives the user:

- a feeling of movement
- role separation
- trust in the process

## User Flow

From the user's point of view, `/goal` should feel like:

1. define a durable objective
2. see that objective become a managed goal
3. watch worker progress
4. receive evaluator judgment
5. get a final result or a clear blocker
6. optionally resume or refine the same goal later

It should **not** feel like:

- one big hidden prompt
- one opaque blocking run
- one ordinary chat reply with a different name

## Example: `/goal help me find today's news`

If the user sends:

```text
/goal help me find today's news
```

the expected flow should be:

1. AutoAide creates a goal record
2. AutoAide replies with a short confirmation such as:

```text
Goal created: goal_20260401_001
Objective: help me find today's news
Status: running
```

3. the worker turns the vague objective into an executable task
4. the worker begins a first pass
5. the evaluator decides whether:
   - the result is already good enough
   - the task needs clarification
   - the worker should continue

Telegram updates might look like:

```text
Goal started: help me find today's news
Worker: planning scope and default categories
Worker: collecting candidate items
Evaluator: result is too broad, continue with clearer grouping
Worker: drafting final summary
Evaluator: complete
```

The final message should be structured and resumable, for example:

```text
[goal_20260401_001] Completed

Today's top news:
1. ...
2. ...
3. ...

Sources:
- ...
- ...

You can continue this goal with:
/goal-resume goal_20260401_001 focus on AI news
```

## Capability Boundary

This example also shows an important design rule:

`/goal` is only as good as the capabilities beneath it.

If AutoAide does not have:

- reliable web access
- clear source handling
- a good tool for news retrieval

then a goal like "find today's news" should not pretend to be stronger than it is.

In that case, the evaluator should prefer one of these outcomes:

- ask for clarification
- state the current limitation clearly
- provide a narrower best-effort result

That is much better than letting the goal system sound autonomous while returning weak output.

## Better Early `/goal` Use Cases

For the first real version, `/goal` will work best on tasks that match AutoAide's current strengths:

- turn uploaded notes into a clean brief
- review a repo and produce a checklist
- summarize files in `workspace/inbox/`
- draft a message or post from local materials
- organize today's workspace outputs into a useful summary

These are better MVP goals than broad live-information requests because they:

- fit the existing workspace model
- fit Codex execution better
- are easier to evaluate
- make progress updates more trustworthy

## Human Control

Long tasks without control feel dangerous.

Required controls:

- `/goal-stop <id>`
- `/goal-resume <id>`
- `/goal-status <id>`

Strongly recommended:

- `/goal-log <id>`

The user should never feel the system is wandering invisibly.

## Where This Fits the Existing Design

This proposal is compatible with the current `AutoAide` principles because:

- daemon remains thin
- session mapping remains thin
- Codex stays the execution core
- workspace remains the context surface
- we add orchestration only where long tasks require it

So this is an extension of the current design, not a rewrite.

## Risks

## 1. Overbuilding too early

The biggest risk is trying to build:

- planner
- scheduler
- memory system
- multi-agent runtime
- retries
- priority queues

all at once.

Do not do that.

## 2. Worker and evaluator collapsing into one

If they share one thread or one role, you lose most of the clarity benefit.

## 3. Background loops becoming invisible

If users cannot see progress or stop a goal, trust will collapse quickly.

## 4. Session pollution

If goal tasks run inside the same thread as conversational chat, continuity gets muddy fast.

## MVP Recommendation

The MVP for `/goal` should include:

- `/goal <objective>`
- one worker session per goal
- one evaluator session per goal
- goal JSON persistence
- progress notifications
- `/goals`
- `/goal-status <id>`
- `/goal-stop <id>`
- `/goal-resume <id>`

The MVP should **not** include:

- parallel workers
- dynamic worker swarms
- heavy planner trees
- generalized scheduling
- autonomous recurring goals

## Expert Review

Your instinct is good:

- `/goal` is the right product surface
- `worker` / `evaluator` separation is the right control model

But the right implementation is not:

- a big new orchestrator

The right implementation is:

- a thin goal layer on top of the existing daemon + session resume architecture

That keeps the design coherent with what `AutoAide` already is.

## Recommended Next Step

Build in this order:

1. goal state files
2. `/goal` command parsing
3. worker session creation
4. evaluator session creation
5. goal runner loop
6. Telegram status updates
7. stop/resume commands

That is the smallest serious path to long-task support.
