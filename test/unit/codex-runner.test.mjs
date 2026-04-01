import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("getShellSpec defaults to non-login shell on unix", async () => {
  await withTempHome(async () => {
    delete process.env.AUTOAIDE_LOGIN_SHELL;
    const { getShellSpec } = await importFresh("../../src/codex-runner.mjs");

    if (process.platform === "win32") {
      assert.deepEqual(getShellSpec().args, ["/d", "/s", "/c"]);
      return;
    }

    assert.deepEqual(getShellSpec().args, ["-c"]);
  });
});

test("getShellSpec supports explicit login-shell opt-in", async () => {
  await withTempHome(async () => {
    process.env.AUTOAIDE_LOGIN_SHELL = "true";
    const { getShellSpec } = await importFresh("../../src/codex-runner.mjs");

    if (process.platform === "win32") {
      assert.deepEqual(getShellSpec().args, ["/d", "/s", "/c"]);
      return;
    }

    assert.deepEqual(getShellSpec().args, ["-lc"]);
    delete process.env.AUTOAIDE_LOGIN_SHELL;
  });
});
