import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
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
