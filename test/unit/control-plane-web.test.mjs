import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { importFresh, withTempHome } from "../helpers/module.js";

test("getControlPlaneSnapshot returns bot list plus health data", async () => {
  await withTempHome(async (tempHome) => {
    const { createBot } = await importFresh("../../src/bots.mjs");
    const { getControlPlaneSnapshot } = await importFresh("../../src/control-plane-web.mjs");

    await createBot({ id: "alpha", name: "Alpha", botUsername: "alpha_bot" });
    const snapshot = await getControlPlaneSnapshot();

    assert.equal(Array.isArray(snapshot.bots), true);
    assert.equal(Array.isArray(snapshot.health), true);
    assert.ok(snapshot.bots.find((bot) => bot.id === "default"));
    assert.ok(snapshot.bots.find((bot) => bot.id === "alpha"));
    const alphaHealth = snapshot.health.find((entry) => entry.id === "alpha");
    assert.equal(alphaHealth.health.botUsername, "alpha_bot");
    assert.equal(alphaHealth.health.homePath, path.join(tempHome, "bots", "alpha"));
  });
});

test("getBotControlPlaneDetail includes inspect, health, and logs", async () => {
  await withTempHome(async (tempHome) => {
    const { createBot } = await importFresh("../../src/bots.mjs");
    const { getBotControlPlaneDetail } = await importFresh("../../src/control-plane-web.mjs");
    const { writeFile, mkdir } = await import("node:fs/promises");

    await createBot({ id: "beta", name: "Beta" });
    await mkdir(path.join(tempHome, "bots", "beta", "logs"), { recursive: true });
    await writeFile(path.join(tempHome, "bots", "beta", "logs", "runtime.log"), "line-1\nline-2\n", "utf8");

    const detail = await getBotControlPlaneDetail("beta");

    assert.equal(detail.detail.bot.id, "beta");
    assert.equal(detail.health.id, "beta");
    assert.match(detail.logs.logPath, /bots\/beta\/logs\/runtime\.log$/);
    assert.match(detail.logs.content, /line-2/);
  });
});

test("control plane web server exposes logs and config update endpoints", async () => {
  await withTempHome(async (tempHome) => {
    const { createBot } = await importFresh("../../src/bots.mjs");
    const { startControlPlaneWebServer } = await importFresh("../../src/control-plane-web.mjs");
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { readConfig } = await importFresh("../../src/config.mjs");

    await createBot({
      id: "gamma",
      name: "Gamma",
      config: {
        channels: {
          telegram: {
            enabled: true,
            botToken: "token-gamma",
            botUsername: "gamma_bot",
            private: {
              allowedChatIds: ["100"],
            },
            groups: {
              allowedChatIds: ["200"],
              allowedUserIds: ["300"],
              requireExplicitMention: true,
            },
          },
        },
      },
    });
    await mkdir(path.join(tempHome, "bots", "gamma", "logs"), { recursive: true });
    await writeFile(path.join(tempHome, "bots", "gamma", "logs", "runtime.log"), "hello-log\n", "utf8");

    const runtime = await startControlPlaneWebServer({ port: 0 });
    try {
      const logsResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/gamma/logs`);
      assert.equal(logsResponse.status, 200);
      const logsPayload = await logsResponse.json();
      assert.match(logsPayload.content, /hello-log/);

      const configResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/gamma/config`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Gamma Two",
        }),
      });
      assert.equal(configResponse.status, 200);
      const configPayload = await configResponse.json();
      assert.equal(configPayload.name, "Gamma Two");

      const nestedResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/gamma/config`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channels: {
            telegram: {
              enabled: false,
            },
          },
        }),
      });
      assert.equal(nestedResponse.status, 200);

      const persisted = await readConfig(path.join(tempHome, "bots", "gamma"));
      assert.equal(persisted.channels.telegram.enabled, false);
      assert.equal(persisted.channels.telegram.botToken, "token-gamma");
      assert.deepEqual(persisted.channels.telegram.private.allowedChatIds, ["100"]);
      assert.deepEqual(persisted.channels.telegram.groups.allowedUserIds, ["300"]);
    } finally {
      await runtime.close();
    }
  });
});

test("bot set-config style nested patch should preserve sibling telegram fields", async () => {
  await withTempHome(async () => {
    const { createBot, updateBotConfig } = await importFresh("../../src/bots.mjs");
    const { readConfig } = await importFresh("../../src/config.mjs");

    function isPlainObject(value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function deepMergeConfig(base, patch) {
      if (!isPlainObject(base) || !isPlainObject(patch)) {
        return patch;
      }
      const merged = { ...base };
      for (const [key, value] of Object.entries(patch)) {
        merged[key] = isPlainObject(value) ? deepMergeConfig(base[key] ?? {}, value) : value;
      }
      return merged;
    }

    await createBot({
      id: "delta",
      name: "Delta",
      config: {
        channels: {
          telegram: {
            enabled: true,
            botToken: "token-delta",
            botUsername: "delta_bot",
            private: {
              allowedChatIds: ["100"],
            },
            groups: {
              allowedChatIds: ["200"],
              allowedUserIds: ["300"],
              requireExplicitMention: true,
            },
          },
        },
      },
    });

    await updateBotConfig("delta", (config) =>
      deepMergeConfig(config, {
        channels: {
          telegram: {
            enabled: false,
          },
        },
      }),
    );

    const persisted = await readConfig();
    assert.equal(persisted.channels.telegram.enabled, false);
    assert.equal(persisted.channels.telegram.botToken, "");
    const delta = await readConfig(path.join(process.env.AUTOAIDE_HOME, "bots", "delta"));
    assert.equal(delta.channels.telegram.enabled, false);
    assert.equal(delta.channels.telegram.botToken, "token-delta");
    assert.deepEqual(delta.channels.telegram.private.allowedChatIds, ["100"]);
    assert.deepEqual(delta.channels.telegram.groups.allowedUserIds, ["300"]);
  });
});
