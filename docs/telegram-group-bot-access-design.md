# Telegram Group Bot Access Design

## Goal

Define the first safe version of AutoAide's Telegram group behavior.

This version is intentionally narrow.

The bot should not behave like a public group chatbot.

## Product Rule

In a Telegram group:

1. The bot only considers responding when it is explicitly mentioned.
2. The user who mentioned the bot must be in an allow list.
3. Everyone else is ignored.

If either condition fails, the bot should stay silent.

## Non-Goals

This version does not support:

- replying to a bot message as a trigger
- reacting to ordinary group messages
- reacting to every group command from anyone
- group-wide public assistant behavior
- admin UI
- complex permissions

Keep it small.

## Why

The user does not want strangers who join a group to immediately gain access to the bot.

That means AutoAide should not treat group presence as open access.

The bot should feel private-by-default even inside a group.

## Trigger Rule

For a group or supergroup message, AutoAide should only continue if all of the following are true:

1. The chat is allowed.
2. The sender is allowed.
3. The bot is explicitly mentioned in the message text.

Otherwise:

- ignore the message
- send nothing
- create no side effects

## Allowed Group

Group access should be controlled separately from private chat access.

Recommended model:

- private chats may continue to use the existing chat allow list
- groups should have their own allow list

Suggested environment variable:

`TELEGRAM_ALLOWED_GROUP_CHAT_IDS`

If the current group chat id is not in this list, ignore the message.

## Allowed User

Even inside an allowed group, not everyone should be able to use the bot.

Suggested environment variable:

`TELEGRAM_ALLOWED_GROUP_USER_IDS`

If the sender user id is not in this list, ignore the message.

This should be checked before any expensive work begins.

## Mention Detection

The bot should only respond when the incoming message explicitly mentions the bot.

Examples:

- `@AutoAideBot hi`
- `@AutoAideBot summarize this`

Mention detection should use Telegram message entities when available, not only plain string matching.

Recommended checks:

1. Prefer `message.entities` and `message.caption_entities`
2. Match `mention` entities against the bot username
3. Optionally support `text_mention` if needed later

For v1, plain `@botusername` mention is enough.

## What "reply to bot message" Means

This does not mean two bots talking to each other.

It means:

- the bot already sent a message in the group
- a human user taps "Reply"
- the human sends a new message replying to the bot

That reply can be used as a trigger.

Example:

1. Bot says: `Task started.`
2. Human replies to that bot message: `stop`

That is "reply to bot message".

This can be useful later, but it is not needed for v1.

For now, do not implement it.

## Recommended Group Policy for V1

### Private chat

- existing behavior can continue

### Group chat

- only process messages in allowed groups
- only process messages from allowed users
- only process messages that mention the bot
- ignore everything else

This gives AutoAide a narrow and predictable group mode.

## Execution Flow

For each incoming Telegram update:

1. Read chat type
2. If private chat:
   continue with current logic
3. If group or supergroup:
   check group allow list
4. Check sender allow list
5. Check explicit bot mention
6. Only then pass the message into the existing AutoAide handling flow

## Silence Is Preferred

For rejected group messages, the default behavior should be silence.

Do not send:

- permission denied
- unknown user
- bot not enabled here

Silence is safer and less noisy in group settings.

If debugging is needed, log locally only.

## Suggested Config Surface

Minimal configuration:

- `TELEGRAM_ALLOWED_CHAT_IDS`
- `TELEGRAM_ALLOWED_GROUP_CHAT_IDS`
- `TELEGRAM_ALLOWED_GROUP_USER_IDS`
- `TELEGRAM_BOT_USERNAME`

Notes:

- `TELEGRAM_BOT_USERNAME` is needed for reliable mention matching
- keep config explicit rather than inferred

## Future Extensions

Possible later additions:

- reply-to-bot triggers
- group admin-only mode
- per-group allow lists
- different policies for commands vs natural language
- explicit "group mode" help output

None of these are required for v1.

## Final Recommendation

The best first implementation is:

- mention-only in groups
- sender must be on an allow list
- group must be on an allow list
- everything else ignored

This keeps the bot private, quiet, and controlled.
