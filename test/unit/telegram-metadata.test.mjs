import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("hydrateTelegramMetadata backfills usernames for existing allow lists", async () => {
  await withTempHome(async (tempHome) => {
    const originalFetch = global.fetch;
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.chat_id === "6994248212") {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              result: {
                id: 6994248212,
                type: "private",
                username: "moshiwei",
              },
            };
          },
        };
      }
      throw new Error(`unexpected chat id ${body.chat_id}`);
    };

    try {
      const configModule = await importFresh("../../src/config.mjs");
      await configModule.writeConfig({
        channels: {
          telegram: {
            enabled: true,
            botToken: "token-123",
            private: {
              allowedChatIds: ["6994248212"],
            },
            groups: {
              allowedChatIds: [],
              allowedUserIds: ["6994248212"],
              requireExplicitMention: true,
            },
          },
        },
      });

      const { hydrateTelegramMetadata } = await importFresh("../../src/telegram-metadata.mjs");
      const config = await hydrateTelegramMetadata(`${tempHome}/bots/default`);

      assert.equal(config.channels.telegram.metadata.users["6994248212"].username, "moshiwei");
      assert.equal(config.channels.telegram.metadata.chats["6994248212"].label, "@moshiwei");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
