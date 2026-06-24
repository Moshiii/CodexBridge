import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { importFresh } from "../helpers/module.js";

async function tempPidPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "codexbridge-pid-"));
  return path.join(dir, "runtime.pid");
}

test("pid files read legacy and JSON pid formats", async () => {
  const { readPidFile } = await importFresh("../../src/pid-files.mjs");
  const pidPath = await tempPidPath();

  await writeFile(pidPath, "123\n", "utf8");
  assert.equal(await readPidFile(pidPath), 123);

  await writeFile(pidPath, JSON.stringify({ pid: 456, startedAt: "now" }), "utf8");
  assert.equal(await readPidFile(pidPath), 456);

  await writeFile(pidPath, JSON.stringify({ pid: -1 }), "utf8");
  assert.equal(await readPidFile(pidPath), null);
});

test("pid files write current pid and replace stale pid files", async () => {
  const { readPidFile, writeCurrentPidFile } = await importFresh("../../src/pid-files.mjs");
  const pidPath = await tempPidPath();

  await writeCurrentPidFile(pidPath);
  assert.equal(await readPidFile(pidPath), process.pid);

  await writeFile(pidPath, JSON.stringify({ pid: 99999999 }), "utf8");
  await writeCurrentPidFile(pidPath);
  const raw = await readFile(pidPath, "utf8");

  assert.equal(await readPidFile(pidPath), process.pid);
  assert.match(raw, /startedAt/);
});

test("pid files reject a running existing pid", async () => {
  const { writeCurrentPidFile } = await importFresh("../../src/pid-files.mjs");
  const pidPath = await tempPidPath();

  await writeFile(pidPath, JSON.stringify({ pid: process.pid }), "utf8");

  await assert.rejects(
    () => writeCurrentPidFile(pidPath, {
      conflictMessage: (pid) => `already running: ${pid}`,
    }),
    new RegExp(`already running: ${process.pid}`),
  );
});

test("pid files terminate running pids with SIGTERM fallback flow", async () => {
  const { isPidRunning, terminatePid } = await importFresh("../../src/pid-files.mjs");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });

  try {
    assert.equal(isPidRunning(child.pid), true);
    assert.equal(await terminatePid(child.pid, { timeoutMs: 1000, pollMs: 20 }), true);
    assert.equal(isPidRunning(child.pid), false);
    assert.equal(await terminatePid(0), false);
  } finally {
    if (isPidRunning(child.pid)) {
      child.kill("SIGKILL");
    }
  }
});

test("pid files request child stop and schedule a hard kill", async () => {
  const { requestChildStop } = await importFresh("../../src/pid-files.mjs");
  const signals = [];
  const child = {
    exitCode: null,
    killed: false,
    kill(signal) {
      signals.push(signal);
      return true;
    },
  };

  assert.equal(requestChildStop(child, { killDelayMs: 5 }), true);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(requestChildStop({ ...child, killed: true }), false);
});
