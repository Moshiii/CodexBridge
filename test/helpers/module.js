import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";

let sharedHomePromise = null;

async function getSharedHome() {
  if (!sharedHomePromise) {
    sharedHomePromise = mkdtemp(path.join(os.tmpdir(), "autoaide-test-"));
  }
  return await sharedHomePromise;
}

export async function withTempHome(fn) {
  const previousHome = process.env.AUTOAIDE_HOME;
  const tempHome = await getSharedHome();
  process.env.AUTOAIDE_HOME = tempHome;

  try {
    const entries = await readdir(tempHome).catch(() => []);
    await Promise.all(
      entries.map((entry) => rm(path.join(tempHome, entry), { recursive: true, force: true })),
    );
    return await fn(tempHome);
  } finally {
    if (previousHome == null) {
      delete process.env.AUTOAIDE_HOME;
    } else {
      process.env.AUTOAIDE_HOME = previousHome;
    }
  }
}

export async function importFresh(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return await import(url.href);
}
