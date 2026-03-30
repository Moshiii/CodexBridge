# Telegram File Bridge MVP

## Goal

Add a minimal but useful file bridge between Telegram and the AutoAide workspace.

The MVP flow is:

1. user uploads a file to the Telegram bot
2. AutoAide downloads it into `~/.autoaide/workspace/inbox/`
3. the user can ask AutoAide to process it
4. AutoAide can send a file back from a safe workspace directory

## Why This Matters

This turns Telegram from a chat surface into a real remote work surface.

It makes the workspace visible and tangible:

- files go in
- work happens
- files come back out

That is much easier for users to understand than abstract memory or agent features.

## MVP Scope

### In scope

- Telegram `document` uploads
- save uploads to `workspace/inbox/`
- confirmation message with saved path
- optional caption treated as a follow-up task against the uploaded file
- `/files [inbox|outbox|exports]` to list available files
- `/get <relative-path>` to send a file back to Telegram

### Out of scope

- arbitrary filesystem access
- webhook mode
- streaming file uploads
- media album support
- image/photo-special handling
- file editing in place from Telegram

## Workspace Contract

AutoAide uses three directories for the file bridge:

- `workspace/inbox/`
- `workspace/outbox/`
- `workspace/exports/`

### Rules

- Telegram uploads always land in `inbox/`
- Telegram downloads are only allowed from `inbox/`, `outbox/`, or `exports/`
- paths outside those directories are rejected

## User Commands

### Upload a file

Send a Telegram document to the bot.

Result:

- file is downloaded to `workspace/inbox/`
- bot confirms path and size

### Upload a file with a caption

Send a document and include a caption such as:

- `summarize this PDF`
- `turn this into a task list`

Result:

- file is saved to `workspace/inbox/`
- AutoAide runs Codex with the saved relative path included in the prompt

### List files

```text
/files
/files inbox
/files outbox
/files exports
```

### Get a file back

```text
/get inbox/example.pdf
/get outbox/summary.md
/get exports/result.txt
```

## Safety Model

The bridge should be intentionally narrow.

### Allowed download roots

- `inbox`
- `outbox`
- `exports`

### Rejected

- absolute paths
- parent directory escapes like `../`
- files outside the allowed roots

## Future Upgrades

Safe next steps after MVP:

- photo/image support
- richer file summaries
- `editMessageText` progress updates
- `latest` shortcuts
- upload result files automatically when Codex writes to `outbox/`
