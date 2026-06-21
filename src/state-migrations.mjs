import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

import {
  getStateMigrationsPath,
  readConfig,
  readJson,
  resolveBotHome,
  writeConfig,
  writeJson,
} from "./config.mjs";
import { readUsersState, writeUsersState } from "./users-state.mjs";
import { readUserCreditsState, writeUserCreditsState } from "./user-credits.mjs";

export const STATE_MIGRATIONS_VERSION = 1;

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDefaultMigrationState() {
  return {
    version: 1,
    schemaVersion: 0,
    applied: {},
  };
}

function normalizeMigrationState(state = {}) {
  const appliedInput = state.applied && typeof state.applied === "object" ? state.applied : {};
  const applied = {};
  for (const [id, record] of Object.entries(appliedInput)) {
    if (!id) {
      continue;
    }
    applied[id] = {
      id,
      appliedAt: record?.appliedAt || nowIso(),
    };
  }
  const schemaVersion = Number(state.schemaVersion);
  return {
    version: 1,
    schemaVersion: Number.isFinite(schemaVersion) ? Math.max(0, Math.floor(schemaVersion)) : 0,
    applied,
  };
}

async function acquireLock(lockPath) {
  const startedAt = Date.now();
  while (true) {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for state migration lock at ${lockPath}`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function readMigrationState(botHome) {
  return normalizeMigrationState(await readJson(getStateMigrationsPath(botHome), createDefaultMigrationState()));
}

async function writeMigrationState(state, botHome) {
  await writeJson(getStateMigrationsPath(botHome), normalizeMigrationState(state));
}

async function normalizeCoreJsonState({ botHome }) {
  const config = await readConfig(botHome);
  await writeConfig(config, botHome);

  const usersState = await readUsersState(botHome);
  await writeUsersState(usersState, botHome);

  const creditsState = await readUserCreditsState(botHome);
  await writeUserCreditsState(creditsState, botHome);
}

export const STATE_MIGRATIONS = [
  {
    id: "001-normalize-core-json-state",
    schemaVersion: 1,
    description: "Normalize config, users, and credits JSON state files before later storage migrations.",
    run: normalizeCoreJsonState,
  },
];

export async function getStateMigrationStatus({ botHome = resolveBotHome() } = {}) {
  const state = await readMigrationState(botHome);
  const pending = STATE_MIGRATIONS
    .filter((migration) => !state.applied[migration.id])
    .map(({ id, schemaVersion, description }) => ({ id, schemaVersion, description }));
  return {
    ok: true,
    version: state.version,
    schemaVersion: state.schemaVersion,
    currentSchemaVersion: STATE_MIGRATIONS_VERSION,
    applied: Object.values(state.applied),
    pending,
  };
}

export async function runStateMigrations({ botHome = resolveBotHome(), dryRun = false } = {}) {
  const statePath = getStateMigrationsPath(botHome);
  const lockPath = `${statePath}.lock`;
  await mkdir(path.dirname(statePath), { recursive: true });
  const handle = await acquireLock(lockPath);
  try {
    const state = await readMigrationState(botHome);
    const executed = [];
    const pending = [];
    for (const migration of STATE_MIGRATIONS) {
      if (state.applied[migration.id]) {
        continue;
      }
      pending.push({
        id: migration.id,
        schemaVersion: migration.schemaVersion,
        description: migration.description,
      });
      if (dryRun) {
        continue;
      }
      await migration.run({ botHome });
      state.applied[migration.id] = {
        id: migration.id,
        appliedAt: nowIso(),
      };
      state.schemaVersion = Math.max(state.schemaVersion, migration.schemaVersion);
      await writeMigrationState(state, botHome);
      executed.push({
        id: migration.id,
        schemaVersion: migration.schemaVersion,
        description: migration.description,
      });
    }
    if (!dryRun && state.schemaVersion < STATE_MIGRATIONS_VERSION) {
      state.schemaVersion = STATE_MIGRATIONS_VERSION;
      await writeMigrationState(state, botHome);
    }
    return {
      ok: true,
      dryRun,
      schemaVersion: dryRun ? state.schemaVersion : Math.max(state.schemaVersion, STATE_MIGRATIONS_VERSION),
      executed,
      pending: dryRun ? pending : [],
    };
  } finally {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}
