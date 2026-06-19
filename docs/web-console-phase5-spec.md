# CodexBridge Web Console Phase 5 Spec

## Purpose

Phase 5 surfaces the bot workspace and skills model as first-class web objects.

After Phase 5, the browser can manage the selected bot's persistent context and installed skills.

## Goal

Deliver workspace browsing/editing and skills management in the web console.

## Non-Goals

- no collaborative editing
- no full version-history UI

## User Stories

- As a user, I can browse key workspace files for a bot.
- As a user, I can edit and save workspace files.
- As a user, I can inspect bootstrap readiness from the workspace surface.
- As a user, I can list installed skills.
- As a user, I can install and remove skills from the browser.

## Deliverable

Two new tabs:

- `Workspace`
- `Skills`

## Workspace Tab

### Layout

```text
+--------------------------------------------------------------+
| file tree      | editor                                      |
|----------------|---------------------------------------------|
| AGENTS.md      | file content                                |
| IDENTITY.md    |                                             |
| USER.md        | [Save]                                      |
| SOUL.md        |                                             |
| TOOLS.md       |                                             |
+--------------------------------------------------------------+
```

### Required features

- file tree for key workspace files
- load file content
- edit file content
- save file
- bootstrap summary panel

### Phase 5 file scope

- `AGENTS.md`
- `IDENTITY.md`
- `USER.md`
- `SOUL.md`
- `TOOLS.md`
- `HEARTBEAT.md`

## Skills Tab

### Required features

- list installed skills
- inspect metadata
- install from uploaded path/zip reference
- remove skill

### Display fields

- skill id
- title/name
- source path
- compatibility

## Backend API Spec

### `GET /api/bots/:id/workspace/tree`

### `GET /api/bots/:id/workspace/file?path=...`

### `POST /api/bots/:id/workspace/file`

### `GET /api/bots/:id/skills`

### `POST /api/bots/:id/skills/install`

### `DELETE /api/bots/:id/skills/:skillId`

## Frontend Components

- `WorkspaceTab`
- `WorkspaceFileTree`
- `WorkspaceEditor`
- `BootstrapSummaryCard`
- `SkillsTab`
- `SkillList`
- `SkillDetailCard`
- `InstallSkillModal`

## Interaction Flows

### Edit workspace file

```text
User -> select file
Frontend -> GET workspace file
User -> edit content
Frontend -> POST workspace file
Frontend -> show saved confirmation
```

### Install skill

```text
User -> open install skill modal
User -> provide source
Frontend -> POST skills/install
Frontend -> refresh skill list
```

## Testing

- workspace tree/file read
- workspace file save
- skill list
- skill install/remove

## PR Breakdown

### PR 1

- workspace file APIs

### PR 2

- skills APIs

### PR 3

- workspace tab UI

### PR 4

- skills tab UI

## Exit Criteria

- user can edit key workspace files from browser
- user can inspect and manage skills from browser
- the browser now covers most persistent bot context management
