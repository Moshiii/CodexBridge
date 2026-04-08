# AutoAide Group Chat And Single-User Mode Design

## Purpose

This document proposes a new operating model for AutoAide:

- single-user mode
- group-chat management mode

The goal is to make AutoAide behave like a serious chat-surface assistant system:

- simple and opinionated for one-person use
- safe and scalable for multi-user group-chat use
- channel-agnostic across Telegram, Feishu, and future channels

This design also draws product lessons from how Midjourney structured its Discord workflow.

## 1. Why A Redesign Is Needed

The current system still mixes several ideas:

- local multi-session shell
- Telegram-first chat routing
- per-chat shared session continuity
- shared `/goal` orchestration

That is acceptable for experimentation, but it is not a clean long-term model for:

- one-person assistants
- shared group bots
- consistent behavior across channels

The biggest mismatch is this:

- group chat currently wants shared memory and personality continuity
- but execution safety really wants per-user isolation

So the system needs an explicit mode model instead of one universal routing rule.

## 2. Product Direction

AutoAide should become:

- a multi-bot runtime
- each bot bound to exactly one external channel
- each bot running in one of two interaction modes:
  - single-user mode
  - group-chat management mode

The core rule should be:

- one bot, one channel, one interaction mode

This makes deployment and mental model much cleaner.

## 3. Proposed Mode Model

### 3.1 Single-user mode

Single-user mode is for personal assistant use.

Rules:

- one bot serves one human owner
- one external channel per bot
- no multi-session chat routing on remote channels
- only one canonical conversation thread per user/channel surface
- `/goal` stays enabled
- schedules stay enabled
- local CLI can still exist, but should map to the same primary personal session

This mode should feel like:

- one assistant
- one memory line
- one owner

### 3.2 Group-chat management mode

Group-chat mode is for shared team/group usage.

Rules:

- one bot sits inside a shared group or can also be privately messaged
- group chat itself is not the session identity
- each human user gets a separate assistant session
- group channel becomes the transport surface, not the memory container
- `/goal` should be disabled
- schedules should be disabled by default unless explicitly reintroduced later with admin-only semantics

This mode should feel like:

- one shared bot identity
- many user-specific sub-conversations
- one execution queue per user or per bot policy

## 4. Key Decision

Your instinct is correct:

- single-user mode keeps `/goal`
- group-chat mode should not keep `/goal`

Reason:

- `/goal` relies on persistent long-running supervision against one user’s intent
- in a group context, ownership, interruption, and authority become ambiguous
- it also creates noise and social confusion in shared channels

So:

- keep `/goal` only in single-user mode
- remove it from group-chat mode entirely

## 5. Canonical Routing Model

The new system should stop treating “chat” as the default session key.

Instead, use a routing identity composed from:

- bot id
- channel
- chat type
- chat id
- user id

### 5.1 Detection requirement

Every channel adapter must normalize:

- `channel`
- `chatType`
- `chatId`
- `userId`
- `messageId`
- `isGroup`
- `isDirect`
- `explicitlyMentionedBot`

This should be mandatory for every channel bridge.

### 5.2 Normalized chat types

Internally, channel adapters should map their native event model into:

- `direct`
- `group`

For example:

- Telegram `private` -> `direct`
- Telegram `group` / `supergroup` -> `group`
- Feishu `p2p` -> `direct`
- Feishu non-`p2p` -> `group`

## 6. Session Routing Rules

### 6.1 Single-user mode routing

In single-user mode:

- direct chat -> one canonical personal session
- group chat should normally be unsupported, or treated as read-only / mention-only relay to the same single owner session only if explicitly enabled

The important simplification:

- no remote multi-session controls
- no `/new`
- no `/switch`
- no per-user branching

The user should just talk to the assistant.

### 6.2 Group-chat mode routing

In group-chat mode:

- direct chat from user X -> session key = `(channel, userId)`
- group chat message from user X -> session key = `(channel, groupChatId, userId)`

This is the key rule:

- group memory is not the same as execution memory

So the bot can still read the surrounding group context, but the persistent assistant session belongs to the human speaker, not to the entire room.

### 6.3 Group context handling

For group chat mode, each turn should include two layers of context:

1. User session context
   - persistent per-user conversation thread

2. Group situational context
   - recent visible group messages
   - who is speaking
   - who was mentioned
   - current channel/group label

That gives you:

- continuity for each user
- awareness of the group scene
- no session collision between different people

## 7. Proposed Memory Model

### 7.1 Single-user mode

Persistent memory key:

- `botId + ownerUserId`

Chat session count:

- exactly one primary session

### 7.2 Group-chat mode

Persistent memory key:

- direct: `botId + userId`
- group: `botId + chatId + userId`

This means:

- the same person can have one relationship with the bot in DM
- and a different role-specific relationship in a shared group

That is usually the correct tradeoff.

If you later want cross-surface identity merge, it should be an explicit feature, not the default.

## 8. Execution Model

### 8.1 Single-user mode

Recommended:

- max one active execution per bot
- `/stop` cancels it
- `/goal` allowed
- schedule allowed

### 8.2 Group-chat mode

Recommended:

- one queue per routed user session
- optional global concurrency cap per bot
- `/stop` can only stop the sender’s own running task unless sender is admin
- `/goal` unavailable
- schedule unavailable by default

This avoids:

- one user blocking everyone forever
- one user stopping another user’s task accidentally

## 9. What Midjourney Got Right

Based on Midjourney’s official Discord docs, the useful product lessons are:

### 9.1 Command-first interaction

Midjourney relies on Discord slash commands such as:

- `/imagine`
- `/info`
- `/settings`
- `/describe`
- `/blend`
- `/relax`
- `/fast`

This creates a strong, low-ambiguity operating model.

Source:

- Midjourney command list: https://docs.midjourney.com/hc/en-us/articles/32894521590669-Discord-Command-List

### 9.2 DM as a private continuation surface

Midjourney explicitly supports DMing the bot and treats DMs as a usable private workspace.

Source:

- Midjourney direct messages: https://docs.midjourney.com/hc/en-us/articles/32637339216013-Discord-Direct-Messages

This matters for AutoAide because it suggests a healthy split:

- public/shared surface for invocation
- private surface for personal continuation when needed

### 9.3 Personal status panels inside shared surfaces

Midjourney’s `/info` returns a panel about queued/running jobs and account info, and the docs state that only the invoking user can see that info panel even when run in a public channel.

Source:

- Midjourney `/info`: https://docs.midjourney.com/hc/en-us/articles/32084927086861-Info-Command

That is a strong design lesson for AutoAide:

- public channels should not be the default place for noisy personal state dumps
- personal operational metadata should be private or at least scoped to the invoker

### 9.4 Channel and DM are explicit contexts in Discord

Discord officially distinguishes interaction contexts such as:

- `GUILD`
- `BOT_DM`
- `PRIVATE_CHANNEL`

and also supports command-level permission controls for users, roles, and channels.

Source:

- Discord application commands: https://docs.discord.com/developers/interactions/application-commands
- Discord interactions: https://docs.discord.com/developers/interactions/receiving-and-responding

The design implication is:

- context awareness should be first-class in AutoAide, not an afterthought

## 10. Product Implications For AutoAide

AutoAide should borrow the following from Midjourney’s design philosophy:

1. Strong mode boundaries
2. Context-aware command availability
3. Personal status views instead of noisy shared control chatter
4. Public invocation plus private continuation as an optional pattern

But AutoAide should not copy Midjourney literally, because the products differ:

- Midjourney is mostly job submission and asset generation
- AutoAide is conversational, stateful, and agentic

So the right adaptation is:

- keep conversational freedom
- adopt explicit command and context governance

## 11. Recommended AutoAide Product Shape

### 11.1 Bot contract

Each bot should declare:

- `channel`
- `mode`
- `ownerUserId` or owner identity for single-user mode
- optional admin user ids for group mode

Suggested config shape:

```json
{
  "channel": "feishu",
  "mode": "group",
  "ownerUserId": null,
  "admins": ["u_123"],
  "channelConfig": {}
}
```

Allowed mode values:

- `single_user`
- `group`

### 11.2 Channel contract

Every channel adapter must provide a normalized inbound envelope:

```json
{
  "channel": "feishu",
  "chatType": "group",
  "chatId": "oc_xxx",
  "userId": "ou_xxx",
  "messageId": "om_xxx",
  "isDirect": false,
  "isGroup": true,
  "explicitlyMentionedBot": true,
  "text": "..."
}
```

### 11.3 Session resolution contract

Introduce one shared resolver:

`resolveConversationKey(botConfig, envelope) -> conversationKey`

Rules:

- single-user mode -> fixed key
- group mode + direct -> key by user
- group mode + group -> key by group + user

## 12. Command Availability Matrix

### 12.1 Single-user mode

Allowed:

- normal chat
- `/stop`
- `/where`
- `/goal`
- `/status`
- schedule commands

Disallowed or hidden:

- `/new`
- `/switch`
- `/sessions`

### 12.2 Group-chat mode

Allowed:

- normal chat
- `/stop`
- `/where`
- lightweight status

Disallowed:

- `/goal`
- schedule commands
- multi-session commands exposed to users

Admin-only optional:

- `/status`
- `/config`
- `/restart`

## 13. Response Policy

### 13.1 Group chat

In groups:

- only respond when explicitly addressed if the channel requires mention gating
- keep replies concise by default
- avoid dumping session ids, internal state, and long operational logs into the room

### 13.2 Private chat

In private chat:

- allow richer status output
- allow deeper operational commands
- allow personal supervision features in single-user mode

## 14. Queueing Policy

### 14.1 Single-user mode

- one active run total
- subsequent requests get a short busy message

### 14.2 Group-chat mode

Recommended:

- one queue per routed user session
- optional global max concurrent sessions per bot

This is better than one big room-wide queue, because:

- it avoids one dominant user starving everyone else
- it keeps causality per user

## 15. Concrete Recommendation

I recommend this exact redesign:

1. Introduce explicit bot `mode`
   - `single_user`
   - `group`

2. Enforce one bot -> one channel

3. Remove remote multi-session UX from single-user mode
   - keep one canonical conversation

4. Remove `/goal` from group mode entirely

5. Make chat-type normalization mandatory in every channel adapter

6. Route sessions by user, not by room, in group mode

7. Pass recent group context into prompts without making the group itself the session owner

8. Make status and operational chatter private or minimized in shared rooms

## 16. Suggested Implementation Plan

### Phase 1

- add `mode` to bot config
- add shared normalized channel envelope
- add `isGroup` / `isDirect` to every channel adapter

### Phase 2

- introduce shared `resolveConversationKey(...)`
- change Telegram and Feishu routing to use resolved conversation keys instead of raw chat-level session keys

### Phase 3

- single-user mode:
  - collapse external channel sessioning to one canonical session
  - hide `/new`, `/switch`, `/sessions`

### Phase 4

- group mode:
  - disable `/goal`
  - disable schedules
  - enforce per-user session routing
  - add per-user stop ownership checks

### Phase 5

- add group-context prompt window
- keep recent room context separate from persistent user session memory

### Phase 6

- clean up Web and CLI UI so configuration is mode-aware

## 17. Final Opinion

Your direction is correct.

The most important strategic move is not “improve the current shared group session.”

It is:

- separate single-user and group mode at the product model level
- make user identity the session owner in shared environments

That gives AutoAide a much more defensible architecture:

- simpler for one-person use
- safer for teams
- easier to extend across Telegram, Feishu, and future channels

