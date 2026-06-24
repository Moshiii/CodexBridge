import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("withBotHomeEnv sets BOT_HOME for the callback and restores an existing value", async () => {
  const { withBotHomeEnv } = await importFresh("../../src/bot-home-env.mjs");
  const previousBotHome = process.env.BOT_HOME;
  process.env.BOT_HOME = "/before";
  try {
    const result = await withBotHomeEnv("/during", async () => {
      assert.equal(process.env.BOT_HOME, "/during");
      return "ok";
    });

    assert.equal(result, "ok");
    assert.equal(process.env.BOT_HOME, "/before");
  } finally {
    if (previousBotHome == null) {
      delete process.env.BOT_HOME;
    } else {
      process.env.BOT_HOME = previousBotHome;
    }
  }
});

test("withBotHomeEnv removes BOT_HOME after the callback when it was previously unset", async () => {
  const { withBotHomeEnv } = await importFresh("../../src/bot-home-env.mjs");
  const previousBotHome = process.env.BOT_HOME;
  delete process.env.BOT_HOME;
  try {
    await withBotHomeEnv("/during", async () => {
      assert.equal(process.env.BOT_HOME, "/during");
    });

    assert.equal(Object.hasOwn(process.env, "BOT_HOME"), false);
  } finally {
    if (previousBotHome == null) {
      delete process.env.BOT_HOME;
    } else {
      process.env.BOT_HOME = previousBotHome;
    }
  }
});

test("withBotHomeEnv restores BOT_HOME when the callback throws", async () => {
  const { withBotHomeEnv } = await importFresh("../../src/bot-home-env.mjs");
  const previousBotHome = process.env.BOT_HOME;
  process.env.BOT_HOME = "/before";
  try {
    await assert.rejects(
      () => withBotHomeEnv("/during", async () => {
        assert.equal(process.env.BOT_HOME, "/during");
        throw new Error("boom");
      }),
      /boom/,
    );

    assert.equal(process.env.BOT_HOME, "/before");
  } finally {
    if (previousBotHome == null) {
      delete process.env.BOT_HOME;
    } else {
      process.env.BOT_HOME = previousBotHome;
    }
  }
});
