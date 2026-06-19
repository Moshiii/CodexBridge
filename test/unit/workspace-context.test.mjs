import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { importFresh, withTempHome } from "../helpers/module.js";

function workspacePath(tempHome) {
  return path.join(tempHome, "bots", "default", "workspace");
}

test("buildWorkspacePrompt returns raw user input when no context files exist", async () => {
  await withTempHome(async () => {
    const { buildWorkspacePrompt } = await importFresh("../../src/workspace-context.mjs");
    const prompt = await buildWorkspacePrompt("hello");
    assert.equal(prompt, "hello");
  });
});

test("buildWorkspacePrompt injects default workspace files in stable order", async () => {
  await withTempHome(async (tempHome) => {
    const workspace = workspacePath(tempHome);
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "SOUL.md"), "Soul", "utf8");
    await writeFile(path.join(workspace, "IDENTITY.md"), "Identity", "utf8");
    await writeFile(path.join(workspace, "USER.md"), "User", "utf8");
    await writeFile(path.join(workspace, "TOOLS.md"), "Tools", "utf8");

    const { buildWorkspacePrompt } = await importFresh("../../src/workspace-context.mjs");
    const prompt = await buildWorkspacePrompt("do work");

    assert.match(prompt, /\[CodexBridge Workspace Context\]/);
    assert.match(prompt, /\[SOUL\.md\]\nSoul/);
    assert.match(prompt, /\[IDENTITY\.md\]\nIdentity/);
    assert.match(prompt, /\[USER\.md\]\nUser/);
    assert.match(prompt, /\[TOOLS\.md\]\nTools/);
    assert.match(prompt, /\[User Message\]\n\ndo work$/);

    assert.ok(prompt.indexOf("[SOUL.md]") < prompt.indexOf("[IDENTITY.md]"));
    assert.ok(prompt.indexOf("[IDENTITY.md]") < prompt.indexOf("[USER.md]"));
    assert.ok(prompt.indexOf("[USER.md]") < prompt.indexOf("[TOOLS.md]"));
  });
});

test("buildWorkspacePrompt ignores empty files and missing files", async () => {
  await withTempHome(async (tempHome) => {
    const workspace = workspacePath(tempHome);
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "SOUL.md"), "  ", "utf8");
    await writeFile(path.join(workspace, "USER.md"), "User notes", "utf8");

    const { buildWorkspacePrompt } = await importFresh("../../src/workspace-context.mjs");
    const prompt = await buildWorkspacePrompt("hi");

    assert.doesNotMatch(prompt, /\[SOUL\.md\]/);
    assert.match(prompt, /\[USER\.md\]\nUser notes/);
  });
});

test("buildWorkspacePrompt honors explicit file selection", async () => {
  await withTempHome(async (tempHome) => {
    const workspace = workspacePath(tempHome);
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "SOUL.md"), "Soul", "utf8");
    await writeFile(path.join(workspace, "USER.md"), "User", "utf8");

    const { buildWorkspacePrompt } = await importFresh("../../src/workspace-context.mjs");
    const prompt = await buildWorkspacePrompt("task", { files: ["USER.md"] });

    assert.doesNotMatch(prompt, /\[SOUL\.md\]/);
    assert.match(prompt, /\[USER\.md\]\nUser/);
  });
});
