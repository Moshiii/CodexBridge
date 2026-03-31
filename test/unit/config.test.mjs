import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { importFresh, withTempHome } from "../helpers/module.js";

test("ensureAutoAideHome creates runtime directories", async () => {
  await withTempHome(async (tempHome) => {
    const config = await importFresh("../../src/config.mjs");

    await config.ensureAutoAideHome();

    await Promise.all([
      access(path.join(tempHome, "workspace")),
      access(path.join(tempHome, "logs")),
      access(path.join(tempHome, "telegram")),
    ]);
  });
});

test("readConfig returns defaults when config is missing", async () => {
  await withTempHome(async () => {
    const config = await importFresh("../../src/config.mjs");
    const value = await config.readConfig();

    assert.equal(value.model, "gpt-5.4");
    assert.deepEqual(value.channels.telegram, {
      enabled: false,
      botToken: "",
      allowedChatIds: [],
    });
  });
});

test("writeConfig persists config and readConfig reads it back", async () => {
  await withTempHome(async (tempHome) => {
    const config = await importFresh("../../src/config.mjs");
    const next = {
      model: "gpt-5.4-mini",
      channels: {
        telegram: {
          enabled: true,
          botToken: "token-123",
          allowedChatIds: ["1", "2"],
        },
      },
    };

    await config.writeConfig(next);

    assert.deepEqual(await config.readConfig(), next);
    const raw = JSON.parse(await readFile(path.join(tempHome, "config.json"), "utf8"));
    assert.deepEqual(raw, next);
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
