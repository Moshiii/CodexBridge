import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("validateBotConfig accepts normalized default config", async () => {
  await withTempHome(async () => {
    const { createDefaultBotConfig, normalizeBotConfig } = await importFresh("../../src/config.mjs");
    const { validateBotConfig } = await importFresh("../../src/config-validator.mjs");

    const errors = validateBotConfig(normalizeBotConfig(createDefaultBotConfig()));

    assert.deepEqual(errors, []);
  });
});

test("writeConfig rejects redacted secrets", async () => {
  await withTempHome(async () => {
    const { createDefaultBotConfig, writeConfig } = await importFresh("../../src/config.mjs");

    await assert.rejects(
      () => writeConfig({
        ...createDefaultBotConfig(),
        channels: {
          ...createDefaultBotConfig().channels,
          telegram: {
            ...createDefaultBotConfig().channels.telegram,
            botToken: "[redacted]",
          },
        },
      }),
      /Redacted Telegram token/,
    );
  });
});

test("validateBotConfig reports malformed channel arrays", async () => {
  await withTempHome(async () => {
    const { createDefaultBotConfig, normalizeBotConfig } = await importFresh("../../src/config.mjs");
    const { validateBotConfig } = await importFresh("../../src/config-validator.mjs");

    const config = normalizeBotConfig(createDefaultBotConfig());
    config.channels.telegram.groups.allowedUserIds = "not-array";
    config.channels.feishu.testAudience.userIds = "not-array";
    const errors = validateBotConfig(config);

    assert.equal(errors.some((error) => error.path === "channels.telegram.groups.allowedUserIds"), true);
    assert.equal(errors.some((error) => error.path === "channels.feishu.testAudience.userIds"), true);
  });
});

test("validateBotConfig reports malformed storage provider", async () => {
  await withTempHome(async () => {
    const { createDefaultBotConfig, normalizeBotConfig } = await importFresh("../../src/config.mjs");
    const { validateBotConfig } = await importFresh("../../src/config-validator.mjs");

    const config = normalizeBotConfig(createDefaultBotConfig());
    config.storage.provider = "postgres";
    const errors = validateBotConfig(config);

    assert.equal(errors.some((error) => error.path === "storage.provider"), true);
  });
});
