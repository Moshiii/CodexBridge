import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("createRunRecord stores a queued run", async () => {
  await withTempHome(async () => {
    const runs = await importFresh("../../src/runs-state.mjs");

    const run = await runs.createRunRecord({
      userId: "telegram:1",
      channel: "telegram",
      chatType: "group",
      status: "queued",
    });

    assert.ok(run.runId);
    assert.equal(run.userId, "telegram:1");
    assert.equal(run.status, "queued");
  });
});

test("updateRunRecord appends latest run snapshot", async () => {
  await withTempHome(async () => {
    const runs = await importFresh("../../src/runs-state.mjs");

    const run = await runs.createRunRecord({
      userId: "telegram:1",
      status: "queued",
    });
    await runs.updateRunRecord(run.runId, {
      status: "running",
    });
    await runs.updateRunRecord(run.runId, {
      status: "completed",
      creditsCharged: 1,
      costSource: "daily_free",
      codexThreadId: "thread_1",
      outputPreview: "done",
    });
    const latest = await runs.getRunRecord(run.runId);

    assert.equal(latest.status, "completed");
    assert.equal(latest.creditsCharged, 1);
    assert.equal(latest.codexThreadId, "thread_1");
    assert.equal(latest.outputPreview, "done");
    assert.ok(latest.finishedAt);
  });
});

test("listRunRecords filters by user", async () => {
  await withTempHome(async () => {
    const runs = await importFresh("../../src/runs-state.mjs");

    await runs.createRunRecord({ userId: "telegram:1" });
    await runs.createRunRecord({ userId: "telegram:2" });

    const records = await runs.listRunRecords({ userId: "telegram:1" });

    assert.equal(records.length, 1);
    assert.equal(records[0].userId, "telegram:1");
  });
});
