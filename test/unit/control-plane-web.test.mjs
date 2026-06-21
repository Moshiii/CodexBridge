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
    const delta = await readConfig(path.join(process.env.CODEXBRIDGE_HOME, "bots", "delta"));
    assert.equal(delta.channels.telegram.enabled, false);
    assert.equal(delta.channels.telegram.botToken, "token-delta");
    assert.deepEqual(delta.channels.telegram.private.allowedChatIds, ["100"]);
    assert.deepEqual(delta.channels.telegram.groups.allowedUserIds, ["300"]);
  });
});

test("web config update rejects placeholder telegram tokens", async () => {
  await withTempHome(async (tempHome) => {
    const { createBot } = await importFresh("../../src/bots.mjs");
    const { startControlPlaneWebServer } = await importFresh("../../src/control-plane-web.mjs");
    const { readConfig } = await importFresh("../../src/config.mjs");

    await createBot({
      id: "epsilon",
      name: "Epsilon",
      config: {
        channels: {
          telegram: {
            enabled: true,
            botToken: "real-token",
            botUsername: "epsilon_bot",
          },
        },
      },
    });

    const runtime = await startControlPlaneWebServer({ port: 0 });
    try {
      const response = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/epsilon/config`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channels: {
            telegram: {
              botToken: "token-123",
            },
          },
        }),
      });

      assert.equal(response.status, 500);
      const payload = await response.json();
      assert.match(payload.error, /placeholder Telegram token/i);

      const persisted = await readConfig(path.join(tempHome, "bots", "epsilon"));
      assert.equal(persisted.channels.telegram.botToken, "real-token");
    } finally {
      await runtime.close();
    }
  });
});

test("web console sessions and workspace endpoints are usable", async () => {
  await withTempHome(async (tempHome) => {
    const { createBot } = await importFresh("../../src/bots.mjs");
    const { startControlPlaneWebServer } = await importFresh("../../src/control-plane-web.mjs");
    const { readFile } = await import("node:fs/promises");

    await createBot({ id: "zeta", name: "Zeta" });
    const runtime = await startControlPlaneWebServer({ port: 0 });
    try {
      const sessionResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/zeta/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ label: "research" }),
      });
      assert.equal(sessionResponse.status, 200);
      const sessionsPayload = await sessionResponse.json();
      assert.equal(sessionsPayload.activeSessionLabel, "research");

      const workspaceWriteResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/zeta/workspace/file`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          path: "NOTES.md",
          content: "# notes\n",
        }),
      });
      assert.equal(workspaceWriteResponse.status, 200);

      const workspaceReadResponse = await fetch(
        `http://${runtime.host}:${runtime.port}/api/bots/zeta/workspace/file?path=${encodeURIComponent("NOTES.md")}`,
      );
      assert.equal(workspaceReadResponse.status, 200);
      const workspacePayload = await workspaceReadResponse.json();
      assert.equal(workspacePayload.content, "# notes\n");

      const raw = await readFile(path.join(tempHome, "bots", "zeta", "workspace", "NOTES.md"), "utf8");
      assert.equal(raw, "# notes\n");
    } finally {
      await runtime.close();
    }
  });
});

test("control plane exposes user, credit, usage, and run operations", async () => {
  await withTempHome(async () => {
    const { createBot } = await importFresh("../../src/bots.mjs");
    const { startControlPlaneWebServer } = await importFresh("../../src/control-plane-web.mjs");
    const users = await importFresh("../../src/users-state.mjs");
    const credits = await importFresh("../../src/user-credits.mjs");
    const runs = await importFresh("../../src/runs-state.mjs");

    await createBot({ id: "theta", name: "Theta" });
    const botHome = path.join(process.env.CODEXBRIDGE_HOME, "bots", "theta");
    await users.upsertUser({
      channel: "telegram",
      externalUserId: "123",
      displayName: "@demo",
    }, botHome);
    await credits.chargeUsage({
      userId: "telegram:123",
      chatType: "group",
      channel: "telegram",
      chatId: "-100",
      messageId: "1",
      botHome,
    });
    await runs.createRunRecord({
      userId: "telegram:123",
      channel: "telegram",
      chatType: "group",
      status: "completed",
      creditsCharged: 1,
    }, botHome);

    const runtime = await startControlPlaneWebServer({ port: 0 });
    try {
      const usersResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/theta/users`);
      assert.equal(usersResponse.status, 200);
      const usersPayload = await usersResponse.json();
      assert.equal(usersPayload.length, 1);
      assert.equal(usersPayload[0].id, "telegram:123");
      assert.equal(usersPayload[0].credits.dailyFreeUsed, 1);

      const grantResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/theta/users/${encodeURIComponent("telegram:123")}/grant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 10 }),
      });
      assert.equal(grantResponse.status, 200);
      const grantPayload = await grantResponse.json();
      assert.equal(grantPayload.credits.granted, 10);

      const privateResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/theta/users/${encodeURIComponent("telegram:123")}/private`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ privateEnabled: true }),
      });
      assert.equal(privateResponse.status, 200);
      const privatePayload = await privateResponse.json();
      assert.equal(privatePayload.privateEnabled, true);

      const statusResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/theta/users/${encodeURIComponent("telegram:123")}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "banned" }),
      });
      assert.equal(statusResponse.status, 200);
      const statusPayload = await statusResponse.json();
      assert.equal(statusPayload.status, "banned");

      const usageResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/theta/usage?userId=${encodeURIComponent("telegram:123")}`);
      assert.equal(usageResponse.status, 200);
      const usagePayload = await usageResponse.json();
      assert.equal(usagePayload.some((event) => event.eventType === "charge"), true);
      assert.equal(usagePayload.some((event) => event.eventType === "grant"), true);

      const runsResponse = await fetch(`http://${runtime.host}:${runtime.port}/api/bots/theta/runs?userId=${encodeURIComponent("telegram:123")}`);
      assert.equal(runsResponse.status, 200);
      const runsPayload = await runsResponse.json();
      assert.equal(runsPayload.length, 1);
      assert.equal(runsPayload[0].status, "completed");
    } finally {
      await runtime.close();
    }
  });
});
