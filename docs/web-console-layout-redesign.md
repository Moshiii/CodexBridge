# CodexBridge Web Console Layout Redesign

## Goal

Make the web console feel like one coherent product surface instead of a stack of tabs competing for attention.

The redesign should:

- reduce context switching
- keep the current bot always visible
- make sessions, goals, schedules, workspace, and skills feel related instead of scattered
- keep runtime and Telegram operations accessible without dominating the whole page
- preserve fast operational workflows for start, stop, restart, pairing, and debugging

## Diagnosis

The current layout feels mixed for three reasons:

1. Too many top-level tabs

The product currently exposes:

- Overview
- Telegram
- Sessions
- Chat
- Goals
- Schedules
- Workspace
- Skills
- Logs
- Config
- Rollout

This makes the user navigate by implementation area instead of by workflow.

2. The selected bot is not structurally central

The UI shows bot state, but the layout does not consistently organize the page around:

- current bot
- current working object
- current action surface

3. Operational data and working data are mixed at the same hierarchy

For example:

- logs
- config
- chat
- workspace
- schedules

These are different modes of work, but the current layout gives them equal visual priority.

## Design Direction

Use a three-pane master-detail workspace.

This is the most appropriate pattern for CodexBridge because the product already has strong object hierarchy:

- fleet
- bot
- object inside bot
- detail for that object

The layout should feel closer to:

- Linear-style list and detail workflow
- a local assistant workspace
- an operations console with a stable frame

Not a traditional admin dashboard with many unrelated cards.

## New Information Architecture

There should be four stable zones:

1. Left rail

Purpose:

- fleet selection
- current bot switching
- global bot actions

Contents:

- bot list
- create bot
- set current
- enable/disable
- start/stop/restart

2. Center list pane

Purpose:

- show the active object collection inside the selected bot

The user chooses one object mode at a time:

- Sessions
- Goals
- Schedules
- Workspace
- Skills

This pane is not a tab bar across the whole app.
It is a content navigator for the selected bot.

3. Right detail pane

Purpose:

- show the selected object
- provide the main action surface

Examples:

- selected session -> chat composer and output
- selected goal -> status, history, stop action
- selected schedule -> cron, timezone, enable/disable
- selected workspace file -> editor
- selected skill -> metadata and install source

4. Bottom diagnostics strip

Purpose:

- runtime log
- bridge log
- recent errors

This keeps observability always reachable without forcing the entire page into a logs-first layout.

## Recommended Layout

This is the recommended default desktop structure.

```text
+------------------------------------------------------------------------------------------------------------------+
| CodexBridge                                                Current Bot: default   Status: running   Telegram: paired |
+------------------------------------------------------------------------------------------------------------------+
| LEFT RAIL                | CENTER PANE                                      | RIGHT DETAIL PANE                |
|--------------------------|--------------------------------------------------|----------------------------------|
| Fleet                    | Object Mode                                      | Detail Header                    |
|                          | [Sessions] [Goals] [Schedules] [Workspace]       | selected item name               |
| default      running     | [Skills]                                         | selected item status             |
| research     stopped     |                                                  | quick actions                    |
| ops          running     | Search / Filter                                  |                                  |
|                          |                                                  | -------------------------------- |
| + New Bot                | List                                              | Main work surface                |
| Set Current              |                                                  |                                  |
| Enable / Disable         | main                     active  running          | if Sessions: chat composer       |
| Start / Stop / Restart   | research-plan            idle                    | if Goals: goal history           |
| Pair Telegram            | ops-draft                idle                    | if Schedules: schedule editor    |
| Refresh Metadata         |                                                  | if Workspace: file editor        |
|                          | + Create item                                    | if Skills: skill details         |
|--------------------------|--------------------------------------------------|----------------------------------|
| BOT SUMMARY              | INLINE OBJECT CONTEXT                            | BOT INSPECTOR                    |
| model                    | mode-specific helper text                        | config summary                   |
| desired version          | empty state / counts                             | telegram access                  |
| recent error             |                                                  | rollout controls                 |
+------------------------------------------------------------------------------------------------------------------+
| DIAGNOSTICS STRIP                                                                                                |
| Runtime Log                                              | Bridge Log                                             |
+------------------------------------------------------------------------------------------------------------------+
```

## Primary Workflow Mapping

### 1. Bot operations

Should stay in the left rail.

Reason:

Bot lifecycle actions are context setters, not the main working surface.

### 2. Sessions and chat

Should become the default center-detail mode.

Reason:

This is the most natural everyday workflow.

Structure:

- center pane: session list
- right pane: chat composer + run output + stop action

### 3. Goals

Should live in the same object system as sessions.

Structure:

- center pane: goal list
- right pane: goal metadata, status, history, final output, stop action

### 4. Schedules

Should use the same pattern.

Structure:

- center pane: schedule list
- right pane: cron, timezone, objective, last run, enable/disable

### 5. Workspace

Should also use the same pattern.

Structure:

- center pane: file tree or file list
- right pane: editor

### 6. Skills

Should be a low-frequency mode in the same middle pane system.

Structure:

- center pane: installed skills
- right pane: description, path, install/update actions

## What Should Move Out Of Top-Level Tabs

The current top tabs should not remain as peers.

Replace them with:

- one small mode switcher inside the center pane
- one stable page frame

Suggested mode switcher:

```text
[ Sessions ] [ Goals ] [ Schedules ] [ Workspace ] [ Skills ]
```

Keep these out of the mode switcher:

- Overview
- Telegram
- Logs
- Config
- Rollout

Those should become collapsible inspector sections in the right pane or diagnostics strip.

## Right Pane Structure

The right pane should be internally sectioned, not tabbed again.

Recommended internal order:

```text
Detail Header
- title
- status
- timestamps

Primary Work Surface
- chat
- goal details
- schedule form
- editor

Context Section
- selected bot summary
- telegram access
- current model

Advanced Section
- raw config
- rollout controls
```

This keeps the page understandable without requiring deep navigation.

## Mobile / Narrow Width Behavior

On smaller screens:

- left rail collapses into a drawer
- center pane becomes the main visible view
- right detail pane becomes a stacked panel below
- diagnostics strip becomes an accordion

ASCII:

```text
+------------------------------------------------------+
| CodexBridge   [Bot Switcher]   [Mode Switcher]          |
+------------------------------------------------------+
| Center list / object list                            |
| sessions / goals / schedules / files / skills        |
+------------------------------------------------------+
| Selected detail                                      |
| composer / editor / config / history                 |
+------------------------------------------------------+
| Logs accordion                                       |
+------------------------------------------------------+
```

## Visual Principles

The redesign should use stronger hierarchy:

- left rail darker or more muted than working surfaces
- center pane list rows compact and dense
- right pane calmer and more spacious
- logs visually separated from productive work

Avoid:

- large numbers of equally weighted cards
- many pills competing for attention
- repeated summary blocks across tabs

Prefer:

- one strong header
- one object list
- one primary detail surface

## Migration Plan

### Step 1

Keep the current APIs and refactor only layout.

Do not change backend contracts first.

### Step 2

Replace the current tab bar with a mode switcher for:

- Sessions
- Goals
- Schedules
- Workspace
- Skills

### Step 3

Move these into the right inspector:

- Telegram summary
- Config summary
- Rollout controls

### Step 4

Move logs into the bottom diagnostics strip.

### Step 5

Refine object-specific detail panes.

## Concrete Component Map

Suggested layout map for implementation:

```text
AppShell
- TopHeader
- LeftRail
  - FleetList
  - BotActions
  - BotSummaryCard
- MainWorkspace
  - ModeSwitcher
  - ObjectListPane
  - DetailPane
    - DetailHeader
    - PrimarySurface
    - InspectorSections
- DiagnosticsStrip
  - RuntimeLogPanel
  - BridgeLogPanel
```

## Recommendation

Proceed with the three-pane redesign centered on:

- left rail for bots
- center pane for object collections
- right pane for selected object work
- bottom strip for diagnostics

This is the best fit for CodexBridge because it reduces visual fragmentation while preserving the system's real mental model.

If implemented well, the product will feel less like a demo console with many tabs and more like a serious local assistant workspace.
