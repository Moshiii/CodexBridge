#!/usr/bin/env node

import path from "node:path";
import os from "node:os";
import { access, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const autoaideHome = process.env.AUTOAIDE_HOME?.trim() || path.join(os.homedir(), ".autoaide");
const workspaceDir = path.join(autoaideHome, "workspace");
const logsDir = path.join(autoaideHome, "logs");
const telegramDir = path.join(autoaideHome, "telegram");
const configPath = path.join(autoaideHome, "config.json");
const legacyConfigPath = path.join(repoRoot, ".autoaide", "config.json");

await mkdir(workspaceDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(telegramDir, { recursive: true });

try {
  await access(configPath);
} catch {
  try {
    await access(legacyConfigPath);
    await copyFile(legacyConfigPath, configPath);
    console.log(`Migrated config from: ${legacyConfigPath}`);
  } catch {
    // No legacy config to migrate.
  }
}

console.log(`AutoAide home ready: ${autoaideHome}`);
console.log(`Workspace ready: ${workspaceDir}`);
console.log(`Telegram state ready: ${telegramDir}`);
