import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startControlPlaneWebServer } from "./control-plane-web.mjs";
import {
  PROJECT_ROOT,
  ensureControlPlaneHome,
  getWebRuntimeLogPath,
  getWebRuntimePidPath,
  getWebRuntimeStatePath,
  readJson,
  writeJson,
} from "./config.mjs";
import { readPidFile } from "./bots.mjs";

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

function createDefaultWebRuntimeState() {
  return {
    version: 1,
    pid: null,
    host: "127.0.0.1",
    port: 8787,
    startedAt: null,
    status: "stopped",
    url: null,
    logPath: getWebRuntimeLogPath(),
  };
}

async function clearWebRuntimePid() {
  await rm(getWebRuntimePidPath(), { force: true });
}

async function clearStoppedState(previous = {}) {
  await writeJson(getWebRuntimeStatePath(), {
    ...createDefaultWebRuntimeState(),
    ...previous,
    pid: null,
    status: "stopped",
    url:
      previous.host && previous.port
        ? `http://${previous.host}:${previous.port}`
        : createDefaultWebRuntimeState().url,
  });
}

async function writeWebRuntimePid() {
  await open(getWebRuntimePidPath(), "wx")
    .then(async (handle) => {
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, startedAt: nowIso() }, null, 2)}\n`,
        "utf8",
      );
      await handle.close();
    })
    .catch(async (error) => {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const existingPid = await readPidFile(getWebRuntimePidPath());
      if (existingPid && isPidRunning(existingPid)) {
        throw new Error(`Web console already running with pid ${existingPid}`);
      }

      await clearWebRuntimePid();
      const retryHandle = await open(getWebRuntimePidPath(), "wx");
      await retryHandle.writeFile(
        `${JSON.stringify({ pid: process.pid, startedAt: nowIso() }, null, 2)}\n`,
        "utf8",
      );
      await retryHandle.close();
    });
}

export async function readWebRuntimeState() {
  await ensureControlPlaneHome();
  return {
    ...createDefaultWebRuntimeState(),
    ...((await readJson(getWebRuntimeStatePath(), createDefaultWebRuntimeState())) ?? {}),
    logPath: getWebRuntimeLogPath(),
  };
}

export async function getWebRuntimeStatus() {
  const state = await readWebRuntimeState();
  const pid = await readPidFile(getWebRuntimePidPath());
  const running = Boolean(pid && isPidRunning(pid));

  if (!running) {
    await clearWebRuntimePid();
    await clearStoppedState(state);
    return {
      ...state,
      pid: null,
      running: false,
      status: "stopped",
      url: state.host && state.port ? `http://${state.host}:${state.port}` : null,
      logPath: getWebRuntimeLogPath(),
    };
  }

  return {
    ...state,
    pid,
    running: true,
    status: "running",
    url: `http://${state.host}:${state.port}`,
    logPath: getWebRuntimeLogPath(),
  };
}

export async function runWebRuntime({ port = 8787, host = "127.0.0.1" } = {}) {
  await ensureControlPlaneHome();
  const runtime = await startControlPlaneWebServer({ port, host });
  const state = {
    version: 1,
    pid: process.pid,
    host: runtime.host,
    port: runtime.port,
    startedAt: nowIso(),
    status: "running",
    url: `http://${runtime.host}:${runtime.port}`,
    logPath: getWebRuntimeLogPath(),
  };

  await writeWebRuntimePid();
  await writeJson(getWebRuntimeStatePath(), state);

  let closed = false;
  const shutdown = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await runtime.close().catch(() => {});
    await clearWebRuntimePid();
    await clearStoppedState(state);
  };

  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("exit", () => {
    void clearWebRuntimePid();
  });

  return runtime;
}

export async function ensureWebRuntime({ port = 8787, host = "127.0.0.1" } = {}) {
  const status = await getWebRuntimeStatus();
  if (status.running) {
    return status;
  }

  await ensureControlPlaneHome();
  const out = createWriteStream(getWebRuntimeLogPath(), { flags: "a" });
  const child = spawn(process.execPath, [BIN_PATH, "web", "run", "--host", host, "--port", String(port)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.unref();

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const next = await getWebRuntimeStatus();
    if (next.running) {
      return next;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for web console to start");
}

export async function stopWebRuntime() {
  const status = await getWebRuntimeStatus();
  if (!status.running || !status.pid) {
    return {
      ...status,
      stopped: true,
    };
  }

  try {
    process.kill(status.pid, "SIGTERM");
  } catch {
    await clearWebRuntimePid();
    await clearStoppedState(status);
    return {
      ...(await getWebRuntimeStatus()),
      stopped: true,
    };
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const next = await getWebRuntimeStatus();
    if (!next.running) {
      return {
        ...next,
        stopped: true,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  try {
    process.kill(status.pid, "SIGKILL");
  } catch {
    // ignore hard-kill failures
  }

  await clearWebRuntimePid();
  await clearStoppedState(status);
  return {
    ...(await getWebRuntimeStatus()),
    stopped: true,
  };
}

export async function restartWebRuntime({ port = null, host = null } = {}) {
  const current = await getWebRuntimeStatus();
  const nextPort = port ?? current.port ?? 8787;
  const nextHost = host ?? current.host ?? "127.0.0.1";
  await stopWebRuntime();
  return await ensureWebRuntime({ port: nextPort, host: nextHost });
}
