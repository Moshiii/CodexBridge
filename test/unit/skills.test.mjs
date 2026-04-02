import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { importFresh, withTempHome } from "../helpers/module.js";

test("listSkills reads SKILL.md frontmatter and formats the overview", async () => {
  await withTempHome(async (homePath) => {
    const skillDir = path.join(homePath, "skills", "demo-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: Demo Skill
description: Test skill for AutoAide.
compatibility: Requires a local workspace.
metadata:
  autoaide:
    preferred_mode: goal
    output_target: outbox
    triggers:
      - demo
      - test
---

# Demo

This is a test skill.
`,
      "utf8",
    );

    const { listSkills, formatSkillsList, formatSkillsOverview } = await importFresh("../../src/skills.mjs");
    const skills = await listSkills();

    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, "demo-skill");
    assert.equal(skills[0].name, "Demo Skill");
    assert.equal(skills[0].autoaide.preferred_mode, "goal");
    assert.deepEqual(skills[0].autoaide.triggers, ["demo", "test"]);
    assert.match(formatSkillsList(skills), /Installed skills \(1\):/);
    assert.match(formatSkillsOverview(skills), /Known skill sources:/);
  });
});

test("installSkillFromPath copies an external skill package into AutoAide home", async () => {
  await withTempHome(async (homePath) => {
    const sourceDir = path.join(homePath, "external-skill");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "SKILL.md"),
      `---
name: external-demo
description: External demo package.
---

# External Demo
`,
      "utf8",
    );

    const { installSkillFromPath, listSkills } = await importFresh("../../src/skills.mjs");
    const installed = await installSkillFromPath(sourceDir, { force: true });

    assert.equal(installed.id, "external-demo");
    assert.match(installed.storedPath, /skills\/external-demo$/);

    const skills = await listSkills();
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.id, "external-demo");
    assert.equal(skills[0]?.name, "external-demo");
  });
});
