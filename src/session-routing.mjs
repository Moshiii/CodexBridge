function safeSegment(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function tail(value, size = 8) {
  const raw = String(value || "");
  return raw.length <= size ? raw : raw.slice(-size);
}

export function resolveSessionKey(envelope = {}) {
  const channel = safeSegment(envelope.channel, "channel");
  const userId = String(envelope.userId || "").trim();
  if (!userId) {
    throw new Error("Cannot resolve session key without userId.");
  }

  if (envelope.isDirect || envelope.chatType === "direct") {
    return `${channel}:user:${userId}`;
  }

  const chatId = String(envelope.chatId || "").trim();
  if (!chatId) {
    throw new Error("Cannot resolve group session key without chatId.");
  }
  return `${channel}:chat:${chatId}:user:${userId}`;
}

export function resolveSessionLabel(envelope = {}) {
  const channel = safeSegment(envelope.channel, "channel");
  const userPart = safeSegment(tail(envelope.userId, 8), "user");
  if (envelope.isDirect || envelope.chatType === "direct") {
    return `${channel}-u-${userPart}`;
  }
  const chatPart = safeSegment(tail(envelope.chatId, 8), "chat");
  return `${channel}-g-${chatPart}-u-${userPart}`;
}

export function resolveConversationIdentity(envelope = {}) {
  return {
    sessionKey: resolveSessionKey(envelope),
    sessionLabel: resolveSessionLabel(envelope),
  };
}
