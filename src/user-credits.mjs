import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { getUserCreditsStatePath, resolveBotHome } from "./config.mjs";
import { appendUsageEvent } from "./usage-ledger.mjs";

export const DEFAULT_INITIAL_CREDITS = 0;
export const DEFAULT_TURN_COST = 1;
export const DEFAULT_DAILY_FREE_LIMIT = 5;
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
      dailyFreeLimit: DEFAULT_DAILY_FREE_LIMIT,
    },
    accounts: {},
  };
}

function normalizeAccount(account = {}, userId) {
  const normalizedUserId = normalizeUserId(userId || account.userId);
  const now = nowIso();
  const paidCreditsValue = Number(account.paidCredits ?? account.balance);
  const consumedValue = Number(account.totalConsumed);
  const dailyFreeUsedValue = Number(account.dailyFreeUsed);
  const dailyFreeLimitValue = Number(account.dailyFreeLimit);
  const paidCredits = Number.isFinite(paidCreditsValue)
    ? Math.max(0, Math.floor(paidCreditsValue))
    : DEFAULT_INITIAL_CREDITS;
  const dailyFreeLimit = Number.isFinite(dailyFreeLimitValue)
    ? Math.max(0, Math.floor(dailyFreeLimitValue))
    : DEFAULT_DAILY_FREE_LIMIT;
  return {
    userId: normalizedUserId,
    balance: paidCredits,
    paidCredits,
    dailyFreeDate: account.dailyFreeDate || new Date().toISOString().slice(0, 10),
    dailyFreeUsed: Number.isFinite(dailyFreeUsedValue) ? Math.max(0, Math.floor(dailyFreeUsedValue)) : 0,
    dailyFreeLimit,
    totalConsumed: Number.isFinite(consumedValue) ? Math.max(0, Math.floor(consumedValue)) : 0,
    createdAt: account.createdAt || now,
    updatedAt: account.updatedAt || now,
  };
}

function normalizeCreditsState(state = {}) {
  const defaults = createDefaultCreditsState();
  const initialCredits = Number(state.defaults?.initialCredits);
  const turnCost = Number(state.defaults?.turnCost);
  const dailyFreeLimit = Number(state.defaults?.dailyFreeLimit);
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
      dailyFreeLimit: Number.isFinite(dailyFreeLimit)
        ? Math.max(0, Math.floor(dailyFreeLimit))
        : defaults.defaults.dailyFreeLimit,
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

export async function readUserCreditsState(botHome = resolveBotHome()) {
  return await readCreditsState(getUserCreditsStatePath(botHome));
}

export async function writeUserCreditsState(state, botHome = resolveBotHome()) {
  await writeCreditsState(getUserCreditsStatePath(botHome), state);
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
        paidCredits: state.defaults.initialCredits,
        dailyFreeLimit: state.defaults.dailyFreeLimit,
        totalConsumed: 0,
      },
      normalizedUserId,
    );
  }
  return state.accounts[normalizedUserId];
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function resetDailyFreeIfNeeded(account, date = new Date()) {
  const currentDay = todayKey(date);
  if (account.dailyFreeDate !== currentDay) {
    account.dailyFreeDate = currentDay;
    account.dailyFreeUsed = 0;
  }
}

export function resolveCliCreditsUserId(config = {}) {
  return normalizeUserId(config.ownerUserId) || "local-cli";
}

export async function getUserCredits(userId, botHome = resolveBotHome()) {
  return await withCreditsLock(botHome, async (state, statePath) => {
    const account = ensureAccount(state, userId);
    resetDailyFreeIfNeeded(account);
    account.updatedAt = nowIso();
    await writeCreditsState(statePath, state);
    return {
      ok: true,
      account: { ...account },
      defaults: { ...state.defaults },
    };
  });
}

export async function grantPaidCredits({ userId, amount, botHome = resolveBotHome() } = {}) {
  const normalizedAmount = Number.isFinite(Number(amount)) ? Math.max(0, Math.floor(Number(amount))) : 0;
  return await withCreditsLock(botHome, async (state, statePath) => {
    const account = ensureAccount(state, userId);
    const balanceBefore = account.paidCredits;
    account.paidCredits += normalizedAmount;
    account.balance = account.paidCredits;
    account.updatedAt = nowIso();
    await writeCreditsState(statePath, state);
    await appendUsageEvent({
      eventType: "grant",
      userId,
      amount: normalizedAmount,
      source: "manual",
      reason: "grant_paid_credits",
    }, botHome);
    return {
      ok: true,
      granted: normalizedAmount,
      balanceBefore,
      balanceAfter: account.paidCredits,
      account: { ...account },
      defaults: { ...state.defaults },
    };
  });
}

export async function adjustPaidCredits({ userId, amount, reason = "manual_adjustment", botHome = resolveBotHome() } = {}) {
  const normalizedAmount = Number.isFinite(Number(amount)) ? Math.trunc(Number(amount)) : 0;
  return await withCreditsLock(botHome, async (state, statePath) => {
    const account = ensureAccount(state, userId);
    const balanceBefore = account.paidCredits;
    const balanceAfter = balanceBefore + normalizedAmount;
    if (balanceAfter < 0) {
      throw new Error(`Adjustment would make paid credits negative for ${account.userId}.`);
    }
    account.paidCredits = balanceAfter;
    account.balance = account.paidCredits;
    account.updatedAt = nowIso();
    await writeCreditsState(statePath, state);
    await appendUsageEvent({
      eventType: "adjustment",
      userId,
      amount: normalizedAmount,
      source: "manual",
      reason,
    }, botHome);
    return {
      ok: true,
      adjusted: normalizedAmount,
      balanceBefore,
      balanceAfter: account.paidCredits,
      account: { ...account },
      defaults: { ...state.defaults },
    };
  });
}

export async function refundPaidCredits({
  userId,
  amount,
  reason = "refund_paid_credits",
  botHome = resolveBotHome(),
  channel = "",
  chatType = "",
  chatId = "",
  messageId = "",
  runId = "",
} = {}) {
  const normalizedAmount = Number.isFinite(Number(amount)) ? Math.max(0, Math.floor(Number(amount))) : 0;
  return await withCreditsLock(botHome, async (state, statePath) => {
    const account = ensureAccount(state, userId);
    const balanceBefore = account.paidCredits;
    account.paidCredits += normalizedAmount;
    account.balance = account.paidCredits;
    account.updatedAt = nowIso();
    await writeCreditsState(statePath, state);
    await appendUsageEvent({
      eventType: "refund",
      userId,
      channel,
      chatType,
      chatId,
      messageId,
      runId,
      amount: normalizedAmount,
      source: "paid_credit",
      reason,
    }, botHome);
    return {
      ok: true,
      refunded: normalizedAmount,
      balanceBefore,
      balanceAfter: account.paidCredits,
      account: { ...account },
      defaults: { ...state.defaults },
    };
  });
}

export async function chargeUsage({
  userId,
  chatType = "group",
  amount = DEFAULT_TURN_COST,
  botHome = resolveBotHome(),
  now = new Date(),
  channel = "",
  chatId = "",
  messageId = "",
  runId = "",
} = {}) {
  const normalizedAmount = Number.isFinite(Number(amount)) ? Math.max(1, Math.floor(Number(amount))) : DEFAULT_TURN_COST;
  const normalizedChatType = String(chatType || "").trim().toLowerCase();
  return await withCreditsLock(botHome, async (state, statePath) => {
    const account = ensureAccount(state, userId);
    resetDailyFreeIfNeeded(account, now);
    const paidBefore = account.paidCredits;
    const dailyBefore = account.dailyFreeUsed;

    if (normalizedChatType === "group") {
      const remainingFree = Math.max(0, account.dailyFreeLimit - account.dailyFreeUsed);
      if (remainingFree >= normalizedAmount) {
        account.dailyFreeUsed += normalizedAmount;
        account.totalConsumed += normalizedAmount;
        account.updatedAt = nowIso();
        await writeCreditsState(statePath, state);
        await appendUsageEvent({
          eventType: "charge",
          userId,
          channel,
          chatType: normalizedChatType,
          chatId,
          messageId,
          runId,
          amount: normalizedAmount,
          source: "daily_free",
          reason: "group_daily_free",
        }, botHome);
        return {
          ok: true,
          charged: normalizedAmount,
          costSource: "daily_free",
          paidCreditsCharged: 0,
          dailyFreeCharged: normalizedAmount,
          balanceBefore: paidBefore,
          balanceAfter: account.paidCredits,
          dailyFreeBefore: dailyBefore,
          dailyFreeAfter: account.dailyFreeUsed,
          account: { ...account },
          defaults: { ...state.defaults },
        };
      }
    }

    if (account.paidCredits < normalizedAmount) {
      account.updatedAt = nowIso();
      await writeCreditsState(statePath, state);
      await appendUsageEvent({
        eventType: "deny",
        userId,
        channel,
        chatType: normalizedChatType,
        chatId,
        messageId,
        runId,
        amount: normalizedAmount,
        source: "insufficient",
        reason: "insufficient_paid_credits",
      }, botHome);
      return {
        ok: false,
        charged: 0,
        costSource: "insufficient",
        paidCreditsCharged: 0,
        dailyFreeCharged: 0,
        balanceBefore: paidBefore,
        balanceAfter: account.paidCredits,
        dailyFreeBefore: dailyBefore,
        dailyFreeAfter: account.dailyFreeUsed,
        account: { ...account },
        defaults: { ...state.defaults },
      };
    }

    account.paidCredits -= normalizedAmount;
    account.balance = account.paidCredits;
    account.totalConsumed += normalizedAmount;
    account.updatedAt = nowIso();
    await writeCreditsState(statePath, state);
    await appendUsageEvent({
      eventType: "charge",
      userId,
      channel,
      chatType: normalizedChatType,
      chatId,
      messageId,
      runId,
      amount: normalizedAmount,
      source: "paid_credit",
      reason: "paid_credit",
    }, botHome);
    return {
      ok: true,
      charged: normalizedAmount,
      costSource: "paid_credit",
      paidCreditsCharged: normalizedAmount,
      dailyFreeCharged: 0,
      balanceBefore: paidBefore,
      balanceAfter: account.paidCredits,
      dailyFreeBefore: dailyBefore,
      dailyFreeAfter: account.dailyFreeUsed,
      account: { ...account },
      defaults: { ...state.defaults },
    };
  });
}

export async function chargeTurnCredits({ userId, amount = DEFAULT_TURN_COST, botHome = resolveBotHome() } = {}) {
  return await chargeUsage({ userId, amount, botHome, chatType: "private" });
}

export function renderInsufficientCreditsMessage(result, options = {}) {
  const balance = Number(result?.balanceAfter ?? result?.account?.paidCredits ?? result?.account?.balance ?? 0);
  const cost = Number(result?.defaults?.turnCost ?? options.turnCost ?? DEFAULT_TURN_COST);
  const userId = normalizeUserId(options.userId || result?.account?.userId);
  const label = userId ? ` for user ${userId}` : "";
  const freeUsed = Number(result?.account?.dailyFreeUsed ?? 0);
  const freeLimit = Number(result?.account?.dailyFreeLimit ?? result?.defaults?.dailyFreeLimit ?? 0);
  const freeRemaining = Math.max(0, freeLimit - freeUsed);
  return [
    `No credits left${label}.`,
    "No credits were charged for this request.",
    `Daily free used: ${freeUsed}/${freeLimit}. Daily free remaining: ${freeRemaining}.`,
    `Paid credits: ${balance}. Each request costs ${cost} credit${cost === 1 ? "" : "s"}.`,
    freeRemaining > 0
      ? "Next: ask in the group to use the remaining daily free quota, or top up paid credits for private chat."
      : "Next: top up paid credits to continue now, or wait for the next daily free reset in group chat.",
  ].join(" ");
}
