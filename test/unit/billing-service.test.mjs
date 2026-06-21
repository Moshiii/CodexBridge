import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("resolveBillingSource maps group to free-then-paid and direct to paid", async () => {
  await withTempHome(async () => {
    const billing = await importFresh("../../src/billing-service.mjs");

    assert.equal(billing.resolveBillingSource("group"), "daily_free_then_paid");
    assert.equal(billing.resolveBillingSource("direct"), "paid_credit");
    assert.equal(billing.resolveBillingSource("private"), "paid_credit");
  });
});

test("chargeRequestUsage uses daily free before paid credits", async () => {
  await withTempHome(async () => {
    const billing = await importFresh("../../src/billing-service.mjs");

    const charge = await billing.chargeRequestUsage({
      userId: "telegram:1",
      chatType: "group",
      channel: "telegram",
      runId: "run_1",
    });

    assert.equal(charge.ok, true);
    assert.equal(charge.costSource, "daily_free");
    assert.equal(charge.dailyFreeCharged, 1);
  });
});

test("chargeRequestUsage rejects direct usage without paid credits", async () => {
  await withTempHome(async () => {
    const billing = await importFresh("../../src/billing-service.mjs");

    const denied = await billing.chargeRequestUsage({
      userId: "telegram:1",
      chatType: "direct",
      channel: "telegram",
      runId: "run_1",
    });

    assert.equal(denied.ok, false);
    assert.match(
      billing.renderBillingDeniedMessage(denied, { userId: "telegram:1" }),
      /Top up paid credits/,
    );
  });
});

test("grantCredits and adjustCredits update paid credits", async () => {
  await withTempHome(async () => {
    const billing = await importFresh("../../src/billing-service.mjs");

    await billing.grantCredits({ userId: "telegram:1", amount: 10 });
    await billing.adjustCredits({ userId: "telegram:1", amount: -3, reason: "manual_deduct" });
    const account = await billing.getBillingAccount("telegram:1");

    assert.equal(account.account.paidCredits, 7);
  });
});

test("refundPaidCreditCharge refunds paid-credit charges and writes ledger", async () => {
  await withTempHome(async () => {
    const billing = await importFresh("../../src/billing-service.mjs");
    const ledger = await importFresh("../../src/usage-ledger.mjs");

    await billing.grantCredits({ userId: "telegram:1", amount: 2 });
    const charge = await billing.chargeRequestUsage({
      userId: "telegram:1",
      chatType: "direct",
      channel: "telegram",
      runId: "run_paid",
    });
    const refund = await billing.refundPaidCreditCharge({
      userId: "telegram:1",
      chargeResult: charge,
      channel: "telegram",
      chatType: "direct",
      runId: "run_paid",
    });
    const account = await billing.getBillingAccount("telegram:1");
    const events = await ledger.listUsageEvents({ userId: "telegram:1" });

    assert.equal(refund.refunded, 1);
    assert.equal(account.account.paidCredits, 2);
    assert.equal(events.at(-1).eventType, "refund");
    assert.equal(events.at(-1).runId, "run_paid");
  });
});

test("refundPaidCreditCharge skips daily-free charges", async () => {
  await withTempHome(async () => {
    const billing = await importFresh("../../src/billing-service.mjs");

    const charge = await billing.chargeRequestUsage({
      userId: "telegram:1",
      chatType: "group",
    });
    const refund = await billing.refundPaidCreditCharge({
      userId: "telegram:1",
      chargeResult: charge,
    });

    assert.equal(charge.costSource, "daily_free");
    assert.equal(refund.skipped, true);
    assert.equal(refund.refunded, 0);
  });
});
