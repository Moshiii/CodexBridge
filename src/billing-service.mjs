import { resolveBotHome } from "./config.mjs";
import {
  adjustPaidCredits,
  chargeUsage,
  getUserCredits,
  grantPaidCredits,
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

export function renderBillingDeniedMessage(result, options = {}) {
  return renderInsufficientCreditsMessage(result, options);
}
