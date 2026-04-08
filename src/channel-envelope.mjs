function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createEnvelope(input = {}) {
  const channel = String(input.channel || "").trim().toLowerCase();
  const chatType = String(input.chatType || "").trim().toLowerCase();
  const chatId = input.chatId == null ? "" : String(input.chatId);
  const userId = input.userId == null ? "" : String(input.userId);
  const messageId = input.messageId == null ? "" : String(input.messageId);
  const isDirect = input.isDirect ?? chatType === "direct";
  const isGroup = input.isGroup ?? chatType === "group";

  return {
    channel,
    chatType: isDirect ? "direct" : "group",
    chatId,
    userId,
    messageId,
    isDirect: Boolean(isDirect),
    isGroup: Boolean(isGroup),
    explicitlyMentionedBot: Boolean(input.explicitlyMentionedBot),
    text: normalizeText(input.text),
    raw: input.raw ?? null,
  };
}

export function normalizeTelegramEnvelope(message, options = {}) {
  const chatType = message?.chat?.type === "private" ? "direct" : "group";
  return createEnvelope({
    channel: "telegram",
    chatType,
    chatId: message?.chat?.id,
    userId: message?.from?.id,
    messageId: message?.message_id,
    isDirect: chatType === "direct",
    isGroup: chatType === "group",
    explicitlyMentionedBot: Boolean(options.explicitlyMentionedBot || chatType === "direct"),
    text: options.text,
    raw: message,
  });
}

export function normalizeFeishuEnvelope(event, options = {}) {
  const chatType = String(event?.message?.chat_type || "").toLowerCase() === "p2p" ? "direct" : "group";
  return createEnvelope({
    channel: "feishu",
    chatType,
    chatId: event?.message?.chat_id,
    userId: event?.sender?.sender_id?.open_id,
    messageId: event?.message?.message_id,
    isDirect: chatType === "direct",
    isGroup: chatType === "group",
    explicitlyMentionedBot: Boolean(options.explicitlyMentionedBot || chatType === "direct"),
    text: options.text,
    raw: event,
  });
}
