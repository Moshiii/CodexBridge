import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";

let sharedHomePromise = null;

async function getSharedHome() {
  if (!sharedHomePromise) {
    sharedHomePromise = mkdtemp(path.join(os.tmpdir(), "codexbridge-test-"));
  }
  return await sharedHomePromise;
}

export async function withTempHome(fn) {
  const previousHome = process.env.CODEXBRIDGE_HOME;
  const tempHome = await getSharedHome();
  process.env.CODEXBRIDGE_HOME = tempHome;

  try {
    const entries = await readdir(tempHome).catch(() => []);
    await Promise.all(
      entries.map((entry) => rm(path.join(tempHome, entry), { recursive: true, force: true })),
    );
    return await fn(tempHome);
  } finally {
    if (previousHome == null) {
      delete process.env.CODEXBRIDGE_HOME;
    } else {
      process.env.CODEXBRIDGE_HOME = previousHome;
    }
  }
}

export async function importFresh(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return await import(url.href);
}
