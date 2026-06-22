import { getUsersStatePath, readJson, resolveBotHome, writeJson } from "./config.mjs";

export const USER_STATUSES = new Set(["free", "paid", "banned", "admin"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeSegment(value) {
  return String(value || "").trim();
}

export function buildUserId(channel, externalUserId) {
  const normalizedChannel = normalizeSegment(channel).toLowerCase();
  const normalizedExternalUserId = normalizeSegment(externalUserId);
  if (!normalizedChannel || !normalizedExternalUserId) {
    throw new Error("User id requires channel and externalUserId.");
  }
  return `${normalizedChannel}:${normalizedExternalUserId}`;
}

function normalizeStatus(status) {
  const normalized = normalizeSegment(status).toLowerCase();
  return USER_STATUSES.has(normalized) ? normalized : "free";
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeUser(user = {}, fallback = {}) {
  const channel = normalizeSegment(user.channel || fallback.channel).toLowerCase();
  const externalUserId = normalizeSegment(user.externalUserId || fallback.externalUserId);
  const id = normalizeSegment(user.id) || buildUserId(channel, externalUserId);
  const status = normalizeStatus(user.status);
  return {
    id,
    channel,
    externalUserId,
    displayName: normalizeSegment(user.displayName || fallback.displayName),
    status,
    privateEnabled: normalizeBoolean(user.privateEnabled, status === "paid" || status === "admin"),
    createdAt: user.createdAt || fallback.createdAt || nowIso(),
    lastSeenAt: user.lastSeenAt || fallback.lastSeenAt || nowIso(),
  };
}

function createDefaultUsersState() {
  return {
    version: 1,
    users: {},
  };
}

function normalizeUsersState(state = {}) {
  const usersInput = state.users && typeof state.users === "object" ? state.users : {};
  const users = {};
  for (const [id, user] of Object.entries(usersInput)) {
    try {
      const normalized = normalizeUser({
        ...user,
        id: user?.id || id,
      });
      users[normalized.id] = normalized;
    } catch {
      // Skip malformed legacy entries.
    }
  }
  return {
    version: 1,
    users,
  };
}

export async function readUsersState(botHome = resolveBotHome()) {
  return normalizeUsersState(await readJson(getUsersStatePath(botHome), createDefaultUsersState()));
}

export async function writeUsersState(state, botHome = resolveBotHome()) {
  await writeJson(getUsersStatePath(botHome), normalizeUsersState(state));
}

export async function getUser(userId, botHome = resolveBotHome()) {
  const state = await readUsersState(botHome);
  return state.users[normalizeSegment(userId)] || null;
}

export async function upsertUser(input = {}, botHome = resolveBotHome()) {
  const state = await readUsersState(botHome);
  const id = input.id || buildUserId(input.channel, input.externalUserId);
  const existing = state.users[id] || null;
  const timestamp = nowIso();
  const normalized = normalizeUser(
    {
      ...existing,
      ...input,
      id,
      createdAt: existing?.createdAt || input.createdAt || timestamp,
      lastSeenAt: timestamp,
    },
    existing || {},
  );
  state.users[id] = normalized;
  await writeUsersState(state, botHome);
  return normalized;
}

export async function updateUser(userId, patch = {}, botHome = resolveBotHome()) {
  const state = await readUsersState(botHome);
  const id = normalizeSegment(userId);
  const existing = state.users[id];
  if (!existing) {
    throw new Error(`Unknown user: ${id}`);
  }
  const next = normalizeUser({
    ...existing,
    ...patch,
    id,
    lastSeenAt: patch.lastSeenAt || existing.lastSeenAt,
  });
  state.users[id] = next;
  await writeUsersState(state, botHome);
  return next;
}

export async function setUserStatus(userId, status, botHome = resolveBotHome()) {
  return await updateUser(userId, { status: normalizeStatus(status) }, botHome);
}

export async function setPrivateEnabled(userId, privateEnabled, botHome = resolveBotHome()) {
  return await updateUser(userId, { privateEnabled: Boolean(privateEnabled) }, botHome);
}

export function canUsePrivateChat(user = {}) {
  if (user.status === "banned") {
    return false;
  }
  return Boolean(user.privateEnabled || user.status === "paid" || user.status === "admin");
}

export function canUseGroupChat(user = {}) {
  return user.status !== "banned";
}

export function renderPrivateChatLockedMessage() {
  return [
    "Private chat is locked for this account.",
    "No credits were charged for this request.",
    "Next: keep using CodexBridge in the group with the daily free quota. Group chat is public, so avoid private or sensitive content there.",
    "Top up paid credits or ask the operator to unlock private chat when you want private conversations.",
  ].join("\n");
}

export function renderBannedUserMessage() {
  return [
    "This account is blocked from using CodexBridge.",
    "No credits were charged for this request.",
    "Next: ask the operator to review the ban if you think this is a mistake.",
  ].join("\n");
}
