import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("run service drives a completed run lifecycle", async () => {
  await withTempHome(async () => {
    const runs = await importFresh("../../src/run-service.mjs");

    const run = await runs.createQueuedRun({
      userId: "telegram:1",
      channel: "telegram",
      chatType: "group",
    });
    await runs.markRunRunning(run.runId, {
      costSource: "daily_free",
      creditsCharged: 1,
    });
    await runs.markRunCompleted(run.runId, {
      codexThreadId: "thread_1",
      output: "done",
    });
    const latest = await runs.getRunRecord(run.runId);

    assert.equal(latest.status, "completed");
    assert.equal(latest.costSource, "daily_free");
    assert.equal(latest.creditsCharged, 1);
    assert.equal(latest.codexThreadId, "thread_1");
    assert.equal(latest.outputPreview, "done");
    assert.ok(latest.finishedAt);
  });
});

test("run service records denied, failed, and stopped states", async () => {
  await withTempHome(async () => {
    const runs = await importFresh("../../src/run-service.mjs");

    const denied = await runs.createQueuedRun({ userId: "telegram:1" });
    await runs.markRunDenied(denied.runId, "insufficient_credits");
    const failed = await runs.createQueuedRun({ userId: "telegram:2" });
    await runs.markRunFailed(failed.runId, new Error("boom"));
    const stopped = await runs.createQueuedRun({ userId: "telegram:3" });
    await runs.markRunStopped(stopped.runId, "user_stop");

    assert.equal((await runs.getRunRecord(denied.runId)).reason, "insufficient_credits");
    assert.equal((await runs.getRunRecord(failed.runId)).error, "boom");
    assert.equal((await runs.getRunRecord(stopped.runId)).status, "stopped");
  });
});

test("run service trims long output previews", async () => {
  await withTempHome(async () => {
    const runs = await importFresh("../../src/run-service.mjs");

    const run = await runs.createQueuedRun({ userId: "telegram:1" });
    await runs.markRunCompleted(run.runId, {
      output: "x".repeat(600),
    });
    const latest = await runs.getRunRecord(run.runId);

    assert.equal(latest.outputPreview.length, 500);
    assert.match(latest.outputPreview, /\.\.\.$/);
  });
});
