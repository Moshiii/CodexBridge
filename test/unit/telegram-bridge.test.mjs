import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("renderRunningMessage stays compact", async () => {
  await withTempHome(async () => {
    const { renderRunningMessage } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    const text = renderRunningMessage("hello", "main", "Codex");

    assert.equal(text, "Running Codex on [main]...");
  });
});

test("renderCodexResult keeps empty-output fallback", async () => {
  await withTempHome(async () => {
    const { renderCodexResult } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.equal(
      renderCodexResult({ ok: true, output: "", stderr: "" }),
      "Codex completed, but returned no output.",
    );
  });
});

test("isTelegramReplyReferenceError recognizes Telegram 400 reply failures", async () => {
  await withTempHome(async () => {
    const { isTelegramReplyReferenceError } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.equal(
      isTelegramReplyReferenceError(new Error("Telegram API sendMessage failed with HTTP 400: Bad Request: reply message not found")),
      true,
    );
    assert.equal(isTelegramReplyReferenceError(new Error("Telegram API sendMessage failed with HTTP 500")), false);
  });
});
