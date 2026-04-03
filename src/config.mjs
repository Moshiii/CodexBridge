import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_BOT_ID = "default";
export const REGISTRY_VERSION = 1;

function trimEnv(name) {
  return process.env[name]?.trim() || "";
}

export function getAutoAideHome() {
  return trimEnv("AUTOAIDE_HOME") || path.join(os.homedir(), ".autoaide");
}

export function getControlHome() {
  return path.join(getAutoAideHome(), "control");
}

export function getBotsRoot() {
  return path.join(getAutoAideHome(), "bots");
}

export function getSharedLogsPath() {
  return path.join(getAutoAideHome(), "logs");
}

export function resolveBotHome(botId = null) {
  const explicitHome = trimEnv("BOT_HOME");
  if (explicitHome) {
    return explicitHome;
  }
  const resolvedBotId = botId || trimEnv("AUTOAIDE_BOT_ID") || DEFAULT_BOT_ID;
  return path.join(getBotsRoot(), resolvedBotId);
}

export function getRegistryPath() {
  return path.join(getControlHome(), "registry.json");
}

export function getActiveBotStatePath() {
  return path.join(getControlHome(), "active-bot.json");
}

export function getBotPath(botId) {
  return path.join(getBotsRoot(), botId);
}

export function getBotConfigPath(botHome = resolveBotHome()) {
  return path.join(botHome, "config.json");
}

export function getCliStatePath(botHome = resolveBotHome()) {
  return path.join(botHome, "cli-sessions.json");
}

export function getBootstrapStatePath(botHome = resolveBotHome()) {
  return path.join(botHome, "bootstrap-state.json");
}

export function getSchedulesStatePath(botHome = resolveBotHome()) {
  return path.join(botHome, "schedules.json");
}

export function getWorkspacePath(botHome = resolveBotHome()) {
  return path.join(botHome, "workspace");
}

export function getGoalsPath(botHome = resolveBotHome()) {
  return path.join(botHome, "goals");
}

export function getSkillsPath(botHome = resolveBotHome()) {
  return path.join(botHome, "skills");
}

export function getLogsPath(botHome = resolveBotHome()) {
  return path.join(botHome, "logs");
}

export function getMemoryPath(botHome = resolveBotHome()) {
  return path.join(botHome, "memory");
}

export function getTelegramStatePath(botHome = resolveBotHome()) {
  return path.join(botHome, "telegram");
}

export function getBotRuntimePidPath(botHome = resolveBotHome()) {
  return path.join(getTelegramStatePath(botHome), "runtime.pid");
}

export function getTelegramBridgePidPath(botHome = resolveBotHome()) {
  return path.join(getTelegramStatePath(botHome), "bridge.pid");
}

export function getBotRuntimeLogPath(botHome = resolveBotHome()) {
  return path.join(getLogsPath(botHome), "runtime.log");
}

export function getTelegramBridgeLogPath(botHome = resolveBotHome()) {
  return path.join(getLogsPath(botHome), "telegram-bridge.log");
}

export const AUTOAIDE_HOME = getAutoAideHome();
export const CONFIG_PATH = getBotConfigPath();
export const CLI_STATE_PATH = getCliStatePath();
export const BOOTSTRAP_STATE_PATH = getBootstrapStatePath();
export const SCHEDULES_STATE_PATH = getSchedulesStatePath();
export const WORKSPACE_PATH = getWorkspacePath();
export const GOALS_PATH = getGoalsPath();
export const SKILLS_PATH = getSkillsPath();
export const LOGS_PATH = getLogsPath();
export const TELEGRAM_STATE_PATH = getTelegramStatePath();
export const REGISTRY_PATH = getRegistryPath();
export const ACTIVE_BOT_STATE_PATH = getActiveBotStatePath();

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

export function createDefaultBotConfig() {
  return {
    version: 1,
    id: DEFAULT_BOT_ID,
    name: "Default",
    channel: "telegram",
    enabled: false,
    desiredVersion: "v1",
    runningVersion: null,
    status: "stopped",
    runtime: {
      model: "gpt-5.4",
    },
    channels: {
      telegram: {
        enabled: false,
        botToken: "",
        botUsername: "",
        metadata: {
          chats: {},
          users: {},
        },
        private: {
          allowedChatIds: [],
        },
        groups: {
          allowedChatIds: [],
          allowedUserIds: [],
          requireExplicitMention: true,
        },
      },
    },
    observability: {
      lastError: null,
      lastStartedAt: null,
      lastStoppedAt: null,
      logPath: null,
    },
  };
}

function normalizeTelegramConfig(telegram = {}) {
  return {
    ...createDefaultBotConfig().channels.telegram,
    ...telegram,
    metadata: {
      ...createDefaultBotConfig().channels.telegram.metadata,
      ...(telegram.metadata ?? {}),
      chats:
        telegram.metadata?.chats && typeof telegram.metadata.chats === "object"
          ? telegram.metadata.chats
          : {},
      users:
        telegram.metadata?.users && typeof telegram.metadata.users === "object"
          ? telegram.metadata.users
          : {},
    },
    private: {
      ...createDefaultBotConfig().channels.telegram.private,
      ...(telegram.private ?? {}),
      allowedChatIds: telegram.private?.allowedChatIds ?? [],
    },
    groups: {
      ...createDefaultBotConfig().channels.telegram.groups,
      ...(telegram.groups ?? {}),
      allowedChatIds: telegram.groups?.allowedChatIds ?? [],
      allowedUserIds: telegram.groups?.allowedUserIds ?? [],
    },
    enabled: telegram.enabled ?? createDefaultBotConfig().channels.telegram.enabled,
    botToken: telegram.botToken ?? createDefaultBotConfig().channels.telegram.botToken,
    botUsername: telegram.botUsername ?? createDefaultBotConfig().channels.telegram.botUsername,
  };
}

export function normalizeBotConfig(config = {}) {
  const defaults = createDefaultBotConfig();
  const {
    runtime: runtimeConfig = {},
    channels: channelsConfig = {},
    observability: observabilityConfig = {},
    skills: _skillsConfig,
    schedule: _scheduleConfig,
    ...rest
  } = config ?? {};
  const telegram = channelsConfig?.telegram ?? {};
  const normalizedTelegram = normalizeTelegramConfig(telegram);
  return {
    ...defaults,
    ...rest,
    enabled: config.enabled ?? normalizedTelegram.enabled ?? defaults.enabled,
    runtime: {
      model: runtimeConfig.model ?? defaults.runtime.model,
    },
    channels: {
      telegram: {
        ...normalizedTelegram,
      },
    },
    observability: {
      ...defaults.observability,
      ...observabilityConfig,
    },
  };
}

export function createDefaultRegistry() {
  return {
    version: REGISTRY_VERSION,
    bots: [
      {
        id: DEFAULT_BOT_ID,
        name: "Default",
        channel: "telegram",
        homePath: getBotPath(DEFAULT_BOT_ID),
        enabled: false,
        desiredVersion: "v1",
        runningVersion: null,
        status: "stopped",
        botUsername: "",
        lastError: null,
      },
    ],
  };
}

export function createDefaultActiveBotState() {
  return {
    version: 1,
    activeBotId: DEFAULT_BOT_ID,
  };
}

export async function ensureControlPlaneHome() {
  await mkdir(getControlHome(), { recursive: true });
  await mkdir(getBotsRoot(), { recursive: true });
  await mkdir(getSharedLogsPath(), { recursive: true });
}

export async function ensureBotHome(botHome = resolveBotHome()) {
  await mkdir(getWorkspacePath(botHome), { recursive: true });
  await mkdir(getGoalsPath(botHome), { recursive: true });
  await mkdir(getSkillsPath(botHome), { recursive: true });
  await mkdir(getLogsPath(botHome), { recursive: true });
  await mkdir(getTelegramStatePath(botHome), { recursive: true });
  await mkdir(getMemoryPath(botHome), { recursive: true });
}

export async function ensureAutoAideHome() {
  await ensureControlPlaneHome();
  await ensureBotHome();
}

export async function readRegistry() {
  await ensureControlPlaneHome();
  const registry = await readJson(getRegistryPath(), createDefaultRegistry());
  if (!Array.isArray(registry.bots)) {
    registry.bots = [];
  }
  if (!registry.bots.find((bot) => bot.id === DEFAULT_BOT_ID)) {
    registry.bots.unshift(createDefaultRegistry().bots[0]);
  }
  registry.version = REGISTRY_VERSION;
  return registry;
}

export async function writeRegistry(registry) {
  await ensureControlPlaneHome();
  await writeJson(getRegistryPath(), registry);
}

export async function readActiveBotState() {
  await ensureControlPlaneHome();
  const state = await readJson(getActiveBotStatePath(), createDefaultActiveBotState());
  return {
    ...createDefaultActiveBotState(),
    ...(state ?? {}),
    activeBotId: state?.activeBotId || DEFAULT_BOT_ID,
  };
}

export async function writeActiveBotState(state) {
  await ensureControlPlaneHome();
  await writeJson(getActiveBotStatePath(), {
    ...createDefaultActiveBotState(),
    ...(state ?? {}),
    activeBotId: state?.activeBotId || DEFAULT_BOT_ID,
  });
}

export async function readActiveBotId() {
  const state = await readActiveBotState();
  return state.activeBotId;
}

export async function writeActiveBotId(activeBotId) {
  await writeActiveBotState({ activeBotId });
}

export async function readConfig(botHome = resolveBotHome()) {
  await ensureBotHome(botHome);
  const config = await readJson(getBotConfigPath(botHome), createDefaultBotConfig());
  return normalizeBotConfig(config);
}

export async function writeConfig(config, botHome = resolveBotHome()) {
  await ensureBotHome(botHome);
  await writeJson(getBotConfigPath(botHome), normalizeBotConfig(config));
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

export async function readCliState(botHome = resolveBotHome()) {
  await ensureBotHome(botHome);
  const state = await readJson(getCliStatePath(botHome), createDefaultCliState());
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

export async function writeCliState(state, botHome = resolveBotHome()) {
  await ensureBotHome(botHome);
  await writeJson(getCliStatePath(botHome), state);
}

export async function readBootstrapState(botHome = resolveBotHome()) {
  await ensureBotHome(botHome);
  return await readJson(getBootstrapStatePath(botHome), createDefaultBootstrapState());
}

export async function writeBootstrapState(state, botHome = resolveBotHome()) {
  await ensureBotHome(botHome);
  await writeJson(getBootstrapStatePath(botHome), state);
}
