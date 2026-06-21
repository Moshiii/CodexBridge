import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { importFresh, withTempHome } from "../helpers/module.js";

test("state migrations report pending work without mutating state during dry run", async () => {
  await withTempHome(async () => {
    const migrations = await importFresh("../../src/state-migrations.mjs");

    const result = await migrations.runStateMigrations({ dryRun: true });
    const status = await migrations.getStateMigrationStatus();

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.executed.length, 0);
    assert.equal(result.pending.length, 1);
    assert.equal(status.pending.length, 1);
    assert.equal(status.schemaVersion, 0);
  });
});

test("state migrations normalize core JSON state and record schema version", async () => {
  await withTempHome(async (tempHome) => {
    const botHome = path.join(tempHome, "bots", "default");
    await mkdir(botHome, { recursive: true });
    await writeFile(path.join(botHome, "config.json"), JSON.stringify({
      runtime: {
        model: "gpt-5.4-mini",
        backend: "codex",
      },
      channels: {
        telegram: {
          enabled: false,
          private: {
            allowedChatIds: ["1"],
          },
        },
      },
      skills: {
        enabled: ["legacy"],
      },
    }), "utf8");
    await writeFile(path.join(botHome, "users.json"), JSON.stringify({
      users: {
        "telegram:42": {
          channel: "Telegram",
          externalUserId: "42",
          status: "paid",
        },
      },
    }), "utf8");
    await writeFile(path.join(botHome, "user-credits.json"), JSON.stringify({
      defaults: {
        initialCredits: 100,
      },
      accounts: {
        "telegram:42": {
          balance: 3,
          totalConsumed: 2,
        },
      },
    }), "utf8");

    const migrations = await importFresh("../../src/state-migrations.mjs");

    const result = await migrations.runStateMigrations({ botHome });
    const secondResult = await migrations.runStateMigrations({ botHome });
    const status = await migrations.getStateMigrationStatus({ botHome });
    const config = JSON.parse(await readFile(path.join(botHome, "config.json"), "utf8"));
    const users = JSON.parse(await readFile(path.join(botHome, "users.json"), "utf8"));
    const credits = JSON.parse(await readFile(path.join(botHome, "user-credits.json"), "utf8"));
    const migrationState = JSON.parse(await readFile(path.join(botHome, "state-migrations.json"), "utf8"));

    assert.equal(result.executed.length, 1);
    assert.equal(secondResult.executed.length, 0);
    assert.equal(status.pending.length, 0);
    assert.equal(status.schemaVersion, migrations.STATE_MIGRATIONS_VERSION);
    assert.equal(migrationState.schemaVersion, migrations.STATE_MIGRATIONS_VERSION);
    assert.equal(config.runtime.model, "gpt-5.4-mini");
    assert.equal("backend" in config.runtime, false);
    assert.equal("skills" in config, false);
    assert.equal(users.version, 1);
    assert.equal(users.users["telegram:42"].channel, "telegram");
    assert.equal(users.users["telegram:42"].privateEnabled, true);
    assert.equal(credits.version, 1);
    assert.equal(credits.accounts["telegram:42"].paidCredits, 3);
    assert.equal(credits.accounts["telegram:42"].dailyFreeLimit, 5);
  });
});
