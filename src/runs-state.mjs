import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getRunsStatePath, resolveBotHome } from "./config.mjs";

const RUN_STATUSES = new Set(["queued", "running", "completed", "failed", "stopped", "denied"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeStatus(status) {
  const normalized = normalizeString(status).toLowerCase();
  return RUN_STATUSES.has(normalized) ? normalized : "queued";
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function normalizeRunRecord(record = {}) {
  const runId = normalizeString(record.runId) || randomUUID();
  const now = nowIso();
  return {
    runId,
    userId: normalizeString(record.userId),
    conversationId: normalizeString(record.conversationId),
    channel: normalizeString(record.channel),
    chatType: normalizeString(record.chatType),
    chatId: normalizeString(record.chatId),
    messageId: normalizeString(record.messageId),
    visibility: normalizeString(record.visibility),
    costSource: normalizeString(record.costSource),
    creditsCharged: normalizeNumber(record.creditsCharged),
    status: normalizeStatus(record.status),
    codexThreadId: normalizeString(record.codexThreadId),
    outputPreview: normalizeString(record.outputPreview),
    error: normalizeString(record.error),
    reason: normalizeString(record.reason),
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    finishedAt: record.finishedAt || null,
  };
}

async function appendRunSnapshot(record, botHome) {
  const runsPath = getRunsStatePath(botHome);
  await mkdir(path.dirname(runsPath), { recursive: true });
  await writeFile(runsPath, `${JSON.stringify(record)}\n`, { flag: "a" });
  return record;
}

export async function createRunRecord(record = {}, botHome = resolveBotHome()) {
  return await appendRunSnapshot(normalizeRunRecord(record), botHome);
}

export async function updateRunRecord(runId, patch = {}, botHome = resolveBotHome()) {
  const existing = await getRunRecord(runId, botHome);
  if (!existing) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const status = normalizeStatus(patch.status || existing.status);
  const next = normalizeRunRecord({
    ...existing,
    ...patch,
    runId: existing.runId,
    status,
    updatedAt: nowIso(),
    finishedAt: ["completed", "failed", "stopped", "denied"].includes(status)
      ? patch.finishedAt || nowIso()
      : patch.finishedAt || existing.finishedAt,
  });
  return await appendRunSnapshot(next, botHome);
}

export async function listRunRecords({ userId = null, limit = 100, botHome = resolveBotHome() } = {}) {
  const runsPath = getRunsStatePath(botHome);
  let raw = "";
  try {
    raw = await readFile(runsPath, "utf8");
  } catch {
    return [];
  }
  const latest = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed);
      if (record?.runId) {
        latest.set(record.runId, record);
      }
    } catch {
      // Ignore malformed snapshots.
    }
  }
  const normalizedUserId = userId == null ? null : normalizeString(userId);
  return Array.from(latest.values())
    .filter((record) => !normalizedUserId || record.userId === normalizedUserId)
    .sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")))
    .slice(-Math.max(1, Number.parseInt(String(limit), 10) || 100));
}

export async function getRunRecord(runId, botHome = resolveBotHome()) {
  const records = await listRunRecords({ botHome, limit: 10000 });
  return records.find((record) => record.runId === runId) || null;
}
