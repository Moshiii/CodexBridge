import path from "node:path";
import { readFile } from "node:fs/promises";
import { WORKSPACE_PATH } from "./config.mjs";

const DEFAULT_PRIVATE_FILES = ["SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md"];

async function readWorkspaceFile(filename) {
  const filePath = path.join(WORKSPACE_PATH, filename);
  try {
    const content = (await readFile(filePath, "utf8")).trim();
    return content ? { filename, content } : null;
  } catch {
    return null;
  }
}

function renderBootstrapContext(files) {
  if (!files.length) {
    return "";
  }

  const sections = files.map(({ filename, content }) => {
    return [`[${filename}]`, content].join("\n");
  });

  return [
    "[AutoAide Workspace Context]",
    "Use this as persistent workspace context.",
    "AGENTS.md may also be loaded natively by Codex from the current workspace.",
    "",
    ...sections,
  ].join("\n\n");
}

export async function buildWorkspacePrompt(userMessage, options = {}) {
  const filenames = options.files || DEFAULT_PRIVATE_FILES;
  const files = (await Promise.all(filenames.map(readWorkspaceFile))).filter(Boolean);
  const prefix = renderBootstrapContext(files);

  if (!prefix) {
    return userMessage;
  }

  return [prefix, "[User Message]", userMessage].join("\n\n");
}
