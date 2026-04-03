import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("pairTelegramChannel retries until a private chat update appears", async () => {
  await withTempHome(async () => {
    const originalFetch = global.fetch;
    const responses = [
      { ok: true, result: { id: 1, username: "demo_bot" } },
      { ok: true, result: [] },
      {
        ok: true,
        result: [
          {
            update_id: 10,
            message: {
              chat: { id: 6994248212, type: "private" },
              from: { id: 6994248212, username: "moshiwei" },
            },
          },
        ],
      },
    ];

    global.fetch = async () => {
      const next = responses.shift();
      return {
        ok: true,
        async json() {
          return next;
        },
      };
    };

    try {
      const { pairTelegramChannel } = await importFresh("../../src/telegram-pairing.mjs");
      const paired = await pairTelegramChannel("token-123", {
        attempts: 2,
        timeoutSeconds: 0,
        retryDelayMs: 0,
      });

      assert.equal(paired.chatId, "6994248212");
      assert.equal(paired.userId, "6994248212");
      assert.equal(paired.botUsername, "demo_bot");
      assert.equal(paired.userUsername, "moshiwei");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
