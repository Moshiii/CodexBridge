import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("formatLogEvent emits stable JSON logs", async () => {
  const logger = await importFresh("../../src/structured-logger.mjs");

  const line = logger.formatLogEvent({
    level: "warn",
    event: "telegram update ignored",
    details: {
      chatId: "-100",
      reason: "not_mentioned",
    },
    timestamp: "2026-06-22T00:00:00.000Z",
  });
  const parsed = JSON.parse(line);

  assert.equal(parsed.timestamp, "2026-06-22T00:00:00.000Z");
  assert.equal(parsed.level, "warn");
  assert.equal(parsed.event, "telegram update ignored");
  assert.equal(parsed.chatId, "-100");
  assert.equal(parsed.reason, "not_mentioned");
});

test("formatLogEvent normalizes Error details", async () => {
  const logger = await importFresh("../../src/structured-logger.mjs");

  const parsed = JSON.parse(logger.formatLogEvent({
    level: "error",
    event: "job failed",
    details: new Error("boom"),
    timestamp: "2026-06-22T00:00:00.000Z",
  }));

  assert.equal(parsed.level, "error");
  assert.equal(parsed.errorMessage, "boom");
});
