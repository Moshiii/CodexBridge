import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";

import { importFresh, withTempHome } from "../helpers/module.js";

test("createBot creates isolated bot home and registry entry", async () => {
  await withTempHome(async (tempHome) => {
    const { createBot, inspectBot, listBots } = await importFresh("../../src/bots.mjs");

    const created = await createBot({ id: "alpha", name: "Alpha" });
    assert.equal(created.id, "alpha");
    assert.equal(created.homePath, path.join(tempHome, "bots", "alpha"));

    const inspected = await inspectBot("alpha");
    assert.equal(inspected.bot.id, "alpha");
    assert.equal(inspected.config.name, "Alpha");
    assert.equal(inspected.paths.homePath, path.join(tempHome, "bots", "alpha"));

    const bots = await listBots();
    assert.ok(bots.find((bot) => bot.id === "default"));
    assert.ok(bots.find((bot) => bot.id === "alpha"));
  });
});

test("updateBotConfig keeps registry and bot config in sync", async () => {
  await withTempHome(async () => {
    const { createBot, getBot, updateBotConfig } = await importFresh("../../src/bots.mjs");
    const { readConfig } = await importFresh("../../src/config.mjs");

    await createBot({ id: "beta", name: "Beta" });
    await updateBotConfig("beta", (config) => ({
      ...config,
      desiredVersion: "v2",
      channels: {
        ...config.channels,
        telegram: {
          ...config.channels.telegram,
          botUsername: "beta_bot",
          private: {
            allowedChatIds: ["123"],
          },
          groups: {
            allowedChatIds: ["456"],
            allowedUserIds: ["789"],
            requireExplicitMention: false,
          },
        },
      },
    }));

    const bot = await getBot("beta");
    assert.equal(bot.desiredVersion, "v2");
    assert.equal(bot.botUsername, "beta_bot");

    const persisted = await readConfig(bot.homePath);
    assert.deepEqual(persisted.channels.telegram.private.allowedChatIds, ["123"]);
    assert.deepEqual(persisted.channels.telegram.groups.allowedUserIds, ["789"]);
  });
});

test("startBot rejects bots without configured Telegram runtime", async () => {
  await withTempHome(async () => {
    const { createBot, inspectBot, startBot } = await importFresh("../../src/bots.mjs");

    await createBot({ id: "gamma", name: "Gamma" });

    await assert.rejects(
      () => startBot("gamma"),
      /Telegram is not configured/,
    );

    const inspected = await inspectBot("gamma");
    assert.equal(inspected.bot.status, "stopped");
    assert.match(inspected.config.observability.lastError, /Telegram is not configured/);
  });
});

test("healthCheckBot returns observability metadata for stopped bots", async () => {
  await withTempHome(async (tempHome) => {
    const { createBot, healthCheckBot } = await importFresh("../../src/bots.mjs");

    await createBot({ id: "delta", name: "Delta", botUsername: "delta_bot" });
    const health = await healthCheckBot("delta");

    assert.equal(health.id, "delta");
    assert.equal(health.healthy, false);
    assert.equal(health.status, "stopped");
    assert.equal(health.botUsername, "delta_bot");
    assert.equal(health.homePath, path.join(tempHome, "bots", "delta"));
    assert.match(health.runtimeLogPath, /bots\/delta\/logs\/runtime\.log$/);
    assert.match(health.bridgeLogPath, /bots\/delta\/logs\/telegram-bridge\.log$/);
  });
});

test("setActiveBot persists the current bot selection", async () => {
  await withTempHome(async () => {
    const { createBot, getActiveBot, setActiveBot } = await importFresh("../../src/bots.mjs");

    await createBot({ id: "omega", name: "Omega" });
    await setActiveBot("omega");

    const active = await getActiveBot();
    assert.equal(active.id, "omega");
  });
});

test("rollingRestartBots returns structured failure results for unconfigured enabled bots", async () => {
  await withTempHome(async () => {
    const { createBot, rollingRestartBots } = await importFresh("../../src/bots.mjs");

    await createBot({ id: "epsilon", name: "Epsilon", enabled: true });
    const results = await rollingRestartBots(["epsilon"]);

    assert.equal(results.length, 1);
    assert.equal(results[0].botId, "epsilon");
    assert.equal(results[0].ok, false);
    assert.equal(results[0].healthy, false);
    assert.match(results[0].error, /Telegram is not configured/);
  });
});

test("rollbackBot returns structured restart result", async () => {
  await withTempHome(async () => {
    const { createBot, rollbackBot, updateBotConfig } = await importFresh("../../src/bots.mjs");

    await createBot({ id: "zeta", name: "Zeta" });
    await updateBotConfig("zeta", (config) => ({
      ...config,
      channels: {
        ...config.channels,
        telegram: {
          ...config.channels.telegram,
          enabled: true,
          botToken: "",
        },
      },
    }));

    const result = await rollbackBot("zeta", "v0").catch((error) => ({
      ok: false,
      error: error.message,
    }));

    assert.equal(result.ok, false);
    assert.match(result.error, /Telegram is not configured/);
  });
});

test("runBotRuntime shuts down the Telegram bridge when the runtime receives SIGTERM", async () => {
  await withTempHome(async (tempHome) => {
    const { createBot, readPidFile } = await importFresh("../../src/bots.mjs");
    const { getBotRuntimePidPath, getTelegramBridgePidPath } = await importFresh("../../src/config.mjs");

    await createBot({
      id: "theta",
      name: "Theta",
      config: {
        channels: {
          telegram: {
            enabled: true,
            botToken: "token-theta",
            botUsername: "theta_bot",
          },
        },
      },
    });

    const runtimeEntry = path.join(process.cwd(), "bin", "autoaide.mjs");
    const botHome = path.join(tempHome, "bots", "theta");
    const runtime = spawn(process.execPath, [runtimeEntry, "bot", "run", "theta"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTOAIDE_HOME: tempHome,
        AUTOAIDE_BOT_ID: "theta",
        BOT_HOME: botHome,
      },
      stdio: ["ignore", "ignore", "ignore"],
    });

    try {
      let bridgePid = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const runtimePid = await readPidFile(getBotRuntimePidPath(botHome));
        bridgePid = await readPidFile(getTelegramBridgePidPath(botHome));
        if (runtimePid && bridgePid) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      assert.ok(bridgePid, "expected telegram bridge pid to be written");
      runtime.kill("SIGTERM");
      await once(runtime, "exit");

      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(await readPidFile(getBotRuntimePidPath(botHome)), null);
      assert.equal(await readPidFile(getTelegramBridgePidPath(botHome)), null);
      assert.throws(() => process.kill(bridgePid, 0));
    } finally {
      runtime.kill("SIGKILL");
    }
  });
});

test("autoaide starts the configured default bot before entering the CLI", async () => {
  await withTempHome(async (tempHome) => {
    const { readConfig } = await importFresh("../../src/config.mjs");
    const { ensureDefaultBot, readPidFile, updateBotConfig } = await importFresh("../../src/bots.mjs");

    const entry = path.join(process.cwd(), "bin", "autoaide.mjs");
    const botHome = path.join(tempHome, "bots", "default");

    await ensureDefaultBot();
    await updateBotConfig("default", (config) => ({
      ...config,
      enabled: true,
      channels: {
        ...config.channels,
        telegram: {
          ...config.channels.telegram,
          enabled: true,
          botToken: "token-default",
          botUsername: "default_bot",
        },
      },
    }));

    const cli = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTOAIDE_HOME: tempHome,
      },
      stdio: ["pipe", "ignore", "ignore"],
    });

    try {
      let startedAt = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        startedAt = (await readConfig(botHome)).observability?.lastStartedAt || null;
        if (startedAt) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      assert.ok(startedAt, "expected default bot runtime to start on CLI launch");
    } finally {
      cli.kill("SIGTERM");
      await once(cli, "exit").catch(() => {});
    }
  });
});

test("autoaide does not start a configured default bot when it is disabled", async () => {
  await withTempHome(async (tempHome) => {
    const { readConfig } = await importFresh("../../src/config.mjs");
    const { ensureDefaultBot, updateBotConfig } = await importFresh("../../src/bots.mjs");

    const entry = path.join(process.cwd(), "bin", "autoaide.mjs");
    const botHome = path.join(tempHome, "bots", "default");

    await ensureDefaultBot();
    await updateBotConfig("default", (config) => ({
      ...config,
      enabled: false,
      channels: {
        ...config.channels,
        telegram: {
          ...config.channels.telegram,
          enabled: true,
          botToken: "token-default",
          botUsername: "default_bot",
        },
      },
    }));

    const cli = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTOAIDE_HOME: tempHome,
      },
      stdio: ["pipe", "ignore", "ignore"],
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const config = await readConfig(botHome);
      assert.equal(config.observability?.lastStartedAt, null);
      assert.equal(config.status, "stopped");
    } finally {
      cli.kill("SIGTERM");
      await once(cli, "exit").catch(() => {});
      await rm(botHome, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("autoaide starts the configured active bot before entering the CLI", async () => {
  await withTempHome(async (tempHome) => {
    const { readConfig } = await importFresh("../../src/config.mjs");
    const { createBot, setActiveBot, updateBotConfig } = await importFresh("../../src/bots.mjs");

    const entry = path.join(process.cwd(), "bin", "autoaide.mjs");
    const botHome = path.join(tempHome, "bots", "omega");

    await createBot({ id: "omega", name: "Omega", enabled: true });
    await updateBotConfig("omega", (config) => ({
      ...config,
      enabled: true,
      channels: {
        ...config.channels,
        telegram: {
          ...config.channels.telegram,
          enabled: true,
          botToken: "token-omega",
          botUsername: "omega_bot",
        },
      },
    }));
    await setActiveBot("omega");

    const cli = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTOAIDE_HOME: tempHome,
      },
      stdio: ["pipe", "ignore", "ignore"],
    });

    try {
      let startedAt = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        startedAt = (await readConfig(botHome)).observability?.lastStartedAt || null;
        if (startedAt) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      assert.ok(startedAt, "expected active bot runtime to start on CLI launch");
    } finally {
      cli.kill("SIGTERM");
      await once(cli, "exit").catch(() => {});
    }
  });
});
