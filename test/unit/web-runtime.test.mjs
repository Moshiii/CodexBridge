import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("web runtime can start in background, report status, and stop", async () => {
  await withTempHome(async () => {
    const { ensureWebRuntime, getWebRuntimeStatus, stopWebRuntime } = await importFresh(
      "../../src/web-runtime.mjs",
    );

    const started = await ensureWebRuntime({ host: "127.0.0.1", port: 0 });
    assert.equal(started.running, true);
    assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const status = await getWebRuntimeStatus();
    assert.equal(status.running, true);
    assert.equal(status.pid, started.pid);
    assert.equal(status.url, started.url);

    const stopped = await stopWebRuntime();
    assert.equal(stopped.stopped, true);

    const finalStatus = await getWebRuntimeStatus();
    assert.equal(finalStatus.running, false);
  });
});

test("web runtime restart keeps service available", async () => {
  await withTempHome(async () => {
    const { ensureWebRuntime, restartWebRuntime, stopWebRuntime } = await importFresh(
      "../../src/web-runtime.mjs",
    );

    const started = await ensureWebRuntime({ host: "127.0.0.1", port: 0 });
    const restarted = await restartWebRuntime({ host: "127.0.0.1", port: 0 });

    assert.equal(restarted.running, true);
    assert.match(restarted.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(restarted.pid, null);
    assert.notEqual(started.pid, null);

    await stopWebRuntime();
  });
});
