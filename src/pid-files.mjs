import { open, readFile, rm } from "node:fs/promises";

function nowIso() {
  return new Date().toISOString();
}

export function isPidRunning(pid) {
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
    const parsed = raw.startsWith("{") ? JSON.parse(raw) : raw;
    const pid = Number.parseInt(typeof parsed === "string" ? parsed : parsed?.pid, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function clearPidFile(filePath) {
  await rm(filePath, { force: true });
}

export async function writeCurrentPidFile(filePath, { conflictMessage = null } = {}) {
  const payload = `${JSON.stringify({ pid: process.pid, startedAt: nowIso() }, null, 2)}\n`;
  try {
    const handle = await open(filePath, "wx");
    try {
      await handle.writeFile(payload, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const existingPid = await readPidFile(filePath);
    if (existingPid && isPidRunning(existingPid)) {
      const message = typeof conflictMessage === "function"
        ? conflictMessage(existingPid)
        : conflictMessage;
      throw new Error(message || `Process already running with pid ${existingPid}`);
    }

    await clearPidFile(filePath);
    const handle = await open(filePath, "wx");
    try {
      await handle.writeFile(payload, "utf8");
    } finally {
      await handle.close();
    }
  }
}

export async function terminatePid(pid, { timeoutMs = 4000, pollMs = 150 } = {}) {
  if (!isPidRunning(pid)) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore hard-kill failures
  }
  return true;
}

export function requestChildStop(child, { signal = "SIGTERM", killDelayMs = 3000 } = {}) {
  if (!child || child.exitCode != null || child.killed) {
    return false;
  }
  try {
    child.kill(signal);
  } catch {
    return false;
  }
  setTimeout(() => {
    if (child.exitCode == null && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore hard-kill failures
      }
    }
  }, killDelayMs).unref?.();
  return true;
}

export async function terminateChildProcess(child, { signal = "SIGTERM", timeoutMs = 4000 } = {}) {
  if (!child || child.exitCode != null || child.killed) {
    return false;
  }

  const waitForExit = new Promise((resolve) => {
    child.once("exit", resolve);
  });

  try {
    child.kill(signal);
  } catch {
    return false;
  }

  await Promise.race([
    waitForExit,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (child.exitCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      return true;
    }
    await waitForExit;
  }
  return true;
}
