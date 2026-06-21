import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("getBotMetrics aggregates users, credits, usage, and run health", async () => {
  await withTempHome(async () => {
    const users = await importFresh("../../src/repositories/users-repository.mjs");
    const credits = await importFresh("../../src/repositories/credits-repository.mjs");
    const runs = await importFresh("../../src/repositories/runs-repository.mjs");
    const analytics = await importFresh("../../src/analytics-service.mjs");

    await users.saveUser({
      channel: "telegram",
      externalUserId: "1",
      status: "free",
    });
    await users.saveUser({
      channel: "telegram",
      externalUserId: "2",
      status: "paid",
      privateEnabled: true,
    });
    await credits.grantCredits({ userId: "telegram:2", amount: 4 });
    await credits.chargeCredits({
      userId: "telegram:1",
      chatType: "group",
      channel: "telegram",
      runId: "run_daily",
    });
    await credits.chargeCredits({
      userId: "telegram:2",
      chatType: "direct",
      channel: "telegram",
      runId: "run_paid",
    });
    await credits.refundCredits({
      userId: "telegram:2",
      amount: 1,
      runId: "run_paid",
    });
    await runs.createRun({
      runId: "run_daily",
      userId: "telegram:1",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:03.000Z",
      finishedAt: "2026-01-01T00:00:03.000Z",
    });
    await runs.createRun({
      runId: "run_paid",
      userId: "telegram:2",
      status: "failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
    });

    const metrics = await analytics.getBotMetrics();

    assert.equal(metrics.totals.users, 2);
    assert.equal(metrics.totals.groupTrialUsers, 1);
    assert.equal(metrics.totals.paidActiveUsers, 1);
    assert.equal(metrics.totals.paidConversionRate, 0.5);
    assert.equal(metrics.userStatusCounts.free, 1);
    assert.equal(metrics.userStatusCounts.paid, 1);
    assert.equal(metrics.runStatusCounts.completed, 1);
    assert.equal(metrics.runStatusCounts.failed, 1);
    assert.equal(metrics.creditTotals.dailyFreeCharged, 1);
    assert.equal(metrics.creditTotals.paidCreditsCharged, 1);
    assert.equal(metrics.creditTotals.paidCreditsGranted, 4);
    assert.equal(metrics.creditTotals.paidCreditsRefunded, 1);
    assert.equal(metrics.totals.averageRunLatencyMs, 2000);
  });
});
