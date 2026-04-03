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

test("buildCommandConfig injects model into default exec commands", async () => {
  await withTempHome(async () => {
    const { buildCommandConfig } = await importFresh("../../src/codex-runner.mjs");
    const config = buildCommandConfig({
      runtime: {
        model: "gpt-5.4-mini",
      },
    });

    assert.match(config.startCommand, /--model 'gpt-5\.4-mini'/);
    assert.match(config.resumeTemplate, /--model 'gpt-5\.4-mini'/);
  });
});

test("buildCommandConfig does not duplicate explicit model flags", async () => {
  await withTempHome(async () => {
    process.env.CODEX_START_COMMAND = "codex exec --model gpt-5.4 --json -";
    process.env.CODEX_RESUME_COMMAND_TEMPLATE = "codex exec resume --model gpt-5.4 __SESSION_ID__ -";
    const { buildCommandConfig } = await importFresh("../../src/codex-runner.mjs");
    const config = buildCommandConfig({
      runtime: {
        model: "gpt-5.4-mini",
      },
    });

    assert.equal((config.startCommand.match(/--model/g) || []).length, 1);
    assert.equal((config.resumeTemplate.match(/--model/g) || []).length, 1);
    delete process.env.CODEX_START_COMMAND;
    delete process.env.CODEX_RESUME_COMMAND_TEMPLATE;
  });
});
