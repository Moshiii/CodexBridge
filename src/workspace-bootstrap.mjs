import path from "node:path";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  WORKSPACE_PATH,
  createDefaultBootstrapState,
  readBootstrapState,
  writeBootstrapState,
} from "./config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "docs", "reference", "templates");
const CORE_SEED_FILES = [
  "AGENTS.md",
  "IDENTITY.md",
  "SOUL.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
];

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function seedFileIfMissing(filename) {
  const destinationPath = path.join(WORKSPACE_PATH, filename);
  if (await fileExists(destinationPath)) {
    return false;
  }

  const templatePath = path.join(TEMPLATE_DIR, filename);
  const content = await readFile(templatePath, "utf8");
  await writeFile(destinationPath, content, "utf8");
  return true;
}

function parseIdentityName(content) {
  const match = content.match(/^\s*-\s*\*\*Name:\*\*\s*([^\n]+)\s*$/m);
  const value = match?.[1]?.trim() || "";
  return value.startsWith("- **") ? "" : value;
}

function parseUserCallName(content) {
  const match = content.match(/^\s*-\s*\*\*What to call them:\*\*\s*([^\n]+)\s*$/m);
  const value = match?.[1]?.trim() || "";
  return value.startsWith("- **") ? "" : value;
}

function replaceBoldBullet(content, label, value) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(\\s*-\\s*\\*\\*${escapedLabel}:\\*\\*).*$`, "m");
  return content.replace(pattern, `$1 ${value}`);
}

export async function ensureWorkspaceBootstrap() {
  await mkdir(WORKSPACE_PATH, { recursive: true });
  await mkdir(path.join(WORKSPACE_PATH, "memory"), { recursive: true });

  const state = {
    ...createDefaultBootstrapState(),
    ...(await readBootstrapState()),
  };

  let seededAny = false;
  const seedFiles = state.completed === true ? CORE_SEED_FILES : [...CORE_SEED_FILES, "BOOTSTRAP.md"];
  for (const filename of seedFiles) {
    const seeded = await seedFileIfMissing(filename);
    seededAny = seededAny || seeded;
  }

  if (seededAny) {
    state.lastSeededAt = new Date().toISOString();
    if (state.completed !== true) {
      state.completed = false;
      state.completedAt = null;
    }
    await writeBootstrapState(state);
  }

  const bootstrapPath = path.join(WORKSPACE_PATH, "BOOTSTRAP.md");
  const identityPath = path.join(WORKSPACE_PATH, "IDENTITY.md");
  const userPath = path.join(WORKSPACE_PATH, "USER.md");

  const bootstrapExists = await fileExists(bootstrapPath);
  const identityContent = await readFile(identityPath, "utf8").catch(() => "");
  const userContent = await readFile(userPath, "utf8").catch(() => "");
  const identityName = parseIdentityName(identityContent);
  const userCallName = parseUserCallName(userContent);
  const identityReady = Boolean(identityName) && identityName !== "AutoAide";
  const userReady = Boolean(userCallName);
  const completed = state.completed === true && !bootstrapExists && identityReady && userReady;

  if (state.completed !== completed) {
    const nextState = {
      ...state,
      completed,
      completedAt: completed ? state.completedAt || new Date().toISOString() : null,
    };
    await writeBootstrapState(nextState);
    return {
      seededAny,
      bootstrapPending: !completed,
      state: nextState,
      identityReady,
      userReady,
      bootstrapExists,
    };
  }

  return {
    seededAny,
    bootstrapPending: !completed,
    state,
    identityReady,
    userReady,
    bootstrapExists,
  };
}

export async function completeBootstrap(answers) {
  const identityPath = path.join(WORKSPACE_PATH, "IDENTITY.md");
  const userPath = path.join(WORKSPACE_PATH, "USER.md");
  const soulPath = path.join(WORKSPACE_PATH, "SOUL.md");
  const bootstrapPath = path.join(WORKSPACE_PATH, "BOOTSTRAP.md");

  const identityContent = await readFile(identityPath, "utf8");
  const userContent = await readFile(userPath, "utf8");
  const soulContent = await readFile(soulPath, "utf8");

  const nextIdentity = [
    ["Name", answers.assistantName],
    ["Creature", answers.creature || "AI assistant"],
    ["Vibe", answers.vibe],
  ].reduce((content, [label, value]) => replaceBoldBullet(content, label, value), identityContent);

  const nextUser = [
    ["Name", answers.userName],
    ["What to call them", answers.userName],
  ].reduce((content, [label, value]) => replaceBoldBullet(content, label, value), userContent);

  const nextSoul = [
    "# SOUL.md",
    "",
    "## Core Stance",
    "",
    "Be useful without fluff.",
    "",
    "Be competent, calm, and direct.",
    "",
    "Do not perform helpfulness. Just help.",
    "",
    "## Working Style",
    "",
    `- Preferred tone: ${answers.vibe}`,
    `- Preferred assistant type: ${answers.assistantType}`,
    `- User preference summary: ${answers.userPreference}`,
    "- Prefer concrete action to vague promises",
    "- Read context before asking obvious questions",
    "- Keep answers concise by default",
    "",
    "## Boundaries",
    "",
    "- Be careful with actions that leave the machine",
    "- Be conservative with private user information",
    "- Do not pretend certainty you do not have",
    "- Ask when risk is real",
    "",
    "## Continuity",
    "",
    "If something matters later, it should be written to the workspace.",
  ].join("\n");

  await writeFile(identityPath, nextIdentity, "utf8");
  await writeFile(userPath, nextUser, "utf8");
  await writeFile(soulPath, nextSoul, "utf8");
  await rm(bootstrapPath, { force: true });

  const nextState = {
    ...createDefaultBootstrapState(),
    ...(await readBootstrapState()),
    completed: true,
    completedAt: new Date().toISOString(),
  };
  await writeBootstrapState(nextState);

  return await ensureWorkspaceBootstrap();
}
