import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getConversationReviewPath, resolveBotHome } from "./config.mjs";

const REVIEW_STATUSES = new Set(["unreviewed", "confirmed_risk", "false_positive", "handled"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeStatus(status) {
  const normalized = normalizeString(status).toLowerCase();
  return REVIEW_STATUSES.has(normalized) ? normalized : "";
}

function normalizeReviewEvent(event = {}) {
  return {
    reviewId: normalizeString(event.reviewId) || randomUUID(),
    eventId: normalizeString(event.eventId),
    status: normalizeStatus(event.status),
    reviewer: normalizeString(event.reviewer) || "local-web",
    note: normalizeString(event.note),
    createdAt: event.createdAt || nowIso(),
  };
}

export async function appendConversationReviewEvent(event = {}, botHome = resolveBotHome()) {
  const normalized = normalizeReviewEvent(event);
  if (!normalized.eventId) {
    throw new Error("Conversation review event requires eventId.");
  }
  if (!normalized.status) {
    throw new Error("Conversation review event requires a valid status.");
  }
  await mkdir(path.dirname(getConversationReviewPath(botHome)), { recursive: true });
  await writeFile(getConversationReviewPath(botHome), `${JSON.stringify(normalized)}\n`, { flag: "a" });
  return normalized;
}

export async function listConversationReviewEvents({
  eventId = null,
  status = null,
  limit = 100,
  botHome = resolveBotHome(),
} = {}) {
  let raw = "";
  try {
    raw = await readFile(getConversationReviewPath(botHome), "utf8");
  } catch {
    return [];
  }
  const normalizedEventId = eventId == null ? null : normalizeString(eventId);
  const normalizedStatus = status == null ? null : normalizeStatus(status);
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = normalizeReviewEvent(JSON.parse(trimmed));
      if (normalizedEventId && event.eventId !== normalizedEventId) {
        continue;
      }
      if (normalizedStatus && event.status !== normalizedStatus) {
        continue;
      }
      events.push(event);
    } catch {
      // Ignore malformed review rows.
    }
  }
  return events.slice(-Math.max(1, Number.parseInt(String(limit), 10) || 100));
}

export async function getLatestConversationReviews({ botHome = resolveBotHome() } = {}) {
  const reviews = await listConversationReviewEvents({ limit: 10000, botHome });
  const latest = new Map();
  for (const review of reviews) {
    latest.set(review.eventId, review);
  }
  return latest;
}
