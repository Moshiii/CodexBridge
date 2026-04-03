#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdir, open, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  getTelegramStatePath,
  getTelegramBridgePidPath,
  getWorkspacePath,
  readConfig,
  resolveBotHome,
  writeConfig,
} from "../../src/config.mjs";
import { buildWorkspacePrompt } from "../../src/workspace-context.mjs";
import { buildCommandConfig as buildRunnerCommandConfig, startCliTurn } from "../../src/codex-runner.mjs";
import { cronMatchesDate, minuteKey, parseCronExpression } from "../../src/cron-utils.mjs";
import { startGoalRun } from "../../src/goal-runner.mjs";
import { parseNaturalLanguageSchedule } from "../../src/schedule-intents.mjs";
import {
  formatSkillInstallResult,
  formatSkillsOverview,
  installSkillFromPath,
  listSkills,
} from "../../src/skills.mjs";
import {
  appendGoalHistory,
  createGoalRecord,
  listGoals,
  readGoal,
  writeGoal,
} from "../../src/goals-state.mjs";
import {
  createScheduleRecord,
  getScheduleById,
  listSchedules,
  readSchedulesState,
  upsertSchedule,
  writeSchedulesState,
} from "../../src/schedules-state.mjs";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_SECONDS = 30;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_BOT_HOME = resolveBotHome();
const DEFAULT_STATE_DIR = getTelegramStatePath(DEFAULT_BOT_HOME);
const DEFAULT_OFFSET_PATH = path.join(DEFAULT_STATE_DIR, "offset.json");
const DEFAULT_ROUTER_STATE_PATH = path.join(DEFAULT_STATE_DIR, "sessions.json");
const DEFAULT_PID_PATH = getTelegramBridgePidPath(DEFAULT_BOT_HOME);
const DEFAULT_MAIN_SESSION_LABEL = "main";
const DEFAULT_MAIN_SESSION_DISPLAY = "personal-chief-of-staff";
const DEFAULT_CODEX_START_COMMAND = "codex exec --skip-git-repo-check --json -";
const DEFAULT_CODEX_RESUME_TEMPLATE =
  "codex exec resume --skip-git-repo-check --json __SESSION_ID__ -";
const DEFAULT_UPLOAD_DIR_NAME = "inbox";
const DEFAULT_DOWNLOAD_DIRS = ["inbox", "outbox", "exports"];
const AUTOAIDE_BIN_PATH = path.join(__dirname, "..", "..", "bin", "autoaide.mjs");

function getShellSpec() {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c"],
    };
  }
  return {
    command: process.env.SHELL || "zsh",
    args: ["-lc"],
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function commandHasModel(command) {
  return /(^|\s)(-m|--model)\s/.test(command) || /(^|\s)(-c|--config)\s+model=/.test(command);
}

function applyModelToCommand(command, model) {
  if (!model || commandHasModel(command)) {
    return command;
  }
  return `${command} --model ${shellQuote(model)}`;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseAllowedChatIds(raw) {
  if (!raw?.trim()) {
    return null;
  }
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseAllowedUserIds(raw) {
  if (!raw?.trim()) {
    return null;
  }
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function getMessageText(message) {
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  if (typeof message.caption === "string" && message.caption.trim()) {
    return message.caption.trim();
  }
  return "";
}

function getMessageEntities(message) {
  if (typeof message.text === "string" && message.text.trim()) {
    return Array.isArray(message.entities) ? message.entities : [];
  }
  if (typeof message.caption === "string" && message.caption.trim()) {
    return Array.isArray(message.caption_entities) ? message.caption_entities : [];
  }
  return [];
}

function isGroupChat(message) {
  const chatType = message?.chat?.type;
  return chatType === "group" || chatType === "supergroup";
}

function extractBotMention(messageText, entities, botUsername) {
  if (!messageText || !botUsername) {
    return null;
  }
  const normalizedUsername = botUsername.replace(/^@+/, "").toLowerCase();
  for (const entity of entities || []) {
    if (entity?.type !== "mention") {
      continue;
    }
    const mentionText = messageText.slice(entity.offset, entity.offset + entity.length);
    if (mentionText.replace(/^@+/, "").toLowerCase() === normalizedUsername) {
      return {
        offset: entity.offset,
        length: entity.length,
        text: mentionText,
      };
    }
  }
  return null;
}

function stripExplicitBotMention(messageText, mention) {
  if (!messageText || !mention) {
    return messageText;
  }
  return `${messageText.slice(0, mention.offset)} ${messageText.slice(mention.offset + mention.length)}`
    .replace(/\s+/g, " ")
    .trim();
}

function truncateTelegramText(text) {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }
  return `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 24)}\n\n[output truncated]`;
}

function sanitizeFilename(raw, fallback = "upload.bin") {
  const cleaned = (raw || fallback)
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "unknown size";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function slugifySessionLabel(raw) {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || null;
}

function renderRunningMessage(prompt, sessionLabel, mode) {
  return `Running ${mode} on [${sessionLabel}]...`;
}

function renderStopRequestedMessage(sessionLabel) {
  return `Stop requested for [${sessionLabel}].`;
}

function logBridgeEvent(message, details = null) {
  const timestamp = new Date().toISOString();
  if (details == null) {
    console.log(`[${timestamp}] ${message}`);
    return;
  }
  console.log(`[${timestamp}] ${message}`, details);
}

function buildCommandConfig(model = "gpt-5.4") {
  const startCommand = process.env.CODEX_START_COMMAND?.trim();
  const resumeTemplate = process.env.CODEX_RESUME_COMMAND_TEMPLATE?.trim();

  if (startCommand) {
    return {
      startCommand: applyModelToCommand(startCommand, model),
      resumeTemplate: applyModelToCommand(resumeTemplate || DEFAULT_CODEX_RESUME_TEMPLATE, model),
    };
  }

  return {
    startCommand: applyModelToCommand(DEFAULT_CODEX_START_COMMAND, model),
    resumeTemplate: applyModelToCommand(DEFAULT_CODEX_RESUME_TEMPLATE, model),
  };
}

function buildGoalCommandConfig() {
  return buildRunnerCommandConfig({
    model: process.env.AUTOAIDE_MODEL?.trim() || "gpt-5.4",
  });
}

async function resolveBotRuntimeContext() {
  const botHome = resolveBotHome();
  const config = await readConfig(botHome);
  const telegram = config.channels?.telegram ?? {};
  return {
    botHome,
    token: telegram.botToken || process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
    botUsername: (telegram.botUsername || process.env.TELEGRAM_BOT_USERNAME?.trim() || "")
      .replace(/^@+/, "") || null,
    allowedChatIds:
      parseAllowedChatIds((telegram.private?.allowedChatIds ?? []).join(",")) ||
      parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    allowedGroupChatIds:
      parseAllowedChatIds((telegram.groups?.allowedChatIds ?? []).join(",")) ||
      parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_GROUP_CHAT_IDS),
    allowedGroupUserIds:
      parseAllowedUserIds((telegram.groups?.allowedUserIds ?? []).join(",")) ||
      parseAllowedUserIds(process.env.TELEGRAM_ALLOWED_GROUP_USER_IDS),
    codexCwd: getWorkspacePath(botHome),
    model: process.env.AUTOAIDE_MODEL?.trim() || config.runtime?.model || "gpt-5.4",
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writePidFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const handle = await open(filePath, "wx");
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.close();
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const existingPid = await readPidFile(filePath);
    if (existingPid) {
      try {
        process.kill(existingPid, 0);
        throw new Error(`Telegram bridge already running with pid ${existingPid}`);
      } catch (pidError) {
        if (pidError?.code !== "ESRCH") {
          throw pidError;
        }
      }
    }

    await clearPidFile(filePath);
    const retryHandle = await open(filePath, "wx");
    await retryHandle.writeFile(`${process.pid}\n`, "utf8");
    await retryHandle.close();
  }
}

async function clearPidFile(filePath) {
  try {
    const currentPid = (await readFile(filePath, "utf8")).trim();
    if (currentPid === String(process.pid)) {
      await unlink(filePath);
    }
  } catch {
    // ignore pid cleanup failures
  }
}

async function readOffset(statePath) {
  const parsed = await readJsonFile(statePath, null);
  return Number.isInteger(parsed?.offset) ? parsed.offset : null;
}

async function writeOffset(statePath, offset) {
  await writeJsonFile(statePath, { offset });
}

async function readPidFile(filePath) {
  try {
    const raw = (await readFile(filePath, "utf8")).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function createDefaultRouterState() {
  return {
    version: 1,
    chats: {},
    sessions: {
      [DEFAULT_MAIN_SESSION_LABEL]: {
        label: DEFAULT_MAIN_SESSION_LABEL,
        displayLabel: DEFAULT_MAIN_SESSION_DISPLAY,
        backend: "codex",
        cliSessionRef: null,
        isMain: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

async function readRouterState(filePath) {
  const parsed = await readJsonFile(filePath, createDefaultRouterState());
  const state =
    parsed && typeof parsed === "object"
      ? {
          version: 1,
          chats: parsed.chats && typeof parsed.chats === "object" ? parsed.chats : {},
          sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
        }
      : createDefaultRouterState();

  if (!state.sessions[DEFAULT_MAIN_SESSION_LABEL]) {
    state.sessions[DEFAULT_MAIN_SESSION_LABEL] = createDefaultRouterState().sessions.main;
  }

  return state;
}

async function writeRouterState(filePath, state) {
  await writeJsonFile(filePath, state);
}

function ensureChatState(state, chatId) {
  if (!state.chats[chatId]) {
    state.chats[chatId] = {
      activeSessionLabel: DEFAULT_MAIN_SESSION_LABEL,
      updatedAt: new Date().toISOString(),
    };
  }
  return state.chats[chatId];
}

async function captureTelegramMetadata(botHome, message) {
  const chatId = String(message?.chat?.id ?? "");
  const senderId = message?.from?.id != null ? String(message.from.id) : null;
  if (!chatId) {
    return;
  }

  const nextChatMeta = {
    type: message.chat?.type || null,
    title: message.chat?.title || null,
    username: message.chat?.username || null,
    label:
      message.chat?.title ||
      (message.chat?.username ? `@${message.chat.username.replace(/^@+/, "")}` : null),
  };
  const nextUserMeta = senderId
    ? {
        username: message.from?.username || null,
        label: message.from?.username ? `@${message.from.username.replace(/^@+/, "")}` : null,
      }
    : null;

  const config = await readConfig(botHome);
  const telegram = config.channels?.telegram ?? {};
  const chats = telegram.metadata?.chats ?? {};
  const users = telegram.metadata?.users ?? {};
  const currentChatMeta = chats[chatId] ?? {};
  const currentUserMeta = senderId ? users[senderId] ?? {} : null;
  const chatChanged =
    currentChatMeta.label !== nextChatMeta.label ||
    currentChatMeta.title !== nextChatMeta.title ||
    currentChatMeta.username !== nextChatMeta.username ||
    currentChatMeta.type !== nextChatMeta.type;
  const userChanged =
    senderId &&
    (currentUserMeta.label !== nextUserMeta.label || currentUserMeta.username !== nextUserMeta.username);

  if (!chatChanged && !userChanged) {
    return;
  }

  await writeConfig({
    ...config,
    channels: {
      ...config.channels,
      telegram: {
        ...telegram,
        metadata: {
          chats: {
            ...chats,
            [chatId]: {
              ...currentChatMeta,
              ...nextChatMeta,
            },
          },
          users: senderId
            ? {
                ...users,
                [senderId]: {
                  ...currentUserMeta,
                  ...nextUserMeta,
                },
              }
            : users,
        },
      },
    },
  }, botHome);
}

function ensureMainSession(state) {
  if (!state.sessions[DEFAULT_MAIN_SESSION_LABEL]) {
    state.sessions[DEFAULT_MAIN_SESSION_LABEL] = createDefaultRouterState().sessions.main;
  }
  return state.sessions[DEFAULT_MAIN_SESSION_LABEL];
}

function getActiveSessionLabel(state, chatId) {
  ensureMainSession(state);
  const chatState = ensureChatState(state, chatId);
  return typeof chatState.activeSessionLabel === "string" && state.sessions[chatState.activeSessionLabel]
    ? chatState.activeSessionLabel
    : DEFAULT_MAIN_SESSION_LABEL;
}

function setActiveSessionLabel(state, chatId, label) {
  const chatState = ensureChatState(state, chatId);
  chatState.activeSessionLabel = label;
  chatState.updatedAt = new Date().toISOString();
}

function formatSessionList(state, chatId) {
  const activeLabel = getActiveSessionLabel(state, chatId);
  const sessions = Object.values(state.sessions).sort((a, b) => a.label.localeCompare(b.label));
  return [
    "Sessions:",
    ...sessions.map((session) => {
      const tags = [
        session.label === activeLabel ? "active" : null,
        session.isMain ? "main" : null,
        session.cliSessionRef ? "started" : "empty",
      ].filter(Boolean);
      return `- ${session.label}${session.displayLabel ? ` (${session.displayLabel})` : ""} [${tags.join(", ")}]`;
    }),
  ].join("\n");
}

function formatWhere(state, chatId) {
  const label = getActiveSessionLabel(state, chatId);
  const session = state.sessions[label];
  const cliState = session.cliSessionRef ? `resume=${session.cliSessionRef}` : "resume=not-started";
  return `Current session: ${session.label}${session.isMain ? " [main]" : ""}\nBackend: ${session.backend}\n${cliState}`;
}

function formatStatus(state, chatId, runningJobs) {
  const label = getActiveSessionLabel(state, chatId);
  const session = state.sessions[label];
  const job = findRunningJob(runningJobs, chatId, label);

  return [
    `Current session: ${session.label}${session.isMain ? " [main]" : ""}`,
    `Backend: ${session.backend}`,
    `Resume: ${session.cliSessionRef ? session.cliSessionRef : "not-started"}`,
    `Running: ${job ? "yes" : "no"}`,
    ...(job ? [`State: ${job.stopRequested ? "stopping" : "running"}`] : []),
  ].join("\n");
}

async function telegramRequest(token, method, body) {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(
      `Telegram API ${method} failed with HTTP ${response.status}${
        payload?.description ? `: ${payload.description}` : ""
      }`,
    );
  }
  if (!payload.ok) {
    throw new Error(`Telegram API ${method} error: ${payload.description ?? "unknown error"}`);
  }
  return payload.result;
}

function isTelegramReplyReferenceError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("http 400") || message.includes("reply message not found");
}

async function telegramApiGet(token, method, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) {
      continue;
    }
    params.set(key, String(value));
  }
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram API ${method} error: ${payload.description ?? "unknown error"}`);
  }
  return payload.result;
}

async function getUpdates(token, offset) {
  return await telegramRequest(token, "getUpdates", {
    offset,
    timeout: POLL_TIMEOUT_SECONDS,
    allowed_updates: ["message"],
  });
}

async function sendMessage(token, chatId, text, replyToMessageId) {
  const payload = {
    chat_id: chatId,
    text: truncateTelegramText(text),
    reply_parameters:
      typeof replyToMessageId === "number"
        ? { message_id: replyToMessageId }
        : undefined,
  };

  try {
    return await telegramRequest(token, "sendMessage", payload);
  } catch (error) {
    if (!payload.reply_parameters || !isTelegramReplyReferenceError(error)) {
      throw error;
    }
    logBridgeEvent("telegram sendMessage retry without reply_parameters", {
      chatId: String(chatId),
      replyToMessageId,
      error: error.message,
    });
    delete payload.reply_parameters;
    return await telegramRequest(token, "sendMessage", payload);
  }
}

async function editMessageText(token, chatId, messageId, text) {
  try {
    return await telegramRequest(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: truncateTelegramText(text),
    });
  } catch (error) {
    if (String(error.message || "").includes("message is not modified")) {
      return null;
    }
    throw error;
  }
}

async function deleteMessage(token, chatId, messageId) {
  try {
    return await telegramRequest(token, "deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("message to delete not found")) {
      return null;
    }
    throw error;
  }
}

async function sendDocument(token, chatId, filePath, replyToMessageId, caption = "") {
  const fileBuffer = await readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
  }
  if (typeof replyToMessageId === "number") {
    form.append("reply_parameters", JSON.stringify({ message_id: replyToMessageId }));
  }
  form.append("document", new Blob([fileBuffer]), path.basename(filePath));

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Telegram API sendDocument failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram API sendDocument error: ${payload.description ?? "unknown error"}`);
  }
  return payload.result;
}

export function buildBotRuntimeRestartCommand(botId, botHome) {
  const logPath = path.join(botHome, "logs", "runtime.log");
  return `sleep 1; node "${AUTOAIDE_BIN_PATH}" bot restart "${botId}" >> "${logPath}" 2>&1`;
}

export function scheduleBotRuntimeRestart(botId, botHome) {
  const shellSpec = getShellSpec();
  const command = buildBotRuntimeRestartCommand(botId, botHome);
  const child = spawn(shellSpec.command, [...shellSpec.args, command], {
    cwd: botHome,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function resolveWorkspacePaths(cwd) {
  const workspaceRoot = path.resolve(cwd);
  const uploadDir = path.join(workspaceRoot, DEFAULT_UPLOAD_DIR_NAME);
  const downloadRoots = DEFAULT_DOWNLOAD_DIRS.map((name) => [name, path.join(workspaceRoot, name)]);

  await mkdir(uploadDir, { recursive: true });
  for (const [, dirPath] of downloadRoots) {
    await mkdir(dirPath, { recursive: true });
  }

  return {
    workspaceRoot,
    uploadDir,
    downloadRoots: new Map(downloadRoots),
  };
}

function toWorkspaceRelativePath(workspaceRoot, absolutePath) {
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join("/");
}

function resolveDownloadPath(workspacePaths, rawRelativePath) {
  const trimmed = rawRelativePath.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\0")) {
    return null;
  }

  const normalized = path.posix.normalize(trimmed);
  if (normalized.startsWith("../") || normalized === "..") {
    return null;
  }

  const parts = normalized.split("/");
  const rootName = parts.shift();
  if (!rootName || !workspacePaths.downloadRoots.has(rootName)) {
    return null;
  }

  const baseDir = workspacePaths.downloadRoots.get(rootName);
  const resolved = path.resolve(baseDir, ...parts);
  const allowedRoot = path.resolve(baseDir);
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`) && resolved !== allowedRoot) {
    return null;
  }

  return resolved;
}

async function fetchTelegramFile(token, fileId) {
  const fileInfo = await telegramApiGet(token, "getFile", { file_id: fileId });
  if (!fileInfo?.file_path) {
    throw new Error("Telegram did not return a downloadable file path.");
  }
  const response = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${fileInfo.file_path}`);
  if (!response.ok) {
    throw new Error(`Telegram file download failed with HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    filePath: fileInfo.file_path,
    fileSize: fileInfo.file_size ?? null,
  };
}

async function saveUploadedDocument(message, token, workspacePaths) {
  const document = message.document;
  if (!document?.file_id) {
    return null;
  }

  const downloaded = await fetchTelegramFile(token, document.file_id);
  const originalName = document.file_name || path.basename(downloaded.filePath) || "upload.bin";
  const safeName = sanitizeFilename(originalName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalName = `${timestamp}-${safeName}`;
  const absolutePath = path.join(workspacePaths.uploadDir, finalName);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, downloaded.buffer);

  return {
    absolutePath,
    relativePath: toWorkspaceRelativePath(workspacePaths.workspaceRoot, absolutePath),
    fileName: finalName,
    originalName,
    fileSize: document.file_size ?? downloaded.fileSize,
    mimeType: document.mime_type ?? null,
  };
}

async function listWorkspaceFiles(workspacePaths, requestedRoot) {
  const rootName = requestedRoot?.trim() || DEFAULT_UPLOAD_DIR_NAME;
  const targetRoot = workspacePaths.downloadRoots.get(rootName);
  if (!targetRoot) {
    return {
      ok: false,
      text: `Unknown directory: ${rootName}\n\nAllowed: ${DEFAULT_DOWNLOAD_DIRS.join(", ")}`,
    };
  }

  const entries = await readdir(targetRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absolutePath = path.join(targetRoot, entry.name);
    const fileStat = await stat(absolutePath);
    files.push({
      name: entry.name,
      size: fileStat.size,
      modifiedAt: fileStat.mtimeMs,
    });
  }

  files.sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (!files.length) {
    return {
      ok: true,
      text: `No files found in ${rootName}/.`,
    };
  }

  return {
    ok: true,
    text: [
      `Files in ${rootName}/:`,
      ...files.slice(0, 20).map((file) => `- ${rootName}/${file.name} (${formatBytes(file.size)})`),
    ].join("\n"),
  };
}

function renderCodexResult(result) {
  if (result.ok) {
    if (result.output) {
      return result.output;
    }
    if (result.stderr) {
      return `Codex completed without final text.\n\nstderr:\n${result.stderr}`;
    }
    return "Codex completed, but returned no output.";
  }

  const parts = [`Codex failed${result.exitCode == null ? "" : ` (exit ${result.exitCode})`}.`];
  if (result.output) {
    parts.push(`stdout:\n${result.output}`);
  }
  if (result.stderr) {
    parts.push(`stderr:\n${result.stderr}`);
  }
  return parts.join("\n\n");
}

function renderInterruptedResult(result) {
  const signalText = result.signal ? ` (${result.signal})` : "";
  return `Codex interrupted${signalText}.`;
}

function parseCommand(text) {
  if (!text.startsWith("/")) {
    return null;
  }
  const [head, ...tail] = text.split(/\s+/);
  const command = head
    .replace(/^\/+/, "")
    .replace(/@[^@\s]+$/, "")
    .toLowerCase();
  return {
    command,
    argsText: tail.join(" ").trim(),
  };
}

function getRunningJobKey(chatId, sessionLabel) {
  return `${chatId}:${sessionLabel}`;
}

function findRunningJob(runningJobs, chatId, sessionLabel) {
  return runningJobs.get(getRunningJobKey(chatId, sessionLabel)) || null;
}

function findAnyRunningJobForChat(runningJobs, chatId) {
  for (const [key, job] of runningJobs.entries()) {
    if (key.startsWith(`${chatId}:`)) {
      return { key, job };
    }
  }
  return null;
}

function registerRunningJob(runningJobs, chatId, sessionLabel, job) {
  runningJobs.set(getRunningJobKey(chatId, sessionLabel), job);
}

function unregisterRunningJob(runningJobs, chatId, sessionLabel, job) {
  const key = getRunningJobKey(chatId, sessionLabel);
  const current = runningJobs.get(key);
  if (current === job) {
    runningJobs.delete(key);
  }
}

function requestJobStop(job) {
  if (!job || !job.child || job.child.exitCode != null || job.child.killed) {
    return false;
  }

  job.stopRequested = true;
  try {
    job.child.kill("SIGTERM");
  } catch {
    return false;
  }

  setTimeout(() => {
    if (job.child.exitCode == null && !job.child.killed) {
      try {
        job.child.kill("SIGKILL");
      } catch {
        // ignore hard-kill failures
      }
    }
  }, 3000).unref?.();

  return true;
}

function findRunningGoal(runningGoals, goalId) {
  return runningGoals.get(goalId) || null;
}

function findRunningGoalForChat(runningGoals, chatId) {
  for (const runningGoal of runningGoals.values()) {
    if (String(runningGoal.chatId) === String(chatId)) {
      return runningGoal;
    }
  }
  return null;
}

function requestGoalStop(runningGoal) {
  if (!runningGoal) {
    return false;
  }

  runningGoal.controller.stopRequested = true;
  const child = runningGoal.controller.activeChild;
  if (!child || child.exitCode != null || child.killed) {
    return true;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    return false;
  }

  setTimeout(() => {
    if (child.exitCode == null && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore hard-kill failures
      }
    }
  }, 3000).unref?.();

  return true;
}

async function shutdownActiveWork(runningJobs, runningGoals) {
  for (const job of runningJobs.values()) {
    requestJobStop(job);
  }

  for (const runningGoal of runningGoals.values()) {
    requestGoalStop(runningGoal);
  }

  if (!runningJobs.size && !runningGoals.size) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
}

function formatGoalSummary(goal) {
  return `- ${goal.id} [${goal.status}] iter=${goal.iteration}${goal.lastEvaluatorVerdict ? ` verdict=${goal.lastEvaluatorVerdict}` : ""}\n  ${goal.objective}`;
}

function formatGoalStatus(goal) {
  return [
    `Goal: ${goal.id}`,
    `Status: ${goal.status}`,
    `Phase: ${goal.phase || "unknown"}`,
    `Iteration: ${goal.iteration}`,
    `Objective: ${goal.objective}`,
    `Worker session: ${goal.workerSessionRef || "not-started"}`,
    `Evaluator session: ${goal.evaluatorSessionRef || "not-started"}`,
    ...(goal.lastWorkerSummary ? [`Last worker summary: ${goal.lastWorkerSummary}`] : []),
    ...(goal.lastEvaluatorVerdict ? [`Last evaluator verdict: ${goal.lastEvaluatorVerdict}`] : []),
    ...(goal.nextWorkerInstruction ? [`Next instruction: ${goal.nextWorkerInstruction}`] : []),
    ...(goal.artifacts?.length ? [`Artifacts: ${goal.artifacts.join(", ")}`] : []),
    ...(goal.error ? [`Error: ${goal.error}`] : []),
  ].join("\n");
}

function formatGoalLog(goal) {
  const history = Array.isArray(goal.history) ? goal.history.slice(-12) : [];
  if (!history.length) {
    return `No log entries for ${goal.id}.`;
  }

  return [
    `Recent log for ${goal.id}:`,
    ...history.map((entry) => {
      const detail =
        entry.verdict ||
        entry.summary ||
        entry.message ||
        entry.status_note ||
        entry.user_message ||
        "";
      return `- ${entry.at} | ${entry.role || "system"} | ${entry.type || "event"}${detail ? ` | ${detail}` : ""}`;
    }),
  ].join("\n");
}

function formatScheduleSummary(schedule) {
  return `- ${schedule.id} [${schedule.enabled ? "enabled" : "disabled"}] ${schedule.cron}\n  ${schedule.objective}`;
}

function parseScheduleCommandArgs(argsText) {
  const parts = String(argsText || "").trim().split(/\s+/);
  if (parts.length < 6) {
    throw new Error("Usage: /schedule <minute> <hour> <day> <month> <weekday> <objective>");
  }
  const cron = parts.slice(0, 5).join(" ");
  const objective = parts.slice(5).join(" ").trim();
  if (!objective) {
    throw new Error("Usage: /schedule <minute> <hour> <day> <month> <weekday> <objective>");
  }
  parseCronExpression(cron);
  return { cron, objective };
}

async function registerSchedule({ token, chatId, messageId, cron, objective }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const schedule = createScheduleRecord({
    chatId,
    objective,
    cron,
    timezone,
  });
  await upsertSchedule(schedule);
  await sendMessage(
    token,
    chatId,
    `Schedule created: ${schedule.id}\nCron: ${schedule.cron}\nTimezone: ${schedule.timezone}\nObjective: ${schedule.objective}`,
    messageId,
  );
  return schedule;
}

async function processSchedulesTick(context) {
  const now = new Date();
  const tickKey = minuteKey(now);
  if (context.lastScheduleTick === tickKey) {
    return;
  }
  context.lastScheduleTick = tickKey;

  const state = await readSchedulesState();
  let changed = false;

  for (const schedule of state.schedules) {
    if (!schedule.enabled) {
      continue;
    }

    let cron;
    try {
      cron = parseCronExpression(schedule.cron);
    } catch (error) {
      schedule.lastError = error.message;
      schedule.enabled = false;
      schedule.updatedAt = new Date().toISOString();
      changed = true;
      continue;
    }

    if (!cronMatchesDate(cron, now)) {
      continue;
    }
    if (schedule.lastTriggeredKey === tickKey) {
      continue;
    }
    if (findRunningGoalForChat(context.runningGoals, schedule.chatId)) {
      schedule.lastError = "Skipped trigger because another goal is already running.";
      schedule.updatedAt = new Date().toISOString();
      changed = true;
      continue;
    }
    if (findAnyRunningJobForChat(context.runningJobs, schedule.chatId)) {
      schedule.lastError = "Skipped trigger because a regular session task is already running.";
      schedule.updatedAt = new Date().toISOString();
      changed = true;
      continue;
    }

    const goal = createGoalRecord({
      objective: schedule.objective,
      chatId: schedule.chatId,
      sessionLabel: DEFAULT_MAIN_SESSION_LABEL,
      channel: "telegram",
    });
    goal.status = "running";
    goal.phase = "queued";
    goal.scheduleId = schedule.id;
    await writeGoal(goal);

    schedule.lastTriggeredAt = now.toISOString();
    schedule.lastTriggeredKey = tickKey;
    schedule.lastGoalId = goal.id;
    schedule.lastError = null;
    schedule.updatedAt = now.toISOString();
    changed = true;

    await sendMessage(
      context.token,
      Number(schedule.chatId),
      `[${schedule.id}] Schedule triggered.\nGoal: ${goal.id}\nObjective: ${goal.objective}`,
    );
    await launchGoal(goal, {
      token: context.token,
      chatId: Number(schedule.chatId),
      messageId: undefined,
      runningGoals: context.runningGoals,
      goalCommandConfig: context.goalCommandConfig,
    });
  }

  if (changed) {
    await writeSchedulesState(state);
  }
}

async function launchGoal(goal, context) {
  let notifyChain = Promise.resolve();
  let currentGoal = {
    ...goal,
    evaluatorMessageIds: Array.isArray(goal.evaluatorMessageIds) ? goal.evaluatorMessageIds : [],
    workerEvents: Array.isArray(goal.workerEvents) ? goal.workerEvents : [],
    evaluatorEvents: Array.isArray(goal.evaluatorEvents) ? goal.evaluatorEvents : [],
  };

  const persistGoal = async (nextGoal) => {
    currentGoal = {
      ...nextGoal,
      evaluatorMessageIds: Array.isArray(nextGoal.evaluatorMessageIds) ? nextGoal.evaluatorMessageIds : [],
      workerEvents: Array.isArray(nextGoal.workerEvents) ? nextGoal.workerEvents : [],
      evaluatorEvents: Array.isArray(nextGoal.evaluatorEvents) ? nextGoal.evaluatorEvents : [],
    };
    await writeGoal(currentGoal);
  };

  const renderWorkerPanel = (activeGoal) => {
    const phase = activeGoal.phase || "running";
    const lines = [
      `[${activeGoal.id}] Worker`,
      `Status: ${activeGoal.status || "running"} / ${phase}`,
    ];

    if (activeGoal.workerEvents?.length) {
      lines.push("", "Recent updates:");
      for (const event of activeGoal.workerEvents.slice(-6)) {
        lines.push(`- ${event}`);
      }
    }

    return lines.join("\n");
  };

  const renderEvaluatorPanel = (activeGoal) => {
    const phase = activeGoal.phase || "evaluator";
    const lines = [
      `[${activeGoal.id}] Evaluator`,
      `Status: ${activeGoal.status || "running"} / ${phase}`,
    ];

    if (activeGoal.evaluatorEvents?.length) {
      lines.push("", "Recent updates:");
      for (const event of activeGoal.evaluatorEvents.slice(-4)) {
        lines.push(`- ${event}`);
      }
    }

    return lines.join("\n");
  };

  const pushWorkerEvent = async (text) => {
    const normalized = text.trim();
    if (
      !normalized ||
      normalized.startsWith("Goal started:") ||
      normalized === "Worker: Session started" ||
      normalized.startsWith("Worker: Running ") ||
      normalized.startsWith("Worker: Finished ")
    ) {
      return;
    }
    currentGoal.workerEvents = [...(currentGoal.workerEvents || []), normalized].slice(-6);
    await persistGoal(currentGoal);

    if (typeof currentGoal.workerMessageId === "number") {
      try {
        await deleteMessage(context.token, context.chatId, currentGoal.workerMessageId);
      } catch {
        // ignore delete failure and replace below
      }
    }

    const workerMessage = await sendMessage(
      context.token,
      context.chatId,
      renderWorkerPanel(currentGoal),
      typeof currentGoal.workerMessageId === "number" ? undefined : context.messageId,
    );
    currentGoal.workerMessageId = workerMessage?.message_id ?? null;
    await persistGoal(currentGoal);
  };

  const sendEvaluatorUpdate = async (text) => {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    if (
      normalized === "Evaluator: Session started" ||
      normalized.startsWith("Evaluator: Running ") ||
      normalized.startsWith("Evaluator: Finished ")
    ) {
      return;
    }
    currentGoal.evaluatorEvents = [...(currentGoal.evaluatorEvents || []), normalized].slice(-4);
    await persistGoal(currentGoal);

    if (typeof currentGoal.evaluatorMessageId === "number") {
      try {
        await deleteMessage(context.token, context.chatId, currentGoal.evaluatorMessageId);
      } catch {
        // ignore delete failure and replace below
      }
    }

    const evaluatorMessage = await sendMessage(
      context.token,
      context.chatId,
      renderEvaluatorPanel(currentGoal),
      typeof currentGoal.evaluatorMessageId === "number" ? undefined : context.messageId,
    );
    if (typeof evaluatorMessage?.message_id === "number") {
      currentGoal.evaluatorMessageId = evaluatorMessage.message_id;
      currentGoal.evaluatorMessageIds = [...(currentGoal.evaluatorMessageIds || []), evaluatorMessage.message_id];
      await persistGoal(currentGoal);
    }
  };

  const enqueueNotify = async (operation) => {
    notifyChain = notifyChain
      .catch(() => {})
      .then(operation);
    await notifyChain;
  };

  const started = startGoalRun(goal, {
    commandConfig: context.goalCommandConfig,
    persistGoal,
    notify: async (text) => {
      await enqueueNotify(async () => {
        try {
          if (text.startsWith("Evaluator:")) {
            await sendEvaluatorUpdate(text);
            return;
          }
          await pushWorkerEvent(text);
        } catch (error) {
          logBridgeEvent("goal notification failed", {
            goalId: goal.id,
            chatId: String(context.chatId),
            error: error.message,
          });
        }
      });
    },
  });

  context.runningGoals.set(goal.id, {
    goalId: goal.id,
    chatId: context.chatId,
    controller: started.controller,
  });

  void started.result
    .then(async ({ goal: finalGoal, userMessage }) => {
      context.runningGoals.delete(goal.id);
      currentGoal = {
        ...currentGoal,
        ...finalGoal,
      };
      currentGoal.finalOutput = userMessage;
      currentGoal.finalOutputAt = new Date().toISOString();
      await persistGoal(currentGoal);
      const finalMessage = await sendMessage(
        context.token,
        context.chatId,
        `[${finalGoal.id}] ${userMessage}`,
        context.messageId,
      );
      if (typeof finalMessage?.message_id === "number") {
        currentGoal.finalMessageId = finalMessage.message_id;
        await persistGoal(currentGoal);
      }
    })
    .catch(async (error) => {
      context.runningGoals.delete(goal.id);
      currentGoal.status = "failed";
      currentGoal.phase = "runner_failed";
      currentGoal.error = error.message;
      appendGoalHistory(currentGoal, {
        role: "system",
        type: "failure",
        message: error.message,
      });
      await persistGoal(currentGoal);
      await sendMessage(
        context.token,
        context.chatId,
        `[${currentGoal.id}] Goal failed.\n\n${error.message}`,
        context.messageId,
      );
    });
}

async function reconcileGoalsOnStartup() {
  const goals = await listGoals({ limit: 200 });
  for (const goal of goals) {
    if (goal.status === "running") {
      goal.status = "blocked";
      goal.phase = "interrupted";
      appendGoalHistory(goal, {
        role: "system",
        type: "restart",
        message: "Goal was interrupted by bridge restart. Use /goal-resume to continue.",
      });
      await writeGoal(goal);
    }
  }
}

async function handleSlashCommand({
  command,
  argsText,
  state,
  chatId,
  token,
  message,
  runningJobs,
  runningGoals,
  goalCommandConfig,
}) {
  ensureMainSession(state);

  if (command === "start" || command === "home") {
    setActiveSessionLabel(state, chatId, DEFAULT_MAIN_SESSION_LABEL);
    await sendMessage(token, message.chat.id, `Switched to ${DEFAULT_MAIN_SESSION_LABEL}.`, message.message_id);
    return { stateChanged: true, handled: true };
  }

  if (command === "where") {
    await sendMessage(token, message.chat.id, formatWhere(state, chatId), message.message_id);
    return { stateChanged: false, handled: true };
  }

  if (command === "help") {
    await sendMessage(
      token,
      message.chat.id,
      [
        "Commands:",
        "/home or /start",
        "/new <label>",
        "/switch <label>",
        "/sessions",
        "/skills",
        "/files [inbox|outbox|exports]",
        "/get <relative-path>",
        "/where",
        "/status",
        "/stop",
        "/goal <objective>",
        "/goals",
        "/goal-status <id>",
        "/goal-stop <id>",
        "/goal-resume <id>",
        "/goal-log <id>",
        "/schedule <cron> <objective>",
        "/schedules",
        "/schedule-stop <id>",
        "/schedule-run <id>",
        "Natural language:",
        "每天9点帮我做xxx",
        "/restart",
      ].join("\n"),
      message.message_id,
    );
    return { stateChanged: false, handled: true };
  }

  if (command === "status") {
    const runningGoal = findRunningGoalForChat(runningGoals, chatId);
    await sendMessage(
      token,
      message.chat.id,
      [formatStatus(state, chatId, runningJobs), `Running goal: ${runningGoal ? runningGoal.goalId : "no"}`].join("\n"),
      message.message_id,
    );
    return { stateChanged: false, handled: true };
  }

  if (command === "files") {
    const requestedRoot = argsText.trim() || DEFAULT_UPLOAD_DIR_NAME;
    const listing = await listWorkspaceFiles(message.workspacePaths, requestedRoot);
    await sendMessage(token, message.chat.id, listing.text, message.message_id);
    return { stateChanged: false, handled: true };
  }

  if (command === "get") {
    const requestedPath = argsText.trim();
    if (!requestedPath) {
      await sendMessage(token, message.chat.id, "Usage: /get <relative-path>", message.message_id);
      return { stateChanged: false, handled: true };
    }

    const resolvedPath = resolveDownloadPath(message.workspacePaths, requestedPath);
    if (!resolvedPath) {
      await sendMessage(
        token,
        message.chat.id,
        `Invalid path: ${requestedPath}\n\nAllowed roots: ${DEFAULT_DOWNLOAD_DIRS.join(", ")}`,
        message.message_id,
      );
      return { stateChanged: false, handled: true };
    }

    let fileStat;
    try {
      fileStat = await stat(resolvedPath);
    } catch {
      await sendMessage(token, message.chat.id, `File not found: ${requestedPath}`, message.message_id);
      return { stateChanged: false, handled: true };
    }

    if (!fileStat.isFile()) {
      await sendMessage(token, message.chat.id, `Not a file: ${requestedPath}`, message.message_id);
      return { stateChanged: false, handled: true };
    }

    await sendDocument(token, message.chat.id, resolvedPath, message.message_id, requestedPath);
    return { stateChanged: false, handled: true };
  }

  if (command === "stop") {
    const activeLabel = getActiveSessionLabel(state, chatId);
    const job = findRunningJob(runningJobs, chatId, activeLabel);
    if (!job) {
      await sendMessage(token, message.chat.id, `No running task for ${activeLabel}.`, message.message_id);
      return { stateChanged: false, handled: true };
    }

    const stopped = requestJobStop(job);
    await sendMessage(
      token,
      message.chat.id,
      stopped ? renderStopRequestedMessage(activeLabel) : `Unable to stop ${activeLabel}.`,
      message.message_id,
    );
    return { stateChanged: false, handled: true };
  }

  if (command === "restart") {
    const botId = process.env.AUTOAIDE_BOT_ID?.trim() || "default";
    const botHome = process.env.BOT_HOME?.trim() || DEFAULT_BOT_HOME;
    await sendMessage(token, message.chat.id, `Restarting bot runtime for ${botId}.`, message.message_id);
    scheduleBotRuntimeRestart(botId, botHome);
    try {
      process.kill(process.ppid, "SIGTERM");
    } catch {
      process.exit(0);
    }
    return { stateChanged: false, handled: true };
  }

  if (command === "sessions") {
    await sendMessage(token, message.chat.id, formatSessionList(state, chatId), message.message_id);
    return { stateChanged: false, handled: true };
  }

  if (command === "skills") {
    const parts = argsText.trim().split(/\s+/).filter(Boolean);
    const subcommand = parts[0];
    if (!subcommand || subcommand === "list") {
      const skills = await listSkills();
      await sendMessage(token, message.chat.id, formatSkillsOverview(skills), message.message_id);
      return { stateChanged: false, handled: true };
    }
    if (subcommand === "install") {
      const source = parts.slice(1).join(" ").trim();
      if (!source) {
        await sendMessage(token, message.chat.id, "Usage: /skills install <zip-or-path>", message.message_id);
        return { stateChanged: false, handled: true };
      }
      try {
        const installed = await installSkillFromPath(source, { force: true });
        await sendMessage(token, message.chat.id, formatSkillInstallResult(installed), message.message_id);
      } catch (error) {
        await sendMessage(token, message.chat.id, `Skill install failed: ${error.message}`, message.message_id);
      }
      return { stateChanged: false, handled: true };
    }
    await sendMessage(
      token,
      message.chat.id,
      ["Skills commands:", "/skills", "/skills install <zip-or-path>"].join("\n"),
      message.message_id,
    );
    return { stateChanged: false, handled: true };
  }

  if (command === "new") {
    const label = slugifySessionLabel(argsText);
    if (!label) {
      await sendMessage(token, message.chat.id, "Usage: /new <label>", message.message_id);
      return { stateChanged: false, handled: true };
    }
    if (state.sessions[label]) {
      setActiveSessionLabel(state, chatId, label);
      await sendMessage(token, message.chat.id, `Session ${label} already exists. Switched to it.`, message.message_id);
      return { stateChanged: true, handled: true };
    }
    state.sessions[label] = {
      label,
      displayLabel: argsText,
      backend: "codex",
      cliSessionRef: null,
      isMain: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setActiveSessionLabel(state, chatId, label);
    await sendMessage(
      token,
      message.chat.id,
      `Created session ${label} and switched to it.\nSend your next message to start that Codex thread.`,
      message.message_id,
    );
    return { stateChanged: true, handled: true };
  }

  if (command === "switch") {
    const label = slugifySessionLabel(argsText);
    if (!label) {
      await sendMessage(token, message.chat.id, "Usage: /switch <label>", message.message_id);
      return { stateChanged: false, handled: true };
    }
    if (!state.sessions[label]) {
      await sendMessage(token, message.chat.id, `Unknown session: ${label}\n\nUse /sessions to list available sessions.`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    setActiveSessionLabel(state, chatId, label);
    await sendMessage(token, message.chat.id, `Switched to ${label}.`, message.message_id);
    return { stateChanged: true, handled: true };
  }

  if (command === "goal") {
    const objective = argsText.trim();
    if (!objective) {
      await sendMessage(token, message.chat.id, "Usage: /goal <objective>", message.message_id);
      return { stateChanged: false, handled: true };
    }

    const activeGoal = findRunningGoalForChat(runningGoals, chatId);
    if (activeGoal) {
      await sendMessage(
        token,
        message.chat.id,
        `A goal is already running for this chat: ${activeGoal.goalId}\nUse /goal-stop ${activeGoal.goalId} first or wait for it to finish.`,
        message.message_id,
      );
      return { stateChanged: false, handled: true };
    }
    const activeSessionJob = findAnyRunningJobForChat(runningJobs, chatId);
    if (activeSessionJob) {
      await sendMessage(
        token,
        message.chat.id,
        "A regular session task is already running for this chat. Use /stop before starting a goal.",
        message.message_id,
      );
      return { stateChanged: false, handled: true };
    }

    const goal = createGoalRecord({
      objective,
      chatId,
      sessionLabel: getActiveSessionLabel(state, chatId),
      channel: "telegram",
    });
    goal.status = "running";
    goal.phase = "queued";
    await writeGoal(goal);
    await sendMessage(
      token,
      message.chat.id,
      `Goal created: ${goal.id}\nObjective: ${goal.objective}\nStatus: running`,
      message.message_id,
    );
    await launchGoal(goal, {
      token,
      chatId: message.chat.id,
      messageId: message.message_id,
      runningGoals,
      goalCommandConfig,
    });
    return { stateChanged: false, handled: true };
  }

  if (command === "goals") {
    const goals = await listGoals({ chatId, limit: 10 });
    await sendMessage(
      token,
      message.chat.id,
      goals.length ? ["Goals:", ...goals.map(formatGoalSummary)].join("\n") : "No goals yet.",
      message.message_id,
    );
    return { stateChanged: false, handled: true };
  }

  if (command === "goal-status") {
    const goalId = argsText.trim();
    if (!goalId) {
      await sendMessage(token, message.chat.id, "Usage: /goal-status <id>", message.message_id);
      return { stateChanged: false, handled: true };
    }
    const goal = await readGoal(goalId);
    if (!goal || String(goal.chatId) !== String(chatId)) {
      await sendMessage(token, message.chat.id, `Unknown goal: ${goalId}`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    await sendMessage(token, message.chat.id, formatGoalStatus(goal), message.message_id);
    return { stateChanged: false, handled: true };
  }

  if (command === "goal-log") {
    const goalId = argsText.trim();
    if (!goalId) {
      await sendMessage(token, message.chat.id, "Usage: /goal-log <id>", message.message_id);
      return { stateChanged: false, handled: true };
    }
    const goal = await readGoal(goalId);
    if (!goal || String(goal.chatId) !== String(chatId)) {
      await sendMessage(token, message.chat.id, `Unknown goal: ${goalId}`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    await sendMessage(token, message.chat.id, formatGoalLog(goal), message.message_id);
    return { stateChanged: false, handled: true };
  }

  if (command === "goal-stop") {
    const goalId = argsText.trim();
    if (!goalId) {
      await sendMessage(token, message.chat.id, "Usage: /goal-stop <id>", message.message_id);
      return { stateChanged: false, handled: true };
    }
    const goal = await readGoal(goalId);
    if (!goal || String(goal.chatId) !== String(chatId)) {
      await sendMessage(token, message.chat.id, `Unknown goal: ${goalId}`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    const runningGoal = findRunningGoal(runningGoals, goalId);
    if (!runningGoal) {
      if (goal.status !== "stopped") {
        goal.status = "stopped";
        goal.phase = "stopped";
        appendGoalHistory(goal, {
          role: "system",
          type: "stop",
          message: "Goal stopped without an active runner.",
        });
        await writeGoal(goal);
      }
      await sendMessage(token, message.chat.id, `[${goalId}] Stopped.`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    const stopped = requestGoalStop(runningGoal);
    await sendMessage(
      token,
      message.chat.id,
      stopped ? `[${goalId}] Stop requested.` : `[${goalId}] Unable to stop right now.`,
      message.message_id,
    );
    return { stateChanged: false, handled: true };
  }

  if (command === "goal-resume") {
    const goalId = argsText.trim();
    if (!goalId) {
      await sendMessage(token, message.chat.id, "Usage: /goal-resume <id>", message.message_id);
      return { stateChanged: false, handled: true };
    }
    const goal = await readGoal(goalId);
    if (!goal || String(goal.chatId) !== String(chatId)) {
      await sendMessage(token, message.chat.id, `Unknown goal: ${goalId}`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    if (findRunningGoalForChat(runningGoals, chatId)) {
      await sendMessage(
        token,
        message.chat.id,
        "Another goal is already running for this chat. Stop it first or wait for it to finish.",
        message.message_id,
      );
      return { stateChanged: false, handled: true };
    }
    if (goal.status === "completed") {
      await sendMessage(token, message.chat.id, `[${goalId}] is already completed.`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    goal.status = "running";
    goal.phase = "resuming";
    goal.error = null;
    appendGoalHistory(goal, {
      role: "system",
      type: "resume",
      message: "Goal resumed by user.",
    });
    await writeGoal(goal);
    await sendMessage(token, message.chat.id, `[${goalId}] Resuming.`, message.message_id);
    await launchGoal(goal, {
      token,
      chatId: message.chat.id,
      messageId: message.message_id,
      runningGoals,
      goalCommandConfig,
    });
    return { stateChanged: false, handled: true };
  }

  if (command === "schedule") {
    let parsedArgs;
    try {
      parsedArgs = parseScheduleCommandArgs(argsText);
    } catch (error) {
      await sendMessage(token, message.chat.id, error.message, message.message_id);
      return { stateChanged: false, handled: true };
    }
    await registerSchedule({
      token,
      chatId: message.chat.id,
      messageId: message.message_id,
      cron: parsedArgs.cron,
      objective: parsedArgs.objective,
    });
    return { stateChanged: false, handled: true };
  }

  if (command === "schedules") {
    const schedules = await listSchedules({ chatId });
    await sendMessage(
      token,
      message.chat.id,
      schedules.length
        ? ["Schedules:", ...schedules.map(formatScheduleSummary)].join("\n")
        : "No schedules yet.",
      message.message_id,
    );
    return { stateChanged: false, handled: true };
  }

  if (command === "schedule-stop") {
    const scheduleId = argsText.trim();
    if (!scheduleId) {
      await sendMessage(token, message.chat.id, "Usage: /schedule-stop <id>", message.message_id);
      return { stateChanged: false, handled: true };
    }
    const schedule = await getScheduleById(scheduleId);
    if (!schedule || String(schedule.chatId) !== String(chatId)) {
      await sendMessage(token, message.chat.id, `Unknown schedule: ${scheduleId}`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    schedule.enabled = false;
    await upsertSchedule(schedule);
    await sendMessage(token, message.chat.id, `[${schedule.id}] Disabled.`, message.message_id);
    return { stateChanged: false, handled: true };
  }

  if (command === "schedule-run") {
    const scheduleId = argsText.trim();
    if (!scheduleId) {
      await sendMessage(token, message.chat.id, "Usage: /schedule-run <id>", message.message_id);
      return { stateChanged: false, handled: true };
    }
    const schedule = await getScheduleById(scheduleId);
    if (!schedule || String(schedule.chatId) !== String(chatId)) {
      await sendMessage(token, message.chat.id, `Unknown schedule: ${scheduleId}`, message.message_id);
      return { stateChanged: false, handled: true };
    }
    if (findRunningGoalForChat(runningGoals, chatId)) {
      await sendMessage(
        token,
        message.chat.id,
        "A goal is already running for this chat. Stop it first or wait for it to finish.",
        message.message_id,
      );
      return { stateChanged: false, handled: true };
    }
    const goal = createGoalRecord({
      objective: schedule.objective,
      chatId,
      sessionLabel: getActiveSessionLabel(state, chatId),
      channel: "telegram",
    });
    goal.status = "running";
    goal.phase = "queued";
    goal.scheduleId = schedule.id;
    await writeGoal(goal);
    schedule.lastTriggeredAt = new Date().toISOString();
    schedule.lastTriggeredKey = minuteKey(new Date());
    schedule.lastGoalId = goal.id;
    schedule.lastError = null;
    await upsertSchedule(schedule);
    await sendMessage(
      token,
      message.chat.id,
      `[${schedule.id}] Manual run started.\nGoal: ${goal.id}`,
      message.message_id,
    );
    await launchGoal(goal, {
      token,
      chatId: message.chat.id,
      messageId: message.message_id,
      runningGoals,
      goalCommandConfig,
    });
    return { stateChanged: false, handled: true };
  }

  return { stateChanged: false, handled: false };
}

async function processUpdate(update, context) {
  const message = update.message;
  if (!message) {
    return;
  }

  const chatId = String(message.chat.id);
  const senderId = message.from?.id != null ? String(message.from.id) : null;
  logBridgeEvent("telegram update received", {
    updateId: update.update_id,
    chatId,
    senderId,
    chatType: message.chat?.type,
    messageId: message.message_id,
    hasText: Boolean(getMessageText(message)),
    hasDocument: Boolean(message.document),
  });
  await captureTelegramMetadata(context.botHome, message);
  const uploadedDocument = await saveUploadedDocument(message, context.token, context.workspacePaths);

  const text = getMessageText(message);
  if (!text && !uploadedDocument) {
    logBridgeEvent("telegram update rejected: unsupported payload", {
      chatId,
      messageId: message.message_id,
    });
    await sendMessage(
      context.token,
      message.chat.id,
      "Only text messages and document uploads are supported right now.",
      message.message_id,
    );
    return;
  }

  if (isGroupChat(message)) {
    if (context.allowedGroupChatIds && !context.allowedGroupChatIds.has(chatId)) {
      logBridgeEvent("telegram group update ignored: group not allowed", {
        chatId,
        senderId,
      });
      return;
    }
    if (context.allowedGroupUserIds && (!senderId || !context.allowedGroupUserIds.has(senderId))) {
      logBridgeEvent("telegram group update ignored: sender not allowed", {
        chatId,
        senderId,
      });
      return;
    }

    const entities = getMessageEntities(message);
    const mention = extractBotMention(text, entities, context.botUsername);
    const slashCommand = parseCommand(text);
    const commandHead = text.split(/\s+/, 1)[0] || "";
    const commandTargetsBot =
      slashCommand &&
      context.botUsername &&
      new RegExp(`^/[^\\s@]+@${context.botUsername.replace(/^@+/, "")}$`, "i").test(commandHead);

    if (!mention && !commandTargetsBot) {
      logBridgeEvent("telegram group update ignored: bot not explicitly mentioned", {
        chatId,
        senderId,
      });
      return;
    }
  } else if (context.allowedChatIds && !context.allowedChatIds.has(chatId)) {
    logBridgeEvent("telegram update ignored: chat not allowed", { chatId });
    return;
  }

  const state = await readRouterState(context.routerStatePath);
  ensureMainSession(state);
  ensureChatState(state, chatId);

  const entities = getMessageEntities(message);
  const mention = isGroupChat(message) ? extractBotMention(text, entities, context.botUsername) : null;
  const normalizedText = mention ? stripExplicitBotMention(text, mention) : text;
  const slashCommand = parseCommand(normalizedText);
  if (slashCommand) {
    logBridgeEvent("telegram slash command", {
      chatId,
      messageId: message.message_id,
      command: slashCommand.command,
    });
    const handled = await handleSlashCommand({
      ...slashCommand,
      state,
      chatId,
      token: context.token,
      runningJobs: context.runningJobs,
      runningGoals: context.runningGoals,
      goalCommandConfig: context.goalCommandConfig,
      message: {
        ...message,
        workspacePaths: context.workspacePaths,
      },
    });
    if (handled.stateChanged) {
      await writeRouterState(context.routerStatePath, state);
    }
    if (handled.handled) {
      return;
    }
  }

  const naturalLanguageSchedule = parseNaturalLanguageSchedule(normalizedText);
  if (naturalLanguageSchedule) {
    logBridgeEvent("telegram natural-language schedule matched", {
      chatId,
      messageId: message.message_id,
      cron: naturalLanguageSchedule.cron,
      objective: naturalLanguageSchedule.objective,
    });
    await registerSchedule({
      token: context.token,
      chatId: message.chat.id,
      messageId: message.message_id,
      cron: naturalLanguageSchedule.cron,
      objective: naturalLanguageSchedule.objective,
    });
    return;
  }

  const activeLabel = getActiveSessionLabel(state, chatId);
  const session = state.sessions[activeLabel];
  const mode = session.cliSessionRef ? "Codex resume" : "Codex";
  const runningJob = findRunningJob(context.runningJobs, chatId, activeLabel);
  const runningGoal = findRunningGoalForChat(context.runningGoals, chatId);

  if (runningGoal) {
    logBridgeEvent("telegram message blocked by running goal", {
      chatId,
      activeLabel,
      goalId: runningGoal.goalId,
    });
    await sendMessage(
      context.token,
      message.chat.id,
      `Goal ${runningGoal.goalId} is already running. Use /goal-stop ${runningGoal.goalId} before sending a normal request.`,
      message.message_id,
    );
    return;
  }

  if (runningJob) {
    logBridgeEvent("telegram message blocked by running job", {
      chatId,
      activeLabel,
      startedAt: runningJob.startedAt,
      stopRequested: runningJob.stopRequested,
    });
    await sendMessage(
      context.token,
      message.chat.id,
      `Session ${activeLabel} is already running. Use /stop before sending a new request.`,
      message.message_id,
    );
    return;
  }

  if (uploadedDocument) {
    const uploadNotice = [
      `Saved file to ${uploadedDocument.relativePath}.`,
      `Name: ${uploadedDocument.originalName}`,
      `Size: ${formatBytes(uploadedDocument.fileSize)}`,
      normalizedText ? "Running your caption against the saved file..." : "You can now ask AutoAide to process it.",
    ].join("\n");
    await sendMessage(context.token, message.chat.id, uploadNotice, message.message_id);
  }

  if (!normalizedText) {
    return;
  }

  await sendMessage(
    context.token,
    message.chat.id,
    renderRunningMessage(normalizedText, activeLabel, mode),
    message.message_id,
  );

  const promptText = uploadedDocument
    ? [
        `A Telegram document was uploaded and saved to workspace path: ${uploadedDocument.relativePath}.`,
        "Treat that file as the primary input unless the user says otherwise.",
        "",
        `User request: ${normalizedText}`,
      ].join("\n")
    : normalizedText;

  const prompt = await buildWorkspacePrompt(promptText);

  const started = startCliTurn(prompt, session.cliSessionRef, context.commandConfig);
  const job = {
    child: started.child,
    stopRequested: false,
    startedAt: new Date().toISOString(),
  };
  registerRunningJob(context.runningJobs, chatId, activeLabel, job);
  logBridgeEvent("codex job started", {
    chatId,
    activeLabel,
    mode,
    startedAt: job.startedAt,
    hasSessionRef: Boolean(session.cliSessionRef),
  });

  void (async () => {
    const finalResult = await started.result;
    unregisterRunningJob(context.runningJobs, chatId, activeLabel, job);

    if (finalResult.ok && finalResult.cliSessionRef) {
      session.cliSessionRef = finalResult.cliSessionRef;
      session.updatedAt = new Date().toISOString();
      await writeRouterState(context.routerStatePath, state);
    }

    logBridgeEvent("codex job finished", {
      chatId,
      activeLabel,
      ok: finalResult.ok,
      exitCode: finalResult.exitCode,
      signal: finalResult.signal,
      stopRequested: job.stopRequested,
      sessionRef: finalResult.cliSessionRef,
      outputPreview: typeof finalResult.output === "string"
        ? finalResult.output.slice(0, 120)
        : "",
    });

    const messageText = job.stopRequested && !finalResult.ok
      ? renderInterruptedResult(finalResult)
      : renderCodexResult(finalResult);

    await sendMessage(
      context.token,
      message.chat.id,
      messageText,
      message.message_id,
    );
  })().catch(async (error) => {
    unregisterRunningJob(context.runningJobs, chatId, activeLabel, job);
    logBridgeEvent("codex job failed", {
      chatId,
      activeLabel,
      error: error.message,
    });
    await sendMessage(
      context.token,
      message.chat.id,
      `Job failed: ${error.message}`,
      message.message_id,
    );
  });
}

async function main() {
  const runtimeContext = await resolveBotRuntimeContext();
  const token = runtimeContext.token;
  if (!token) {
    throw new Error("Telegram bridge cannot start: bot-scoped Telegram token is missing.");
  }
  const offsetPath = process.env.TELEGRAM_OFFSET_FILE?.trim() || DEFAULT_OFFSET_PATH;
  const routerStatePath = process.env.TELEGRAM_ROUTER_STATE_FILE?.trim() || DEFAULT_ROUTER_STATE_PATH;
  const pidPath = process.env.TELEGRAM_BRIDGE_PID_FILE?.trim() || DEFAULT_PID_PATH;
  const allowedChatIds = runtimeContext.allowedChatIds;
  const allowedGroupChatIds = runtimeContext.allowedGroupChatIds;
  const allowedGroupUserIds = runtimeContext.allowedGroupUserIds;
  const botUsername = runtimeContext.botUsername;
  const commandConfig = buildCommandConfig(runtimeContext.model);
  const codexCwd = runtimeContext.codexCwd;
  const workspacePaths = await resolveWorkspacePaths(codexCwd);
  const runningJobs = new Map();
  const runningGoals = new Map();
  const goalCommandConfig = {
    ...buildGoalCommandConfig(),
    model: runtimeContext.model,
    cwd: codexCwd,
  };
  const schedulerContext = {
    token,
    runningJobs,
    runningGoals,
    goalCommandConfig,
    lastScheduleTick: null,
  };

  await writePidFile(pidPath);
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (signal) {
      console.log(`telegram bridge shutting down: ${signal}`);
    }
    await shutdownActiveWork(runningJobs, runningGoals);
    await clearPidFile(pidPath);
    process.exit(0);
  };

  process.on("exit", () => {
    void clearPidFile(pidPath);
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  await reconcileGoalsOnStartup();

  let nextOffset = await readOffset(offsetPath);

  console.log("telegram bridge started");
  console.log(`bot home: ${runtimeContext.botHome}`);
  console.log(`codex cwd: ${codexCwd}`);
  console.log(`codex start: ${commandConfig.startCommand}`);
  console.log(`codex resume: ${commandConfig.resumeTemplate}`);
  console.log(`router state: ${routerStatePath}`);
  if (allowedChatIds) {
    console.log(`allowed chat ids: ${Array.from(allowedChatIds).join(", ")}`);
  }
  if (allowedGroupChatIds) {
    console.log(`allowed group chat ids: ${Array.from(allowedGroupChatIds).join(", ")}`);
  }
  if (allowedGroupUserIds) {
    console.log(`allowed group user ids: ${Array.from(allowedGroupUserIds).join(", ")}`);
  }
  if (botUsername) {
    console.log(`telegram bot username: @${botUsername}`);
  }

  while (true) {
    try {
      const updates = await getUpdates(token, nextOffset);
      for (const update of updates) {
        nextOffset = update.update_id + 1;
        await writeOffset(offsetPath, nextOffset);
        await processUpdate(update, {
          token,
          botUsername,
          allowedChatIds,
          allowedGroupChatIds,
          allowedGroupUserIds,
          routerStatePath,
          runningJobs,
          runningGoals,
          goalCommandConfig,
          commandConfig: {
            ...commandConfig,
            cwd: codexCwd,
          },
          workspacePaths,
        });
      }
      await processSchedulesTick(schedulerContext);
    } catch (error) {
      console.error("poll loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  extractBotMention,
  isGroupChat,
  isTelegramReplyReferenceError,
  parseCommand,
  resolveBotRuntimeContext,
  renderCodexResult,
  renderRunningMessage,
  stripExplicitBotMention,
};
