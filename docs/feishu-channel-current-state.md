# Feishu Channel Current State

## Purpose

This document captures the current implementation state of the Feishu channel in `AutoAide`.

It is intentionally scoped to:

- what has already been implemented
- how onboarding currently works
- what runtime behavior is available now
- what is still missing

## Current Status

Feishu is now wired in as an experimental external channel for normal chat.

The current implementation supports:

- configuring a Feishu self-built app from the CLI
- switching a bot's active channel to `feishu`
- starting the bot runtime with the Feishu bridge
- receiving plain text messages through Feishu event subscription long connection mode
- running a normal Codex conversation turn per Feishu chat
- preserving per-chat session continuity through `cliSessionRef`
- replying with plain text messages back into the same Feishu chat
- a minimal `/where` command inside Feishu chats

It does not yet support:

- `/goal`
- schedules
- file upload / download bridge
- richer slash command parity with Telegram
- dedicated Feishu controls in the web console

## Implemented Files

### Channel registration

- [src/channel-adapters.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/channel-adapters.mjs)

This file now registers `feishu` as a first-class channel adapter and defines:

- adapter id
- label
- bridge script path
- config readiness check
- channel summary field

### Config and paths

- [src/config.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/config.mjs)

Feishu-specific additions include:

- `channels.feishu`
- `getFeishuStatePath`
- `getFeishuBridgePidPath`
- `getFeishuBridgeLogPath`
- generic per-channel bridge pid/log helpers

Current Feishu config shape:

```json
{
  "enabled": false,
  "appId": "",
  "appSecret": "",
  "verificationToken": "",
  "encryptKey": "",
  "defaultReceiveIdType": "chat_id",
  "metadata": {
    "chats": {},
    "users": {}
  }
}
```

### Bot runtime integration

- [src/bots.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/bots.mjs)
- [bin/autoaide.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/bin/autoaide.mjs)

Bot lifecycle is now channel-aware rather than Telegram-only.

The runtime now:

- validates readiness through the active channel adapter
- selects the channel bridge dynamically
- writes bridge logs using the active channel name
- reports channel summary from the active adapter

### CLI onboarding

- [src/cli.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/src/cli.mjs)

The CLI now supports:

- `/channel` -> choose `Telegram` or `Feishu`
- Feishu onboarding checklist and setup prompts
- saving `appId` and `appSecret`
- switching the bot's active channel to `feishu`
- restarting the runtime so the Feishu bridge actually takes over
- multi-channel status output in `/status`

Feishu onboarding flow currently asks the user to:

1. Create a self-built app in Feishu Open Platform.
2. Enable bot / IM permissions.
3. Subscribe to `im.message.receive_v1`.
4. Install the app into the target tenant.
5. Paste `appId` and `appSecret` into the CLI.
6. Send a plain text message to the app in Feishu.

### Feishu bridge

- [plugins/feishu-codex/feishu-codex-bridge.mjs](/Users/moshiwei/Documents/GitHub/AutoAide/plugins/feishu-codex/feishu-codex-bridge.mjs)

The bridge uses the official Feishu Node SDK:

- package: `@larksuiteoapi/node-sdk`

It currently uses:

- `Lark.Client`
- `Lark.WSClient`
- `EventDispatcher`

Transport model:

- long connection mode
- no public webhook URL required
- local or server runtime only needs outbound internet access

Current message behavior:

- receive `im.message.receive_v1`
- ignore non-user senders
- ignore non-text messages
- parse Feishu text payload JSON
- build a workspace prompt
- run a normal Codex turn using the existing session when available
- persist updated session state
- send a plain text reply back to the same chat

Current Feishu router state is stored at:

```text
~/.autoaide/bots/<id>/feishu/router.json
```

It currently tracks:

- per-chat session label
- per-chat `cliSessionRef`
- recently processed message ids for de-duplication

## Official SDK Dependency

The current implementation depends on:

- `@larksuiteoapi/node-sdk`

This was added to:

- [package.json](/Users/moshiwei/Documents/GitHub/AutoAide/package.json)

## Current Runtime Model

Feishu normal chat follows this path:

```text
Feishu user
  -> Feishu event subscription long connection
  -> feishu-codex-bridge
  -> workspace prompt construction
  -> codex exec / codex resume
  -> plain text reply to Feishu chat
```

Session continuity is per Feishu chat, not global.

The current session label is generated like:

```text
feishu-<last-8-chars-of-chat-id>
```

## Current Limitations

### Product limitations

- Feishu is currently normal-chat-only.
- There is no shared `/goal` integration for Feishu yet.
- There is no schedule trigger delivery into Feishu yet.
- There is no file bridge yet.

### UX limitations

- CLI onboarding is complete enough for setup, but there is no web onboarding parity yet.
- `/status` now shows Feishu state, but the web console still has Telegram-first wording and controls in several places.
- Feishu slash-command support is intentionally minimal right now.

### Technical limitations

- Message sending is currently hard-coded to `receive_id_type = chat_id`.
- Non-text messages are rejected.
- Message editing and richer render modes are not implemented.
- No Feishu-specific permission validation is performed beyond app id / secret presence and runtime behavior.

## Relationship To Goal Refactor

The recent `/goal` refactor moved goal behavior toward:

- normal chat execution in the main conversation thread
- supervisor evaluation instead of a separate worker-product model

That work was completed in shared layers first, but Feishu has not yet been connected to it.

This means Feishu currently benefits from:

- channel abstraction
- shared bot runtime lifecycle

but not yet from:

- shared goal supervision flows

## Recommended Next Steps

In order of value:

1. Connect Feishu to the shared goal controller.
2. Add Feishu-aware controls to the web console.
3. Add Feishu schedule delivery using the same shared goal path.
4. Add file support for Feishu uploads.
5. Decide whether Feishu should support more slash-command parity or stay intentionally minimal.

## Verification Performed

At the time of this snapshot:

- the codebase test suite passed with `npm test`
- the Feishu bridge module loads and exits with the expected config-missing error when `appId` / `appSecret` are absent

This confirms:

- the bridge is wired into the repo
- the runtime path is syntactically valid
- the current test suite is green

It does not yet prove:

- live Feishu tenant permissions are correct
- event subscription is enabled in a real app
- end-to-end message delivery against a real Feishu workspace
