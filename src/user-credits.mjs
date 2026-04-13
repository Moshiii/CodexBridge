import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getUserCreditsStatePath, resolveBotHome } from "./config.mjs";

export const DEFAULT_INITIAL_CREDITS = 100;
export const DEFAULT_TURN_COST = 1;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeUserId(userId) {
  return String(userId || "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDefaultCreditsState() {
  return {
    version: 1,
    defaults: {
      initialCredits: DEFAULT_INITIAL_CREDITS,
      turnCost: DEFAULT_TURN_COST,
    },
    accounts: {},
  };
}

function normalizeAccount(account = {}, userId) {
  const normalizedUserId = normalizeUserId(userId || account.userId);
  const now = nowIso();
  const balanceValue = Number(account.balance);
  const consumedValue = Number(account.totalConsumed);
  return {
    userId: normalizedUserId,
    balance: Number.isFinite(balanceValue) ? Math.max(0, Math.floor(balanceValue)) : DEFAULT_INITIAL_CREDITS,
    totalConsumed: Number.isFinite(consumedValue) ? Math.max(0, Math.floor(consumedValue)) : 0,
    createdAt: account.createdAt || now,
    updatedAt: account.updatedAt || now,
  };
}

function normalizeCreditsState(state = {}) {
  const defaults = createDefaultCreditsState();
  const initialCredits = Number(state.defaults?.initialCredits);
  const turnCost = Number(state.defaults?.turnCost);
  const accountsInput = state.accounts && typeof state.accounts === "object" ? state.accounts : {};
  const accounts = Object.fromEntries(
    Object.entries(accountsInput)
      .map(([userId, account]) => {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId) {
          return null;
        }
        return [normalizedUserId, normalizeAccount(account, normalizedUserId)];
      })
      .filter(Boolean),
  );
  return {
    version: 1,
    defaults: {
      initialCredits: Number.isFinite(initialCredits) ? Math.max(0, Math.floor(initialCredits)) : defaults.defaults.initialCredits,
      turnCost: Number.isFinite(turnCost) ? Math.max(1, Math.floor(turnCost)) : defaults.defaults.turnCost,
    },
    accounts,
  };
}

async function readCreditsState(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeCreditsState(JSON.parse(raw));
  } catch {
    return createDefaultCreditsState();
  }
}

async function writeCreditsState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalizeCreditsState(state), null, 2)}\n`, "utf8");
}

async function acquireLock(lockPath) {
  const startedAt = Date.now();
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for credits lock at ${lockPath}`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function withCreditsLock(botHome, fn) {
  const statePath = getUserCreditsStatePath(botHome);
  const lockPath = `${statePath}.lock`;
  await mkdir(path.dirname(statePath), { recursive: true });
  const handle = await acquireLock(lockPath);
  try {
    const state = await readCreditsState(statePath);
    const result = await fn(state, statePath);
    return result;
  } finally {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

function ensureAccount(state, userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    throw new Error("User credits require a userId.");
  }
  if (!state.accounts[normalizedUserId]) {
    state.accounts[normalizedUserId] = normalizeAccount(
      {
        userId: normalizedUserId,
        balance: state.defaults.initialCredits,
        totalConsumed: 0,
      },
      normalizedUserId,
    );
  }
  return state.accounts[normalizedUserId];
}

export function resolveCliCreditsUserId(config = {}) {
  return normalizeUserId(config.ownerUserId) || "local-cli";
}

export async function getUserCredits(userId, botHome = resolveBotHome()) {
  return await withCreditsLock(botHome, async (state, statePath) => {
    const account = ensureAccount(state, userId);
    account.updatedAt = nowIso();
    await writeCreditsState(statePath, state);
    return {
      ok: true,
      account: { ...account },
      defaults: { ...state.defaults },
    };
  });
}

export async function chargeTurnCredits({ userId, amount = DEFAULT_TURN_COST, botHome = resolveBotHome() } = {}) {
  const normalizedAmount = Number.isFinite(Number(amount)) ? Math.max(1, Math.floor(Number(amount))) : DEFAULT_TURN_COST;
  return await withCreditsLock(botHome, async (state, statePath) => {
    const account = ensureAccount(state, userId);
    const balanceBefore = account.balance;
    if (balanceBefore < normalizedAmount) {
      account.updatedAt = nowIso();
      await writeCreditsState(statePath, state);
      return {
        ok: false,
        charged: 0,
        balanceBefore,
        balanceAfter: balanceBefore,
        account: { ...account },
        defaults: { ...state.defaults },
      };
    }

    account.balance = Math.max(0, balanceBefore - normalizedAmount);
    account.totalConsumed += normalizedAmount;
    account.updatedAt = nowIso();
    await writeCreditsState(statePath, state);
    return {
      ok: true,
      charged: normalizedAmount,
      balanceBefore,
      balanceAfter: account.balance,
      account: { ...account },
      defaults: { ...state.defaults },
    };
  });
}

export function renderInsufficientCreditsMessage(result, options = {}) {
  const balance = Number(result?.balanceAfter ?? result?.account?.balance ?? 0);
  const cost = Number(result?.defaults?.turnCost ?? options.turnCost ?? DEFAULT_TURN_COST);
  const userId = normalizeUserId(options.userId || result?.account?.userId);
  const label = userId ? ` for user ${userId}` : "";
  return `No credits left${label} on this bot. Balance: ${balance}. Each turn costs ${cost} credit${cost === 1 ? "" : "s"}.`;
}
