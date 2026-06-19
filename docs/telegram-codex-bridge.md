# Telegram Codex Bridge

This is the smallest working bridge for the flow:

- Telegram sends a message
- your program receives it
- the program resolves the current active session
- the program immediately sends `Running ...`
- the program runs `codex exec --json` or `codex exec resume --json`
- when `codex` finishes, the program sends one final reply back to Telegram

It does not stream partial output.

## File

- `plugins/telegram-codex/telegram-codex-bridge.mjs`

In normal product use, this worker is launched by `codexbridge`.

You can still run it directly for debugging.

## What It Does

- uses Telegram Bot API `getUpdates` long polling
- accepts text messages only
- maintains a thin session mapping state
- always keeps a default `main` session
- supports `/home`, `/new`, `/switch`, `/sessions`, `/where`
- starts a new Codex CLI session on first use
- resumes the same Codex CLI session on later messages
- buffers stdout and stderr until Codex exits
- sends one final Telegram reply
- persists the Telegram update offset locally to avoid reprocessing old updates after restart

## Required Environment Variables

- `TELEGRAM_BOT_TOKEN`

## Optional Environment Variables

- `CODEX_CWD`
  - default: `~/.codexbridge/bots/<bot-id>/workspace`
- `TELEGRAM_ALLOWED_CHAT_IDS`
  - comma-separated list like `123456789,-1009876543210`
  - if unset, all chats that can reach the bot are accepted
- `TELEGRAM_OFFSET_FILE`
  - default: `~/.codexbridge/bots/<bot-id>/telegram/offset.json`
- `TELEGRAM_ROUTER_STATE_FILE`
  - default: `~/.codexbridge/bots/<bot-id>/telegram/sessions.json`
- `CODEX_START_COMMAND`
  - default: `codex exec --skip-git-repo-check --json -`
- `CODEX_RESUME_COMMAND_TEMPLATE`
  - default: `codex exec resume --skip-git-repo-check --json __SESSION_ID__ -`
## Recommended First Run

```bash
export TELEGRAM_BOT_TOKEN="123456:abc..."
export TELEGRAM_ALLOWED_CHAT_IDS="123456789"
export BOT_HOME="$HOME/.codexbridge/bots/default"
export CODEX_CWD="$HOME/.codexbridge/bots/default/workspace"

node plugins/telegram-codex/telegram-codex-bridge.mjs
```

Then send your bot a Telegram message.

For normal product use, prefer:

```bash
codexbridge
```

Then use `/channel` inside the CLI.

## Run Codex From Source

If you do not want to use a globally installed `codex`, point `CODEX_START_COMMAND` and `CODEX_RESUME_COMMAND_TEMPLATE` to the Codex executable or wrapper you want to use.

Example:

```bash
export CODEX_START_COMMAND='codex exec --skip-git-repo-check --json -'
export CODEX_RESUME_COMMAND_TEMPLATE='codex exec resume --skip-git-repo-check --json __SESSION_ID__ -'
node plugins/telegram-codex/telegram-codex-bridge.mjs
```

## Behavior Notes

- bridge commands:
  - `/home`
  - `/new <label>`
  - `/switch <label>`
  - `/sessions`
  - `/where`
- success:
  - sends Codex stdout back to Telegram
- success with no stdout:
  - sends a fallback message
- failure:
  - sends exit code plus any stdout/stderr it captured
- non-text Telegram messages:
  - replies with `Only text messages are supported right now.`
- running status message:
  - replies with `Running Codex on [session-label]...`
  - does not echo the full original prompt text

## Limitations

- no streaming progress
- no webhook mode
- no markdown/html formatting conversion
- Telegram replies are truncated to 4096 characters
- updates are processed sequentially right now
- state is intentionally thin; this is not a custom agent runtime

## Next Step

After this works, the next safe upgrade is:

- periodically `editMessageText`
- add per-chat queueing and background workers
- introduce a backend runner interface so Codex can later be swapped with Gemini or Claude Code
