import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("normalizeTelegramEnvelope returns direct envelope for private chats", async () => {
  const { normalizeTelegramEnvelope } = await importFresh("../../src/channel-envelope.mjs");
  const envelope = normalizeTelegramEnvelope({
    chat: { id: 100, type: "private" },
    from: { id: 200 },
    message_id: 300,
    text: "hello",
  }, {
    text: "hello",
  });

  assert.deepEqual(envelope, {
    channel: "telegram",
    chatType: "direct",
    chatId: "100",
    userId: "200",
    messageId: "300",
    isDirect: true,
    isGroup: false,
    explicitlyMentionedBot: true,
    text: "hello",
    raw: {
      chat: { id: 100, type: "private" },
      from: { id: 200 },
      message_id: 300,
      text: "hello",
    },
  });
});

test("normalizeFeishuEnvelope returns group envelope for non-p2p chats", async () => {
  const { normalizeFeishuEnvelope } = await importFresh("../../src/channel-envelope.mjs");
  const event = {
    message: {
      chat_id: "oc_1234567890",
      chat_type: "group",
      message_id: "om_123",
    },
    sender: {
      sender_id: { open_id: "ou_456" },
    },
  };
  const envelope = normalizeFeishuEnvelope(event, {
    text: "@bot hi",
    explicitlyMentionedBot: true,
  });

  assert.equal(envelope.channel, "feishu");
  assert.equal(envelope.chatType, "group");
  assert.equal(envelope.chatId, "oc_1234567890");
  assert.equal(envelope.userId, "ou_456");
  assert.equal(envelope.messageId, "om_123");
  assert.equal(envelope.isDirect, false);
  assert.equal(envelope.isGroup, true);
  assert.equal(envelope.explicitlyMentionedBot, true);
  assert.equal(envelope.text, "@bot hi");
  assert.equal(envelope.raw, event);
});

test("resolveSessionKey uses user identity in direct chats", async () => {
  const { resolveSessionKey, resolveSessionLabel } = await importFresh("../../src/session-routing.mjs");
  const envelope = {
    channel: "telegram",
    chatType: "direct",
    isDirect: true,
    userId: "99887766",
  };

  assert.equal(resolveSessionKey(envelope), "telegram:user:99887766");
  assert.equal(resolveSessionLabel(envelope), "telegram-u-99887766");
});

test("resolveSessionKey uses chat and user identity in group chats", async () => {
  const { resolveConversationIdentity } = await importFresh("../../src/session-routing.mjs");
  const identity = resolveConversationIdentity({
    channel: "feishu",
    chatType: "group",
    isGroup: true,
    chatId: "oc_d70431726f2f3e0eb3c540609dc324fc",
    userId: "ou_1234567890",
  });

  assert.equal(
    identity.sessionKey,
    "feishu:chat:oc_d70431726f2f3e0eb3c540609dc324fc:user:ou_1234567890",
  );
  assert.equal(identity.sessionLabel, "feishu-g-9dc324fc-u-34567890");
});
