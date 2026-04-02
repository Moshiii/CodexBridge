import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const AUTOAIDE_HOME = process.env.AUTOAIDE_HOME?.trim() || path.join(os.homedir(), ".autoaide");
export const CONFIG_PATH = path.join(AUTOAIDE_HOME, "config.json");
export const CLI_STATE_PATH = path.join(AUTOAIDE_HOME, "cli-sessions.json");
export const BOOTSTRAP_STATE_PATH = path.join(AUTOAIDE_HOME, "bootstrap-state.json");
export const SCHEDULES_STATE_PATH = path.join(AUTOAIDE_HOME, "schedules.json");
export const WORKSPACE_PATH = path.join(AUTOAIDE_HOME, "workspace");
export const GOALS_PATH = path.join(AUTOAIDE_HOME, "goals");
export const SKILLS_PATH = path.join(AUTOAIDE_HOME, "skills");
export const LOGS_PATH = path.join(AUTOAIDE_HOME, "logs");
export const DAEMON_PID_PATH = path.join(AUTOAIDE_HOME, "autoaide.pid");
export const DAEMON_LOG_PATH = path.join(LOGS_PATH, "daemon.log");
export const TELEGRAM_STATE_PATH = path.join(AUTOAIDE_HOME, "telegram");
export const TELEGRAM_BRIDGE_PID_PATH = path.join(TELEGRAM_STATE_PATH, "bridge.pid");
export const TELEGRAM_BRIDGE_LOG_PATH = path.join(LOGS_PATH, "telegram-bridge.log");
export const TELEGRAM_BRIDGE_PATH = path.join(
  PROJECT_ROOT,
  "plugins",
  "telegram-codex",
  "telegram-codex-bridge.mjs",
);

export async function ensureAutoAideHome() {
  await mkdir(WORKSPACE_PATH, { recursive: true });
  await mkdir(GOALS_PATH, { recursive: true });
  await mkdir(SKILLS_PATH, { recursive: true });
  await mkdir(LOGS_PATH, { recursive: true });
  await mkdir(TELEGRAM_STATE_PATH, { recursive: true });
}

export async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function createDefaultConfig() {
  return {
    model: "gpt-5.4",
    channels: {
      telegram: {
        enabled: false,
        botToken: "",
        allowedChatIds: [],
        allowedGroupChatIds: [],
        allowedGroupUserIds: [],
        botUsername: "",
      },
    },
  };
}

export async function readConfig() {
  await ensureAutoAideHome();
  const config = await readJson(CONFIG_PATH, createDefaultConfig());
  const telegram = config.channels?.telegram ?? {};
  config.channels = {
    ...(config.channels ?? {}),
    telegram: {
      ...createDefaultConfig().channels.telegram,
      ...telegram,
    },
  };
  return config;
}

export async function writeConfig(config) {
  await ensureAutoAideHome();
  await writeJson(CONFIG_PATH, config);
}

export function createDefaultCliState() {
  return {
    version: 1,
    sessions: {
      main: {
        label: "main",
        cliSessionRef: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    activeSessionLabel: "main",
  };
}

export function createDefaultBootstrapState() {
  return {
    version: 1,
    completed: false,
    completedAt: null,
    lastSeededAt: null,
  };
}

export async function readCliState() {
  await ensureAutoAideHome();
  const state = await readJson(CLI_STATE_PATH, createDefaultCliState());
  if (!state.sessions?.main) {
    state.sessions = {
      ...(state.sessions ?? {}),
      main: createDefaultCliState().sessions.main,
    };
  }
  if (!state.activeSessionLabel || !state.sessions[state.activeSessionLabel]) {
    state.activeSessionLabel = "main";
  }
  return state;
}

export async function writeCliState(state) {
  await ensureAutoAideHome();
  await writeJson(CLI_STATE_PATH, state);
}

export async function readBootstrapState() {
  await ensureAutoAideHome();
  return await readJson(BOOTSTRAP_STATE_PATH, createDefaultBootstrapState());
}

export async function writeBootstrapState(state) {
  await ensureAutoAideHome();
  await writeJson(BOOTSTRAP_STATE_PATH, state);
}
