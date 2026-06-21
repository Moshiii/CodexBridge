import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getAdminAuditLogPath, resolveBotHome } from "./config.mjs";

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAuditEvent(event = {}) {
  return {
    eventId: normalizeString(event.eventId) || randomUUID(),
    actor: normalizeString(event.actor) || "local-web",
    action: normalizeString(event.action),
    userId: normalizeString(event.userId),
    amount: normalizeNumber(event.amount),
    status: normalizeString(event.status),
    privateEnabled: typeof event.privateEnabled === "boolean" ? event.privateEnabled : null,
    reason: normalizeString(event.reason),
    createdAt: event.createdAt || nowIso(),
  };
}

export async function appendAdminAuditEvent(event = {}, botHome = resolveBotHome()) {
  const normalized = normalizeAuditEvent(event);
  if (!normalized.action) {
    throw new Error("Admin audit event requires action.");
  }
  await mkdir(path.dirname(getAdminAuditLogPath(botHome)), { recursive: true });
  await writeFile(getAdminAuditLogPath(botHome), `${JSON.stringify(normalized)}\n`, { flag: "a" });
  return normalized;
}

export async function listAdminAuditEvents({ userId = null, limit = 100, botHome = resolveBotHome() } = {}) {
  let raw = "";
  try {
    raw = await readFile(getAdminAuditLogPath(botHome), "utf8");
  } catch {
    return [];
  }
  const normalizedUserId = userId == null ? null : normalizeString(userId);
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = normalizeAuditEvent(JSON.parse(trimmed));
      if (!normalizedUserId || event.userId === normalizedUserId) {
        events.push(event);
      }
    } catch {
      // Ignore malformed audit rows.
    }
  }
  return events.slice(-Math.max(1, Number.parseInt(String(limit), 10) || 100));
}
