import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { importFresh, withTempHome } from "../helpers/module.js";

test("control plane detail service builds Telegram access summaries", async () => {
  const { buildTelegramAccessSummary } = await importFresh("../../src/control-plane-detail-service.mjs");

  const access = buildTelegramAccessSummary({
    channels: {
      telegram: {
        metadata: {
          chats: {
            "10": { label: "Alice" },
            "20": { title: "Demo Group" },
          },
          users: {
            "30": { username: "bob" },
          },
        },
        private: { allowedChatIds: ["10", "11"] },
        groups: {
          allowedChatIds: ["20"],
          allowedUserIds: ["30"],
        },
      },
    },
  });

  assert.deepEqual(access.privateChats, ["Alice (10)", "11"]);
  assert.deepEqual(access.groupChats, ["Demo Group (20)"]);
  assert.deepEqual(access.groupUsers, ["@bob (30)"]);
});

test("control plane detail service reads bridge logs for a bot", async () => {
  await withTempHome(async (homePath) => {
    const { createBot } = await importFresh("../../src/bots.mjs");
    const { readBridgeLogs } = await importFresh("../../src/control-plane-detail-service.mjs");

    await createBot({ id: "logbot", name: "Log Bot" });
    const logDir = path.join(homePath, "bots", "logbot", "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, "telegram-bridge.log"), "line-1\nline-2\nline-3\n", "utf8");

    const logs = await readBridgeLogs("logbot", 2);

    assert.match(logs.logPath, /bots\/logbot\/logs\/telegram-bridge\.log$/);
    assert.equal(logs.content, "line-2\nline-3");
  });
});

test("control plane detail service composes bot detail readiness fields", async () => {
  await withTempHome(async () => {
    const { createBot } = await importFresh("../../src/bots.mjs");
    const { getBotControlPlaneDetail } = await importFresh("../../src/control-plane-detail-service.mjs");

    await createBot({
      id: "detailbot",
      name: "Detail Bot",
      config: {
        channels: {
          telegram: {
            enabled: true,
            botToken: "123456:ABCDEF",
            botUsername: "detail_bot",
            private: { allowedChatIds: ["10"] },
            metadata: {
              chats: { "10": { label: "Alice" } },
              users: {},
            },
          },
        },
      },
    });

    const detail = await getBotControlPlaneDetail("detailbot");

    assert.equal(detail.detail.bot.id, "detailbot");
    assert.equal(detail.health.id, "detailbot");
    assert.deepEqual(detail.access.privateChats, ["Alice (10)"]);
    assert.equal(detail.setupGuide.total, 5);
    assert.equal(detail.storageReadiness.provider, "json");
    assert.equal(detail.quickTestPreflight.readyForIm, false);
  });
});
