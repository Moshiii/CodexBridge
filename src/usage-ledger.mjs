import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getUsageLedgerPath, resolveBotHome } from "./config.mjs";

const EVENT_TYPES = new Set(["grant", "charge", "refund", "adjustment", "deny"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

function normalizeUsageEvent(event = {}) {
  const eventType = normalizeString(event.eventType || event.type).toLowerCase();
  if (!EVENT_TYPES.has(eventType)) {
    throw new Error(`Unsupported usage event type: ${eventType || "(missing)"}`);
  }
  const userId = normalizeString(event.userId);
  if (!userId) {
    throw new Error("Usage event requires userId.");
  }
  return {
    eventId: normalizeString(event.eventId) || randomUUID(),
    eventType,
    userId,
    channel: normalizeString(event.channel),
    chatType: normalizeString(event.chatType),
    chatId: normalizeString(event.chatId),
    messageId: normalizeString(event.messageId),
    runId: normalizeString(event.runId),
    amount: normalizeAmount(event.amount),
    source: normalizeString(event.source),
    reason: normalizeString(event.reason),
    createdAt: event.createdAt || nowIso(),
  };
}

export async function appendUsageEvent(event, botHome = resolveBotHome()) {
  const normalized = normalizeUsageEvent(event);
  const ledgerPath = getUsageLedgerPath(botHome);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, `${JSON.stringify(normalized)}\n`, { flag: "a" });
  return normalized;
}

export async function listUsageEvents({ userId = null, limit = 100, botHome = resolveBotHome() } = {}) {
  const ledgerPath = getUsageLedgerPath(botHome);
  let raw = "";
  try {
    raw = await readFile(ledgerPath, "utf8");
  } catch {
    return [];
  }
  const normalizedUserId = userId == null ? null : normalizeString(userId);
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((event) => !normalizedUserId || event.userId === normalizedUserId)
    .slice(-Math.max(1, Number.parseInt(String(limit), 10) || 100));
}
