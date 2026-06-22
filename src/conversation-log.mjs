import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getConversationLogPath, resolveBotHome } from "./config.mjs";

const DIRECTIONS = new Set(["input", "output", "system"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeDirection(direction) {
  const normalized = normalizeString(direction).toLowerCase();
  return DIRECTIONS.has(normalized) ? normalized : "system";
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseDateMs(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function detectConversationRiskLabels(content = "") {
  const text = String(content || "");
  const labels = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
    labels.push("possible_email");
  }
  if (/(?:\+?\d[\s-]?){8,}\d/.test(text)) {
    labels.push("possible_phone");
  }
  if (/\b(?:sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/.test(text)) {
    labels.push("possible_secret");
  }
  if (/(ignore previous instructions|disregard (all )?(previous|prior) instructions|system prompt|developer message)/i.test(text)) {
    labels.push("prompt_injection_signal");
  }
  if (/(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+/i.test(text)) {
    labels.push("credential_like_text");
  }
  return unique(labels);
}

export function redactConversationContent(content = "") {
  return String(content || "")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, "[redacted-secret]")
    .replace(/\b(password|passwd|api[_-]?key|secret|token)\s*[:=]\s*\S+/gi, "$1=[redacted-secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(?:\+?\d[\s-]?){8,}\d/g, "[redacted-phone]");
}

function normalizeConversationLogEvent(event = {}) {
  const content = String(event.content ?? "");
  return {
    eventId: normalizeString(event.eventId) || randomUUID(),
    runId: normalizeString(event.runId),
    userId: normalizeString(event.userId),
    channel: normalizeString(event.channel),
    chatType: normalizeString(event.chatType),
    chatId: normalizeString(event.chatId),
    messageId: normalizeString(event.messageId),
    conversationId: normalizeString(event.conversationId),
    direction: normalizeDirection(event.direction),
    content,
    contentLength: content.length,
    riskLabels: unique([
      ...(Array.isArray(event.riskLabels) ? event.riskLabels.map(normalizeString) : []),
      ...detectConversationRiskLabels(content),
    ]),
    metadata: event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? event.metadata
      : {},
    createdAt: event.createdAt || nowIso(),
  };
}

function redactConversationLogEvent(event) {
  return {
    ...event,
    content: redactConversationContent(event.content),
    contentRedacted: true,
  };
}

export async function appendConversationLogEvent(event = {}, botHome = resolveBotHome()) {
  const normalized = normalizeConversationLogEvent(event);
  if (!normalized.content && normalized.direction !== "system") {
    throw new Error("Conversation log event requires content.");
  }
  const logPath = getConversationLogPath(botHome);
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, `${JSON.stringify(normalized)}\n`, { flag: "a" });
  return normalized;
}

export async function listConversationLogEvents({
  userId = null,
  runId = null,
  direction = null,
  riskLabel = null,
  riskOnly = false,
  createdAfter = null,
  createdBefore = null,
  redactContent = false,
  limit = 100,
  botHome = resolveBotHome(),
} = {}) {
  let raw = "";
  try {
    raw = await readFile(getConversationLogPath(botHome), "utf8");
  } catch {
    return [];
  }
  const normalizedUserId = userId == null ? null : normalizeString(userId);
  const normalizedRunId = runId == null ? null : normalizeString(runId);
  const normalizedDirection = direction == null ? null : normalizeDirection(direction);
  const normalizedRiskLabel = riskLabel == null ? null : normalizeString(riskLabel);
  const createdAfterMs = parseDateMs(createdAfter);
  const createdBeforeMs = parseDateMs(createdBefore);
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = normalizeConversationLogEvent(JSON.parse(trimmed));
      if (normalizedUserId && event.userId !== normalizedUserId) {
        continue;
      }
      if (normalizedRunId && event.runId !== normalizedRunId) {
        continue;
      }
      if (normalizedDirection && event.direction !== normalizedDirection) {
        continue;
      }
      if (normalizedRiskLabel && !event.riskLabels.includes(normalizedRiskLabel)) {
        continue;
      }
      if (riskOnly && event.riskLabels.length === 0) {
        continue;
      }
      const createdAtMs = parseDateMs(event.createdAt);
      if (createdAfterMs != null && (createdAtMs == null || createdAtMs < createdAfterMs)) {
        continue;
      }
      if (createdBeforeMs != null && (createdAtMs == null || createdAtMs > createdBeforeMs)) {
        continue;
      }
      events.push(redactContent ? redactConversationLogEvent(event) : event);
    } catch {
      // Ignore malformed conversation rows.
    }
  }
  return events.slice(-Math.max(1, Number.parseInt(String(limit), 10) || 100));
}

export async function cleanupConversationLogEvents({
  olderThan = null,
  dryRun = false,
  botHome = resolveBotHome(),
} = {}) {
  const cutoffMs = parseDateMs(olderThan);
  if (cutoffMs == null) {
    throw new Error("Conversation log cleanup requires a valid olderThan timestamp.");
  }
  const logPath = getConversationLogPath(botHome);
  let raw = "";
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    return {
      ok: true,
      dryRun: Boolean(dryRun),
      cutoff: new Date(cutoffMs).toISOString(),
      kept: 0,
      removed: 0,
      malformed: 0,
    };
  }
  const kept = [];
  let removed = 0;
  let malformed = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = normalizeConversationLogEvent(JSON.parse(trimmed));
      const createdAtMs = parseDateMs(event.createdAt);
      if (createdAtMs != null && createdAtMs < cutoffMs) {
        removed += 1;
      } else {
        kept.push(event);
      }
    } catch {
      malformed += 1;
      kept.push(trimmed);
    }
  }
  if (!dryRun) {
    await mkdir(path.dirname(logPath), { recursive: true });
    const serialized = kept.map((event) => (
      typeof event === "string" ? event : JSON.stringify(event)
    )).join("\n");
    await writeFile(logPath, serialized ? `${serialized}\n` : "", "utf8");
  }
  return {
    ok: true,
    dryRun: Boolean(dryRun),
    cutoff: new Date(cutoffMs).toISOString(),
    kept: kept.length,
    removed,
    malformed,
  };
}
