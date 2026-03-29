# AutoAide Workspace Markdown System

## 1. Purpose

This document defines the Markdown file system that lives under:

```text
~/.autoaide/workspace/
```

The goal is not to build a second agent runtime.

The goal is to give AutoAide a stable, editable, product-grade context layer:

- the repo contains software
- `~/.autoaide/workspace` contains the assistant's working memory and operating context
- Codex remains the execution core
- Markdown files define how the assistant understands itself, the user, the environment, and its ongoing work

This design is heavily informed by OpenClaw's workspace bootstrap model, but is adapted for AutoAide's lighter CLI-first architecture.

## 2. Core Design Principle

Use different Markdown files for different kinds of context.

Do not dump everything into one `AGENTS.md`.

The system should separate:

- operating rules
- identity
- user profile
- local tool/environment notes
- first-run bootstrapping
- proactive heartbeat behavior
- long-term memory
- daily memory

That separation is the main reason OpenClaw's model is strong.

## 3. What This System Is

This Markdown system is:

- a bootstrap context layer
- a persistent memory surface
- a human-editable control surface
- a product feature, not just internal docs

This Markdown system is not:

- a replacement for Codex sessions
- a second tool runtime
- a duplicate skill system
- a substitute for structured config

## 4. Product Boundary

AutoAide has two major homes:

- install/source directory:
  - `/Users/moshiwei/Documents/GitHub/AutoAide`
- runtime home:
  - `~/.autoaide`

The Markdown system belongs to the runtime home, not the repo.

Recommended layout:

```text
~/.autoaide/
  config.json
  cli-sessions.json
  logs/
  telegram/
  workspace/
    AGENTS.md
    SOUL.md
    TOOLS.md
    IDENTITY.md
    USER.md
    BOOTSTRAP.md
    HEARTBEAT.md
    MEMORY.md
    memory/
      YYYY-MM-DD.md
```

## 4.1 What Is Implemented Today

The current product already uses part of this Markdown system.

Implemented now:

- Codex runs with `cwd=~/.autoaide/workspace`
- Codex can therefore read `AGENTS.md` natively
- AutoAide reads `SOUL.md`, `IDENTITY.md`, `USER.md`, and `TOOLS.md`
- AutoAide injects those files into the prompt before calling Codex
- bootstrap writes identity and user answers back into workspace Markdown

Not fully implemented yet:

- heartbeat turns driven by `HEARTBEAT.md`
- ongoing long-term memory maintenance into `MEMORY.md`
- daily memory rollups in `memory/YYYY-MM-DD.md`

## 5. File Set

### 5.1 `AGENTS.md`

Purpose:

- global work rules
- session startup rules
- stable operating constraints
- safety boundaries
- red lines
- channel behavior rules

This is the most important operating file.

It should contain:

- what the assistant must read at session start
- what it must never do without asking
- what kinds of actions are safe to do autonomously
- how to behave in private chats vs shared chats
- how memory should be updated

It should not contain:

- detailed persona prose
- user biography
- machine-specific command notes
- one-time onboarding steps

Short version:

`AGENTS.md` defines how AutoAide works.

### 5.2 `SOUL.md`

Purpose:

- identity in the personality sense
- tone
- values
- style
- behavioral philosophy

It should contain:

- how concise or expressive AutoAide should be
- whether it is warm, blunt, playful, formal, or dry
- what kind of judgment it should exercise
- how it should think about trust and initiative

Short version:

`SOUL.md` defines who AutoAide feels like.

### 5.3 `USER.md`

Purpose:

- user profile
- communication preferences
- habits
- recurring context

It should contain:

- name
- what to call the user
- timezone
- work style
- preferences
- dislikes
- recurring projects or life context that help the assistant operate well

Short version:

`USER.md` defines who AutoAide is helping.

### 5.4 `IDENTITY.md`

Purpose:

- structured identity card

This file is intentionally more structured than the others.

Suggested fields:

- `Name:`
- `Emoji:`
- `Creature:`
- `Vibe:`
- `Theme:`
- `Avatar:`

This file is the best candidate for future programmatic parsing.

Short version:

`IDENTITY.md` is AutoAide's structured nameplate.

### 5.5 `TOOLS.md`

Purpose:

- environment-specific notes
- local machine knowledge
- path and command conventions
- channel-specific operational notes

It should contain:

- local command habits
- machine-specific file locations
- Telegram operational reminders
- preferred shells, editors, repos, and working assumptions
- notes that are specific to this machine or this user's setup

It should not duplicate skill definitions.

Short version:

`TOOLS.md` is local environment knowledge, not a shared skills catalog.

### 5.6 `BOOTSTRAP.md`

Purpose:

- one-time first-run ritual

This should exist only for initial setup.

It should guide AutoAide to:

- introduce itself
- ask who the user is
- define identity
- define tone
- define boundaries
- write the initial `IDENTITY.md`, `USER.md`, and `SOUL.md`

After first-run setup is complete, it should be deleted or archived.

Short version:

`BOOTSTRAP.md` is the birth ritual, not a permanent instruction file.

### 5.7 `HEARTBEAT.md`

Purpose:

- proactive checklist for the always-on assistant

This file is special because it is meant to guide periodic background turns.

It should contain:

- what to check periodically
- when to stay quiet
- when to proactively notify the user
- routines like inbox checks, reminders, project status reviews, or memory maintenance

Important:

- an empty `HEARTBEAT.md` should mean "do nothing"
- a small file is better than a sprawling one
- heartbeat tasks should be stable and repetitive, not ad hoc brainstorming

Short version:

`HEARTBEAT.md` defines what AutoAide does when nobody is actively talking to it.

### 5.8 `MEMORY.md`

Purpose:

- curated long-term memory

This should contain:

- durable preferences
- important decisions
- stable constraints
- ongoing relationships
- key long-lived facts worth preserving

It should not become a raw log dump.

Short version:

`MEMORY.md` is long-term distilled memory.

### 5.9 `memory/YYYY-MM-DD.md`

Purpose:

- daily raw memory

This should contain:

- what happened today
- open loops
- temporary context
- observations
- outcomes worth revisiting later

This is the scratchpad memory layer that can later feed `MEMORY.md`.

Short version:

Daily memory files are raw notes; `MEMORY.md` is the refined version.

## 6. Program Semantics

AutoAide should not treat every file the same way.

Recommended semantics:

- `AGENTS.md`
  - always high priority
- `SOUL.md`
  - high priority
- `USER.md`
  - high priority in private main-assistant contexts
- `IDENTITY.md`
  - available to both private and shared contexts
- `TOOLS.md`
  - available broadly when tool/environment context matters
- `BOOTSTRAP.md`
  - only for first-run initialization
- `HEARTBEAT.md`
  - only for heartbeat/proactive turns
- `MEMORY.md`
  - only for private trusted contexts
- `memory/YYYY-MM-DD.md`
  - recent context only, typically today and yesterday

This follows the same core insight as OpenClaw:

not every session should see every file.

## 7. Session-Type Filtering

AutoAide should eventually distinguish at least these contexts:

- main private session
- Telegram private session
- shared or group-facing session
- heartbeat turn
- isolated worker/subagent turn

Recommended file visibility:

### Main private session

Load:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `IDENTITY.md`
- `TOOLS.md`
- `MEMORY.md`
- `memory/today`
- `memory/yesterday`

### Telegram private session

Load:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `IDENTITY.md`
- `TOOLS.md`
- optionally `MEMORY.md`
- recent daily memory

### Shared/group-facing session

Load:

- `AGENTS.md`
- `SOUL.md`
- `IDENTITY.md`
- `TOOLS.md`

Do not automatically load:

- `MEMORY.md`
- sensitive `USER.md` details

### Heartbeat turn

Load:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `HEARTBEAT.md`
- recent memory when needed

### Worker/subagent turn

Load minimally:

- `AGENTS.md`
- `TOOLS.md`
- possibly `IDENTITY.md`

The rule is simple:

private memory should not leak into broader contexts by default.

## 8. Structured vs Semantic Files

Most of this system should remain semantic Markdown, not rigid schema.

But a small amount of structure is useful.

Recommended structured surfaces:

- `IDENTITY.md`
  - stable label-like fields
- `AGENTS.md`
  - a few reserved headings
- maybe future frontmatter for metadata

Recommended reserved `AGENTS.md` headings:

- `## Session Startup`
- `## Red Lines`
- `## External vs Internal`
- `## Memory`
- `## Channel Rules`
- `## Heartbeats`

That gives AutoAide a future path for partial extraction without turning the whole system into YAML.

## 9. Bootstrap Behavior

When `BOOTSTRAP.md` exists and the workspace is new, AutoAide should treat that as a first-run ritual.

Recommended first-run flow:

1. Start interactive CLI
2. Detect missing identity/user files
3. Read `BOOTSTRAP.md`
4. Ask one question at a time
5. Write:
   - `IDENTITY.md`
   - `USER.md`
   - `SOUL.md`
   - optionally starter `AGENTS.md`
6. Delete or archive `BOOTSTRAP.md`

This is a strong product pattern because it lets the assistant help create its own working context.

## 10. Heartbeat Behavior

AutoAide is meant to become an always-on assistant, so `HEARTBEAT.md` should be treated as a first-class file.

Design rules:

- do not force heartbeats on by default until the setup is trusted
- keep the file short
- make "no work needed" a valid outcome
- support a stable no-op token like `HEARTBEAT_OK`
- use it for periodic maintenance, not random free-form speculation

Good heartbeat tasks:

- check inbox
- scan calendar
- review reminders
- refresh memory
- watch project status

Bad heartbeat tasks:

- giant strategy planning loops
- broad internet rabbit holes
- noisy user interruptions without clear value

## 11. Minimal AutoAide v1 Markdown Set

For AutoAide v1, the best file set is:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `IDENTITY.md`
- `TOOLS.md`
- `BOOTSTRAP.md`

Add later:

- `HEARTBEAT.md`
- `MEMORY.md`
- `memory/YYYY-MM-DD.md`

Reason:

v1 needs a stable identity and operator model more than it needs a full memory engine.

## 12. Recommended Seed Strategy

On first setup, AutoAide should seed starter templates into:

```text
~/.autoaide/workspace/
```

Recommended starter files:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `BOOTSTRAP.md`
- `HEARTBEAT.md`

Optional:

- `MEMORY.md`
- `memory/`

This should be part of product setup, not a manual docs-only step.

## 13. Final Interpretation

The right way to think about this system is:

- config files define how AutoAide runs
- workspace Markdown defines how AutoAide understands the world

Or even more simply:

- code runs the assistant
- Markdown shapes the assistant

That is the main lesson worth importing from OpenClaw.
