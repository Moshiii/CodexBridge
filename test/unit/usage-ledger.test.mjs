import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("appendUsageEvent stores and lists usage events", async () => {
  await withTempHome(async () => {
    const ledger = await importFresh("../../src/usage-ledger.mjs");

    const event = await ledger.appendUsageEvent({
      eventType: "charge",
      userId: "telegram:1",
      channel: "telegram",
      chatType: "group",
      chatId: "-100",
      messageId: "10",
      amount: 1,
      source: "daily_free",
      reason: "group_daily_free",
    });
    const events = await ledger.listUsageEvents({ userId: "telegram:1" });

    assert.equal(event.eventType, "charge");
    assert.equal(event.userId, "telegram:1");
    assert.equal(events.length, 1);
    assert.equal(events[0].eventId, event.eventId);
  });
});

test("chargeUsage writes charge and deny events", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");
    const ledger = await importFresh("../../src/usage-ledger.mjs");

    await credits.chargeUsage({
      userId: "telegram:1",
      chatType: "group",
      channel: "telegram",
      chatId: "-100",
      messageId: "10",
      runId: "run_1",
    });
    await credits.chargeUsage({ userId: "empty", chatType: "direct", runId: "run_denied" });

    const charged = await ledger.listUsageEvents({ userId: "telegram:1" });
    const denied = await ledger.listUsageEvents({ userId: "empty" });

    assert.equal(charged[0].eventType, "charge");
    assert.equal(charged[0].source, "daily_free");
    assert.equal(charged[0].runId, "run_1");
    assert.equal(denied.at(-1).eventType, "deny");
    assert.equal(denied.at(-1).runId, "run_denied");
  });
});

test("grantPaidCredits writes grant event", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");
    const ledger = await importFresh("../../src/usage-ledger.mjs");

    await credits.grantPaidCredits({ userId: "telegram:1", amount: 10 });
    const events = await ledger.listUsageEvents({ userId: "telegram:1" });

    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "grant");
    assert.equal(events[0].amount, 10);
    assert.equal(events[0].source, "manual");
  });
});
