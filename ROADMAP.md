# CodexBridge Roadmap

Date: 2026-04-04

## Purpose

This document gives a practical roadmap for CodexBridge from the current repo state.

It is not a pure vision document.
It is not a rewrite proposal.

It is meant to answer:

- what is already real
- what still feels incomplete
- what should be done next
- which directions are actually worth investing in

## Current State

CodexBridge already has a real product core:

- bot-scoped runtime model
- local interactive CLI
- Telegram bridge
- goals and schedules state
- web control plane
- workspace bootstrap and prompt injection
- bot-scoped skill install

Recent progress means the web console is no longer a thin demo shell.
It now has real endpoints and real flows for:

- bot lifecycle
- current bot switching
- Telegram pairing and metadata refresh
- sessions
- chat execution
- goals
- schedules
- workspace file editing
- skill install
- rollout actions

That means the product is now beyond the "can this architecture work?" stage.
The main question is now:

how to turn this into a coherent, durable assistant operating environment.

## What Is Still Missing

The biggest remaining gaps are not basic CRUD.
They are coherence gaps.

### 1. Execution visibility is still fragmented

The product has:

- normal chat
- goals
- scheduled goals
- Telegram-side execution

But it still does not have one clean shared model for:

- progress visibility
- final output semantics
- history
- handoff back to the origin session

This is the most important product-system gap.

### 2. Web console functionality exists, but product polish is uneven

The web console now works, but it still needs:

- cleaner layout flows
- more robust error states
- clearer status transitions
- richer detail views for sessions/goals/schedules
- less dependence on raw JSON for advanced users

This is now mostly a product refinement problem, not a pure plumbing problem.

### 3. Telegram operations are powerful but still fragile

Telegram remains the most failure-prone surface because it depends on:

- token validity
- polling conflicts
- access rules
- bot privacy configuration
- session routing

The system works, but operational resilience is not finished.

### 4. Goal system exists, but it is not yet a first-class experience

Goals have real state and execution loops.
But they still need:

- better origin-session linkage
- clearer reinjection behavior
- clearer final output modeling
- better visibility in web and Telegram

### 5. Workspace and skills are present, but not yet strategically differentiated

They work, but today they feel like support systems.
They are not yet a strong product moat.

## Strategic Priority Order

Recommended order:

1. execution visibility and output semantics
2. Telegram resilience and operational safety
3. web console product refinement
4. goal workflow maturity
5. workspace and skills as differentiated product surfaces
6. multi-channel and backend expansion

## Roadmap

## Phase A: Stabilize The Product Core

Target: next 2 to 4 weeks

### Goal

Make the current system harder to break in daily use.

### Why this matters

Before expanding features, CodexBridge should become operationally trustworthy.

### Work items

- harden web console loading, rendering, and page-level error handling
- improve startup and runtime error propagation in web and CLI
- add more protection around Telegram token handling and repair flows
- add explicit prevention for placeholder or invalid config writes
- improve process conflict handling for Telegram polling
- make runtime, bridge, and web logs easier to correlate
- verify current bot selection and bot health always stay in sync

### Exit criteria

- no "stuck loading" class bugs in the web console
- Telegram failures are diagnosable without code inspection
- config writes are safer and more predictable
- the system survives normal bot lifecycle actions cleanly

## Phase B: Unify Execution Visibility

Target: next 3 to 6 weeks

### Goal

Create one shared model for what execution shows to the user.

### Why this matters

This is the product layer that makes CodexBridge feel coherent across:

- CLI
- Telegram
- web
- goals
- schedules

### Work items

- implement shared visibility modes:
  - `off`
  - `summary`
  - `verbose`
- add explicit `finalOutput` semantics where still missing
- add lightweight normal-session output state
- add goal origin linkage:
  - `originSessionLabel`
  - context snapshot
  - reinjection target
- normalize completion and failure reporting
- ensure scheduled goals and interactive goals use the same final-output model

### Important source plans

- [docs/goal-handoff-and-execution-visibility-plan.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/goal-handoff-and-execution-visibility-plan.md)
- [docs/execution-visibility-and-history-design.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/execution-visibility-and-history-design.md)

### Exit criteria

- final output is a first-class object
- goals can cleanly hand back results to origin sessions
- CLI, Telegram, and web all show execution progress in consistent ways

## Phase C: Make Telegram A Reliable Production Surface

Target: next 4 to 8 weeks

### Goal

Reduce Telegram operational fragility.

### Why this matters

Telegram is CodexBridge's most valuable remote surface.
If it is unreliable, the product feels unreliable even if the core architecture is solid.

### Work items

- improve pairing UX in web and CLI
- improve metadata hydration and access diagnostics
- surface privacy mode and conflict guidance more directly
- improve restart behavior after token changes or runtime conflicts
- tighten session routing visibility
- improve group access management
- add more direct troubleshooting panels in web

### Important source plans

- [docs/telegram-group-bot-access-design.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/telegram-group-bot-access-design.md)
- [docs/telegram-always-on-agent-design.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/telegram-always-on-agent-design.md)
- [docs/telegram-codex-bridge.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/telegram-codex-bridge.md)

### Exit criteria

- pairing and repair are clear
- conflicts and invalid token states are surfaced well
- group behavior is understandable from the product UI
- Telegram becomes a dependable daily driver

## Phase D: Refine The Web Console Into The Primary Operations Surface

Target: next 4 to 8 weeks

### Goal

Move the web console from "working control plane" to "preferred working surface".

### Why this matters

The web console now has the right primitives.
The next step is product quality and workflow quality.

### Work items

- apply the three-pane layout redesign fully
- finish visual system consistency
- improve session, goal, and schedule detail panes
- improve empty states and loading states
- make inspector and diagnostics more legible
- make raw config editing clearly advanced-only
- improve bulk actions and bot fleet visibility

### Important source plans

- [docs/web-console-layout-redesign.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/web-console-layout-redesign.md)
- [docs/web-console-visual-style.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/web-console-visual-style.md)
- [docs/web-console-phased-plan.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/web-console-phased-plan.md)

### Exit criteria

- web is the easiest place to inspect and operate bots
- the layout feels coherent
- the product no longer feels tab-fragmented

## Phase E: Turn Goals Into A First-Class Product Loop

Target: next 6 to 10 weeks

### Goal

Make goals feel like a real autonomous work primitive, not just a background loop.

### Why this matters

This is one of the strongest differentiated directions in the repo.

### Work items

- improve goal launch UX from chat and Telegram
- improve goal history, artifacts, and final output views
- support clearer stop/resume semantics
- improve evaluator feedback surface
- improve schedule-triggered goal traceability
- connect goals back into the user’s normal session flow

### Important source plans

- [docs/goal-command-implementation-plan.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/goal-command-implementation-plan.md)
- [docs/goal-command-long-task-design.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/goal-command-long-task-design.md)
- [docs/long-task-design.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/long-task-design.md)

### Exit criteria

- goals are visible, understandable, and trustworthy
- users can launch them, inspect them, and consume their output cleanly

## Phase F: Differentiate Through Workspace And Skills

Target: next 2 to 3 months

### Goal

Turn workspace and skills into strategic product value.

### Why this matters

Many systems can wrap a CLI.
Fewer systems make persistent context and capability composition feel native.

### Work items

- better workspace file organization and editing flows
- clearer memory layer and workspace summarization
- stronger skill discovery, inspection, and compatibility reporting
- better skill install/update/remove lifecycle
- productized workspace-context authoring patterns

### Important source plans

- [docs/workspace-markdown-system.md](/Users/moshiwei/Documents/GitHub/CodexBridge/docs/workspace-markdown-system.md)

### Exit criteria

- the workspace is clearly useful, not just present
- skills feel integrated into bot identity and workflow

## Phase G: Longer-Term Expansion

Target: 3+ months

### Directions worth exploring

These are worth doing only after the core product is coherent.

### 1. Multi-channel support

Examples:

- WeChat
- email-style ingestion
- browser-native inbound workflows

### 2. Backend abstraction

Longer term, the runtime should not be permanently locked to one execution backend.

That does not mean abstracting too early.
It means leaving room for:

- Codex
- Claude Code
- Gemini

### 3. Richer event history

Only after visibility semantics are stable.

### 4. Better fleet orchestration

Examples:

- multi-bot rollout policy
- canary and rollback with stronger health semantics
- fleet-level dashboards

## What Is Most Worth Doing

If focus is limited, the most valuable directions are:

1. shared execution visibility and final output semantics
2. Telegram reliability and repair UX
3. web console refinement
4. goal maturity and reinjection

These four together would make CodexBridge feel like a real product rather than a strong technical prototype.

## What Is Less Urgent

These can wait:

- large visual polish without workflow gains
- backend abstraction before product semantics stabilize
- heavy transcript infrastructure before a lightweight output model is finished
- exotic channels before Telegram and web are truly solid

## Recommended Immediate Next Steps

For the next work cycle, the highest-signal sequence is:

1. finish web console robustness
2. implement unified execution visibility and final output semantics
3. tighten Telegram repair and diagnostics
4. improve goal origin-session handoff and reinjection

## Success Definition

CodexBridge will feel meaningfully complete when:

- a user can operate bots from web without confusion
- Telegram feels reliable enough for daily remote use
- normal chat, goals, and schedules share one mental model
- final outputs are explicit and reusable
- workspace and skills feel like real leverage, not just storage
