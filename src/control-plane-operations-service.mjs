import { appendAdminAuditEvent, listAdminAuditEvents } from "./admin-audit-log.mjs";
import { getBotMetrics } from "./analytics-service.mjs";
import { cleanupConversationLogEvents, listConversationLogEvents } from "./conversation-log.mjs";
import {
  appendConversationReviewEvent,
  getLatestConversationReviews,
  listConversationReviewEvents,
} from "./conversation-review.mjs";
import { UserInputError } from "./errors.mjs";
import { listRunRecords } from "./runs-state.mjs";
import { getStateMigrationStatus, runStateMigrations } from "./state-migrations.mjs";
import { adjustPaidCredits, getUserCredits, grantPaidCredits } from "./user-credits.mjs";
import { listUsageEvents } from "./usage-ledger.mjs";
import { readUsersState, setPrivateEnabled, setUserStatus } from "./users-state.mjs";

function normalizeOperationsUserId(userId) {
  return String(userId || "").trim();
}

function normalizePositiveIntegerAmount(amount, path = "amount") {
  const value = Number(amount);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new UserInputError("Amount must be a positive whole number.", {
      code: "invalid_credit_amount",
      details: { path },
    });
  }
  return value;
}

function normalizeIntegerAdjustment(amount, path = "amount") {
  const value = Number(amount);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value === 0) {
    throw new UserInputError("Adjustment amount must be a non-zero whole number.", {
      code: "invalid_credit_adjustment",
      details: { path },
    });
  }
  return value;
}

async function assertKnownOperationsUser(botHome, userId) {
  const normalizedUserId = normalizeOperationsUserId(userId);
  if (!normalizedUserId) {
    throw new UserInputError("Select a user before changing credits, private access, or status.", {
      code: "operations_user_required",
      details: { path: "userId" },
    });
  }
  const user = (await readUsersState(botHome)).users[normalizedUserId];
  if (!user) {
    throw new UserInputError(`Unknown user: ${normalizedUserId}`, {
      code: "operations_user_not_found",
      details: { userId: normalizedUserId },
    });
  }
  return user;
}

export async function listOperationsUsers(botHome) {
  const state = await readUsersState(botHome);
  const users = await Promise.all(
    Object.values(state.users).map(async (user) => {
      const credits = await getUserCredits(user.id, botHome);
      return {
        ...user,
        credits: {
          paidCredits: credits.account.paidCredits,
          dailyFreeUsed: credits.account.dailyFreeUsed,
          dailyFreeLimit: credits.account.dailyFreeLimit,
          totalConsumed: credits.account.totalConsumed,
        },
      };
    }),
  );
  return users.sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
}

export async function grantCredits(botHome, userId, amount) {
  const user = await assertKnownOperationsUser(botHome, userId);
  const normalizedAmount = normalizePositiveIntegerAmount(amount);
  const result = await grantPaidCredits({ userId: user.id, amount: normalizedAmount, botHome });
  await appendAdminAuditEvent({
    action: "grant_credits",
    userId: user.id,
    amount: result.granted,
    reason: "manual_grant",
  }, botHome);
  return {
    user,
    credits: result,
  };
}

export async function adjustCredits(botHome, userId, amount, reason = "manual_adjustment") {
  const user = await assertKnownOperationsUser(botHome, userId);
  const normalizedAmount = normalizeIntegerAdjustment(amount);
  const result = await adjustPaidCredits({ userId: user.id, amount: normalizedAmount, reason, botHome });
  await appendAdminAuditEvent({
    action: "adjust_credits",
    userId: user.id,
    amount: result.adjusted,
    reason,
  }, botHome);
  return {
    user,
    credits: result,
  };
}

export async function updateUserStatus(botHome, userId, status) {
  const existing = await assertKnownOperationsUser(botHome, userId);
  const user = await setUserStatus(existing.id, status, botHome);
  await appendAdminAuditEvent({
    action: "set_user_status",
    userId: existing.id,
    status: user.status,
    reason: "manual_status_update",
  }, botHome);
  return user;
}

export async function updatePrivateEnabled(botHome, userId, privateEnabled) {
  const existing = await assertKnownOperationsUser(botHome, userId);
  const user = await setPrivateEnabled(existing.id, privateEnabled, botHome);
  await appendAdminAuditEvent({
    action: "set_private_enabled",
    userId: existing.id,
    privateEnabled: user.privateEnabled,
    reason: "manual_private_update",
  }, botHome);
  return user;
}

export async function listUsage(botHome, options = {}) {
  return await listUsageEvents({
    botHome,
    userId: options.userId || null,
    limit: options.limit || 100,
  });
}

export async function listRuns(botHome, options = {}) {
  return await listRunRecords({
    botHome,
    userId: options.userId || null,
    limit: options.limit || 100,
  });
}

export async function listAdminAudit(botHome, options = {}) {
  return await listAdminAuditEvents({
    botHome,
    userId: options.userId || null,
    limit: options.limit || 100,
  });
}

export async function getMetrics(botHome) {
  return await getBotMetrics({ botHome });
}

export async function runMigrations(botHome) {
  const result = await runStateMigrations({ botHome });
  await appendAdminAuditEvent({
    action: "run_state_migrations",
    userId: "operator",
    amount: result.executed.length,
    reason: result.executed.length > 0
      ? `executed: ${result.executed.map((migration) => migration.id).join(", ")}`
      : "no_migrations_pending",
  }, botHome);
  return {
    ...result,
    migrationStatus: await getStateMigrationStatus({ botHome }),
  };
}

export async function listConversationLogs(botHome, options = {}) {
  const [events, latestReviews] = await Promise.all([
    listConversationLogEvents({
      botHome,
      userId: options.userId || null,
      runId: options.runId || null,
      direction: options.direction || null,
      riskLabel: options.riskLabel || null,
      riskOnly: options.riskOnly === true || options.riskOnly === "true",
      createdAfter: options.createdAfter || null,
      createdBefore: options.createdBefore || null,
      redactContent: true,
      limit: options.limit || 100,
    }),
    getLatestConversationReviews({ botHome }),
  ]);
  const reviewStatus = String(options.reviewStatus || "").trim();
  return events
    .map((event) => ({
      ...event,
      review: latestReviews.get(event.eventId) || null,
    }))
    .filter((event) => !reviewStatus || event.review?.status === reviewStatus);
}

export async function listConversationReviews(botHome, options = {}) {
  return await listConversationReviewEvents({
    botHome,
    eventId: options.eventId || null,
    status: options.status || null,
    limit: options.limit || 100,
  });
}

export async function cleanupConversationLogs(botHome, options = {}) {
  const olderThan = String(options.olderThan || "").trim();
  if (!olderThan || !Number.isFinite(Date.parse(olderThan))) {
    throw new UserInputError("Conversation log cleanup requires a valid olderThan timestamp.", {
      code: "conversation_cleanup_older_than_required",
      details: { path: "olderThan" },
    });
  }
  const result = await cleanupConversationLogEvents({
    botHome,
    olderThan,
    dryRun: options.dryRun === true || options.dryRun === "true",
  });
  await appendAdminAuditEvent({
    action: "cleanup_conversation_logs",
    userId: "operator",
    amount: result.removed,
    reason: result.dryRun
      ? `dry_run older_than ${result.cutoff}`
      : `removed older_than ${result.cutoff}`,
  }, botHome);
  return result;
}

export async function reviewConversationLog(botHome, eventId, body = {}) {
  const normalizedEventId = String(eventId || "").trim();
  if (!normalizedEventId) {
    throw new UserInputError("Conversation event id is required.", { code: "conversation_event_id_required" });
  }
  return await appendConversationReviewEvent({
    eventId: normalizedEventId,
    status: body.status,
    reviewer: body.reviewer || "local-web",
    note: body.note || "",
  }, botHome);
}
