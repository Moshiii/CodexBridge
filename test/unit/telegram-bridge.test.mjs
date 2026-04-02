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

test("parseCommand strips command targeting suffix", async () => {
  await withTempHome(async () => {
    const { parseCommand } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.deepEqual(parseCommand("/skills@AutoAideBot install /tmp/demo.zip"), {
      command: "skills",
      argsText: "install /tmp/demo.zip",
    });
  });
});

test("extractBotMention finds explicit group mentions", async () => {
  await withTempHome(async () => {
    const { extractBotMention } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    const text = "@AutoAideBot hi there";
    const mention = extractBotMention(
      text,
      [{ type: "mention", offset: 0, length: 12 }],
      "AutoAideBot",
    );

    assert.deepEqual(mention, {
      offset: 0,
      length: 12,
      text: "@AutoAideBot",
    });
  });
});

test("stripExplicitBotMention removes the mention and preserves the request", async () => {
  await withTempHome(async () => {
    const { stripExplicitBotMention } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.equal(
      stripExplicitBotMention("@AutoAideBot summarize this", { offset: 0, length: 12 }),
      "summarize this",
    );
  });
});
