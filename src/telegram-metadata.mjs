import { readConfig, writeConfig } from "./config.mjs";

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

function hasUsefulMetadata(entry) {
  return Boolean(entry?.label || entry?.username || entry?.title);
}

function toChatMetadata(chat) {
  return {
    type: chat?.type || null,
    title: chat?.title || null,
    username: chat?.username || null,
    label: chat?.title || (chat?.username ? `@${String(chat.username).replace(/^@+/, "")}` : null),
  };
}

function toUserMetadata(user) {
  return {
    username: user?.username || null,
    label: user?.username ? `@${String(user.username).replace(/^@+/, "")}` : null,
  };
}

export async function hydrateTelegramMetadata(botHome) {
  const config = await readConfig(botHome);
  const telegram = config.channels?.telegram ?? {};
  if (!telegram.enabled || !telegram.botToken) {
    return config;
  }

  const chatIds = [
    ...(telegram.private?.allowedChatIds ?? []),
    ...(telegram.groups?.allowedChatIds ?? []),
  ];
  const userIds = telegram.groups?.allowedUserIds ?? [];
  const currentMetadata = telegram.metadata ?? { chats: {}, users: {} };
  const nextChats = { ...currentMetadata.chats };
  const nextUsers = { ...currentMetadata.users };
  let changed = false;

  for (const chatId of chatIds) {
    if (hasUsefulMetadata(nextChats[chatId])) {
      continue;
    }
    try {
      const chat = await telegramRequest(telegram.botToken, "getChat", { chat_id: chatId });
      nextChats[chatId] = {
        ...nextChats[chatId],
        ...toChatMetadata(chat),
      };
      changed = true;
    } catch {
      // Best effort only. Keep raw ids when Telegram won't resolve metadata.
    }
  }

  for (const userId of userIds) {
    if (hasUsefulMetadata(nextUsers[userId])) {
      continue;
    }
    try {
      const chat = await telegramRequest(telegram.botToken, "getChat", { chat_id: userId });
      nextUsers[userId] = {
        ...nextUsers[userId],
        ...toUserMetadata(chat),
      };
      if (!nextChats[userId] || !hasUsefulMetadata(nextChats[userId])) {
        nextChats[userId] = {
          ...nextChats[userId],
          ...toChatMetadata(chat),
        };
      }
      changed = true;
    } catch {
      // Best effort only. Keep raw ids when Telegram won't resolve metadata.
    }
  }

  if (!changed) {
    return config;
  }

  const nextConfig = {
    ...config,
    channels: {
      ...config.channels,
      telegram: {
        ...telegram,
        metadata: {
          chats: nextChats,
          users: nextUsers,
        },
      },
    },
  };
  await writeConfig(nextConfig, botHome);
  return nextConfig;
}
