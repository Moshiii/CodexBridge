import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { importFresh, withTempHome } from "../helpers/module.js";

test("control plane skills service lists skills with frontmatter fallback", async () => {
  await withTempHome(async (homePath) => {
    const botHome = path.join(homePath, "bots", "alpha");
    const skillsRoot = path.join(botHome, "skills");
    await mkdir(path.join(skillsRoot, "z-skill"), { recursive: true });
    await mkdir(path.join(skillsRoot, "a-skill"), { recursive: true });
    await writeFile(
      path.join(skillsRoot, "z-skill", "SKILL.md"),
      "name: Zed\n\ndescription: Last skill.\n",
      "utf8",
    );

    const service = await importFresh("../../src/control-plane-skills-service.mjs");
    const listed = await service.listControlPlaneSkills(botHome);

    assert.deepEqual(listed.map((skill) => skill.id), ["a-skill", "z-skill"]);
    assert.equal(listed[0].name, "a-skill");
    assert.equal(listed[0].description, "No description.");
    assert.equal(listed[1].name, "Zed");
    assert.equal(listed[1].description, "Last skill.");
  });
});

test("control plane skills service returns an empty list when skills directory is missing", async () => {
  await withTempHome(async (homePath) => {
    const service = await importFresh("../../src/control-plane-skills-service.mjs");

    const listed = await service.listControlPlaneSkills(path.join(homePath, "bots", "missing"));

    assert.deepEqual(listed, []);
  });
});

test("control plane skills service installs into the selected bot home", async () => {
  await withTempHome(async (homePath) => {
    const sourceDir = path.join(homePath, "source-skill");
    const botHome = path.join(homePath, "bots", "alpha");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "SKILL.md"),
      "---\nname: Installed Skill\ndescription: Installed from test.\n---\n\n# Installed Skill\n",
      "utf8",
    );

    const service = await importFresh("../../src/control-plane-skills-service.mjs");
    const installed = await service.installControlPlaneSkill(botHome, sourceDir);
    const listed = await service.listControlPlaneSkills(botHome);

    assert.equal(installed.id, "installed-skill");
    assert.match(installed.storedPath, /bots\/alpha\/skills\/installed-skill$/);
    assert.deepEqual(listed.map((skill) => skill.id), ["installed-skill"]);
  });
});
