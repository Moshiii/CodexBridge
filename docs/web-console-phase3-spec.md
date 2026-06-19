# CodexBridge Web Console Phase 3 Spec

## Purpose

Phase 3 brings Telegram operations into the web console as a first-class product surface.

After Phase 3, Telegram pairing, access management, and troubleshooting should no longer require guessing from raw config or logs.

## Goal

Deliver a Telegram operations console for the selected bot.

## Non-Goals

- no webhook mode
- no complete Telegram transcript browser
- no full moderation/admin workflow

## User Stories

- As a user, I can pair or re-pair Telegram from web.
- As a user, I can see which private chats and users are allowed.
- As a user, I can see which groups and users the bot has seen.
- As a user, I can understand why a group message was ignored.
- As a user, I can add/remove access entries from the browser.

## Deliverable

Phase 3 expands the `Telegram` tab into a full operational tab.

## Telegram Tab Structure

### Section 1: Pairing

Fields:

- paired yes/no
- bot username
- paired user
- token present yes/no
- last pairing result if available

Actions:

- `Pair`
- `Re-pair`
- `Refresh Metadata`

### Section 2: Private Access

Display:

- named private chat allow list

Actions:

- add private chat entry
- remove private chat entry

### Section 3: Group Access

Display:

- named allowed groups
- named allowed users
- mention required yes/no

Actions:

- add/remove allowed group
- add/remove allowed user
- toggle mention requirement

### Section 4: Seen Chats and Users

Display:

- recently seen groups
- recently seen private chats
- recently seen users

Actions:

- convert seen user to allowed user
- convert seen group to allowed group

### Section 5: Troubleshooting

Display possible causes:

- runtime offline
- Telegram not paired
- no mention in group
- sender not allowed
- group not allowed
- likely privacy mode issue

## Backend API Spec

### `POST /api/bots/:id/telegram/pair`

Request:

```json
{
  "token": "123456:abc"
}
```

Behavior:

- pause runtime if needed
- perform pairing
- update config
- restore/start runtime

### `GET /api/bots/:id/telegram/access`

Response:

```json
{
  "privateChats": [],
  "groupChats": [],
  "groupUsers": [],
  "mentionRequired": true
}
```

### `POST /api/bots/:id/telegram/access`

Request:

```json
{
  "kind": "groupUser",
  "id": "6994248212"
}
```

### `DELETE /api/bots/:id/telegram/access`

Request:

```json
{
  "kind": "groupUser",
  "id": "6994248212"
}
```

### `GET /api/bots/:id/telegram/seen-chats`

### `GET /api/bots/:id/telegram/seen-users`

### `POST /api/bots/:id/telegram/refresh-metadata`

### `GET /api/bots/:id/telegram/debug`

Response should include:

- runtime online yes/no
- paired yes/no
- mentionRequired yes/no
- privacyModeLikelyIssue yes/no
- last known ignore reasons if available

## Frontend Components

- `TelegramPairingCard`
- `TelegramAccessPanel`
- `NamedChatList`
- `NamedUserList`
- `SeenEntitiesPanel`
- `TelegramTroubleshootingPanel`

## Interaction Flows

### Pair bot

```text
User -> open pairing flow
User -> enter token
Frontend -> POST /telegram/pair
Backend -> pair + update config + restore runtime
Frontend -> refresh bot detail
```

### Add seen user to allow list

```text
User -> click allow on seen user
Frontend -> POST /telegram/access
Backend -> update config
Frontend -> refresh access and seen lists
```

## Testing

- pair endpoint success/failure
- access add/remove
- metadata refresh
- debug endpoint output

## PR Breakdown

### PR 1

- pairing endpoint
- tests

### PR 2

- access endpoints
- seen entity endpoints

### PR 3

- Telegram tab full UI

### PR 4

- troubleshooting panel

## Exit Criteria

- Telegram can be paired from web
- allow lists can be managed from web
- seen groups/users are visible
- troubleshooting is good enough to reduce silent confusion
