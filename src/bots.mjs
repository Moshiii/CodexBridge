import { spawn } from "node:child_process";
import { open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BOT_ID,
  PROJECT_ROOT,
  createDefaultBotConfig,
  ensureBotHome,
  ensureControlPlaneHome,
  getBotConfigPath,
  getBotPath,
  getBotRuntimeLogPath,
  getBotRuntimePidPath,
  getLogsPath,
  getRegistryPath,
  getTelegramBridgeLogPath,
  readConfig,
  readActiveBotId,
  readJson,
  readRegistry,
  resolveBotHome,
  writeActiveBotId,
  writeConfig,
  writeJson,
  writeRegistry,
} from "./config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BIN_PATH = path.join(PROJECT_ROOT, "bin", "autoaide.mjs");

function nowIso() {
  return new Date().toISOString();
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateChildProcess(child, signal = "SIGTERM", timeoutMs = 4000) {
  if (!child || child.exitCode != null || child.killed) {
    return;
  }

  const waitForExit = new Promise((resolve) => {
    child.once("exit", resolve);
  });

  child.kill(signal);
  await Promise.race([
    waitForExit,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (child.exitCode == null) {
    child.kill("SIGKILL");
    await waitForExit;
  }
}

export function normalizeBotId(raw) {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || null;
}

function summarizeBot(bot, runtimePid = null) {
  return {
    ...bot,
    status: runtimePid ? "running" : bot.status || "stopped",
    runtimePid,
  };
}

export async function readPidFile(filePath) {
  try {
    const raw = (await readFile(filePath, "utf8")).trim();
    const parsed = raw.startsWith("{") ? JSON.parse(raw) : raw;
    const pid = Number.parseInt(typeof parsed === "string" ? parsed : parsed?.pid, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function writePidFile(filePath) {
  await writeJson(filePath, { pid: process.pid, startedAt: nowIso() });
}

async function clearPidFile(filePath) {
  await rm(filePath, { force: true });
}

async function readRuntimePid(bot) {
  const raw = await readJson(getBotRuntimePidPath(bot.homePath), null);
  const pid = raw?.pid ?? null;
  return isPidRunning(pid) ? pid : null;
}

async function replaceRegistryBot(nextBot) {
  const registry = await readRegistry();
  registry.bots = registry.bots.map((bot) => (bot.id === nextBot.id ? { ...bot, ...nextBot } : bot));
  await writeRegistry(registry);
  return registry.bots.find((bot) => bot.id === nextBot.id);
}

async function markBotStoppedWithError(bot, errorMessage = null) {
  const config = await readConfig(bot.homePath);
  const nextConfig = {
    ...config,
    status: "stopped",
    observability: {
      ...config.observability,
      lastStoppedAt: nowIso(),
      lastError: errorMessage,
    },
  };
  await writeConfig(nextConfig, bot.homePath);
  await replaceRegistryBot({
    ...bot,
    enabled: nextConfig.enabled,
    desiredVersion: nextConfig.desiredVersion,
    runningVersion: nextConfig.runningVersion,
    status: "stopped",
    botUsername: nextConfig.channels?.telegram?.botUsername || bot.botUsername || "",
    lastError: errorMessage,
  });
}

async function getRegistryBotOrThrow(botId) {
  const registry = await readRegistry();
  const bot = registry.bots.find((entry) => entry.id === botId);
  if (!bot) {
    throw new Error(`Unknown bot: ${botId}`);
  }
  return bot;
}

export async function ensureDefaultBot() {
  await ensureControlPlaneHome();
  const registry = await readRegistry();
  const existing = registry.bots.find((bot) => bot.id === DEFAULT_BOT_ID);
  if (existing) {
    await ensureBotHome(existing.homePath);
    const config = await readConfig(existing.homePath);
    if (!config.observability?.logPath) {
      config.observability.logPath = getLogsPath(existing.homePath);
      await writeConfig(config, existing.homePath);
    }
    return existing;
  }
  return await createBot({ id: DEFAULT_BOT_ID, name: "Default", enabled: false });
}

export async function listBots() {
  await ensureDefaultBot();
  const registry = await readRegistry();
  const bots = [];
  for (const bot of registry.bots) {
    bots.push(summarizeBot(bot, await readRuntimePid(bot)));
  }
  return bots.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getBot(botId) {
  const bot = await getRegistryBotOrThrow(botId);
  const runtimePid = await readRuntimePid(bot);
  return summarizeBot(bot, runtimePid);
}

export async function getActiveBot() {
  return await getBot(await readActiveBotId());
}

export async function createBot({
  id,
  name,
  enabled = true,
  desiredVersion = "v1",
  channel = "telegram",
  botUsername = "",
  config = {},
} = {}) {
  const botId = normalizeBotId(id);
  if (!botId) {
    throw new Error("Bot id is required.");
  }
  await ensureControlPlaneHome();
  const registry = await readRegistry();
  if (registry.bots.find((bot) => bot.id === botId)) {
    throw new Error(`Bot already exists: ${botId}`);
  }

  const homePath = getBotPath(botId);
  await ensureBotHome(homePath);

  const nextConfig = {
    ...createDefaultBotConfig(),
    ...config,
    id: botId,
    name: name || botId,
    channel,
    enabled,
    desiredVersion,
    runningVersion: null,
    status: "stopped",
    observability: {
      ...createDefaultBotConfig().observability,
      ...(config.observability ?? {}),
      logPath: getLogsPath(homePath),
    },
  };
  if (botUsername) {
    nextConfig.channels.telegram.botUsername = botUsername;
  }
  await writeConfig(nextConfig, homePath);

  const entry = {
    id: botId,
    name: nextConfig.name,
    channel,
    homePath,
    enabled,
    desiredVersion,
    runningVersion: null,
    status: "stopped",
    botUsername: nextConfig.channels.telegram.botUsername || "",
    lastError: null,
  };
  registry.bots.push(entry);
  await writeRegistry(registry);
  return entry;
}

export async function updateBotConfig(botId, updater) {
  const bot = await getRegistryBotOrThrow(botId);
  const config = await readConfig(bot.homePath);
  const nextConfig = typeof updater === "function" ? await updater(config) : { ...config, ...updater };
  await writeConfig(nextConfig, bot.homePath);
  return await replaceRegistryBot({
    ...bot,
    name: nextConfig.name || bot.name,
    enabled: nextConfig.enabled ?? bot.enabled,
    desiredVersion: nextConfig.desiredVersion ?? bot.desiredVersion,
    runningVersion: nextConfig.runningVersion ?? bot.runningVersion,
    status: nextConfig.status ?? bot.status,
    botUsername: nextConfig.channels?.telegram?.botUsername || bot.botUsername || "",
    lastError: nextConfig.observability?.lastError || null,
  });
}

export async function setBotEnabled(botId, enabled) {
  return await updateBotConfig(botId, (config) => ({ ...config, enabled }));
}

export async function deleteBot(botId) {
  if (botId === DEFAULT_BOT_ID) {
    throw new Error("Default bot cannot be deleted.");
  }
  await stopBot(botId).catch(() => {});
  const registry = await readRegistry();
  const bot = registry.bots.find((entry) => entry.id === botId);
  if (!bot) {
    throw new Error(`Unknown bot: ${botId}`);
  }
  if ((await readActiveBotId()) === botId) {
    await writeActiveBotId(DEFAULT_BOT_ID);
  }
  registry.bots = registry.bots.filter((entry) => entry.id !== botId);
  await writeRegistry(registry);
  await rm(bot.homePath, { recursive: true, force: true });
}

export async function setActiveBot(botId) {
  const bot = await getRegistryBotOrThrow(botId);
  await writeActiveBotId(bot.id);
  return await getBot(bot.id);
}

export async function startBot(botId) {
  const bot = await getRegistryBotOrThrow(botId);
  const existingPid = await readRuntimePid(bot);
  if (existingPid) {
    return existingPid;
  }
  const config = await readConfig(bot.homePath);
  const telegram = config.channels?.telegram ?? {};
  if (bot.channel === "telegram" && (!telegram.enabled || !telegram.botToken)) {
    const errorMessage = `Bot ${botId} is not ready to start: Telegram is not configured.`;
    await markBotStoppedWithError(bot, errorMessage);
    throw new Error(errorMessage);
  }
  await ensureBotHome(bot.homePath);
  const runtimeLog = getBotRuntimeLogPath(bot.homePath);
  const logHandle = await open(runtimeLog, "a");
  const child = spawn(process.execPath, [BIN_PATH, "bot", "run", bot.id], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      AUTOAIDE_BOT_ID: bot.id,
      BOT_HOME: bot.homePath,
    },
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
  });
  child.unref();
  await logHandle.close();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const pid = await readRuntimePid(bot);
    if (pid) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const stablePid = await readRuntimePid(bot);
      if (stablePid === pid) {
        return pid;
      }
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await markBotStoppedWithError(bot, `Bot failed to start: ${botId}`);
  throw new Error(`Bot failed to start: ${botId}`);
}

export async function stopBot(botId) {
  const bot = await getRegistryBotOrThrow(botId);
  const pid = await readRuntimePid(bot);
  if (!pid) {
    await updateBotConfig(botId, (config) => ({
      ...config,
      status: "stopped",
      observability: {
        ...config.observability,
        lastStoppedAt: nowIso(),
      },
    }));
    return false;
  }
  process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!(await readRuntimePid(bot))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  process.kill(pid, "SIGKILL");
  await clearPidFile(getBotRuntimePidPath(bot.homePath));
  return true;
}

export async function restartBot(botId) {
  await stopBot(botId).catch(() => {});
  return await startBot(botId);
}

async function restartWithHealth(botId) {
  const pid = await restartBot(botId);
  const health = await healthCheckBot(botId);
  return {
    botId,
    ok: Boolean(health.healthy && pid),
    pid,
    healthy: health.healthy,
    status: health.status,
    runningVersion: health.runningVersion,
    desiredVersion: health.desiredVersion,
    lastError: health.lastError,
  };
}

export async function rollingRestartBots(botIds = null) {
  const targets = botIds?.length ? botIds : (await listBots()).filter((bot) => bot.enabled).map((bot) => bot.id);
  const results = [];
  for (const botId of targets) {
    try {
      results.push(await restartWithHealth(botId));
    } catch (error) {
      results.push({
        botId,
        ok: false,
        pid: null,
        healthy: false,
        error: error.message,
      });
      break;
    }
  }
  return results;
}

export async function canaryRollout(botIds, desiredVersion) {
  const results = [];
  for (const botId of botIds) {
    try {
      await updateBotConfig(botId, (config) => ({ ...config, desiredVersion }));
      results.push(await restartWithHealth(botId));
    } catch (error) {
      results.push({
        botId,
        ok: false,
        pid: null,
        healthy: false,
        desiredVersion,
        error: error.message,
      });
      break;
    }
  }
  return results;
}

export async function rollbackBot(botId, version) {
  await updateBotConfig(botId, (config) => ({ ...config, desiredVersion: version }));
  return await restartWithHealth(botId);
}

export async function inspectBot(botId) {
  const bot = await getRegistryBotOrThrow(botId);
  const config = await readConfig(bot.homePath);
  const runtimePid = await readRuntimePid(bot);
  return {
    bot: summarizeBot(bot, runtimePid),
    config,
    paths: {
      homePath: bot.homePath,
      configPath: getBotConfigPath(bot.homePath),
      runtimePidPath: getBotRuntimePidPath(bot.homePath),
      runtimeLogPath: getBotRuntimeLogPath(bot.homePath),
      bridgeLogPath: getTelegramBridgeLogPath(bot.homePath),
    },
  };
}

export async function runBotRuntime(botId) {
  const bot = await getRegistryBotOrThrow(botId);
  const botHome = resolveBotHome(bot.id);
  await ensureBotHome(botHome);

  const config = await readConfig(botHome);
  const telegram = config.channels?.telegram ?? {};
  if (bot.channel === "telegram" && (!telegram.enabled || !telegram.botToken)) {
    const errorMessage = `Bot ${botId} is not ready to run: Telegram is not configured.`;
    await markBotStoppedWithError(bot, errorMessage);
    throw new Error(errorMessage);
  }
  config.status = "running";
  config.runningVersion = config.desiredVersion;
  config.observability = {
    ...config.observability,
    lastError: null,
    lastStartedAt: nowIso(),
    logPath: getLogsPath(botHome),
  };
  await writeConfig(config, botHome);
  await replaceRegistryBot({
    ...bot,
    enabled: config.enabled,
    desiredVersion: config.desiredVersion,
    runningVersion: config.runningVersion,
    status: "running",
    botUsername: config.channels.telegram.botUsername || "",
    lastError: null,
  });

  await writePidFile(getBotRuntimePidPath(botHome));

  let exiting = false;
  let bridgeChild = null;
  const shutdown = async (signal = "SIGTERM") => {
    if (exiting) {
      return;
    }
    exiting = true;
    await terminateChildProcess(bridgeChild, signal === "SIGINT" ? "SIGINT" : "SIGTERM");
    const latest = await readConfig(botHome);
    latest.status = "stopped";
    latest.observability = {
      ...latest.observability,
      lastStoppedAt: nowIso(),
    };
    await writeConfig(latest, botHome);
    await replaceRegistryBot({
      ...bot,
      enabled: latest.enabled,
      desiredVersion: latest.desiredVersion,
      runningVersion: latest.runningVersion,
      status: "stopped",
      botUsername: latest.channels.telegram.botUsername || "",
      lastError: latest.observability?.lastError || null,
    });
    await clearPidFile(getBotRuntimePidPath(botHome));
    process.exit(signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("exit", () => {
    void clearPidFile(getBotRuntimePidPath(botHome));
  });

  const bridgeLog = await open(getTelegramBridgeLogPath(botHome), "a");
  const child = spawn(process.execPath, [path.join(__dirname, "..", "plugins", "telegram-codex", "telegram-codex-bridge.mjs")], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      AUTOAIDE_BOT_ID: bot.id,
      BOT_HOME: botHome,
    },
    stdio: ["ignore", bridgeLog.fd, bridgeLog.fd],
  });
  bridgeChild = child;
  await bridgeLog.close();

  child.on("exit", async (code, signal) => {
    const latest = await readConfig(botHome);
    latest.status = "stopped";
    latest.observability = {
      ...latest.observability,
      lastStoppedAt: nowIso(),
      lastError: code === 0 || signal === "SIGTERM" || signal === "SIGINT" ? null : `bridge exited (${code ?? signal})`,
    };
    await writeConfig(latest, botHome);
    await replaceRegistryBot({
      ...bot,
      enabled: latest.enabled,
      desiredVersion: latest.desiredVersion,
      runningVersion: latest.runningVersion,
      status: "stopped",
      botUsername: latest.channels.telegram.botUsername || "",
      lastError: latest.observability.lastError,
    });
    await clearPidFile(getBotRuntimePidPath(botHome));
    if (!exiting) {
      process.exit(code ?? 1);
    }
  });

  await new Promise(() => {});
}

export async function healthCheckBot(botId) {
  const bot = await getRegistryBotOrThrow(botId);
  const pid = await readRuntimePid(bot);
  const config = await readConfig(bot.homePath);
  const telegram = config.channels?.telegram ?? {};
  return {
    id: bot.id,
    healthy: Boolean(pid),
    status: pid ? "running" : config.status || bot.status || "stopped",
    pid,
    botUsername: telegram.botUsername || "",
    homePath: bot.homePath,
    runningVersion: config.runningVersion,
    desiredVersion: config.desiredVersion,
    lastStartedAt: config.observability?.lastStartedAt || null,
    lastStoppedAt: config.observability?.lastStoppedAt || null,
    lastError: config.observability?.lastError || null,
    runtimeLogPath: getBotRuntimeLogPath(bot.homePath),
    bridgeLogPath: getTelegramBridgeLogPath(bot.homePath),
  };
}

export async function readBotLogs(botId, lines = 100) {
  const bot = await getRegistryBotOrThrow(botId);
  const logPath = getBotRuntimeLogPath(bot.homePath);
  const raw = await readFile(logPath, "utf8").catch(() => "");
  const chunks = raw.trimEnd().split(/\r?\n/);
  return {
    logPath,
    content: chunks.slice(-lines).join("\n"),
  };
}

export async function botExists(botId) {
  try {
    await stat(getBotPath(botId));
    return true;
  } catch {
    return false;
  }
}
