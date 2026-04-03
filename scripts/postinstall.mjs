#!/usr/bin/env node

import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";

const autoaideHome = process.env.AUTOAIDE_HOME?.trim() || path.join(os.homedir(), ".autoaide");
const controlDir = path.join(autoaideHome, "control");
const botsDir = path.join(autoaideHome, "bots");
const defaultBotDir = path.join(botsDir, "default");
const workspaceDir = path.join(defaultBotDir, "workspace");
const memoryDir = path.join(defaultBotDir, "memory");
const logsDir = path.join(autoaideHome, "logs");
const botLogsDir = path.join(defaultBotDir, "logs");
const telegramDir = path.join(defaultBotDir, "telegram");
const goalsDir = path.join(defaultBotDir, "goals");
const skillsDir = path.join(defaultBotDir, "skills");

await mkdir(controlDir, { recursive: true });
await mkdir(botsDir, { recursive: true });
await mkdir(defaultBotDir, { recursive: true });
await mkdir(workspaceDir, { recursive: true });
await mkdir(memoryDir, { recursive: true });
await mkdir(logsDir, { recursive: true });
await mkdir(botLogsDir, { recursive: true });
await mkdir(telegramDir, { recursive: true });
await mkdir(goalsDir, { recursive: true });
await mkdir(skillsDir, { recursive: true });

console.log(`AutoAide home ready: ${autoaideHome}`);
console.log(`Control plane ready: ${controlDir}`);
console.log(`Default bot ready: ${defaultBotDir}`);
console.log(`Default bot workspace ready: ${workspaceDir}`);
console.log(`Default bot telegram state ready: ${telegramDir}`);
