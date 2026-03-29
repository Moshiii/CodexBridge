const TELEGRAM_API_BASE = "https://api.telegram.org";

async function telegramRequest(token, method, body) {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram API ${method} error: ${payload.description ?? "unknown error"}`);
  }
  return payload.result;
}

export async function getTelegramUpdates(token) {
  return await telegramRequest(token, "getUpdates", {});
}

export async function pairTelegramChannel(token) {
  const updates = await getTelegramUpdates(token);
  const latestMessage = [...updates]
    .reverse()
    .find((update) => update.message?.chat?.type === "private" && update.message?.chat?.id);

  if (!latestMessage) {
    throw new Error("No private chat update found. Message your bot first, then retry pairing.");
  }

  return {
    chatId: String(latestMessage.message.chat.id),
    username: latestMessage.message.from?.username ?? null,
  };
}
