import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { readFile, unlink, writeFile } from "node:fs/promises";
import {
  AUTOAIDE_HOME,
  DAEMON_PID_PATH,
  TELEGRAM_BRIDGE_PATH,
  TELEGRAM_BRIDGE_LOG_PATH,
  TELEGRAM_BRIDGE_PID_PATH,
  WORKSPACE_PATH,
  ensureAutoAideHome,
  readConfig,
} from "./config.mjs";

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

export async function readPidFile(filePath) {
  try {
    const raw = (await readFile(filePath, "utf8")).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function writePidFile(filePath) {
  await writeFile(filePath, `${process.pid}\n`, "utf8");
}

async function clearPidFile(filePath) {
  try {
    const current = (await readFile(filePath, "utf8")).trim();
    if (current === String(process.pid)) {
      await unlink(filePath);
    }
  } catch {
    // ignore cleanup errors
  }
}

export async function isDaemonRunning() {
  const pid = await readPidFile(DAEMON_PID_PATH);
  return isPidRunning(pid) ? pid : null;
}

function isProcessAlive(child) {
  return Boolean(child && !child.killed && child.exitCode == null);
}

async function stopChild(child) {
  if (isProcessAlive(child)) {
    child.kill("SIGTERM");
  }
}

async function startTelegramBridge(config) {
  const telegram = config.channels?.telegram;
  if (!telegram?.enabled || !telegram.botToken || !(telegram.allowedChatIds ?? []).length) {
    return null;
  }

  await ensureAutoAideHome();
  const logHandle = await open(TELEGRAM_BRIDGE_LOG_PATH, "a");
  const child = spawn(
    process.env.SHELL || "zsh",
    ["-lc", `node "${TELEGRAM_BRIDGE_PATH}"`],
    {
      cwd: WORKSPACE_PATH,
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: telegram.botToken,
        TELEGRAM_ALLOWED_CHAT_IDS: telegram.allowedChatIds.join(","),
        TELEGRAM_ALLOWED_GROUP_CHAT_IDS: (telegram.allowedGroupChatIds ?? []).join(","),
        TELEGRAM_ALLOWED_GROUP_USER_IDS: (telegram.allowedGroupUserIds ?? []).join(","),
        TELEGRAM_BOT_USERNAME: telegram.botUsername || "",
        AUTOAIDE_HOME,
        TELEGRAM_BRIDGE_PID_FILE: TELEGRAM_BRIDGE_PID_PATH,
        CODEX_CWD: process.env.CODEX_CWD?.trim() || WORKSPACE_PATH,
        CODEX_START_COMMAND:
          process.env.CODEX_START_COMMAND?.trim() ||
          "codex exec --skip-git-repo-check --json -",
        CODEX_RESUME_COMMAND_TEMPLATE:
          process.env.CODEX_RESUME_COMMAND_TEMPLATE?.trim() ||
          "codex exec resume --skip-git-repo-check --json __SESSION_ID__ -",
      },
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    },
  );
  await logHandle.close();
  return child;
}

function telegramSignature(config) {
  const telegram = config.channels?.telegram;
  return JSON.stringify({
    enabled: Boolean(telegram?.enabled),
    botToken: telegram?.botToken || "",
    allowedChatIds: telegram?.allowedChatIds || [],
    allowedGroupChatIds: telegram?.allowedGroupChatIds || [],
    allowedGroupUserIds: telegram?.allowedGroupUserIds || [],
    botUsername: telegram?.botUsername || "",
  });
}

export async function runDaemon() {
  await ensureAutoAideHome();
  const existingPid = await isDaemonRunning();
  if (existingPid) {
    console.log(`autoaide daemon already running: ${existingPid}`);
    return;
  }
  await writePidFile(DAEMON_PID_PATH);

  let bridgeProcess = null;
  let lastTelegramSignature = null;
  let stopped = false;

  async function shutdown() {
    if (stopped) {
      return;
    }
    stopped = true;
    await stopChild(bridgeProcess);
    await clearPidFile(DAEMON_PID_PATH);
    process.exit(0);
  }

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("exit", () => {
    void clearPidFile(DAEMON_PID_PATH);
  });

  console.log("autoaide daemon started");
  console.log(`home: ${AUTOAIDE_HOME}`);

  while (true) {
    const config = await readConfig();
    const nextSignature = telegramSignature(config);

    if (nextSignature !== lastTelegramSignature) {
      await stopChild(bridgeProcess);
      bridgeProcess = await startTelegramBridge(config);
      lastTelegramSignature = nextSignature;
    } else if (lastTelegramSignature && !isProcessAlive(bridgeProcess)) {
      bridgeProcess = await startTelegramBridge(config);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
