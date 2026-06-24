import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

import { getSkillsPath } from "./config.mjs";
import { installSkillFromPath } from "./skills.mjs";

async function withBotHome(botHome, work) {
  const previousBotHome = process.env.BOT_HOME;
  process.env.BOT_HOME = botHome;
  try {
    return await work();
  } finally {
    if (previousBotHome == null) {
      delete process.env.BOT_HOME;
    } else {
      process.env.BOT_HOME = previousBotHome;
    }
  }
}

function readFrontmatterValue(raw, field) {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "m");
  return raw.match(pattern)?.[1]?.trim() || "";
}

export async function listControlPlaneSkills(botHome) {
  const skillsPath = getSkillsPath(botHome);
  let entries = [];
  try {
    entries = await readdir(skillsPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const skillPath = path.join(skillsPath, entry.name, "SKILL.md");
          const raw = await readFile(skillPath, "utf8").catch(() => "");
          return {
            id: entry.name,
            name: readFrontmatterValue(raw, "name") || entry.name,
            description: readFrontmatterValue(raw, "description") || "No description.",
            path: skillPath,
          };
        }),
    )
  ).filter(Boolean);
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

export async function installControlPlaneSkill(botHome, sourcePath) {
  return await withBotHome(botHome, async () => await installSkillFromPath(sourcePath, { force: true }));
}
