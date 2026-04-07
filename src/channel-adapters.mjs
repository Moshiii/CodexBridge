import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getTelegramSummary(config = {}) {
  return config.channels?.telegram?.botUsername || "";
}

function getFeishuSummary(config = {}) {
  return config.channels?.feishu?.appId || "";
}

export const CHANNEL_ADAPTERS = {
  telegram: {
    id: "telegram",
    label: "Telegram",
    bridgeScriptPath: path.join(__dirname, "..", "plugins", "telegram-codex", "telegram-codex-bridge.mjs"),
    isConfigured(config = {}) {
      const telegram = config.channels?.telegram ?? {};
      return Boolean(telegram.enabled && telegram.botToken);
    },
    getSummary: getTelegramSummary,
  },
  feishu: {
    id: "feishu",
    label: "Feishu",
    bridgeScriptPath: path.join(__dirname, "..", "plugins", "feishu-codex", "feishu-codex-bridge.mjs"),
    isConfigured(config = {}) {
      const feishu = config.channels?.feishu ?? {};
      return Boolean(feishu.enabled && feishu.appId && feishu.appSecret);
    },
    getSummary: getFeishuSummary,
  },
};

export function getChannelAdapter(channel) {
  const normalized = String(channel || "").trim().toLowerCase();
  return CHANNEL_ADAPTERS[normalized] ?? null;
}

export function listChannelAdapters() {
  return Object.values(CHANNEL_ADAPTERS);
}
