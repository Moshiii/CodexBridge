import { resolveBotHome } from "./config.mjs";
import { chargeRequestUsage, renderBillingDeniedMessage } from "./billing-service.mjs";
import { createQueuedRun, markRunDenied } from "./run-service.mjs";
import { evaluateConversationPolicy } from "./conversation-policy.mjs";
import {
  buildUserId,
  canUseGroupChat,
  canUsePrivateChat,
  renderPrivateChatLockedMessage,
  upsertUser,
} from "./users-state.mjs";

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeChatType(chatType) {
  const normalized = normalizeString(chatType).toLowerCase();
  return normalized === "group" ? "group" : "direct";
}

function isDirectChat(chatType, isDirect) {
  return Boolean(isDirect || normalizeChatType(chatType) === "direct");
}

function buildVisibility(chatType, isDirect) {
  return isDirectChat(chatType, isDirect) ? "private" : "public";
}

function canUserAccessChat(user, chatType, isDirect) {
  return isDirectChat(chatType, isDirect) ? canUsePrivateChat(user) : canUseGroupChat(user);
}

function accessDeniedReason(user, chatType, isDirect) {
  if (user?.status === "banned") {
    return "user_banned";
  }
  if (isDirectChat(chatType, isDirect)) {
    return "private_chat_locked";
  }
  return "chat_access_denied";
}

function accessDeniedMessage(user, chatType, isDirect) {
  if (user?.status === "banned") {
    return "This user is banned from CodexBridge.";
  }
  if (isDirectChat(chatType, isDirect)) {
    return renderPrivateChatLockedMessage(user);
  }
  return "This user cannot use CodexBridge in this chat.";
}

export async function prepareChatRequest({
  channel,
  externalUserId,
  displayName = "",
  envelope = {},
  chatId = "",
  messageId = "",
  conversationId = "",
  content = "",
  amount,
  botHome = resolveBotHome(),
} = {}) {
  const normalizedChannel = normalizeString(channel || envelope.channel).toLowerCase();
  const normalizedExternalUserId = normalizeString(externalUserId || envelope.userId);
  const chatType = normalizeChatType(envelope.chatType);
  const isDirect = Boolean(envelope.isDirect);
  const user = await upsertUser({
    id: buildUserId(normalizedChannel, normalizedExternalUserId),
    channel: normalizedChannel,
    externalUserId: normalizedExternalUserId,
    displayName,
  }, botHome);

  const runFields = {
    userId: user.id,
    conversationId: normalizeString(conversationId || envelope.conversationId),
    channel: normalizedChannel,
    chatType,
    chatId: normalizeString(chatId || envelope.chatId),
    messageId: normalizeString(messageId || envelope.messageId),
    visibility: buildVisibility(chatType, isDirect),
  };

  const run = await createQueuedRun(runFields, botHome);
  const policy = evaluateConversationPolicy(content);
  if (policy.action === "block") {
    const deniedRun = await markRunDenied(run.runId, "conversation_policy_blocked", {
      reason: policy.reason,
    }, botHome);
    return {
      ok: false,
      decision: "denied",
      reason: "conversation_policy_blocked",
      message: policy.userMessage,
      user,
      run: deniedRun,
      charged: null,
      policy,
    };
  }

  if (!canUserAccessChat(user, chatType, isDirect)) {
    const reason = accessDeniedReason(user, chatType, isDirect);
    const deniedRun = await markRunDenied(run.runId, reason, {}, botHome);
    return {
      ok: false,
      decision: "denied",
      reason,
      message: accessDeniedMessage(user, chatType, isDirect),
      user,
      run: deniedRun,
      charged: null,
      policy,
    };
  }

  const charge = await chargeRequestUsage({
    userId: user.id,
    chatType,
    amount,
    botHome,
    channel: normalizedChannel,
    chatId: runFields.chatId,
    messageId: runFields.messageId,
    runId: run.runId,
  });
  if (!charge.ok) {
    const deniedRun = await markRunDenied(run.runId, "insufficient_credits", {}, botHome);
    return {
      ok: false,
      decision: "denied",
      reason: "insufficient_credits",
      message: renderBillingDeniedMessage(charge, { userId: user.id }),
      user,
      run: deniedRun,
      charged: charge,
      policy,
    };
  }

  return {
    ok: true,
    decision: "ready",
    reason: "",
    message: "",
    user,
    run,
    charged: charge,
    policy,
  };
}
