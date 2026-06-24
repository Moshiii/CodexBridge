import { sleep } from "./async-utils.mjs";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_PAIRING_ATTEMPTS = 10;
const DEFAULT_POLL_TIMEOUT_SECONDS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

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

export async function getTelegramBotInfo(token) {
  return await telegramRequest(token, "getMe", {});
}

export async function getTelegramUpdates(token, { timeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS } = {}) {
  return await telegramRequest(token, "getUpdates", {
    timeout: timeoutSeconds,
    allowed_updates: ["message"],
  });
}

function findLatestPrivateChatUpdate(updates) {
  return [...updates]
    .reverse()
    .find((update) => update.message?.chat?.type === "private" && update.message?.chat?.id);
}

export async function pairTelegramChannel(
  token,
  {
    attempts = DEFAULT_PAIRING_ATTEMPTS,
    timeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {},
) {
  const botInfo = await getTelegramBotInfo(token);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const updates = await getTelegramUpdates(token, { timeoutSeconds });
    const latestMessage = findLatestPrivateChatUpdate(updates);

    if (latestMessage) {
      return {
        chatId: String(latestMessage.message.chat.id),
        userId: String(latestMessage.message.from?.id ?? latestMessage.message.chat.id),
        botUsername: botInfo.username ?? null,
        userUsername: latestMessage.message.from?.username ?? null,
        };
    }

    if (attempt < attempts - 1) {
      await sleep(retryDelayMs);
    }
  }

  throw new Error("No private chat update found. Message your bot first, then retry pairing.");
}
