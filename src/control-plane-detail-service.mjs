import { readFile } from "node:fs/promises";

import { getChannelBridgeLogPath, readActiveBotId } from "./config.mjs";
import { healthCheckBot, inspectBot, listBots, readBotLogs } from "./bots.mjs";
import { hydrateTelegramMetadata } from "./telegram-metadata.mjs";
import { getStateMigrationStatus } from "./state-migrations.mjs";
import {
  buildQuickTestPreflight,
  buildSetupGuide,
  buildStorageReadiness,
} from "./control-plane-readiness-service.mjs";

export async function getControlPlaneSnapshot() {
  const bots = await listBots();
  const health = await Promise.all(
    bots.map(async (bot) => ({
      id: bot.id,
      health: await healthCheckBot(bot.id),
    })),
  );
  return {
    generatedAt: new Date().toISOString(),
    currentBotId: await readActiveBotId(),
    bots,
    health,
  };
}

function formatTelegramAccessEntry(id, source) {
  const entry = source?.[id];
  if (entry?.label) {
    return `${entry.label} (${id})`;
  }
  if (entry?.username) {
    return `@${String(entry.username).replace(/^@+/, "")} (${id})`;
  }
  if (entry?.title) {
    return `${entry.title} (${id})`;
  }
  return String(id);
}

export function buildTelegramAccessSummary(config = {}) {
  const telegram = config.channels?.telegram ?? {};
  const metadata = telegram.metadata ?? { chats: {}, users: {} };
  return {
    privateChats: (telegram.private?.allowedChatIds ?? []).map((id) => formatTelegramAccessEntry(id, metadata.chats)),
    groupChats: (telegram.groups?.allowedChatIds ?? []).map((id) => formatTelegramAccessEntry(id, metadata.chats)),
    groupUsers: (telegram.groups?.allowedUserIds ?? []).map((id) => formatTelegramAccessEntry(id, metadata.users)),
  };
}

export async function getBotControlPlaneDetail(botId) {
  const detail = await inspectBot(botId);
  detail.config = await hydrateTelegramMetadata(detail.bot.homePath).catch(() => detail.config);
  const health = await healthCheckBot(botId);
  const access = buildTelegramAccessSummary(detail.config);
  const setupGuide = await buildSetupGuide(detail, health, access);
  const migrationStatus = await getStateMigrationStatus({ botHome: detail.bot.homePath });
  return {
    detail,
    health,
    logs: await readBotLogs(botId, 50),
    access,
    setupGuide,
    migrationStatus,
    storageReadiness: buildStorageReadiness(detail.config, migrationStatus),
    quickTestPreflight: buildQuickTestPreflight(setupGuide),
  };
}

export async function readBridgeLogs(botId, lines = 200) {
  const detail = await inspectBot(botId);
  const logPath = getChannelBridgeLogPath(detail.bot.channel, detail.bot.homePath);
  const raw = await readFile(logPath, "utf8").catch(() => "");
  const chunks = raw.trimEnd().split(/\r?\n/).filter(Boolean);
  return {
    logPath,
    content: chunks.slice(-lines).join("\n"),
  };
}
