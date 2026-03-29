# Telegram Codex Plugin

This folder contains the Telegram integration as an external plugin layer, so Codex core updates do not require patching the Codex codebase.

## Layout

- `telegram-codex-bridge.mjs`: long-polling bridge between Telegram Bot API and Codex CLI

## Flow

1. Telegram sends a message to your bot.
2. The bridge receives it with `getUpdates`.
3. The bridge resolves the current active session label for that Telegram chat.
4. The bridge immediately replies with `Running ...`.
5. If the session has not started yet, the bridge runs `codex exec --json -`.
6. If the session already exists, the bridge runs `codex exec resume --json <session_id> -`.
7. When Codex exits, the bridge sends one final Telegram reply.

It does not stream partial output.

## Session Model

- there is always a default `main` session
- each Telegram chat has an `active session pointer`
- normal messages go to the active session
- `/new <label>` creates a secondary session
- `/switch <label>` switches active session
- `/home` switches back to `main`
- `/sessions` lists known sessions
- `/where` shows the current active session

This is a thin mapping layer, not a custom session runtime.

## Required Environment Variables

- `TELEGRAM_BOT_TOKEN`

## Optional Environment Variables

- `CODEX_CWD`
  - default: `~/.autoaide/workspace`
- `TELEGRAM_ALLOWED_CHAT_IDS`
  - comma-separated list like `123456789,-1009876543210`
  - if unset, all chats that can reach the bot are accepted
- `TELEGRAM_OFFSET_FILE`
  - default: `~/.autoaide/telegram/offset.json`
- `TELEGRAM_ROUTER_STATE_FILE`
  - default: `~/.autoaide/telegram/sessions.json`
- `CODEX_START_COMMAND`
  - default: `codex exec --skip-git-repo-check --json -`
- `CODEX_RESUME_COMMAND_TEMPLATE`
  - default: `codex exec resume --skip-git-repo-check --json __SESSION_ID__ -`
- `CODEX_COMMAND`
  - legacy fallback
  - if set, it is used as the start command base and the bridge tries to derive a resume command from it

## Recommended First Run

```bash
export TELEGRAM_BOT_TOKEN="123456:abc..."
export TELEGRAM_ALLOWED_CHAT_IDS="123456789"
export CODEX_CWD="$HOME/.autoaide/workspace"

node plugins/telegram-codex/telegram-codex-bridge.mjs
```

Then send your bot a Telegram message.

## Run Codex From Source

If you do not want to use a globally installed `codex`, point `CODEX_START_COMMAND` and `CODEX_RESUME_COMMAND_TEMPLATE` to whatever Codex binary or wrapper you want to use.

Example:

```bash
export CODEX_START_COMMAND='codex exec --json -'
export CODEX_RESUME_COMMAND_TEMPLATE='codex exec resume --skip-git-repo-check --json __SESSION_ID__ -'
node plugins/telegram-codex/telegram-codex-bridge.mjs
```

## Behavior Notes

- `/new`, `/switch`, `/home`, `/sessions`, `/where` are handled by the bridge itself
- success:
  - sends Codex stdout back to Telegram
- success with no stdout:
  - sends a fallback message
- failure:
  - sends exit code plus any stdout/stderr it captured
- non-text Telegram messages:
  - replies with `Only text messages are supported right now.`

## Limitations

- no streaming progress
- updates are processed sequentially
- no webhook mode
- no markdown/html formatting conversion
- Telegram replies are truncated to 4096 characters
