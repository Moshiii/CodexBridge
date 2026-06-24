import path from "node:path";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";

import { getWorkspacePath } from "./config.mjs";
import { UserInputError } from "./errors.mjs";

async function listWorkspaceFilesFrom(entries, workspacePath, prefix = "") {
  const files = await Promise.all(entries.map(async (entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(workspacePath, relative);
    const metadata = await stat(absolute).catch(() => null);
    if (entry.isDirectory()) {
      return { path: relative, type: "dir", updatedAt: metadata?.mtime?.toISOString?.() || null };
    }
    return {
      path: relative,
      type: "file",
      size: metadata?.size ?? null,
      updatedAt: metadata?.mtime?.toISOString?.() || null,
    };
  }));
  return files;
}

function sanitizeWorkspacePath(relativePath) {
  const sanitized = path.normalize(String(relativePath || ""));
  if (!sanitized || sanitized === "." || sanitized.startsWith("..") || path.isAbsolute(sanitized)) {
    throw new UserInputError("Workspace file path is required.", { code: "workspace_path_required" });
  }
  return sanitized;
}

export async function listWorkspaceFiles(botHome) {
  const workspacePath = getWorkspacePath(botHome);
  const entries = await readdir(workspacePath, { withFileTypes: true }).catch(() => []);
  return (await listWorkspaceFilesFrom(entries, workspacePath))
    .filter((entry) => entry.path !== "memory")
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function readWorkspaceFile(botHome, relativePath) {
  const workspacePath = getWorkspacePath(botHome);
  const sanitized = sanitizeWorkspacePath(relativePath);
  const filePath = path.join(workspacePath, sanitized);
  return {
    path: sanitized,
    content: await readFile(filePath, "utf8"),
  };
}

export async function writeWorkspaceFile(botHome, relativePath, content) {
  const workspacePath = getWorkspacePath(botHome);
  const sanitized = sanitizeWorkspacePath(relativePath);
  const filePath = path.join(workspacePath, sanitized);
  await writeFile(filePath, String(content ?? ""), "utf8");
  return {
    path: sanitized,
    content: await readFile(filePath, "utf8"),
  };
}

export function summarizeWorkspaceChanges(beforeEntries, afterEntries) {
  const beforeByPath = new Map(
    beforeEntries
      .filter((entry) => entry.type === "file")
      .map((entry) => [entry.path, entry]),
  );
  return afterEntries
    .filter((entry) => entry.type === "file")
    .map((entry) => {
      const before = beforeByPath.get(entry.path);
      if (!before) {
        return { ...entry, changeType: "new" };
      }
      if (before.size !== entry.size || before.updatedAt !== entry.updatedAt) {
        return { ...entry, changeType: "updated" };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.changeType !== b.changeType) {
        return a.changeType === "new" ? -1 : 1;
      }
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
}
