import path from "node:path";
import os from "node:os";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

import { ensureBotHome, getSkillsPath } from "./config.mjs";

function slugifySkillId(raw) {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || null;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function getDefaultSkillSources() {
  return {
    codex: path.join(os.homedir(), ".codex", "skills"),
    "claude-code": path.join(os.homedir(), ".claude", "skills"),
    gemini: path.join(os.homedir(), ".gemini", "skills"),
  };
}

function parseScalar(raw) {
  const value = raw.trim();
  if (!value) {
    return "";
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseYamlBlock(lines, startIndex, indent) {
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }
    const currentIndent = line.match(/^ */)?.[0].length ?? 0;
    if (currentIndent < indent) {
      return { value: {}, nextIndex: index };
    }
    break;
  }

  if (index >= lines.length) {
    return { value: {}, nextIndex: index };
  }

  const firstLine = lines[index];
  const firstTrimmed = firstLine.trim();
  if (firstTrimmed.startsWith("- ")) {
    const items = [];
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim() || line.trim().startsWith("#")) {
        index += 1;
        continue;
      }
      const currentIndent = line.match(/^ */)?.[0].length ?? 0;
      if (currentIndent < indent) {
        break;
      }
      if (currentIndent !== indent || !line.trim().startsWith("- ")) {
        break;
      }
      items.push(parseScalar(line.trim().slice(2)));
      index += 1;
    }
    return { value: items, nextIndex: index };
  }

  const object = {};
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }
    const currentIndent = line.match(/^ */)?.[0].length ?? 0;
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent !== indent) {
      break;
    }

    const trimmed = line.trim();
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      index += 1;
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const remainder = trimmed.slice(separator + 1).trim();
    if (remainder) {
      object[key] = parseScalar(remainder);
      index += 1;
      continue;
    }

    const nested = parseYamlBlock(lines, index + 1, indent + 2);
    object[key] = nested.value;
    index = nested.nextIndex;
  }

  return { value: object, nextIndex: index };
}

function extractFrontmatter(raw) {
  const normalized = String(raw || "");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const endIndex = normalized.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const frontmatterRaw = normalized.slice(4, endIndex).trimEnd();
  const body = normalized.slice(endIndex + 4).trim();
  const parsed = parseYamlBlock(frontmatterRaw.split(/\r?\n/), 0, 0).value;
  return {
    frontmatter: parsed && typeof parsed === "object" ? parsed : {},
    body,
  };
}

function formatCompatibility(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function inspectSkillSource(sourcePath) {
  const raw = await readFile(path.join(sourcePath, "SKILL.md"), "utf8");
  const { frontmatter, body } = extractFrontmatter(raw);
  const derivedId = slugifySkillId(frontmatter.name || path.basename(sourcePath));
  if (!derivedId) {
    throw new Error("Skill package is missing a valid name.");
  }
  if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
    throw new Error("Skill package is missing a description in SKILL.md frontmatter.");
  }

  return {
    id: derivedId,
    sourcePath,
    name: String(frontmatter.name).trim(),
    description: frontmatter.description.trim(),
    compatibility: formatCompatibility(frontmatter.compatibility),
    autoaide:
      frontmatter.metadata?.autoaide && typeof frontmatter.metadata.autoaide === "object"
        ? frontmatter.metadata.autoaide
        : {},
    body,
  };
}

export async function installSkillFromPath(sourcePath, options = {}) {
  await ensureBotHome();
  const source = path.resolve(sourcePath);
  const skillsPath = getSkillsPath();
  let installSource = source;
  let tempDir = null;

  if (source.toLowerCase().endsWith(".zip")) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "autoaide-skill-"));
    if (process.platform === "darwin") {
      await runCommand("/usr/bin/ditto", ["-x", "-k", source, tempDir]);
    } else {
      await runCommand("unzip", ["-q", source, "-d", tempDir]);
    }
    const entries = await readdir(tempDir, { withFileTypes: true });
    const firstDir = entries.find((entry) => entry.isDirectory());
    installSource = firstDir ? path.join(tempDir, firstDir.name) : tempDir;
  }

  const inspected = await inspectSkillSource(installSource);
  const destination = path.join(skillsPath, inspected.id);

  if (options.force) {
    await rm(destination, { recursive: true, force: true });
  }

  await cp(installSource, destination, {
    recursive: true,
    force: Boolean(options.force),
    errorOnExist: !options.force,
  });

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }

  return {
    ...inspected,
    sourcePath: source,
    storedPath: destination,
  };
}

export function formatSkillSources() {
  const sources = getDefaultSkillSources();
  return [
    "Known skill sources:",
    ...Object.entries(sources).map(([name, location]) => `- ${name}: ${location}`),
  ].join("\n");
}

export async function listSkills() {
  await ensureBotHome();
  const skillsPath = getSkillsPath();
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
          let raw;
          try {
            raw = await readFile(skillPath, "utf8");
          } catch {
            return null;
          }

          const { frontmatter } = extractFrontmatter(raw);
          return {
            id: entry.name,
            path: skillPath,
            name: typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : entry.name,
            description:
              typeof frontmatter.description === "string" && frontmatter.description.trim()
                ? frontmatter.description.trim()
                : "No description.",
            compatibility: formatCompatibility(frontmatter.compatibility),
            autoaide:
              frontmatter.metadata?.autoaide && typeof frontmatter.metadata.autoaide === "object"
                ? frontmatter.metadata.autoaide
                : {},
          };
        }),
    )
  ).filter(Boolean);

  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

export function formatSkillSummary(skill) {
  const tags = [];
  if (Array.isArray(skill.autoaide?.triggers) && skill.autoaide.triggers.length) {
    tags.push(`${skill.autoaide.triggers.length} triggers`);
  }
  if (skill.autoaide?.preferred_mode) {
    tags.push(`mode=${skill.autoaide.preferred_mode}`);
  }
  return `- ${skill.id}: ${skill.description}${tags.length ? ` [${tags.join(", ")}]` : ""}`;
}

export function formatSkillsList(skills) {
  if (!skills.length) {
    return `No skills installed yet.\n\nLocal path: ${getSkillsPath()}`;
  }

  return [
    `Installed skills (${skills.length}):`,
    ...skills.map(formatSkillSummary),
    "",
    `Local path: ${getSkillsPath()}`,
  ].join("\n");
}

export function formatSkillsOverview(skills) {
  const sections = [formatSkillsList(skills), "", formatSkillSources()];
  return sections.join("\n");
}

export function formatSkillInstallResult(installedSkill) {
  const lines = [
    `Imported skill: ${installedSkill.id}`,
    `Name: ${installedSkill.name}`,
    `Description: ${installedSkill.description}`,
    `Source: ${installedSkill.sourcePath}`,
    `Stored at: ${installedSkill.storedPath}`,
  ];

  if (installedSkill.compatibility) {
    lines.push(`Compatibility: ${installedSkill.compatibility}`);
  }

  return lines.join("\n");
}
