import { UserInputError } from "./errors.mjs";
import { pairTelegramChannel } from "./telegram-pairing.mjs";
import { assertSafeTelegramToken } from "./control-plane-config-service.mjs";

export function buildPairedTelegramConfig(currentConfig = {}, nextToken, paired = {}) {
  const telegram = currentConfig.channels?.telegram ?? {};
  const existingGroupUserIds = telegram.groups?.allowedUserIds ?? [];
  return {
    ...currentConfig,
    enabled: true,
    channels: {
      ...currentConfig.channels,
      telegram: {
        ...telegram,
        enabled: true,
        botToken: nextToken,
        botUsername: paired.botUsername || telegram.botUsername || "",
        metadata: {
          chats: {
            ...(telegram.metadata?.chats ?? {}),
            [paired.chatId]: {
              type: "private",
              username: paired.userUsername ?? null,
              label: paired.userUsername ? `@${paired.userUsername.replace(/^@+/, "")}` : null,
            },
          },
          users: {
            ...(telegram.metadata?.users ?? {}),
            [paired.userId]: {
              username: paired.userUsername ?? null,
              label: paired.userUsername ? `@${paired.userUsername.replace(/^@+/, "")}` : null,
            },
          },
        },
        private: {
          allowedChatIds: [paired.chatId],
        },
        groups: {
          allowedChatIds: telegram.groups?.allowedChatIds ?? [],
          allowedUserIds: Array.from(new Set([...existingGroupUserIds, paired.userId])),
          requireExplicitMention: telegram.groups?.requireExplicitMention ?? true,
        },
      },
    },
  };
}

export function buildTelegramAccessConfig(currentConfig = {}, { accessType, id } = {}) {
  const normalizedType = String(accessType || "").trim();
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    throw new UserInputError("Telegram access id is required.", { code: "telegram_access_id_required" });
  }
  if (!["private_chat", "group_chat", "group_user"].includes(normalizedType)) {
    throw new UserInputError("Telegram access type is required.", { code: "telegram_access_type_required" });
  }
  const telegram = currentConfig.channels?.telegram ?? {};
  const privateChatIds = telegram.private?.allowedChatIds ?? [];
  const groupChatIds = telegram.groups?.allowedChatIds ?? [];
  const groupUserIds = telegram.groups?.allowedUserIds ?? [];
  return {
    ...currentConfig,
    channels: {
      ...currentConfig.channels,
      telegram: {
        ...telegram,
        private: {
          ...(telegram.private ?? {}),
          allowedChatIds: normalizedType === "private_chat"
            ? Array.from(new Set([...privateChatIds, normalizedId]))
            : privateChatIds,
        },
        groups: {
          ...(telegram.groups ?? {}),
          allowedChatIds: normalizedType === "group_chat"
            ? Array.from(new Set([...groupChatIds, normalizedId]))
            : groupChatIds,
          allowedUserIds: normalizedType === "group_user"
            ? Array.from(new Set([...groupUserIds, normalizedId]))
            : groupUserIds,
          requireExplicitMention: telegram.groups?.requireExplicitMention ?? true,
        },
      },
    },
  };
}

export async function pairTelegramForControlPlane(
  botId,
  token,
  {
    pairFn = pairTelegramChannel,
    updateBotConfigFn,
    getDetailFn,
  } = {},
) {
  const nextToken = String(token || "").trim();
  if (!nextToken) {
    throw new UserInputError("Telegram token is required.", { code: "telegram_token_required" });
  }
  assertSafeTelegramToken(nextToken);
  const paired = await pairFn(nextToken);
  await updateBotConfigFn(botId, (currentConfig) => buildPairedTelegramConfig(currentConfig, nextToken, paired));
  return {
    chatId: paired.chatId,
    userId: paired.userId,
    botUsername: paired.botUsername,
    detail: await getDetailFn(botId),
  };
}

export async function allowTelegramAccessForControlPlane(
  botId,
  payload,
  {
    updateBotConfigFn,
    getDetailFn,
  } = {},
) {
  await updateBotConfigFn(botId, (currentConfig) => buildTelegramAccessConfig(currentConfig, payload));
  return await getDetailFn(botId);
}
