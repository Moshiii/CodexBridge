#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildWorkspacePrompt } from "../../src/workspace-context.mjs";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_SECONDS = 30;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_AUTOAIDE_HOME = process.env.AUTOAIDE_HOME?.trim() || path.join(os.homedir(), ".autoaide");
const DEFAULT_STATE_DIR = process.env.AUTOAIDE_HOME?.trim()
  ? path.join(process.env.AUTOAIDE_HOME.trim(), "telegram")
  : path.join(DEFAULT_AUTOAIDE_HOME, "telegram");
const DEFAULT_OFFSET_PATH = path.join(DEFAULT_STATE_DIR, "offset.json");
const DEFAULT_ROUTER_STATE_PATH = path.join(DEFAULT_STATE_DIR, "sessions.json");
const DEFAULT_PID_PATH = path.join(DEFAULT_STATE_DIR, "bridge.pid");
const DEFAULT_MAIN_SESSION_LABEL = "main";
const DEFAULT_MAIN_SESSION_DISPLAY = "personal-chief-of-staff";
const DEFAULT_CODEX_START_COMMAND = "codex exec --skip-git-repo-check --json -";
const DEFAULT_CODEX_RESUME_TEMPLATE =
  "codex exec resume --skip-git-repo-check --json __SESSION_ID__ -";
const DEFAULT_UPLOAD_DIR_NAME = "inbox";
const DEFAULT_DOWNLOAD_DIRS = ["inbox", "outbox", "exports"];

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

function getMessageText(message) {
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  if (typeof message.caption === "string" && message.caption.trim()) {
    return message.caption.trim();
  }
  return "";
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

function buildCommandConfig() {
  const startCommand = process.env.CODEX_START_COMMAND?.trim();
  const resumeTemplate = process.env.CODEX_RESUME_COMMAND_TEMPLATE?.trim();
  const legacyStart = process.env.CODEX_COMMAND?.trim();

  if (startCommand) {
    return {
      startCommand,
      resumeTemplate: resumeTemplate || DEFAULT_CODEX_RESUME_TEMPLATE,
    };
  }

  if (legacyStart) {
    const derivedStart = legacyStart.includes(" --json")
      ? legacyStart
      : legacyStart.replace(/\s+-\s*$/, " --json -");
    return {
      startCommand: derivedStart,
      resumeTemplate: resumeTemplate || DEFAULT_CODEX_RESUME_TEMPLATE,
    };
  }

  return {
    startCommand: DEFAULT_CODEX_START_COMMAND,
    resumeTemplate: DEFAULT_CODEX_RESUME_TEMPLATE,
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
  await writeFile(filePath, `${process.pid}\n`, "utf8");
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

async function telegramRequest(token, method, body) {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`Telegram API ${method} error: ${payload.description ?? "unknown error"}`);
  }
  return payload.result;
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
  await telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text: truncateTelegramText(text),
    reply_parameters:
      typeof replyToMessageId === "number"
        ? { message_id: replyToMessageId }
        : undefined,
  });
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

function parseCodexJson(stdout) {
  const events = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  let threadId = null;
  let finalText = "";

  for (const event of events) {
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      threadId = event.thread_id;
    }
    if (
      event.type === "item.completed" &&
      event.item &&
      event.item.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      finalText = event.item.text;
    }
  }

  return { threadId, finalText };
}

async function runShellCommand(prompt, command, cwd) {
  return await new Promise((resolve) => {
    const shellSpec = getShellSpec();
    const child = spawn(shellSpec.command, [...shellSpec.args, command], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: `Failed to start command: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    child.stdin.end(prompt);
  });
}

async function runCodexStart(prompt, options) {
  const result = await runShellCommand(prompt, options.startCommand, options.cwd);
  const parsed = parseCodexJson(result.stdout);
  return {
    ...result,
    cliSessionRef: parsed.threadId,
    output: parsed.finalText || result.stdout,
  };
}

async function runCodexResume(prompt, sessionRef, options) {
  const command = options.resumeTemplate.replaceAll("__SESSION_ID__", sessionRef);
  const result = await runShellCommand(prompt, command, options.cwd);
  const parsed = parseCodexJson(result.stdout);
  return {
    ...result,
    cliSessionRef: sessionRef,
    output: parsed.finalText || result.stdout,
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

function parseCommand(text) {
  if (!text.startsWith("/")) {
    return null;
  }
  const [head, ...tail] = text.split(/\s+/);
  const command = head.replace(/^\/+/, "").toLowerCase();
  return {
    command,
    argsText: tail.join(" ").trim(),
  };
}

async function handleSlashCommand({ command, argsText, state, chatId, token, message }) {
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

  if (command === "sessions") {
    await sendMessage(token, message.chat.id, formatSessionList(state, chatId), message.message_id);
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

  if (command === "files") {
    const listing = await listWorkspaceFiles(message.workspacePaths, argsText);
    await sendMessage(token, message.chat.id, listing.text, message.message_id);
    return { stateChanged: false, handled: true };
  }

  if (command === "get") {
    if (!argsText) {
      await sendMessage(token, message.chat.id, "Usage: /get <inbox|outbox|exports/...>", message.message_id);
      return { stateChanged: false, handled: true };
    }

    const resolvedPath = resolveDownloadPath(message.workspacePaths, argsText);
    if (!resolvedPath) {
      await sendMessage(
        token,
        message.chat.id,
        `Path not allowed.\n\nUse a path inside: ${DEFAULT_DOWNLOAD_DIRS.join(", ")}`,
        message.message_id,
      );
      return { stateChanged: false, handled: true };
    }

    try {
      const fileStat = await stat(resolvedPath);
      if (!fileStat.isFile()) {
        throw new Error("not a file");
      }
      const relativePath = toWorkspaceRelativePath(message.workspacePaths.workspaceRoot, resolvedPath) || argsText;
      await sendDocument(
        token,
        message.chat.id,
        resolvedPath,
        message.message_id,
        `Sent from workspace: ${relativePath}`,
      );
    } catch {
      await sendMessage(token, message.chat.id, `File not found: ${argsText}`, message.message_id);
    }
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
  if (context.allowedChatIds && !context.allowedChatIds.has(chatId)) {
    return;
  }

  const uploadedDocument = await saveUploadedDocument(message, context.token, context.workspacePaths);

  const text = getMessageText(message);
  if (!text && !uploadedDocument) {
    await sendMessage(
      context.token,
      message.chat.id,
      "Only text messages and document uploads are supported right now.",
      message.message_id,
    );
    return;
  }

  const state = await readRouterState(context.routerStatePath);
  ensureMainSession(state);
  ensureChatState(state, chatId);

  const slashCommand = parseCommand(text);
  if (slashCommand) {
    const handled = await handleSlashCommand({
      ...slashCommand,
      state,
      chatId,
      token: context.token,
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

  const activeLabel = getActiveSessionLabel(state, chatId);
  const session = state.sessions[activeLabel];
  const mode = session.cliSessionRef ? "Codex resume" : "Codex";

  if (uploadedDocument) {
    const uploadNotice = [
      `Saved file to ${uploadedDocument.relativePath}.`,
      `Name: ${uploadedDocument.originalName}`,
      `Size: ${formatBytes(uploadedDocument.fileSize)}`,
      text ? "Running your caption against the saved file..." : "You can now ask AutoAide to process it.",
    ].join("\n");
    await sendMessage(context.token, message.chat.id, uploadNotice, message.message_id);
  }

  if (!text) {
    return;
  }

  await sendMessage(
    context.token,
    message.chat.id,
    renderRunningMessage(text, activeLabel, mode),
    message.message_id,
  );

  const promptText = uploadedDocument
    ? [
        `A Telegram document was uploaded and saved to workspace path: ${uploadedDocument.relativePath}.`,
        "Treat that file as the primary input unless the user says otherwise.",
        "",
        `User request: ${text}`,
      ].join("\n")
    : text;

  const prompt = await buildWorkspacePrompt(promptText);

  const result = session.cliSessionRef
    ? await runCodexResume(prompt, session.cliSessionRef, context.commandConfig)
    : await runCodexStart(prompt, context.commandConfig);

  if (result.ok && result.cliSessionRef) {
    session.cliSessionRef = result.cliSessionRef;
    session.updatedAt = new Date().toISOString();
    await writeRouterState(context.routerStatePath, state);
  }

  await sendMessage(
    context.token,
    message.chat.id,
    renderCodexResult(result),
    message.message_id,
  );
}

async function main() {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const offsetPath = process.env.TELEGRAM_OFFSET_FILE?.trim() || DEFAULT_OFFSET_PATH;
  const routerStatePath = process.env.TELEGRAM_ROUTER_STATE_FILE?.trim() || DEFAULT_ROUTER_STATE_PATH;
  const pidPath = process.env.TELEGRAM_BRIDGE_PID_FILE?.trim() || DEFAULT_PID_PATH;
  const allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
  const commandConfig = buildCommandConfig();
  const codexCwd = process.env.CODEX_CWD?.trim() || path.join(DEFAULT_AUTOAIDE_HOME, "workspace");
  const workspacePaths = await resolveWorkspacePaths(codexCwd);

  await writePidFile(pidPath);
  process.on("exit", () => {
    void clearPidFile(pidPath);
  });
  process.on("SIGTERM", () => {
    void clearPidFile(pidPath).finally(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void clearPidFile(pidPath).finally(() => process.exit(0));
  });

  let nextOffset = await readOffset(offsetPath);

  console.log("telegram bridge started");
  console.log(`codex cwd: ${codexCwd}`);
  console.log(`codex start: ${commandConfig.startCommand}`);
  console.log(`codex resume: ${commandConfig.resumeTemplate}`);
  console.log(`router state: ${routerStatePath}`);
  if (allowedChatIds) {
    console.log(`allowed chat ids: ${Array.from(allowedChatIds).join(", ")}`);
  }

  while (true) {
    try {
      const updates = await getUpdates(token, nextOffset);
      for (const update of updates) {
        nextOffset = update.update_id + 1;
        await writeOffset(offsetPath, nextOffset);
        await processUpdate(update, {
          token,
          allowedChatIds,
          routerStatePath,
          commandConfig: {
            ...commandConfig,
            cwd: codexCwd,
          },
          workspacePaths,
        });
      }
    } catch (error) {
      console.error("poll loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
