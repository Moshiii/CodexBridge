import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

function baseConfig() {
  return {
    channels: {
      telegram: {
        enabled: false,
        botToken: "",
        botUsername: "old_bot",
        metadata: {
          chats: {
            "1": { type: "group", title: "Existing" },
          },
          users: {
            "2": { username: "existing" },
          },
        },
        private: {
          allowedChatIds: ["10"],
        },
        groups: {
          allowedChatIds: ["20"],
          allowedUserIds: ["30"],
          requireExplicitMention: false,
        },
      },
    },
  };
}

test("control plane telegram service builds paired config and preserves existing metadata", async () => {
  const { buildPairedTelegramConfig } = await importFresh("../../src/control-plane-telegram-service.mjs");

  const next = buildPairedTelegramConfig(baseConfig(), "123456:ABCDEF", {
    chatId: "100",
    userId: "200",
    botUsername: "new_bot",
    userUsername: "alice",
  });

  assert.equal(next.enabled, true);
  assert.equal(next.channels.telegram.enabled, true);
  assert.equal(next.channels.telegram.botToken, "123456:ABCDEF");
  assert.equal(next.channels.telegram.botUsername, "new_bot");
  assert.equal(next.channels.telegram.metadata.chats["1"].title, "Existing");
  assert.equal(next.channels.telegram.metadata.chats["100"].label, "@alice");
  assert.equal(next.channels.telegram.metadata.users["200"].label, "@alice");
  assert.deepEqual(next.channels.telegram.private.allowedChatIds, ["100"]);
  assert.deepEqual(next.channels.telegram.groups.allowedChatIds, ["20"]);
  assert.deepEqual(next.channels.telegram.groups.allowedUserIds, ["30", "200"]);
  assert.equal(next.channels.telegram.groups.requireExplicitMention, false);
});

test("control plane telegram service updates allowed access with validation and de-duplication", async () => {
  const { buildTelegramAccessConfig } = await importFresh("../../src/control-plane-telegram-service.mjs");

  const privateChat = buildTelegramAccessConfig(baseConfig(), { accessType: "private_chat", id: "10" });
  const groupChat = buildTelegramAccessConfig(baseConfig(), { accessType: "group_chat", id: "21" });
  const groupUser = buildTelegramAccessConfig(baseConfig(), { accessType: "group_user", id: "31" });

  assert.deepEqual(privateChat.channels.telegram.private.allowedChatIds, ["10"]);
  assert.deepEqual(groupChat.channels.telegram.groups.allowedChatIds, ["20", "21"]);
  assert.deepEqual(groupUser.channels.telegram.groups.allowedUserIds, ["30", "31"]);
  assert.throws(
    () => buildTelegramAccessConfig(baseConfig(), { accessType: "private_chat", id: "" }),
    /Telegram access id is required/,
  );
  assert.throws(
    () => buildTelegramAccessConfig(baseConfig(), { accessType: "bad", id: "1" }),
    /Telegram access type is required/,
  );
});

test("control plane telegram service pairs through injected dependencies", async () => {
  const { pairTelegramForControlPlane } = await importFresh("../../src/control-plane-telegram-service.mjs");
  const updates = [];

  const result = await pairTelegramForControlPlane("bot-a", "123456:ABCDEF", {
    pairFn: async (token) => {
      assert.equal(token, "123456:ABCDEF");
      return {
        chatId: "100",
        userId: "200",
        botUsername: "new_bot",
        userUsername: "alice",
      };
    },
    updateBotConfigFn: async (botId, updater) => {
      updates.push([botId, updater(baseConfig())]);
    },
    getDetailFn: async (botId) => ({ botId, ok: true }),
  });

  assert.equal(result.chatId, "100");
  assert.equal(result.userId, "200");
  assert.equal(result.botUsername, "new_bot");
  assert.deepEqual(result.detail, { botId: "bot-a", ok: true });
  assert.equal(updates[0][0], "bot-a");
  assert.equal(updates[0][1].channels.telegram.metadata.users["200"].label, "@alice");
  await assert.rejects(
    () => pairTelegramForControlPlane("bot-a", "placeholder", {
      pairFn: async () => {
        throw new Error("should not pair");
      },
      updateBotConfigFn: async () => {},
      getDetailFn: async () => ({}),
    }),
    /placeholder Telegram token/,
  );
});

test("control plane telegram service allows access through injected dependencies", async () => {
  const { allowTelegramAccessForControlPlane } = await importFresh("../../src/control-plane-telegram-service.mjs");
  let updated = null;

  const detail = await allowTelegramAccessForControlPlane("bot-a", { accessType: "group_chat", id: "21" }, {
    updateBotConfigFn: async (botId, updater) => {
      updated = { botId, config: updater(baseConfig()) };
    },
    getDetailFn: async (botId) => ({ botId, refreshed: true }),
  });

  assert.equal(updated.botId, "bot-a");
  assert.deepEqual(updated.config.channels.telegram.groups.allowedChatIds, ["20", "21"]);
  assert.deepEqual(detail, { botId: "bot-a", refreshed: true });
});
