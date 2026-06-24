import {
  CODEXBRIDGE_HOME,
  getBootstrapStatePath,
  getBotRuntimePidPath,
  getFeishuStatePath,
  getTelegramStatePath,
  getWorkspacePath,
} from "./config.mjs";
import { resolveCliCreditsUserId } from "./user-credits.mjs";
import { formatKeyValueCard, formatListCard } from "./ui/banner.mjs";

export function formatBotPrompt(botId) {
  return `codexbridge:${botId}> `;
}

export function getTelegramConfigView(config) {
  const telegram = config.channels?.telegram ?? {};
  return {
    ...telegram,
    privateAllowedChatIds: telegram.private?.allowedChatIds ?? [],
    groupAllowedChatIds: telegram.groups?.allowedChatIds ?? [],
    groupAllowedUserIds: telegram.groups?.allowedUserIds ?? [],
  };
}

export function getFeishuConfigView(config) {
  const feishu = config.channels?.feishu ?? {};
  return {
    ...feishu,
    metadataChats: feishu.metadata?.chats ?? {},
    metadataUsers: feishu.metadata?.users ?? {},
  };
}

export function formatTelegramEntity(id, entry, fallbackLabel = null) {
  if (entry?.label) {
    return `${entry.label} (${id})`;
  }
  if (entry?.username) {
    return `@${entry.username.replace(/^@+/, "")} (${id})`;
  }
  if (entry?.title) {
    return `${entry.title} (${id})`;
  }
  return fallbackLabel ? `${fallbackLabel} (${id})` : String(id);
}

export function formatTelegramEntityList(ids, metadata, kind) {
  if (!ids?.length) {
    return kind === "chat" ? "(all chats)" : "(none)";
  }
  const source = kind === "user" ? metadata?.users : metadata?.chats;
  return ids
    .map((id) => formatTelegramEntity(id, source?.[id]))
    .join(", ");
}

export function formatStatusOverview(botContext, config, bridgeProcess, cliState, bootstrapInfo, creditsInfo = null) {
  const telegram = getTelegramConfigView(config);
  const feishu = getFeishuConfigView(config);
  const runtimeOnline = Boolean(bridgeProcess?.pid);
  const activeChannel = config.channel || "telegram";
  const creditsBalance = creditsInfo?.account?.balance;
  const creditsDisplay = Number.isFinite(creditsBalance) ? String(creditsBalance) : "unknown";
  return formatKeyValueCard("Current Bot", [
    ["bot", botContext.botId],
    ["channel", activeChannel],
    ["runtime", runtimeOnline ? "online" : "offline"],
    ["bootstrap", bootstrapInfo.bootstrapPending ? "pending" : "done"],
    ["session", cliState.activeSessionLabel],
    ["credits", creditsDisplay],
    ["telegram", telegram?.enabled ? "paired" : "unpaired"],
    ["feishu", feishu?.enabled ? "configured" : "not configured"],
  ]);
}

export function formatCliStatus(botContext, config, bridgeProcess, cliState, bootstrapInfo, creditsInfo = null) {
  const telegram = getTelegramConfigView(config);
  const feishu = getFeishuConfigView(config);
  const runtimeOnline = Boolean(bridgeProcess?.pid);
  const activeChannel = config.channel || "telegram";
  const telegramOnline = runtimeOnline && activeChannel === "telegram" && telegram?.enabled;
  const feishuOnline = runtimeOnline && activeChannel === "feishu" && feishu?.enabled;
  const creditsBalance = creditsInfo?.account?.balance;
  const creditsDisplay = Number.isFinite(creditsBalance) ? String(creditsBalance) : "unknown";
  return formatKeyValueCard("CodexBridge Status", [
    ["home", CODEXBRIDGE_HOME],
    ["bot", botContext.botId],
    ["workspace", getWorkspacePath(botContext.botHome)],
    ["bootstrap state", getBootstrapStatePath(botContext.botHome)],
    ["runtime pid file", getBotRuntimePidPath(botContext.botHome)],
    ["telegram state", getTelegramStatePath(botContext.botHome)],
    ["feishu state", getFeishuStatePath(botContext.botHome)],
    ["active channel", activeChannel],
    ["owner user id", config.ownerUserId || "unset"],
    ["admin count", String((config.adminUserIds ?? []).length)],
    ["credits user id", creditsInfo?.account?.userId || resolveCliCreditsUserId(config)],
    ["credits remaining", creditsDisplay],
    ["model", config.runtime?.model || "gpt-5.4"],
    ["bootstrap completed", bootstrapInfo.bootstrapPending ? "no" : "yes"],
    ["active session", cliState.activeSessionLabel],
    ["bot runtime online", runtimeOnline ? "yes" : "no"],
    ["telegram paired", telegram?.enabled ? "yes" : "no"],
    ["telegram bridge online", telegramOnline ? "yes" : "no"],
    ["feishu enabled", feishu?.enabled ? "yes" : "no"],
    ["feishu bridge online", feishuOnline ? "yes" : "no"],
    ["feishu app id", feishu?.appId || "none"],
    ["feishu mention required", String(feishu?.requireExplicitMention ?? true)],
    ...(telegram?.enabled
      ? [
          ["private chats", formatTelegramEntityList(telegram.privateAllowedChatIds, telegram.metadata, "chat")],
          ["group chats", formatTelegramEntityList(telegram.groupAllowedChatIds, telegram.metadata, "chat")],
          ["group users", formatTelegramEntityList(telegram.groupAllowedUserIds, telegram.metadata, "user")],
        ]
      : []),
  ]);
}

export function getRunningTurn(runningTurns, label) {
  return runningTurns.get(label) || null;
}

export function formatCliSessions(cliState, runningTurns) {
  const sessions = Object.values(cliState.sessions).sort((a, b) => a.label.localeCompare(b.label));
  return formatListCard(
    "Sessions",
    sessions.map((session) => {
      const tags = [
        session.label === cliState.activeSessionLabel ? "active" : null,
        session.cliSessionRef ? "started" : "empty",
        getRunningTurn(runningTurns, session.label) ? "running" : null,
      ].filter(Boolean);
      return `- ${session.label} [${tags.join(", ")}]`;
    }),
  );
}

export function renderCliResult(result) {
  if (result.ok) {
    return result.output || "Codex completed without output.";
  }
  if (result.signal) {
    const parts = [`Codex interrupted (${result.signal}).`];
    if (result.stderr) {
      parts.push(`stderr:\n${result.stderr}`);
    }
    return parts.join("\n\n");
  }
  const parts = [`Codex failed${result.exitCode == null ? "" : ` (exit ${result.exitCode})`}.`];
  if (result.output) {
    parts.push(`stdout:\n${result.output}`);
  }
  if (result.stderr) {
    parts.push(`stderr:\n${result.stderr}`);
  }
  return parts.join("\n\n");
}

export function slugifySessionLabel(raw) {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || null;
}
