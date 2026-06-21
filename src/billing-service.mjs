import { resolveBotHome } from "./config.mjs";
import {
  adjustPaidCredits,
  chargeUsage,
  getUserCredits,
  grantPaidCredits,
  refundPaidCredits,
  renderInsufficientCreditsMessage,
} from "./user-credits.mjs";

function normalizeChatType(chatType) {
  const normalized = String(chatType || "").trim().toLowerCase();
  return normalized === "group" ? "group" : "direct";
}

export function resolveBillingSource(chatType) {
  return normalizeChatType(chatType) === "group" ? "daily_free_then_paid" : "paid_credit";
}

export async function getBillingAccount(userId, botHome = resolveBotHome()) {
  return await getUserCredits(userId, botHome);
}

export async function chargeRequestUsage({
  userId,
  chatType = "group",
  amount,
  botHome = resolveBotHome(),
  now,
  channel = "",
  chatId = "",
  messageId = "",
  runId = "",
} = {}) {
  return await chargeUsage({
    userId,
    chatType: normalizeChatType(chatType),
    amount,
    botHome,
    now,
    channel,
    chatId,
    messageId,
    runId,
  });
}

export async function grantCredits({ userId, amount, botHome = resolveBotHome() } = {}) {
  return await grantPaidCredits({ userId, amount, botHome });
}

export async function adjustCredits({ userId, amount, reason, botHome = resolveBotHome() } = {}) {
  return await adjustPaidCredits({ userId, amount, reason, botHome });
}

export function getRefundablePaidCredits(chargeResult = {}) {
  return Number.isFinite(Number(chargeResult.paidCreditsCharged))
    ? Math.max(0, Math.floor(Number(chargeResult.paidCreditsCharged)))
    : 0;
}

export async function refundPaidCreditCharge({
  userId,
  chargeResult = {},
  amount = getRefundablePaidCredits(chargeResult),
  reason = "codex_start_failed",
  botHome = resolveBotHome(),
  channel = "",
  chatType = "",
  chatId = "",
  messageId = "",
  runId = "",
} = {}) {
  const refundableAmount = Number.isFinite(Number(amount)) ? Math.max(0, Math.floor(Number(amount))) : 0;
  if (refundableAmount <= 0) {
    return {
      ok: true,
      refunded: 0,
      skipped: true,
      reason: "no_paid_credits_to_refund",
    };
  }
  return await refundPaidCredits({
    userId,
    amount: refundableAmount,
    reason,
    botHome,
    channel,
    chatType,
    chatId,
    messageId,
    runId,
  });
}

export function renderBillingDeniedMessage(result, options = {}) {
  return renderInsufficientCreditsMessage(result, options);
}
