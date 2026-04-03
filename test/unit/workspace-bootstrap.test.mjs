import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { access, readFile, rm, writeFile } from "node:fs/promises";

import { importFresh, withTempHome } from "../helpers/module.js";

function workspacePath(tempHome) {
  return path.join(tempHome, "bots", "default", "workspace");
}

test("ensureWorkspaceBootstrap seeds workspace and reports bootstrap pending", async () => {
  await withTempHome(async (tempHome) => {
    const bootstrap = await importFresh("../../src/workspace-bootstrap.mjs");
    const result = await bootstrap.ensureWorkspaceBootstrap();

    assert.equal(result.bootstrapPending, true);
    assert.equal(result.bootstrapExists, true);
    assert.equal(result.identityReady, false);
    assert.equal(result.userReady, false);

    for (const filename of [
      "AGENTS.md",
      "IDENTITY.md",
      "SOUL.md",
      "USER.md",
      "TOOLS.md",
      "HEARTBEAT.md",
      "BOOTSTRAP.md",
    ]) {
      await access(path.join(workspacePath(tempHome), filename));
    }

    await access(path.join(workspacePath(tempHome), "memory"));
  });
});

test("completeBootstrap updates identity, user, soul, and removes BOOTSTRAP.md", async () => {
  await withTempHome(async (tempHome) => {
    const bootstrap = await importFresh("../../src/workspace-bootstrap.mjs");
    await bootstrap.ensureWorkspaceBootstrap();

    const result = await bootstrap.completeBootstrap({
      userName: "Moshi",
      assistantName: "Pearl",
      assistantType: "chief of staff",
      vibe: "direct and precise",
      userPreference: "keep it concise",
      creature: "fox",
    });

    assert.equal(result.bootstrapPending, false);
    assert.equal(result.bootstrapExists, false);
    assert.equal(result.identityReady, true);
    assert.equal(result.userReady, true);

    const identity = await readFile(path.join(workspacePath(tempHome), "IDENTITY.md"), "utf8");
    const user = await readFile(path.join(workspacePath(tempHome), "USER.md"), "utf8");
    const soul = await readFile(path.join(workspacePath(tempHome), "SOUL.md"), "utf8");

    assert.match(identity, /\*\*Name:\*\* Pearl/);
    assert.match(identity, /\*\*Creature:\*\* fox/);
    assert.match(identity, /\*\*Vibe:\*\* direct and precise/);
    assert.match(user, /\*\*Name:\*\* Moshi/);
    assert.match(user, /\*\*What to call them:\*\* Moshi/);
    assert.match(soul, /Preferred assistant type: chief of staff/);
    assert.match(soul, /User preference summary: keep it concise/);

    await assert.rejects(access(path.join(workspacePath(tempHome), "BOOTSTRAP.md")));
  });
});

test("ensureWorkspaceBootstrap stays pending when placeholders remain", async () => {
  await withTempHome(async (tempHome) => {
    const bootstrap = await importFresh("../../src/workspace-bootstrap.mjs");
    await bootstrap.ensureWorkspaceBootstrap();

    const identityPath = path.join(workspacePath(tempHome), "IDENTITY.md");
    const userPath = path.join(workspacePath(tempHome), "USER.md");
    await rm(path.join(workspacePath(tempHome), "BOOTSTRAP.md"), { force: true });
    await writeFile(
      identityPath,
      (await readFile(identityPath, "utf8")).replace(/(\*\*Name:\*\*).*/, "$1 AutoAide"),
      "utf8",
    );
    await writeFile(userPath, (await readFile(userPath, "utf8")).replace(/(\*\*What to call them:\*\*).*/, "$1 "), "utf8");

    const result = await bootstrap.ensureWorkspaceBootstrap();

    assert.equal(result.bootstrapPending, true);
    assert.equal(result.bootstrapExists, true);
    assert.equal(result.identityReady, false);
    assert.equal(result.userReady, false);
  });
});

test("ensureWorkspaceBootstrap does not overwrite edited files after completion", async () => {
  await withTempHome(async (tempHome) => {
    const bootstrap = await importFresh("../../src/workspace-bootstrap.mjs");
    await bootstrap.ensureWorkspaceBootstrap();
    await bootstrap.completeBootstrap({
      userName: "Moshi",
      assistantName: "Pearl",
      assistantType: "operator",
      vibe: "steady",
      userPreference: "be brief",
    });

    const identityPath = path.join(workspacePath(tempHome), "IDENTITY.md");
    await writeFile(identityPath, "# custom identity\n", "utf8");

    const result = await bootstrap.ensureWorkspaceBootstrap();
    const identity = await readFile(identityPath, "utf8");

    assert.equal(result.bootstrapPending, true);
    assert.equal(identity, "# custom identity\n");
  });
});
