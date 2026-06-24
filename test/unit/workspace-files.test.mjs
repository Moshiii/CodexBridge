import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { importFresh, withTempHome } from "../helpers/module.js";

function botHome(tempHome, botId = "default") {
  return path.join(tempHome, "bots", botId);
}

test("workspace files module lists, reads, and writes workspace files", async () => {
  await withTempHome(async (tempHome) => {
    const { ensureBotHome, getWorkspacePath } = await importFresh("../../src/config.mjs");
    const workspaceFiles = await importFresh("../../src/workspace-files.mjs");
    const home = botHome(tempHome);
    await ensureBotHome(home);

    const written = await workspaceFiles.writeWorkspaceFile(home, "notes.md", "# notes\n");
    assert.equal(written.path, "notes.md");
    assert.equal(written.content, "# notes\n");

    const read = await workspaceFiles.readWorkspaceFile(home, "notes.md");
    assert.equal(read.content, "# notes\n");

    await mkdir(path.join(getWorkspacePath(home), "memory"), { recursive: true });
    const files = await workspaceFiles.listWorkspaceFiles(home);
    assert.equal(files.some((entry) => entry.path === "memory"), false);
    const notes = files.find((entry) => entry.path === "notes.md");
    assert.equal(notes.type, "file");
    assert.equal(notes.size, 8);
    assert.match(notes.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("workspace files module rejects empty and parent-relative paths", async () => {
  await withTempHome(async (tempHome) => {
    const { ensureBotHome } = await importFresh("../../src/config.mjs");
    const { readWorkspaceFile, writeWorkspaceFile } = await importFresh("../../src/workspace-files.mjs");
    const home = botHome(tempHome);
    await ensureBotHome(home);

    await assert.rejects(() => readWorkspaceFile(home, ""), /Workspace file path is required/);
    await assert.rejects(() => writeWorkspaceFile(home, "../outside.md", "x"), /Workspace file path is required/);
  });
});

test("workspace files module summarizes new and updated files", async () => {
  const { summarizeWorkspaceChanges } = await importFresh("../../src/workspace-files.mjs");
  const changes = summarizeWorkspaceChanges(
    [
      { path: "same.md", type: "file", size: 4, updatedAt: "2026-01-01T00:00:00.000Z" },
      { path: "changed.md", type: "file", size: 4, updatedAt: "2026-01-01T00:00:00.000Z" },
    ],
    [
      { path: "same.md", type: "file", size: 4, updatedAt: "2026-01-01T00:00:00.000Z" },
      { path: "changed.md", type: "file", size: 8, updatedAt: "2026-01-01T00:00:01.000Z" },
      { path: "new.md", type: "file", size: 3, updatedAt: "2026-01-01T00:00:02.000Z" },
      { path: "folder", type: "dir", updatedAt: "2026-01-01T00:00:03.000Z" },
    ],
  );

  assert.deepEqual(changes.map((entry) => [entry.path, entry.changeType]), [
    ["new.md", "new"],
    ["changed.md", "updated"],
  ]);
});
