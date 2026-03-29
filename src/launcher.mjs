import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";
import { DAEMON_LOG_PATH, PROJECT_ROOT, ensureAutoAideHome } from "./config.mjs";
import { isDaemonRunning } from "./daemon.mjs";
const BIN_PATH = path.join(PROJECT_ROOT, "bin", "autoaide.mjs");

export async function ensureDaemonRunning() {
  const existingPid = await isDaemonRunning();
  if (existingPid) {
    return existingPid;
  }

  await ensureAutoAideHome();
  const logHandle = await open(DAEMON_LOG_PATH, "a");

  const child = spawn(process.execPath, [BIN_PATH, "daemon"], {
    cwd: PROJECT_ROOT,
    env: process.env,
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
  });

  child.unref();
  await logHandle.close();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pid = await isDaemonRunning();
    if (pid) {
      return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("AutoAide daemon failed to start.");
}
