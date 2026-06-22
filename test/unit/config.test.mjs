import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { importFresh, withTempHome } from "../helpers/module.js";

test("ensureCodexBridgeHome creates runtime directories", async () => {
  await withTempHome(async (tempHome) => {
    const config = await importFresh("../../src/config.mjs");

    await config.ensureCodexBridgeHome();

    await Promise.all([
      access(path.join(tempHome, "control")),
      access(path.join(tempHome, "bots", "default", "workspace")),
      access(path.join(tempHome, "bots", "default", "memory")),
      access(path.join(tempHome, "logs")),
      access(path.join(tempHome, "bots", "default", "telegram")),
      access(path.join(tempHome, "bots", "default", "feishu")),
    ]);
  });
});

test("readConfig returns defaults when config is missing", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");
    const value = await config.readConfig();

    assert.equal(value.runtime.model, "gpt-5.4");
    assert.deepEqual(value.storage, {
      provider: "json",
    });
    assert.equal(value.ownerUserId, "");
    assert.deepEqual(value.adminUserIds, []);
    assert.deepEqual(value.channels.telegram, {
      enabled: false,
      botToken: "",
      botUsername: "",
      metadata: {
        chats: {},
        users: {},
      },
      private: {
        allowedChatIds: [],
      },
      groups: {
        allowedChatIds: [],
        allowedUserIds: [],
        requireExplicitMention: true,
      },
    });
    assert.deepEqual(value.channels.feishu, {
      enabled: false,
      appId: "",
      appSecret: "",
      verificationToken: "",
      encryptKey: "",
      defaultReceiveIdType: "chat_id",
      requireExplicitMention: true,
      botMentionNames: [],
      metadata: {
        chats: {},
        users: {},
      },
    });
  });
});

test("normalizeBotConfig drops unused runtime backend, skills, and schedule stubs", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");
    const normalized = config.normalizeBotConfig({
      channels: {
        telegram: {
          enabled: false,
        },
      },
      runtime: {
        model: "gpt-5.4-mini",
        backend: "codex",
      },
      skills: {
        enabled: ["demo"],
        isolatedStore: false,
      },
      schedule: {
        enabled: false,
      },
    });

    assert.equal(normalized.runtime.model, "gpt-5.4-mini");
    assert.equal(normalized.enabled, false);
    assert.equal(normalized.ownerUserId, "");
    assert.deepEqual(normalized.adminUserIds, []);
    assert.equal("backend" in normalized.runtime, false);
    assert.equal("skills" in normalized, false);
    assert.equal("schedule" in normalized, false);
  });
});

test("normalizeBotConfig normalizes storage provider", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");

    assert.equal(config.normalizeBotConfig({ storage: { provider: "sqlite" } }).storage.provider, "sqlite");
    assert.equal(config.normalizeBotConfig({ storage: { provider: "unknown" } }).storage.provider, "json");
    assert.equal(config.normalizeBotConfig({}).storage.provider, "json");
  });
});

test("normalizeBotConfig normalizes owner and admin ids", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");
    const normalized = config.normalizeBotConfig({
      ownerUserId: " 123 ",
      adminUserIds: [" 123 ", "", "456", null],
    });

    assert.equal(normalized.ownerUserId, "123");
    assert.deepEqual(normalized.adminUserIds, ["123", "456"]);
  });
});

test("writeConfig persists config and readConfig reads it back", async () => {
  await withTempHome(async (tempHome) => {
    const config = await importFresh("../../src/config.mjs");
    const next = {
      runtime: {
        model: "gpt-5.4-mini",
        backend: "codex",
      },
      channels: {
        telegram: {
          enabled: true,
          botToken: "token-123",
          botUsername: "demo_bot",
          private: {
            allowedChatIds: ["1", "2"],
          },
          groups: {
            allowedChatIds: ["3"],
            allowedUserIds: ["9"],
            requireExplicitMention: true,
          },
        },
      },
    };

    await config.writeConfig(next);

    const persisted = await config.readConfig();
    assert.equal(persisted.runtime.model, "gpt-5.4-mini");
    assert.equal(persisted.storage.provider, "json");
    assert.deepEqual(persisted.channels.telegram.private.allowedChatIds, ["1", "2"]);
    assert.deepEqual(persisted.channels.telegram.groups.allowedChatIds, ["3"]);
    const raw = JSON.parse(await readFile(path.join(tempHome, "bots", "default", "config.json"), "utf8"));
    assert.equal(raw.runtime.model, "gpt-5.4-mini");
    assert.equal("model" in raw, false);
    assert.equal("backend" in raw.runtime, false);
    assert.equal("skills" in raw, false);
    assert.equal("schedule" in raw, false);
  });
});

test("readCliState creates a valid default main session", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");
    const state = await config.readCliState();

    assert.equal(state.activeSessionLabel, "main");
    assert.equal(state.sessions.main.label, "main");
    assert.equal(state.sessions.main.cliSessionRef, null);
    assert.match(state.sessions.main.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("readCliState repairs missing main session and invalid active session", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");
    await config.writeCliState({
      version: 1,
      sessions: {
        other: {
          label: "other",
          cliSessionRef: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      },
      activeSessionLabel: "missing",
    });

    const state = await config.readCliState();
    assert.equal(state.activeSessionLabel, "main");
    assert.equal(state.sessions.main.label, "main");
    assert.equal(state.sessions.other.label, "other");
  });
});

test("readBootstrapState returns default bootstrap state", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");
    const state = await config.readBootstrapState();

    assert.deepEqual(state, {
      version: 1,
      completed: false,
      completedAt: null,
      lastSeededAt: null,
    });
  });
});

test("active bot state defaults to default and can be updated", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");

    assert.equal(await config.readActiveBotId(), "default");
    await config.writeActiveBotId("alpha");
    assert.equal(await config.readActiveBotId(), "alpha");
  });
});
