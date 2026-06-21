import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("repositories expose users, credits, usage ledger, and runs", async () => {
  await withTempHome(async () => {
    const users = await importFresh("../../src/repositories/users-repository.mjs");
    const credits = await importFresh("../../src/repositories/credits-repository.mjs");
    const usage = await importFresh("../../src/repositories/usage-ledger-repository.mjs");
    const runs = await importFresh("../../src/repositories/runs-repository.mjs");

    const user = await users.saveUser({
      channel: "telegram",
      externalUserId: "1",
      displayName: "@demo",
    });
    const run = await runs.createRun({
      userId: user.id,
      channel: "telegram",
      chatType: "group",
      status: "queued",
    });
    await credits.chargeCredits({
      userId: user.id,
      chatType: "group",
      channel: "telegram",
      runId: run.runId,
    });
    await runs.updateRun(run.runId, {
      status: "completed",
      costSource: "daily_free",
      creditsCharged: 1,
    });

    const listedUsers = await users.listUsers();
    const listedUsage = await usage.listUsageLedgerEvents({ userId: user.id });
    const latestRun = await runs.findRun(run.runId);

    assert.equal(listedUsers.length, 1);
    assert.equal(listedUsers[0].id, "telegram:1");
    assert.equal(listedUsage[0].runId, run.runId);
    assert.equal(latestRun.status, "completed");
  });
});
