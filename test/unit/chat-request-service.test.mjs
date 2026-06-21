import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("prepareChatRequest creates user, queued run, and daily-free charge for group chat", async () => {
  await withTempHome(async () => {
    const service = await importFresh("../../src/chat-request-service.mjs");
    const runs = await importFresh("../../src/run-service.mjs");
    const ledger = await importFresh("../../src/usage-ledger.mjs");

    const result = await service.prepareChatRequest({
      channel: "telegram",
      externalUserId: "1",
      displayName: "@demo",
      envelope: {
        channel: "telegram",
        userId: "1",
        chatType: "group",
        conversationId: "telegram:group:-100:user:1",
      },
      chatId: "-100",
      messageId: "m1",
    });

    assert.equal(result.ok, true);
    assert.equal(result.user.id, "telegram:1");
    assert.equal(result.run.status, "queued");
    assert.equal(result.charged.costSource, "daily_free");
    const latestRun = await runs.getRunRecord(result.run.runId);
    const events = await ledger.listUsageEvents({ userId: "telegram:1" });
    assert.equal(latestRun.status, "queued");
    assert.equal(events[0].runId, result.run.runId);
  });
});

test("prepareChatRequest denies locked private chat without charging", async () => {
  await withTempHome(async () => {
    const service = await importFresh("../../src/chat-request-service.mjs");
    const ledger = await importFresh("../../src/usage-ledger.mjs");

    const result = await service.prepareChatRequest({
      channel: "telegram",
      externalUserId: "1",
      envelope: {
        channel: "telegram",
        userId: "1",
        chatType: "direct",
        isDirect: true,
      },
      chatId: "1",
      messageId: "m1",
    });
    const events = await ledger.listUsageEvents({ userId: "telegram:1" });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "private_chat_locked");
    assert.equal(result.run.status, "denied");
    assert.equal(events.length, 0);
  });
});

test("prepareChatRequest denies group chat after free quota when paid credits are empty", async () => {
  await withTempHome(async () => {
    const service = await importFresh("../../src/chat-request-service.mjs");
    const credits = await importFresh("../../src/user-credits.mjs");
    const ledger = await importFresh("../../src/usage-ledger.mjs");

    let result = null;
    for (let index = 0; index <= credits.DEFAULT_DAILY_FREE_LIMIT; index += 1) {
      result = await service.prepareChatRequest({
        channel: "telegram",
        externalUserId: "1",
        envelope: {
          channel: "telegram",
          userId: "1",
          chatType: "group",
        },
        chatId: "-100",
        messageId: `m${index}`,
      });
    }
    const events = await ledger.listUsageEvents({ userId: "telegram:1" });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient_credits");
    assert.equal(result.run.status, "denied");
    assert.equal(events.at(-1).eventType, "deny");
  });
});
