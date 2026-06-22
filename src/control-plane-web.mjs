import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

import {
  canaryRollout,
  createBot,
  deleteBot,
  healthCheckBot,
  inspectBot,
  listBots,
  readBotLogs,
  restartBot,
  rollbackBot,
  rollingRestartBots,
  setActiveBot,
  setBotEnabled,
  startBot,
  stopBot,
  updateBotConfig,
} from "./bots.mjs";
import {
  getSkillsPath,
  getChannelBridgeLogPath,
  getWorkspacePath,
  readActiveBotId,
  readCliState,
  readConfig,
  writeCliState,
} from "./config.mjs";
import { buildCommandConfig, startCliTurn } from "./codex-runner.mjs";
import { launchGoal } from "./goal-controller.mjs";
import { createGoalRecord, listGoals, readGoal, writeGoal } from "./goals-state.mjs";
import { createScheduleRecord, getScheduleById, listSchedules, upsertSchedule } from "./schedules-state.mjs";
import { installSkillFromPath } from "./skills.mjs";
import { hydrateTelegramMetadata } from "./telegram-metadata.mjs";
import { pairTelegramChannel } from "./telegram-pairing.mjs";
import { buildWorkspacePrompt } from "./workspace-context.mjs";
import { adjustPaidCredits, getUserCredits, grantPaidCredits } from "./user-credits.mjs";
import { listUsageEvents } from "./usage-ledger.mjs";
import { listRunRecords } from "./runs-state.mjs";
import { readUsersState, setPrivateEnabled, setUserStatus } from "./users-state.mjs";
import { appendAdminAuditEvent, listAdminAuditEvents } from "./admin-audit-log.mjs";
import { getBotMetrics } from "./analytics-service.mjs";
import { NotFoundError, UserInputError, toPublicError } from "./errors.mjs";
import { appendConversationLogEvent, listConversationLogEvents } from "./conversation-log.mjs";
import {
  appendConversationReviewEvent,
  getLatestConversationReviews,
  listConversationReviewEvents,
} from "./conversation-review.mjs";

const PLACEHOLDER_TOKEN_PATTERNS = [
  /^token-\d+$/i,
  /^your[-_\s]?telegram[-_\s]?token$/i,
  /^your[-_\s]?token[-_\s]?here$/i,
  /^placeholder$/i,
  /^changeme$/i,
  /^example/i,
  /^test[-_\s]?token/i,
];
const DEFAULT_WEB_CHAT_POLL_MS = 500;
const QUICK_TEST_PROMPT = "Reply with one short sentence confirming CodexBridge is ready.";
const REDACTED_SECRET = "[redacted]";
const activeChatRuns = new Map();
const activeGoalRuns = new Map();

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMergeConfig(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = isPlainObject(value) ? deepMergeConfig(base[key] ?? {}, value) : value;
  }
  return merged;
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function text(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(payload);
}

function html(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(payload);
}

function unauthorized(response) {
  response.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "www-authenticate": 'Basic realm="CodexBridge Control Plane"',
  });
  response.end(`${JSON.stringify({ error: "Unauthorized" }, null, 2)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new UserInputError("Request body must be valid JSON.", {
      code: "invalid_json",
    });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isPlaceholderToken(value) {
  const token = String(value || "").trim();
  if (!token) {
    return false;
  }
  return PLACEHOLDER_TOKEN_PATTERNS.some((pattern) => pattern.test(token));
}

function assertSafeTelegramToken(token) {
  if (isPlaceholderToken(token)) {
    throw new UserInputError("Refusing to save placeholder Telegram token.", {
      code: "placeholder_telegram_token",
    });
  }
}

function isRedactedSecret(value) {
  return String(value || "").trim() === REDACTED_SECRET;
}

function redactSecret(value) {
  return String(value || "").trim() ? REDACTED_SECRET : "";
}

function redactConfigSecrets(config) {
  return {
    ...config,
    channels: {
      ...(config.channels || {}),
      telegram: {
        ...(config.channels?.telegram || {}),
        botToken: redactSecret(config.channels?.telegram?.botToken),
      },
      feishu: {
        ...(config.channels?.feishu || {}),
        appSecret: redactSecret(config.channels?.feishu?.appSecret),
      },
    },
  };
}

function redactControlPlaneDetail(detail) {
  return {
    ...detail,
    detail: {
      ...detail.detail,
      config: redactConfigSecrets(detail.detail.config),
    },
  };
}

function getWebOperatorToken() {
  return String(process.env.CODEXBRIDGE_WEB_TOKEN || "").trim();
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthPassword(header) {
  const encoded = String(header || "").replace(/^Basic\s+/i, "").trim();
  if (!encoded) {
    return "";
  }
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    return separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;
  } catch {
    return "";
  }
}

export function isWebRequestAuthorized(request, operatorToken = getWebOperatorToken()) {
  const token = String(operatorToken || "").trim();
  if (!token) {
    return true;
  }
  const headers = request?.headers || {};
  const headerValue = typeof headers.get === "function"
    ? (name) => headers.get(name)
    : (name) => headers[name.toLowerCase()] || headers[name];
  const explicitToken = String(headerValue("x-codexbridge-token") || "").trim();
  if (explicitToken && timingSafeEqualString(explicitToken, token)) {
    return true;
  }
  const authorization = String(headerValue("authorization") || "").trim();
  if (/^Bearer\s+/i.test(authorization)) {
    return timingSafeEqualString(authorization.replace(/^Bearer\s+/i, "").trim(), token);
  }
  if (/^Basic\s+/i.test(authorization)) {
    return timingSafeEqualString(parseBasicAuthPassword(authorization), token);
  }
  return false;
}

function getRunKey(botId, sessionLabel) {
  return `${botId}:${sessionLabel}`;
}

async function getBotHome(botId) {
  const detail = await inspectBot(botId);
  return detail.bot.homePath;
}

async function buildSetupGuide(detail, health, access) {
  const config = detail.config || {};
  const telegram = config.channels?.telegram || {};
  const feishu = config.channels?.feishu || {};
  const runs = await listRunRecords({ limit: 1, botHome: detail.bot.homePath }).catch(() => []);
  const hasImChannel = Boolean(telegram.enabled || feishu.enabled);
  const hasTelegramToken = Boolean(telegram.botToken);
  const hasTelegramIdentity = Boolean(telegram.botUsername || telegram.metadata?.bot?.username);
  const hasAnyAudience = Boolean(
    access.privateChats.length ||
    access.groupChats.length ||
    access.groupUsers.length ||
    feishu.enabled,
  );
  const steps = [
    {
      id: "configure_channel",
      label: "Connect an IM channel",
      status: hasImChannel && (hasTelegramToken || feishu.enabled) ? "done" : "todo",
      action: "Add a Telegram token or enable Feishu in Config.",
      targetTab: telegram.enabled ? "telegram" : "config",
    },
    {
      id: "pair_identity",
      label: "Confirm bot identity",
      status: hasTelegramIdentity || feishu.enabled ? "done" : "todo",
      action: "Use Telegram Pair / Re-pair after pasting the BotFather token.",
      targetTab: "telegram",
    },
    {
      id: "allow_audience",
      label: "Allow a test group or user",
      status: hasAnyAudience ? "done" : "todo",
      action: "Add a group, private chat, or allowed group user so someone can try it.",
      targetTab: "telegram",
    },
    {
      id: "start_runtime",
      label: "Start the bridge runtime",
      status: health.healthy ? "done" : "todo",
      action: "Click Start in the top toolbar.",
      targetTab: "overview",
    },
    {
      id: "send_first_message",
      label: "Send one test message",
      status: runs.length > 0 ? "done" : "todo",
      action: "Use Chat or send a message from the connected IM group.",
      targetTab: "chat",
    },
  ];
  const completed = steps.filter((step) => step.status === "done").length;
  return {
    ready: completed === steps.length,
    completed,
    total: steps.length,
    nextStep: steps.find((step) => step.status !== "done") || null,
    steps,
  };
}

function buildQuickTestPreflight(setupGuide) {
  const missing = (setupGuide?.steps || [])
    .filter((step) => step.status !== "done" && step.id !== "send_first_message");
  if (missing.length === 0) {
    return {
      readyForIm: true,
      message: "Quick test can run now. IM setup also looks ready.",
      missingSteps: [],
    };
  }
  return {
    readyForIm: false,
    message: `Quick test can still verify local Codex. Before inviting users, finish: ${missing.map((step) => step.label).join(", ")}.`,
    missingSteps: missing.map((step) => ({
      id: step.id,
      label: step.label,
      action: step.action,
      targetTab: step.targetTab,
    })),
  };
}

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

async function readBridgeLogs(botId, lines = 200) {
  const detail = await inspectBot(botId);
  const logPath = getChannelBridgeLogPath(detail.bot.channel, detail.bot.homePath);
  const raw = await readFile(logPath, "utf8").catch(() => "");
  const chunks = raw.trimEnd().split(/\r?\n/).filter(Boolean);
  return {
    logPath,
    content: chunks.slice(-lines).join("\n"),
  };
}

async function readBotSessions(botId) {
  const botHome = await getBotHome(botId);
  const cliState = await readCliState(botHome);
  const sessions = Object.values(cliState.sessions ?? {}).sort((a, b) => a.label.localeCompare(b.label));
  return {
    activeSessionLabel: cliState.activeSessionLabel,
    sessions,
  };
}

async function createBotSession(botId, label) {
  const nextLabel = String(label || "").trim();
  if (!nextLabel) {
    throw new UserInputError("Session label is required.", { code: "session_label_required" });
  }
  const botHome = await getBotHome(botId);
  const cliState = await readCliState(botHome);
  if (!cliState.sessions[nextLabel]) {
    const timestamp = nowIso();
    cliState.sessions[nextLabel] = {
      label: nextLabel,
      cliSessionRef: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  cliState.activeSessionLabel = nextLabel;
  cliState.sessions[nextLabel].updatedAt = nowIso();
  await writeCliState(cliState, botHome);
  return await readBotSessions(botId);
}

async function activateBotSession(botId, label) {
  const nextLabel = String(label || "").trim();
  if (!nextLabel) {
    throw new UserInputError("Session label is required.", { code: "session_label_required" });
  }
  const botHome = await getBotHome(botId);
  const cliState = await readCliState(botHome);
  if (!cliState.sessions[nextLabel]) {
    throw new NotFoundError(`Unknown session: ${nextLabel}`, { code: "session_not_found" });
  }
  cliState.activeSessionLabel = nextLabel;
  cliState.sessions[nextLabel].updatedAt = nowIso();
  await writeCliState(cliState, botHome);
  return await readBotSessions(botId);
}

function summarizeRun(run) {
  if (!run) {
    return {
      running: false,
      status: "idle",
      prompt: "",
      output: "",
      error: null,
      friendlyMessage: "No test has run yet. Click Run Quick Test to verify this bot.",
      sessionLabel: null,
      startedAt: null,
      finishedAt: null,
    };
  }
  const friendlyMessage = run.status === "running"
    ? "Running now. You can wait here; the output will update automatically."
    : run.status === "completed"
      ? "Quick test completed. This bot can run a CodexBridge turn from the web console."
      : run.status === "stopped"
        ? "The run was stopped before it finished. Start another quick test when ready."
        : run.status === "failed"
          ? "The run failed before CodexBridge returned a usable answer. Check the Runtime Log below, then verify Codex is installed and logged in on this host."
          : "No test has run yet. Click Run Quick Test to verify this bot.";
  return {
    running: run.status === "running",
    status: run.status,
    prompt: run.prompt,
    output: run.output,
    error: run.error,
    friendlyMessage,
    sessionLabel: run.sessionLabel,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

async function readChatStatus(botId, sessionLabel = null) {
  const sessions = await readBotSessions(botId);
  const label = sessionLabel || sessions.activeSessionLabel || "main";
  const run = activeChatRuns.get(getRunKey(botId, label));
  return {
    ...summarizeRun(run),
    sessionLabel: label,
    activeSessionLabel: sessions.activeSessionLabel,
  };
}

async function startBotChat(botId, { prompt, sessionLabel = null } = {}) {
  const nextPrompt = String(prompt || "").trim();
  if (!nextPrompt) {
    throw new UserInputError("Prompt is required.", { code: "prompt_required" });
  }
  const botHome = await getBotHome(botId);
  const config = await readConfig(botHome);
  const cliState = await readCliState(botHome);
  const label = sessionLabel || cliState.activeSessionLabel || "main";
  if (!cliState.sessions[label]) {
    const timestamp = nowIso();
    cliState.sessions[label] = {
      label,
      cliSessionRef: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  cliState.activeSessionLabel = label;
  await writeCliState(cliState, botHome);

  const key = getRunKey(botId, label);
  const existing = activeChatRuns.get(key);
  if (existing?.status === "running") {
    throw new UserInputError(`Session ${label} is already running.`, {
      code: "session_already_running",
      statusCode: 409,
    });
  }

  const session = cliState.sessions[label];
  const commandConfig = {
    ...buildCommandConfig(config),
    cwd: getWorkspacePath(botHome),
  };
  const run = {
    botId,
    sessionLabel: label,
    prompt: nextPrompt,
    startedAt: nowIso(),
    finishedAt: null,
    status: "running",
    output: "",
    error: null,
    child: null,
  };
  activeChatRuns.set(key, run);
  await appendConversationLogEvent({
    userId: "local-web",
    channel: "web",
    chatType: "direct",
    chatId: botId,
    conversationId: label,
    direction: "input",
    content: nextPrompt,
    metadata: {
      sessionLabel: label,
    },
  }, botHome).catch(() => {});

  const started = startCliTurn(await buildWorkspacePrompt(nextPrompt, { botHome }), session.cliSessionRef, commandConfig);
  run.child = started.child;
  void started.result.then(async (result) => {
    const latestState = await readCliState(botHome);
    latestState.sessions[label] = {
      ...(latestState.sessions[label] ?? session),
      label,
      cliSessionRef: result.cliSessionRef || latestState.sessions[label]?.cliSessionRef || null,
      createdAt: latestState.sessions[label]?.createdAt || session.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    latestState.activeSessionLabel = label;
    await writeCliState(latestState, botHome);
    run.finishedAt = nowIso();
    run.child = null;
    if (result.ok) {
      run.status = "completed";
      run.output = result.output || "";
      await appendConversationLogEvent({
        userId: "local-web",
        channel: "web",
        chatType: "direct",
        chatId: botId,
        conversationId: label,
        direction: "output",
        content: run.output || "Done.",
        metadata: {
          sessionLabel: label,
          ok: true,
        },
      }, botHome).catch(() => {});
      return;
    }
    run.status = result.signal ? "stopped" : "failed";
    run.error = [result.output, result.stderr].filter(Boolean).join("\n\n") || "Chat run failed.";
    await appendConversationLogEvent({
      userId: "local-web",
      channel: "web",
      chatType: "direct",
      chatId: botId,
      conversationId: label,
      direction: "output",
      content: run.error,
      metadata: {
        sessionLabel: label,
        ok: false,
        stopped: Boolean(result.signal),
      },
    }, botHome).catch(() => {});
  }).catch((error) => {
    run.finishedAt = nowIso();
    run.child = null;
    run.status = "failed";
    run.error = error.message;
    void appendConversationLogEvent({
      userId: "local-web",
      channel: "web",
      chatType: "direct",
      chatId: botId,
      conversationId: label,
      direction: "output",
      content: run.error,
      metadata: {
        sessionLabel: label,
        ok: false,
      },
    }, botHome).catch(() => {});
  });

  return await readChatStatus(botId, label);
}

async function startQuickTestForBot(botId) {
  const detail = await getBotControlPlaneDetail(botId);
  const run = await startBotChat(botId, {
    prompt: QUICK_TEST_PROMPT,
    sessionLabel: "main",
  });
  return {
    ...run,
    preflight: buildQuickTestPreflight(detail.setupGuide),
  };
}

async function stopBotChat(botId, sessionLabel = null) {
  const status = await readChatStatus(botId, sessionLabel);
  for (const active of activeGoalRuns.values()) {
    if (active?.botId === botId && active?.sessionLabel === status.sessionLabel) {
      active.controller.stopRequested = true;
      active.controller.activeChild?.kill("SIGINT");
      return await readChatStatus(botId, status.sessionLabel);
    }
  }
  const run = activeChatRuns.get(getRunKey(botId, status.sessionLabel));
  if (!run || run.status !== "running" || !run.child) {
    return status;
  }
  run.child.kill("SIGINT");
  return await readChatStatus(botId, status.sessionLabel);
}

function listWorkspaceFilesFrom(entries, prefix = "") {
  return entries.flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return [{ path: relative, type: "dir" }];
    }
    return [{ path: relative, type: "file" }];
  });
}

async function listWorkspaceFiles(botId) {
  const botHome = await getBotHome(botId);
  const workspacePath = getWorkspacePath(botHome);
  const entries = await readdir(workspacePath, { withFileTypes: true }).catch(() => []);
  return listWorkspaceFilesFrom(entries)
    .filter((entry) => entry.path !== "memory")
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function readWorkspaceFileForBot(botId, relativePath) {
  const botHome = await getBotHome(botId);
  const workspacePath = getWorkspacePath(botHome);
  const sanitized = path.normalize(String(relativePath || "")).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!sanitized || sanitized.startsWith("..")) {
    throw new UserInputError("Workspace file path is required.", { code: "workspace_path_required" });
  }
  const filePath = path.join(workspacePath, sanitized);
  const content = await readFile(filePath, "utf8");
  return {
    path: sanitized,
    content,
  };
}

async function writeWorkspaceFileForBot(botId, relativePath, content) {
  const botHome = await getBotHome(botId);
  const workspacePath = getWorkspacePath(botHome);
  const sanitized = path.normalize(String(relativePath || "")).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!sanitized || sanitized.startsWith("..")) {
    throw new UserInputError("Workspace file path is required.", { code: "workspace_path_required" });
  }
  const filePath = path.join(workspacePath, sanitized);
  await writeFile(filePath, String(content ?? ""), "utf8");
  return {
    path: sanitized,
    content: await readFile(filePath, "utf8"),
  };
}

async function listBotSkills(botId) {
  const botHome = await getBotHome(botId);
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
          const matchName = raw.match(/^name:\s*(.+)$/m);
          const matchDescription = raw.match(/^description:\s*(.+)$/m);
          return {
            id: entry.name,
            name: matchName?.[1]?.trim() || entry.name,
            description: matchDescription?.[1]?.trim() || "No description.",
            path: skillPath,
          };
        }),
    )
  ).filter(Boolean);
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

async function installSkillForBot(botId, sourcePath) {
  const botHome = await getBotHome(botId);
  return await withBotHome(botHome, async () => await installSkillFromPath(sourcePath, { force: true }));
}

async function pairTelegramForBot(botId, token) {
  const nextToken = String(token || "").trim();
  if (!nextToken) {
    throw new UserInputError("Telegram token is required.", { code: "telegram_token_required" });
  }
  assertSafeTelegramToken(nextToken);
  const botHome = await getBotHome(botId);
  const paired = await pairTelegramChannel(nextToken);
  await updateBotConfig(botId, (currentConfig) => {
    const existingGroupUserIds = currentConfig.channels?.telegram?.groups?.allowedUserIds ?? [];
    return {
      ...currentConfig,
      enabled: true,
      channels: {
        ...currentConfig.channels,
        telegram: {
          ...(currentConfig.channels?.telegram ?? {}),
          enabled: true,
          botToken: nextToken,
          botUsername: paired.botUsername || currentConfig.channels?.telegram?.botUsername || "",
          metadata: {
            chats: {
              ...(currentConfig.channels?.telegram?.metadata?.chats ?? {}),
              [paired.chatId]: {
                type: "private",
                username: paired.userUsername ?? null,
                label: paired.userUsername ? `@${paired.userUsername.replace(/^@+/, "")}` : null,
              },
            },
            users: {
              ...(currentConfig.channels?.telegram?.metadata?.users ?? {}),
              [paired.userId]: {
                username: paired.userUsername ?? null,
                label: paired.userUsername ? `@${paired.userUsername.replace(/^@+/, "")}` : null,
              },
            },
          },
          private: {
            allowedChatIds: [paired.chatId],
          },
          groups: {
            allowedChatIds: currentConfig.channels?.telegram?.groups?.allowedChatIds ?? [],
            allowedUserIds: Array.from(new Set([...existingGroupUserIds, paired.userId])),
            requireExplicitMention: currentConfig.channels?.telegram?.groups?.requireExplicitMention ?? true,
          },
        },
      },
    };
  });
  const detail = await getBotControlPlaneDetail(botId);
  return {
    chatId: paired.chatId,
    userId: paired.userId,
    botUsername: paired.botUsername,
    detail,
  };
}

async function allowTelegramAccessForBot(botId, { accessType, id } = {}) {
  const normalizedType = String(accessType || "").trim();
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    throw new UserInputError("Telegram access id is required.", { code: "telegram_access_id_required" });
  }
  if (!["private_chat", "group_chat", "group_user"].includes(normalizedType)) {
    throw new UserInputError("Telegram access type is required.", { code: "telegram_access_type_required" });
  }
  await updateBotConfig(botId, (currentConfig) => {
    const telegram = currentConfig.channels?.telegram ?? {};
    const privateChatIds = telegram.private?.allowedChatIds ?? [];
    const groupChatIds = telegram.groups?.allowedChatIds ?? [];
    const groupUserIds = telegram.groups?.allowedUserIds ?? [];
    return {
      ...currentConfig,
      channels: {
        ...currentConfig.channels,
        telegram: {
          ...telegram,
          private: {
            ...(telegram.private ?? {}),
            allowedChatIds: normalizedType === "private_chat"
              ? Array.from(new Set([...privateChatIds, normalizedId]))
              : privateChatIds,
          },
          groups: {
            ...(telegram.groups ?? {}),
            allowedChatIds: normalizedType === "group_chat"
              ? Array.from(new Set([...groupChatIds, normalizedId]))
              : groupChatIds,
            allowedUserIds: normalizedType === "group_user"
              ? Array.from(new Set([...groupUserIds, normalizedId]))
              : groupUserIds,
            requireExplicitMention: telegram.groups?.requireExplicitMention ?? true,
          },
        },
      },
    };
  });
  return await getBotControlPlaneDetail(botId);
}

function applySafeConfigPatch(currentConfig, patch) {
  const nextConfig = deepMergeConfig(currentConfig, patch);
  const nextToken = nextConfig.channels?.telegram?.botToken;
  const currentToken = currentConfig.channels?.telegram?.botToken || "";
  if (isRedactedSecret(nextToken)) {
    nextConfig.channels.telegram.botToken = currentToken;
  }
  if (typeof nextToken === "string" && nextToken.trim() !== currentToken.trim()) {
    if (!nextToken.trim()) {
      return nextConfig;
    }
    if (!isRedactedSecret(nextToken)) {
      assertSafeTelegramToken(nextToken);
    }
  }

  const nextFeishuSecret = nextConfig.channels?.feishu?.appSecret;
  const currentFeishuSecret = currentConfig.channels?.feishu?.appSecret || "";
  if (isRedactedSecret(nextFeishuSecret)) {
    nextConfig.channels.feishu.appSecret = currentFeishuSecret;
  }
  return nextConfig;
}

async function listBotGoals(botId) {
  const botHome = await getBotHome(botId);
  return await withBotHome(botHome, async () => await listGoals({ limit: 40 }));
}

async function startGoalForBot(botId, { objective, sessionLabel = null } = {}) {
  const nextObjective = String(objective || "").trim();
  if (!nextObjective) {
    throw new UserInputError("Goal objective is required.", { code: "goal_objective_required" });
  }
  const botHome = await getBotHome(botId);
  const sessions = await readCliState(botHome);
  const label = sessionLabel || sessions.activeSessionLabel || "main";
  const goal = createGoalRecord({
    objective: nextObjective,
    chatId: botId,
    sessionLabel: label,
    channel: "web",
  });
  goal.conversationSessionRef = sessions.sessions?.[label]?.cliSessionRef || null;
  await withBotHome(botHome, async () => await writeGoal(goal));
  const config = await readConfig(botHome);
  const commandConfig = {
    ...buildCommandConfig(config),
    cwd: getWorkspacePath(botHome),
  };
  await launchGoal(goal, {
    runningGoals: activeGoalRuns,
    commandConfig,
    registration: {
      chatId: botId,
      sessionLabel: goal.sessionLabel,
    },
    persistGoal: async (nextGoal) => await withBotHome(botHome, async () => await writeGoal(nextGoal)),
    notify: async () => {},
    onGoalStarted: (_startedGoal, entry) => {
      activeGoalRuns.set(goal.id, { ...entry, botId, sessionLabel: goal.sessionLabel });
    },
    onGoalFinished: async ({ goal: finalGoal }) => {
      await withBotHome(botHome, async () => await writeGoal(finalGoal));
    },
    onGoalFailed: async ({ goal: failedGoal, error }) => {
      await withBotHome(botHome, async () => {
        const nextGoal = {
          ...failedGoal,
          status: "failed",
          phase: "runner_failed",
          error: error.message,
        };
        await writeGoal(nextGoal);
      });
    },
  });
  return goal;
}

async function listBotSchedules(botId) {
  const botHome = await getBotHome(botId);
  return await withBotHome(botHome, async () => await listSchedules());
}

async function createScheduleForBot(botId, { objective, cron, timezone } = {}) {
  const nextObjective = String(objective || "").trim();
  const nextCron = String(cron || "").trim();
  const nextTimezone = String(timezone || "").trim() || "Asia/Shanghai";
  if (!nextObjective || !nextCron) {
    throw new UserInputError("Schedule objective and cron are required.", {
      code: "schedule_objective_and_cron_required",
    });
  }
  const botHome = await getBotHome(botId);
  return await withBotHome(botHome, async () => {
    const schedule = createScheduleRecord({
      chatId: botId,
      objective: nextObjective,
      cron: nextCron,
      timezone: nextTimezone,
    });
    return await upsertSchedule(schedule);
  });
}

async function toggleScheduleForBot(botId, scheduleId, enabled) {
  const botHome = await getBotHome(botId);
  return await withBotHome(botHome, async () => {
    const schedule = await getScheduleById(scheduleId);
    if (!schedule) {
      throw new NotFoundError(`Unknown schedule: ${scheduleId}`, { code: "schedule_not_found" });
    }
    schedule.enabled = enabled;
    schedule.updatedAt = nowIso();
    return await upsertSchedule(schedule);
  });
}

async function listBotUsers(botId) {
  const botHome = await getBotHome(botId);
  const state = await readUsersState(botHome);
  const users = await Promise.all(
    Object.values(state.users).map(async (user) => {
      const credits = await getUserCredits(user.id, botHome);
      return {
        ...user,
        credits: {
          paidCredits: credits.account.paidCredits,
          dailyFreeUsed: credits.account.dailyFreeUsed,
          dailyFreeLimit: credits.account.dailyFreeLimit,
          totalConsumed: credits.account.totalConsumed,
        },
      };
    }),
  );
  return users.sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
}

async function grantCreditsForBot(botId, userId, amount) {
  const botHome = await getBotHome(botId);
  const result = await grantPaidCredits({ userId, amount, botHome });
  await appendAdminAuditEvent({
    action: "grant_credits",
    userId,
    amount: result.granted,
    reason: "manual_grant",
  }, botHome);
  return {
    user: (await readUsersState(botHome)).users[userId] || null,
    credits: result,
  };
}

async function adjustCreditsForBot(botId, userId, amount, reason) {
  const botHome = await getBotHome(botId);
  const result = await adjustPaidCredits({ userId, amount, reason, botHome });
  await appendAdminAuditEvent({
    action: "adjust_credits",
    userId,
    amount: result.adjusted,
    reason,
  }, botHome);
  return {
    user: (await readUsersState(botHome)).users[userId] || null,
    credits: result,
  };
}

async function updateUserStatusForBot(botId, userId, status) {
  const botHome = await getBotHome(botId);
  const user = await setUserStatus(userId, status, botHome);
  await appendAdminAuditEvent({
    action: "set_user_status",
    userId,
    status: user.status,
    reason: "manual_status_update",
  }, botHome);
  return user;
}

async function updatePrivateEnabledForBot(botId, userId, privateEnabled) {
  const botHome = await getBotHome(botId);
  const user = await setPrivateEnabled(userId, privateEnabled, botHome);
  await appendAdminAuditEvent({
    action: "set_private_enabled",
    userId,
    privateEnabled: user.privateEnabled,
    reason: "manual_private_update",
  }, botHome);
  return user;
}

async function listUsageForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listUsageEvents({
    botHome,
    userId: options.userId || null,
    limit: options.limit || 100,
  });
}

async function listRunsForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listRunRecords({
    botHome,
    userId: options.userId || null,
    limit: options.limit || 100,
  });
}

async function listAdminAuditForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listAdminAuditEvents({
    botHome,
    userId: options.userId || null,
    limit: options.limit || 100,
  });
}

async function getMetricsForBot(botId) {
  const botHome = await getBotHome(botId);
  return await getBotMetrics({ botHome });
}

async function listConversationLogsForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  const [events, latestReviews] = await Promise.all([
    listConversationLogEvents({
      botHome,
      userId: options.userId || null,
      runId: options.runId || null,
      direction: options.direction || null,
      riskLabel: options.riskLabel || null,
      riskOnly: options.riskOnly === true || options.riskOnly === "true",
      createdAfter: options.createdAfter || null,
      createdBefore: options.createdBefore || null,
      redactContent: true,
      limit: options.limit || 100,
    }),
    getLatestConversationReviews({ botHome }),
  ]);
  const reviewStatus = String(options.reviewStatus || "").trim();
  return events
    .map((event) => ({
      ...event,
      review: latestReviews.get(event.eventId) || null,
    }))
    .filter((event) => !reviewStatus || event.review?.status === reviewStatus);
}

async function listConversationReviewsForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listConversationReviewEvents({
    botHome,
    eventId: options.eventId || null,
    status: options.status || null,
    limit: options.limit || 100,
  });
}

async function reviewConversationLogForBot(botId, eventId, body = {}) {
  const botHome = await getBotHome(botId);
  const normalizedEventId = String(eventId || "").trim();
  if (!normalizedEventId) {
    throw new UserInputError("Conversation event id is required.", { code: "conversation_event_id_required" });
  }
  return await appendConversationReviewEvent({
    eventId: normalizedEventId,
    status: body.status,
    reviewer: body.reviewer || "local-web",
    note: body.note || "",
  }, botHome);
}

export async function getControlPlaneSnapshot() {
  const bots = await listBots();
  const health = await Promise.all(
    bots.map(async (bot) => ({
      id: bot.id,
      health: await healthCheckBot(bot.id),
    })),
  );
  return {
    generatedAt: new Date().toISOString(),
    currentBotId: await readActiveBotId(),
    bots,
    health,
  };
}

export async function getBotControlPlaneDetail(botId) {
  const detail = await inspectBot(botId);
  detail.config = await hydrateTelegramMetadata(detail.bot.homePath).catch(() => detail.config);
  const health = await healthCheckBot(botId);
  const telegram = detail.config.channels?.telegram ?? {};
  const metadata = telegram.metadata ?? { chats: {}, users: {} };
  const formatEntry = (id, source) => {
    const entry = source?.[id];
    if (entry?.label) {
      return `${entry.label} (${id})`;
    }
    if (entry?.username) {
      return `@${String(entry.username).replace(/^@+/, "")} (${id})`;
    }
    if (entry?.title) {
      return `${entry.title} (${id})`;
    }
    return String(id);
  };
  const access = {
    privateChats: (telegram.private?.allowedChatIds ?? []).map((id) => formatEntry(id, metadata.chats)),
    groupChats: (telegram.groups?.allowedChatIds ?? []).map((id) => formatEntry(id, metadata.chats)),
    groupUsers: (telegram.groups?.allowedUserIds ?? []).map((id) => formatEntry(id, metadata.users)),
  };
  const setupGuide = await buildSetupGuide(detail, health, access);
  return {
    detail,
    health,
    logs: await readBotLogs(botId, 50),
    access,
    setupGuide,
    quickTestPreflight: buildQuickTestPreflight(setupGuide),
  };
}

function renderHtmlPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CodexBridge Control Plane</title>
    <style>
      :root {
        --bg-0: #09100e;
        --bg-1: #0d1512;
        --bg-2: #111a17;
        --panel-0: rgba(18, 29, 25, 0.92);
        --panel-1: rgba(22, 35, 31, 0.94);
        --panel-2: rgba(26, 41, 36, 0.96);
        --line-0: #20332d;
        --line-1: #2a433b;
        --text-0: #e4f2ec;
        --text-1: #b8cbc3;
        --text-2: #7e958d;
        --accent-0: #37f3c8;
        --accent-1: #7cff5b;
        --warn-0: #f6b73c;
        --danger-0: #e85d4f;
        --shadow-soft: 0 18px 48px rgba(0, 0, 0, 0.35);
        --glow-accent: 0 0 18px rgba(55, 243, 200, 0.14);
      }
      * { box-sizing: border-box; }
      html { color-scheme: dark; }
      body {
        margin: 0;
        color: var(--text-0);
        font-family: "IBM Plex Sans Condensed", "Rajdhani", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(55, 243, 200, 0.06), transparent 26%),
          radial-gradient(circle at top right, rgba(124, 255, 91, 0.05), transparent 24%),
          linear-gradient(180deg, var(--bg-0), var(--bg-1) 34%, var(--bg-2));
        min-height: 100vh;
        position: relative;
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background:
          linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
        background-size: 100% 28px, 28px 100%;
        opacity: 0.18;
      }
      body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(180deg, rgba(255,255,255,0.035), transparent 12%, transparent 88%, rgba(255,255,255,0.03));
        mix-blend-mode: soft-light;
        opacity: 0.3;
      }
      main {
        max-width: 1680px;
        margin: 0 auto;
        padding: 18px 18px 26px;
        position: relative;
        z-index: 1;
      }
      h1, h2, h3 { margin: 0; }
      h1, h2, h3, .metric-value, .tab {
        font-family: "Rajdhani", "IBM Plex Sans Condensed", sans-serif;
        letter-spacing: 0.03em;
      }
      .subtle { color: var(--text-2); }
      .panel,
      .card,
      .metric,
      .list-item,
      pre,
      textarea,
      input,
      select,
      .modal {
        backdrop-filter: blur(10px);
      }
      .panel {
        background: linear-gradient(180deg, rgba(25, 38, 34, 0.92), rgba(16, 26, 22, 0.94));
        border: 1px solid var(--line-0);
        border-radius: 18px;
        padding: 16px;
        box-shadow: var(--shadow-soft);
        position: relative;
        overflow: hidden;
      }
      .panel::before,
      .card::before,
      .metric::before,
      .list-item::before,
      .modal::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        border: 1px solid rgba(255,255,255,0.03);
      }
      .topbar {
        display: grid;
        grid-template-columns: 1.1fr auto;
        gap: 16px;
        align-items: start;
        min-height: 110px;
      }
      .headline {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .eyebrow {
        color: var(--accent-0);
        text-transform: uppercase;
        font-size: 12px;
        letter-spacing: 0.18em;
      }
      .headline h1 {
        font-size: 36px;
        line-height: 0.95;
      }
      .status-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 11px;
        border-radius: 999px;
        border: 1px solid var(--line-1);
        font-size: 12px;
        color: var(--text-1);
        background: rgba(7, 14, 12, 0.75);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .pill::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: var(--text-2);
        box-shadow: 0 0 8px rgba(255,255,255,0.08);
      }
      .pill.accent {
        color: var(--accent-0);
        border-color: rgba(55, 243, 200, 0.38);
        box-shadow: inset 0 0 0 1px rgba(55, 243, 200, 0.08), var(--glow-accent);
      }
      .pill.accent::before {
        background: var(--accent-0);
        box-shadow: 0 0 10px rgba(55, 243, 200, 0.5);
      }
      .pill.danger {
        color: var(--danger-0);
        border-color: rgba(232, 93, 79, 0.38);
      }
      .pill.danger::before {
        background: var(--danger-0);
        box-shadow: 0 0 10px rgba(232, 93, 79, 0.38);
      }
      button {
        appearance: none;
        border: 1px solid var(--line-1);
        background: linear-gradient(180deg, rgba(17, 28, 24, 0.94), rgba(10, 17, 15, 0.96));
        color: var(--text-0);
        border-radius: 12px;
        padding: 10px 14px;
        cursor: pointer;
        font: inherit;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        transition: border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease, color 140ms ease;
      }
      button:hover {
        border-color: rgba(55, 243, 200, 0.35);
        box-shadow: var(--glow-accent);
        transform: translateY(-1px);
      }
      button.primary {
        color: #03110d;
        border-color: rgba(55, 243, 200, 0.62);
        background: linear-gradient(180deg, var(--accent-0), #1fcba5);
        box-shadow: 0 0 16px rgba(55, 243, 200, 0.22);
      }
      button.danger {
        color: var(--danger-0);
      }
      button.ghost {
        background: transparent;
      }
      pre {
        background: linear-gradient(180deg, rgba(9, 15, 13, 0.96), rgba(12, 19, 16, 0.98));
        border: 1px solid var(--line-0);
        border-radius: 14px;
        padding: 13px 14px;
        overflow: auto;
        white-space: pre-wrap;
        color: var(--text-1);
        font-family: "IBM Plex Mono", "JetBrains Mono", monospace;
        font-size: 12px;
        line-height: 1.55;
      }
      textarea, input, select {
        width: 100%;
        border: 1px solid var(--line-0);
        border-radius: 12px;
        padding: 10px 12px;
        background: linear-gradient(180deg, rgba(11, 18, 16, 0.96), rgba(14, 23, 20, 0.96));
        color: var(--text-0);
        font: inherit;
      }
      textarea {
        min-height: 220px;
        resize: vertical;
        font-family: "IBM Plex Mono", "JetBrains Mono", monospace;
        line-height: 1.5;
      }
      input::placeholder,
      textarea::placeholder {
        color: #5f776f;
      }
      .app-shell {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr) 340px;
        gap: 16px;
        margin-top: 16px;
        align-items: start;
      }
      .fleet-rail,
      .main-panel,
      .side-panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .fleet-list,
      .list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .bot-row,
      .list-item {
        border: 1px solid var(--line-0);
        border-radius: 14px;
        padding: 12px;
        background: linear-gradient(180deg, rgba(15, 24, 21, 0.98), rgba(10, 16, 14, 0.98));
        position: relative;
      }
      .bot-row {
        cursor: pointer;
      }
      .bot-row.current {
        border-color: rgba(55, 243, 200, 0.5);
        box-shadow: inset 0 0 0 1px rgba(55, 243, 200, 0.14), var(--glow-accent);
      }
      .muted-box {
        border: 1px dashed var(--line-1);
        border-radius: 14px;
        padding: 13px;
        color: var(--text-2);
        background: rgba(7, 14, 12, 0.52);
        line-height: 1.55;
      }
      .section-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .section-kicker {
        color: var(--accent-0);
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        margin-bottom: 6px;
      }
      .bot-hero {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 18px;
        align-items: start;
      }
      .hero-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        min-width: 260px;
      }
      .mode-panel {
        padding: 12px;
      }
      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .tab {
        padding: 8px 12px;
        border-radius: 10px;
        border: 1px solid var(--line-0);
        background: rgba(11, 18, 16, 0.9);
        cursor: pointer;
        color: var(--text-1);
        text-transform: uppercase;
        font-size: 13px;
      }
      .tab.active {
        color: var(--accent-0);
        border-color: rgba(55, 243, 200, 0.45);
        box-shadow: inset 0 0 0 1px rgba(55, 243, 200, 0.11), var(--glow-accent);
      }
      .tab-panel {
        display: none;
      }
      .tab-panel.active {
        display: block;
      }
      .overview-metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }
      .metric {
        border: 1px solid var(--line-0);
        border-radius: 14px;
        padding: 14px;
        background: linear-gradient(180deg, rgba(15, 24, 21, 0.96), rgba(10, 16, 14, 0.98));
        position: relative;
      }
      .metric-label {
        font-size: 11px;
        color: var(--text-2);
        text-transform: uppercase;
        letter-spacing: 0.16em;
      }
      .metric-value {
        margin-top: 10px;
        font-size: 26px;
        line-height: 1;
      }
      .card-grid,
      .two-col,
      .chat-shell {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .chat-shell {
        grid-template-columns: 280px 1fr;
      }
      .card {
        border: 1px solid var(--line-0);
        border-radius: 14px;
        padding: 14px;
        background: linear-gradient(180deg, rgba(15, 24, 21, 0.98), rgba(10, 16, 14, 0.98));
        min-width: 0;
        position: relative;
      }
      .kv {
        display: grid;
        grid-template-columns: 132px 1fr;
        gap: 8px 12px;
        margin-top: 10px;
        min-width: 0;
      }
      .kv div:nth-child(odd) {
        color: var(--text-2);
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.12em;
      }
      .kv div:nth-child(even) {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      .inspector-stack {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .compact-card h3 {
        margin-bottom: 10px;
      }
      .diagnostics {
        margin-top: 16px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .log-panel pre {
        min-height: 260px;
        margin: 0;
      }
      .toast {
        position: fixed;
        right: 18px;
        bottom: 18px;
        background: rgba(7, 15, 13, 0.96);
        color: var(--text-0);
        border: 1px solid rgba(55, 243, 200, 0.35);
        box-shadow: var(--glow-accent), var(--shadow-soft);
        padding: 12px 14px;
        border-radius: 14px;
        max-width: 360px;
        display: none;
        z-index: 20;
      }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(2, 7, 6, 0.72);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        z-index: 30;
      }
      .modal {
        width: min(560px, 100%);
        background: linear-gradient(180deg, rgba(18, 29, 25, 0.98), rgba(11, 18, 16, 0.98));
        border: 1px solid var(--line-0);
        border-radius: 18px;
        padding: 18px;
        box-shadow: var(--shadow-soft);
        position: relative;
      }
      .modal-grid {
        display: grid;
        gap: 12px;
        margin-top: 12px;
      }
      .divider-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: var(--accent-0);
        margin-bottom: 10px;
      }
      @media (max-width: 1320px) {
        .app-shell {
          grid-template-columns: 280px 1fr;
        }
        .side-panel {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
      }
      @media (max-width: 1120px) {
        .app-shell,
        .diagnostics,
        .chat-shell,
        .two-col,
        .card-grid,
        .topbar,
        .bot-hero,
        .overview-metrics,
        .side-panel {
          grid-template-columns: 1fr;
        }
        .hero-actions {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          min-width: 0;
        }
        .status-strip {
          justify-content: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel topbar">
        <div class="headline">
          <div class="eyebrow">Autonomous Operations Console</div>
          <h1>CodexBridge Web Console</h1>
          <p class="subtle">Hard-sci-fi local control room for bots, sessions, goals, schedules, workspace files, and live Telegram runtime state.</p>
        </div>
        <div class="status-strip">
          <span class="pill accent" id="top-current-bot">current bot: loading</span>
          <span class="pill" id="top-runtime">runtime: unknown</span>
          <span class="pill" id="top-telegram">telegram: unknown</span>
          <span class="pill" id="top-enabled">enabled: unknown</span>
        </div>
      </section>

      <div class="app-shell">
        <aside class="fleet-rail">
          <section class="panel">
            <div class="section-kicker">Fleet</div>
            <div class="section-title">
              <h2>Bot Rail</h2>
              <button class="primary" id="open-create-bot">+ New Bot</button>
            </div>
            <div class="muted-box">
              Canonical bot config stays bot-scoped. Placeholder Telegram tokens are rejected on write.
            </div>
          </section>

          <section class="panel">
            <div class="section-title">
              <h3>Fleet Nodes</h3>
            </div>
            <div id="bots" class="fleet-list">Loading...</div>
          </section>

          <section class="panel">
            <div class="section-title">
              <h3>Global Actions</h3>
            </div>
            <div class="toolbar">
              <button id="fleet-set-current">Set Current</button>
              <button id="fleet-delete" class="danger">Delete</button>
            </div>
          </section>
        </aside>

        <section class="main-panel">
          <div class="section-title">
            <div>
              <div class="section-kicker">Current Bot</div>
              <h2 id="bot-title">Select a bot</h2>
            </div>
            <div class="badge-row" id="bot-badges"></div>
          </div>
          <section class="panel bot-hero">
            <div>
              <p class="subtle" id="bot-subtitle">No bot selected.</p>
            </div>
            <div class="hero-actions">
              <button class="primary" id="action-start">Start</button>
              <button id="action-stop">Stop</button>
              <button id="action-restart">Restart</button>
              <button id="action-enable">Enable / Disable</button>
              <button id="action-use">Set Current</button>
            </div>
          </section>

          <section class="panel mode-panel">
            <div class="section-kicker">Work Surface</div>
            <div class="tabs" id="tabs">
              <button class="tab active" data-tab="overview">Overview</button>
              <button class="tab" data-tab="telegram">Telegram</button>
              <button class="tab" data-tab="feishu">Feishu</button>
              <button class="tab" data-tab="sessions">Sessions</button>
              <button class="tab" data-tab="chat">Chat</button>
              <button class="tab" data-tab="goals">Goals</button>
              <button class="tab" data-tab="schedules">Schedules</button>
              <button class="tab" data-tab="operations">Operations</button>
              <button class="tab" data-tab="workspace">Workspace</button>
              <button class="tab" data-tab="skills">Skills</button>
              <button class="tab" data-tab="config">Config</button>
            </div>
          </section>

          <section class="panel tab-panel active" id="tab-overview">
            <div class="card-grid">
              <div class="card">
                <div class="section-kicker">Overview</div>
                <h3>Control Room</h3>
                <p class="subtle" id="setup-summary">Loading setup status...</p>
              </div>
              <div class="card">
                <div class="section-kicker">Quick Start</div>
                <h3>Setup Checklist</h3>
                <div class="list" id="setup-checklist">Loading...</div>
                <div class="toolbar" style="margin-top:14px;">
                  <button class="primary" id="quick-test-chat">Run Quick Test</button>
                </div>
              </div>
              <div class="card">
                <div class="section-kicker">Modes</div>
                <h3>Work Surface</h3>
                <pre>Sessions: manage session refs
Chat: run prompt turns
Goals: long-running work
Schedules: timed automation
Workspace: persistent files
Skills: installed capabilities</pre>
              </div>
              <div class="card">
                <div class="section-kicker">Diagnostics</div>
                <h3>Live Console</h3>
                <p class="subtle">Runtime and bridge logs stay pinned at the bottom so debugging never requires leaving the current work mode.</p>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-telegram">
            <div class="two-col">
              <div class="card">
                <div class="section-title">
                  <h3>Pairing</h3>
                  <div>
                    <button class="primary" id="telegram-repair">Pair / Re-pair</button>
                    <button id="telegram-refresh-meta">Refresh Metadata</button>
                  </div>
                </div>
                <label>Telegram Bot Token<input id="telegram-token-input" type="password" placeholder="Paste a real BotFather token only" /></label>
                <div class="modal-grid">
                  <label>Enabled
                    <select id="telegram-enabled-input">
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>
                  <label>Bot Username<input id="telegram-username-input" placeholder="your_bot" /></label>
                  <label>Mention Required
                    <select id="telegram-mention-required-input">
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>
                </div>
                <div class="toolbar" style="margin-top:14px;">
                  <button id="save-telegram-settings">Save Telegram Settings</button>
                </div>
                <div class="kv" id="telegram-pairing-panel"></div>
              </div>
              <div class="card">
                <h3>Troubleshooting</h3>
                <div class="list">
                  <div class="list-item">If the bot is in a group, disable Group Privacy in BotFather for reliable message delivery.</div>
                  <div class="list-item">If group replies are ignored, check mention requirement and allowed users.</div>
                  <div class="list-item">If re-pairing fails, another runtime may still be consuming Telegram updates.</div>
                </div>
              </div>
            </div>
            <div class="card-grid" style="margin-top:14px;">
              <div class="card">
                <h3>Private Access</h3>
                <pre id="telegram-private-access">Loading...</pre>
              </div>
              <div class="card">
                <h3>Group Access</h3>
                <pre id="telegram-group-access">Loading...</pre>
              </div>
              <div class="card">
                <div class="section-title">
                  <h3>Known Chats</h3>
                </div>
                <div class="list" id="telegram-seen-chats"></div>
              </div>
              <div class="card">
                <div class="section-title">
                  <h3>Known Users</h3>
                </div>
                <div class="list" id="telegram-seen-users"></div>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-feishu">
            <div class="two-col">
              <div class="card">
                <div class="section-title">
                  <h3>Feishu Quick Settings</h3>
                  <button id="save-feishu-settings">Save Feishu Settings</button>
                </div>
                <div class="modal-grid">
                  <label>Enabled
                    <select id="feishu-enabled-input">
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>
                  <label>App ID<input id="feishu-app-id-input" placeholder="cli_xxx" /></label>
                  <label>App Secret<input id="feishu-app-secret-input" type="password" placeholder="Leave blank to keep existing secret" /></label>
                  <label>Mention Required
                    <select id="feishu-mention-required-input">
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>
                </div>
                <label>Bot Mention Names<input id="feishu-mention-names-input" placeholder="CodexBridge, 助手" /></label>
                <div class="kv" id="feishu-settings-panel"></div>
              </div>
              <div class="card">
                <h3>Setup Notes</h3>
                <div class="list">
                  <div class="list-item">Use the Feishu app credentials from the developer console.</div>
                  <div class="list-item">Keep App Secret blank when you only want to edit non-secret settings.</div>
                  <div class="list-item">Mention names help group messages identify when CodexBridge should respond.</div>
                </div>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-sessions">
            <div class="section-title">
              <h3>Sessions</h3>
              <div class="toolbar" style="margin-top:0;">
                <input id="session-label-input" placeholder="research-plan" />
                <button class="primary" id="create-session">Create Session</button>
              </div>
            </div>
            <div class="list" id="sessions-list"></div>
          </section>

          <section class="panel tab-panel" id="tab-chat">
            <div class="chat-shell">
              <div class="card">
                <h3>Session Context</h3>
                <div class="kv">
                  <div>Bot</div><div id="chat-bot-name">-</div>
                  <div>Session</div><div id="chat-session-label">main</div>
                  <div>Run state</div><div id="chat-run-state">idle</div>
                </div>
                <div class="toolbar">
                  <button class="primary" id="run-chat">Run Prompt</button>
                  <button id="stop-chat">Stop Turn</button>
                </div>
              </div>
              <div class="card">
                <h3>Composer</h3>
                <textarea id="chat-input">Summarize the current repo and propose next steps.</textarea>
                <div class="toolbar">
                  <button class="primary" id="send-chat">Send</button>
                </div>
                <h3 style="margin-top:16px;">Output</h3>
                <pre id="chat-output">No run yet.</pre>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-goals">
            <div class="section-title">
              <h3>Goals</h3>
              <div class="toolbar" style="margin-top:0;">
                <input id="goal-objective-input" placeholder="Create a research brief for today's market open" />
                <button class="primary" id="create-goal">Create Goal</button>
              </div>
            </div>
            <div class="list" id="goals-list"></div>
          </section>

          <section class="panel tab-panel" id="tab-schedules">
            <div class="section-title">
              <h3>Schedules</h3>
              <div class="toolbar" style="margin-top:0;">
                <input id="schedule-cron-input" placeholder="0 30 9 * * 1-5" />
                <input id="schedule-timezone-input" placeholder="Asia/Shanghai" value="Asia/Shanghai" />
                <input id="schedule-objective-input" placeholder="Summarize market open drivers" />
                <button class="primary" id="create-schedule">Create Schedule</button>
              </div>
            </div>
            <div class="list" id="schedules-list"></div>
          </section>

          <section class="panel tab-panel" id="tab-operations">
            <div class="card" style="margin-bottom:14px;">
              <div class="section-title">
                <h3>Metrics</h3>
              </div>
              <div class="list" id="operations-metrics">Loading...</div>
            </div>
            <div class="two-col">
              <div class="card">
                <div class="section-title">
                  <h3>Users</h3>
                  <button id="operations-refresh">Refresh</button>
                </div>
                <div class="list" id="operations-users">Loading...</div>
              </div>
              <div class="card">
                <h3>Admin Actions</h3>
                <div class="modal-grid">
                  <label>User ID<input id="operations-user-id" placeholder="telegram:123" /></label>
                  <label>Credits<input id="operations-credit-amount" type="number" min="1" step="1" value="10" /></label>
                </div>
                <div class="toolbar">
                  <button class="primary" id="operations-grant">Grant</button>
                  <button id="operations-deduct">Deduct</button>
                  <button id="operations-unlock">Unlock Private</button>
                  <button id="operations-lock">Lock Private</button>
                  <button id="operations-ban" class="danger">Ban</button>
                  <button id="operations-unban">Unban</button>
                </div>
              </div>
            </div>
            <div class="two-col" style="margin-top:14px;">
              <div class="card">
                <h3>Usage Ledger</h3>
                <div class="list" id="operations-usage">Loading...</div>
              </div>
              <div class="card">
                <h3>Runs</h3>
                <div class="list" id="operations-runs">Loading...</div>
              </div>
            </div>
            <div class="card" style="margin-top:14px;">
              <h3>Conversation Logs</h3>
              <div class="list" id="operations-conversation-logs">Loading...</div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-workspace">
            <div class="two-col">
              <div class="card">
                <h3>Workspace Tree</h3>
                <div class="list" id="workspace-tree"></div>
              </div>
              <div class="card">
                <h3>Editor</h3>
                <label>Selected File<input id="workspace-file-path" value="IDENTITY.md" /></label>
                <textarea id="workspace-editor">Loading...</textarea>
                <div class="toolbar">
                  <button id="workspace-open">Open File</button>
                  <button class="primary" id="save-workspace">Save File</button>
                </div>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-skills">
            <div class="section-title">
              <h3>Skills</h3>
              <div class="toolbar" style="margin-top:0;">
                <input id="skill-source-input" placeholder="/path/to/skill-or-zip" />
                <button class="primary" id="install-skill">Install Skill</button>
              </div>
            </div>
            <div class="list" id="skills-list"></div>
          </section>

          <section class="panel tab-panel" id="tab-config">
            <div class="two-col">
              <div class="card">
                <h3>Common Settings</h3>
                <div class="modal-grid">
                  <label>Name<input id="config-name" /></label>
                  <label>Model<input id="config-model" /></label>
                  <label>Bot Username<input id="config-bot-username" /></label>
                  <label>Mention Required<select id="config-mention-required"><option value="true">true</option><option value="false">false</option></select></label>
                </div>
                <div class="toolbar" style="margin-top:14px;">
                  <button class="primary" id="save-form-config">Save Form</button>
                </div>
              </div>
              <div class="card">
                <h3>Raw Config</h3>
                <textarea id="config-editor"></textarea>
                <div class="toolbar" style="margin-top:14px;">
                  <button class="primary" id="save-config">Save Raw Config</button>
                </div>
              </div>
            </div>
          </section>
        </section>

        <aside class="side-panel">
          <section class="panel compact-card">
            <div class="section-kicker">Inspector</div>
            <h3>Runtime State</h3>
            <div class="overview-metrics">
              <div class="metric">
                <div class="metric-label">Current Bot</div>
                <div class="metric-value" id="metric-bot">-</div>
              </div>
              <div class="metric">
                <div class="metric-label">Runtime</div>
                <div class="metric-value" id="metric-runtime">-</div>
              </div>
              <div class="metric">
                <div class="metric-label">Telegram</div>
                <div class="metric-value" id="metric-telegram">-</div>
              </div>
              <div class="metric">
                <div class="metric-label">Model</div>
                <div class="metric-value" id="metric-model">-</div>
              </div>
            </div>
            <div class="divider-title">Recent Error</div>
            <pre id="overview-error">No error.</pre>
          </section>

          <section class="panel compact-card">
            <div class="section-kicker">System Summary</div>
            <h3>Runtime Bus</h3>
            <div class="kv" id="overview-runtime"></div>
            <div class="divider-title" style="margin-top:16px;">Workspace Paths</div>
            <div class="kv" id="overview-workspace"></div>
          </section>

          <section class="panel compact-card">
            <div class="section-kicker">Telegram</div>
            <h3>Access Matrix</h3>
            <div class="kv" id="overview-telegram"></div>
            <div class="divider-title" style="margin-top:16px;">Pairing State</div>
            <div class="kv" id="telegram-pairing-inspector"></div>
          </section>

          <section class="panel compact-card">
            <div class="section-kicker">Rollout</div>
            <h3>Version Control</h3>
            <div class="modal-grid">
              <label>Desired Version<input id="rollout-version-input" value="v1" /></label>
            </div>
            <div class="toolbar">
              <button class="primary" id="restart-all">Restart All</button>
              <button id="run-canary">Canary</button>
              <button id="run-rollback">Rollback</button>
            </div>
          </section>
        </aside>
      </section>

      <section class="diagnostics">
        <div class="panel log-panel">
          <div class="section-kicker">Diagnostics</div>
          <div class="section-title">
            <h3>Runtime Log</h3>
            <button id="logs-refresh">Refresh</button>
          </div>
          <pre id="runtime-log">Loading...</pre>
        </div>
        <div class="panel log-panel">
          <div class="section-kicker">Diagnostics</div>
          <div class="section-title">
            <h3>Bridge Log</h3>
            <button id="bridge-logs-refresh">Refresh</button>
          </div>
          <pre id="bridge-log">Loading...</pre>
        </div>
      </div>

      <div class="toast" id="toast"></div>

      <div class="modal-backdrop" id="create-bot-modal-backdrop">
        <div class="modal">
          <div class="section-title">
            <h3>Create Bot</h3>
            <button class="ghost" id="close-create-bot">Close</button>
          </div>
          <div class="modal-grid">
            <label>Bot ID<input id="create-bot-id" placeholder="research" /></label>
            <label>Name<input id="create-bot-name" placeholder="Research" /></label>
            <label>Enabled on Create
              <select id="create-bot-enabled">
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
          </div>
          <div class="toolbar" style="margin-top:14px;">
            <button class="primary" id="submit-create-bot">Create</button>
          </div>
        </div>
      </div>

      <div class="modal-backdrop" id="demo-modal-backdrop">
        <div class="modal">
          <div class="section-title">
            <h3 id="demo-modal-title">Demo Action</h3>
            <button class="ghost" id="close-demo-modal">Close</button>
          </div>
          <p class="subtle" id="demo-modal-body">This Phase UI is present for demo review and not fully wired yet.</p>
        </div>
      </div>
    </main>
    <script>
      function compactPath(value) {
        const home = "/Users/moshiwei";
        return String(value || "").startsWith(home) ? "~" + String(value).slice(home.length) : String(value || "");
      }

      const botsRoot = document.getElementById("bots");
      const toastRoot = document.getElementById("toast");
      const tabButtons = Array.from(document.querySelectorAll(".tab"));
      const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
      const createBotModal = document.getElementById("create-bot-modal-backdrop");
      const demoModal = document.getElementById("demo-modal-backdrop");
      const state = {
        currentBotId: null,
        selectedBotId: null,
        bots: [],
        detail: null,
      };

      async function request(path, options = {}) {
        const response = await fetch(path, {
          headers: { "content-type": "application/json" },
          ...options,
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || response.statusText);
        }
        return await response.json();
      }

      function showToast(message) {
        toastRoot.textContent = message;
        toastRoot.style.display = "block";
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => {
          toastRoot.style.display = "none";
        }, 2400);
      }

      function openDemoModal(title, body) {
        document.getElementById("demo-modal-title").textContent = title;
        document.getElementById("demo-modal-body").textContent = body;
        demoModal.style.display = "flex";
      }

      function setTopStatus(detail) {
        const bot = detail?.detail?.bot;
        const config = detail?.detail?.config;
        document.getElementById("top-current-bot").textContent = "current bot: " + (state.currentBotId || bot?.id || "none");
        document.getElementById("top-runtime").textContent = "runtime: " + (bot?.status || "unknown");
        document.getElementById("top-telegram").textContent = "telegram: " + ((config?.channels?.telegram?.enabled && config?.channels?.telegram?.botToken) ? "paired" : "unpaired");
        document.getElementById("top-enabled").textContent = "enabled: " + (bot?.enabled ? "yes" : "no");
      }

      function renderBadges(bot, config) {
        const root = document.getElementById("bot-badges");
        root.innerHTML = "";
        [
          { label: bot.id, klass: "accent" },
          { label: bot.status || "unknown", klass: bot.status === "running" ? "accent" : "" },
          { label: bot.enabled ? "enabled" : "disabled", klass: bot.enabled ? "" : "danger" },
          { label: config?.channels?.telegram?.enabled ? "telegram paired" : "telegram unpaired", klass: config?.channels?.telegram?.enabled ? "" : "danger" },
          { label: state.currentBotId === bot.id ? "current" : "not current", klass: state.currentBotId === bot.id ? "accent" : "" },
        ].forEach((item) => {
          const badge = document.createElement("span");
          badge.className = "pill " + (item.klass || "");
          badge.textContent = item.label;
          root.appendChild(badge);
        });
      }

      function setSelectedTab(tabName) {
        tabButtons.forEach((button) => {
          button.classList.toggle("active", button.dataset.tab === tabName);
        });
        tabPanels.forEach((panel) => {
          panel.classList.toggle("active", panel.id === "tab-" + tabName);
        });
      }

      function renderKV(rootId, rows) {
        const root = document.getElementById(rootId);
        root.innerHTML = "";
        rows.forEach(([key, value]) => {
          const k = document.createElement("div");
          const v = document.createElement("div");
          k.textContent = key;
          v.textContent = value;
          root.appendChild(k);
          root.appendChild(v);
        });
      }

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function renderList(items, emptyText) {
        if (!items.length) {
          return '<div class="list-item subtle">' + escapeHtml(emptyText) + '</div>';
        }
        return items.join("");
      }

      function renderBotItem(title, meta, buttons = []) {
        return [
          '<div class="list-item">',
          '<strong>' + escapeHtml(title) + '</strong>',
          '<div class="subtle">' + escapeHtml(meta) + '</div>',
          buttons.length ? '<div class="toolbar">' + buttons.join("") + '</div>' : '',
          '</div>',
        ].join("");
      }

      async function loadBots() {
        const snapshot = await request("/api/bots");
        state.bots = snapshot.bots;
        state.currentBotId = snapshot.currentBotId || (snapshot.bots.find((bot) => bot.isCurrent)?.id ?? snapshot.bots[0]?.id ?? null);
        if (!state.selectedBotId) {
          state.selectedBotId = state.currentBotId;
        }
        botsRoot.innerHTML = "";
        snapshot.bots.forEach((bot) => {
          const row = document.createElement("div");
          row.className = "bot-row" + (state.selectedBotId === bot.id ? " current" : "");
          row.innerHTML = [
            '<div><strong>' + bot.name + '</strong></div>',
            '<div class="subtle">' + bot.id + '</div>',
            '<div class="badge-row" style="margin-top:8px;">' +
              '<span class="pill ' + (bot.status === 'running' ? 'accent' : '') + '">' + bot.status + '</span>' +
              '<span class="pill ' + (bot.enabled ? '' : 'danger') + '">' + (bot.enabled ? 'enabled' : 'disabled') + '</span>' +
              '<span class="pill ' + (state.currentBotId === bot.id ? 'accent' : '') + '">' + (state.currentBotId === bot.id ? 'current' : 'bot') + '</span>' +
            '</div>'
          ].join("");
          row.onclick = () => {
            state.selectedBotId = bot.id;
            void loadBots().then(() => loadDetail(bot.id));
          };
          botsRoot.appendChild(row);
        });
      }

      function applyFormFromConfig(config) {
        document.getElementById("config-name").value = config.name || "";
        document.getElementById("config-model").value = config.runtime?.model || "";
        document.getElementById("config-bot-username").value = config.channels?.telegram?.botUsername || "";
        document.getElementById("config-mention-required").value = String(config.channels?.telegram?.groups?.requireExplicitMention ?? true);
        document.getElementById("telegram-token-input").value = "";
        document.getElementById("telegram-enabled-input").value = String(config.channels?.telegram?.enabled ?? false);
        document.getElementById("telegram-username-input").value = config.channels?.telegram?.botUsername || "";
        document.getElementById("telegram-mention-required-input").value = String(config.channels?.telegram?.groups?.requireExplicitMention ?? true);
        document.getElementById("feishu-enabled-input").value = String(config.channels?.feishu?.enabled ?? false);
        document.getElementById("feishu-app-id-input").value = config.channels?.feishu?.appId || "";
        document.getElementById("feishu-app-secret-input").value = "";
        document.getElementById("feishu-mention-required-input").value = String(config.channels?.feishu?.requireExplicitMention ?? true);
        document.getElementById("feishu-mention-names-input").value = (config.channels?.feishu?.botMentionNames || []).join(", ");
      }

      async function saveConfig(botId) {
        const field = document.getElementById('config-editor');
        const nextConfig = JSON.parse(field.value);
        await request('/api/bots/' + botId + '/config', {
          method: 'POST',
          body: JSON.stringify(nextConfig),
        });
        await loadBots();
        await loadDetail(botId);
      }

      async function saveFormConfig(botId) {
        const payload = {
          name: document.getElementById("config-name").value.trim(),
          runtime: {
            model: document.getElementById("config-model").value.trim(),
          },
          channels: {
            telegram: {
              botUsername: document.getElementById("config-bot-username").value.trim(),
              groups: {
                requireExplicitMention: document.getElementById("config-mention-required").value === "true",
              },
            },
          },
        };
        await request('/api/bots/' + botId + '/config', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast("Saved form config");
        await loadBots();
        await loadDetail(botId);
      }

      async function saveTelegramSettings(botId) {
        const token = document.getElementById("telegram-token-input").value.trim();
        const telegram = {
          enabled: document.getElementById("telegram-enabled-input").value === "true",
          botUsername: document.getElementById("telegram-username-input").value.trim(),
          groups: {
            requireExplicitMention: document.getElementById("telegram-mention-required-input").value === "true",
          },
        };
        if (token) {
          telegram.botToken = token;
        }
        await request('/api/bots/' + botId + '/config', {
          method: 'POST',
          body: JSON.stringify({ channels: { telegram } }),
        });
        showToast("Saved Telegram settings");
        await loadBots();
        await loadDetail(botId);
      }

      async function saveFeishuSettings(botId) {
        const secret = document.getElementById("feishu-app-secret-input").value.trim();
        const feishu = {
          enabled: document.getElementById("feishu-enabled-input").value === "true",
          appId: document.getElementById("feishu-app-id-input").value.trim(),
          requireExplicitMention: document.getElementById("feishu-mention-required-input").value === "true",
          botMentionNames: document.getElementById("feishu-mention-names-input").value
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        };
        if (secret) {
          feishu.appSecret = secret;
        }
        await request('/api/bots/' + botId + '/config', {
          method: 'POST',
          body: JSON.stringify({ channels: { feishu } }),
        });
        showToast("Saved Feishu settings");
        await loadBots();
        await loadDetail(botId);
      }

      async function mutateBot(botId, action) {
        await request('/api/bots/' + botId + '/' + action, { method: 'POST' });
        showToast('Bot ' + action + ' complete');
        await loadBots();
        await loadDetail(botId);
      }

      async function loadSessions(botId) {
        const payload = await request('/api/bots/' + botId + '/sessions');
        document.getElementById("chat-session-label").textContent = payload.activeSessionLabel || "main";
        document.getElementById("sessions-list").innerHTML = renderList(
          payload.sessions.map((session) => renderBotItem(
            session.label,
            [
              session.label === payload.activeSessionLabel ? "active" : "inactive",
              session.cliSessionRef ? "started" : "empty",
              session.updatedAt ? ("updated " + session.updatedAt) : null,
            ].filter(Boolean).join(" | "),
            [
              "<button onclick=\\\"window.__useSession(decodeURIComponent('" + encodeURIComponent(session.label) + "'))\\\">Use</button>",
            ],
          )),
          "No sessions yet."
        );
      }

      async function loadChatStatus(botId) {
        const sessionLabel = document.getElementById("chat-session-label").textContent.trim();
        const payload = await request('/api/bots/' + botId + '/chat?sessionLabel=' + encodeURIComponent(sessionLabel));
        document.getElementById("chat-run-state").textContent = payload.status || "idle";
        document.getElementById("chat-output").textContent =
          payload.error ? [payload.friendlyMessage, payload.error].filter(Boolean).join("\\n\\n") : (payload.output || payload.friendlyMessage || (payload.running ? "Running..." : "No run yet."));
        if (payload.running) {
          clearTimeout(loadChatStatus._timer);
          loadChatStatus._timer = setTimeout(() => {
            if (state.selectedBotId === botId) {
              void loadChatStatus(botId);
            }
          }, ${DEFAULT_WEB_CHAT_POLL_MS});
        }
      }

      async function runChatPrompt(prompt, sessionLabel = null) {
        if (!state.selectedBotId) return;
        const label = sessionLabel || document.getElementById('chat-session-label').textContent.trim() || "main";
        document.getElementById('chat-session-label').textContent = label;
        document.getElementById('chat-input').value = prompt;
        await request('/api/bots/' + state.selectedBotId + '/chat', {
          method: 'POST',
          body: JSON.stringify({ prompt, sessionLabel: label }),
        });
        showToast('Chat run started');
        await loadChatStatus(state.selectedBotId);
      }

      async function runQuickTest() {
        if (!state.selectedBotId) return;
        const payload = await request('/api/bots/' + state.selectedBotId + '/quick-test', { method: 'POST' });
        document.getElementById('chat-session-label').textContent = "main";
        document.getElementById('chat-input').value = '${QUICK_TEST_PROMPT}';
        if (payload.preflight?.message) {
          document.getElementById('chat-output').textContent = payload.preflight.message;
        }
        showToast('Quick test started');
        await loadChatStatus(state.selectedBotId);
      }

      async function loadGoals(botId) {
        const payload = await request('/api/bots/' + botId + '/goals');
        document.getElementById("goals-list").innerHTML = renderList(
          payload.map((goal) => renderBotItem(
            goal.id,
            [goal.status, goal.phase, goal.objective].filter(Boolean).join(" | "),
            goal.status === "running"
              ? ["<button onclick=\\\"window.__stopFlow(decodeURIComponent('" + encodeURIComponent(goal.sessionLabel || "main") + "'))\\\">Stop</button>"]
              : [],
          )),
          "No goals yet."
        );
      }

      async function loadSchedules(botId) {
        const payload = await request('/api/bots/' + botId + '/schedules');
        document.getElementById("schedules-list").innerHTML = renderList(
          payload.map((schedule) => renderBotItem(
            schedule.id,
            [schedule.cron, schedule.timezone, schedule.enabled ? "enabled" : "disabled", schedule.objective].join(" | "),
            [
              "<button onclick=\\\"window.__toggleSchedule(decodeURIComponent('" + encodeURIComponent(schedule.id) + "'), '" + (schedule.enabled ? "disable" : "enable") + "')\\\">" + (schedule.enabled ? "Disable" : "Enable") + "</button>",
            ],
          )),
          "No schedules yet."
        );
      }

      function formatCredits(user) {
        const credits = user.credits || {};
        return [
          user.channel,
          user.status,
          user.privateEnabled ? "private unlocked" : "private locked",
          "paid " + (credits.paidCredits ?? 0),
          "free " + (credits.dailyFreeUsed ?? 0) + "/" + (credits.dailyFreeLimit ?? 0),
          user.lastSeenAt ? "seen " + user.lastSeenAt : null,
        ].filter(Boolean).join(" | ");
      }

      function renderSetupGuide(setupGuide) {
        const guide = setupGuide || { completed: 0, total: 0, steps: [] };
        const next = guide.nextStep;
        document.getElementById("setup-summary").textContent = guide.ready
          ? "Ready to use. The bot has a channel, audience, runtime, and at least one test run."
          : "Setup " + (guide.completed ?? 0) + "/" + (guide.total ?? 0) + " complete. Next: " + (next?.label || "check configuration") + ".";
        document.getElementById("setup-checklist").innerHTML = renderList(
          (guide.steps || []).map((step) => renderBotItem(
            (step.status === "done" ? "Done: " : "Next: ") + step.label,
            [step.action, step.targetTab ? "tab " + step.targetTab : null].filter(Boolean).join(" | "),
            step.targetTab
              ? ["<button onclick=\\\"window.__openSetupStep('" + escapeHtml(step.targetTab) + "')\\\">Go</button>"]
              : [],
          )),
          "No setup steps available."
        );
      }

      async function loadOperations(botId) {
        const [users, usage, runs, metrics, conversationLogs] = await Promise.all([
          request('/api/bots/' + botId + '/users'),
          request('/api/bots/' + botId + '/usage?limit=100'),
          request('/api/bots/' + botId + '/runs?limit=100'),
          request('/api/bots/' + botId + '/metrics'),
          request('/api/bots/' + botId + '/conversation-logs?limit=100'),
        ]);
        const metricRows = [
          ["users", metrics.totals?.users ?? 0],
          ["group trial users", metrics.totals?.groupTrialUsers ?? 0],
          ["paid active users", metrics.totals?.paidActiveUsers ?? 0],
          ["paid conversion", Math.round((metrics.totals?.paidConversionRate ?? 0) * 100) + "%"],
          ["runs", metrics.totals?.runs ?? 0],
          ["failed runs", metrics.runStatusCounts?.failed ?? 0],
          ["daily free charged", metrics.creditTotals?.dailyFreeCharged ?? 0],
          ["paid credits charged", metrics.creditTotals?.paidCreditsCharged ?? 0],
          ["paid credits refunded", metrics.creditTotals?.paidCreditsRefunded ?? 0],
          ["avg latency", (metrics.totals?.averageRunLatencyMs ?? 0) + "ms"],
          ["conversation events", metrics.conversationTotals?.events ?? 0],
          ["risky events", metrics.conversationTotals?.riskyEvents ?? 0],
          ["policy blocked", metrics.conversationTotals?.blockedEvents ?? 0],
          ["reviewed events", metrics.conversationTotals?.reviewedEvents ?? 0],
          ["confirmed risks", metrics.reviewStatusCounts?.confirmed_risk ?? 0],
          ["false positives", metrics.reviewStatusCounts?.false_positive ?? 0],
          ["prompt injection", metrics.riskLabelCounts?.prompt_injection_signal ?? 0],
          ["possible secrets", metrics.riskLabelCounts?.possible_secret ?? 0],
        ];
        document.getElementById("operations-metrics").innerHTML = renderList(
          metricRows.map(([label, value]) => renderBotItem(label, String(value))),
          "No metrics yet."
        );
        document.getElementById("operations-users").innerHTML = renderList(
          users.map((user) => renderBotItem(
            user.displayName || user.id,
            formatCredits(user),
            [
              "<button onclick=\\\"window.__selectOperationsUser(decodeURIComponent('" + encodeURIComponent(user.id) + "'))\\\">Select</button>",
            ],
          )),
          "No users recorded yet."
        );
        document.getElementById("operations-usage").innerHTML = renderList(
          usage.map((event) => renderBotItem(
            event.eventType + " " + (event.amount ?? 0) + " " + (event.source || ""),
            [
              event.userId,
              event.chatType,
              event.reason,
              event.runId,
              event.createdAt,
            ].filter(Boolean).join(" | "),
          )),
          "No usage events yet."
        );
        document.getElementById("operations-runs").innerHTML = renderList(
          runs.map((run) => renderBotItem(
            run.status + " " + run.id,
            [
              run.userId,
              run.channel,
              run.chatType,
              run.costSource,
              run.creditsCharged != null ? "credits " + run.creditsCharged : null,
              run.error,
              run.updatedAt || run.createdAt,
            ].filter(Boolean).join(" | "),
          )),
          "No runs recorded yet."
        );
        document.getElementById("operations-conversation-logs").innerHTML = renderList(
          conversationLogs.map((event) => renderBotItem(
            event.direction + " " + (event.userId || "unknown"),
            [
              event.channel,
              event.chatType,
              event.runId,
              event.riskLabels?.length ? ("risk " + event.riskLabels.join(",")) : null,
              event.review?.status ? ("review " + event.review.status) : null,
              event.content ? event.content.slice(0, 180) : null,
              event.createdAt,
            ].filter(Boolean).join(" | "),
          )),
          "No conversation logs yet."
        );
      }

      async function loadWorkspace(botId) {
        const files = await request('/api/bots/' + botId + '/workspace');
        document.getElementById("workspace-tree").innerHTML = renderList(
          files.map((entry) => renderBotItem(
            entry.path,
            entry.type,
            entry.type === "file"
              ? ["<button onclick=\\\"window.__openWorkspaceFile(decodeURIComponent('" + encodeURIComponent(entry.path) + "'))\\\">Open</button>"]
              : [],
          )),
          "Workspace is empty."
        );
        const currentPath = document.getElementById("workspace-file-path").value.trim();
        if (currentPath) {
          await openWorkspaceFile(botId, currentPath).catch(() => {});
        }
      }

      async function openWorkspaceFile(botId, filePath) {
        const payload = await request('/api/bots/' + botId + '/workspace/file?path=' + encodeURIComponent(filePath));
        document.getElementById("workspace-file-path").value = payload.path;
        document.getElementById("workspace-editor").value = payload.content;
      }

      async function loadSkills(botId) {
        const payload = await request('/api/bots/' + botId + '/skills');
        document.getElementById("skills-list").innerHTML = renderList(
          payload.map((skill) => renderBotItem(skill.id, skill.description || skill.path || "")),
          "No skills installed yet."
        );
      }

      async function loadLogs(botId) {
        const [runtimeLogs, bridgeLogs] = await Promise.all([
          request('/api/bots/' + botId + '/logs'),
          request('/api/bots/' + botId + '/bridge-logs'),
        ]);
        document.getElementById("runtime-log").textContent = runtimeLogs.content || 'No logs yet.';
        document.getElementById("bridge-log").textContent = bridgeLogs.content || 'No bridge logs yet.';
      }

      async function loadDetail(botId) {
        const payload = await request('/api/bots/' + botId);
        state.detail = payload;
        const bot = payload.detail.bot;
        const config = payload.detail.config;
        document.getElementById("bot-title").textContent = bot.name;
        document.getElementById("bot-subtitle").textContent =
          bot.id + " | " + bot.homePath + " | desired " + (payload.health.desiredVersion || "v1");
        renderBadges(bot, config);
        setTopStatus(payload);
        renderSetupGuide(payload.setupGuide);
        document.getElementById("metric-bot").textContent = bot.name;
        document.getElementById("metric-runtime").textContent = payload.health.healthy ? "Online" : "Offline";
        document.getElementById("metric-telegram").textContent = config.channels?.telegram?.enabled ? "Paired" : "Unpaired";
        document.getElementById("metric-model").textContent = config.runtime?.model || "gpt-5.4";
        renderKV("overview-runtime", [
          ["status", payload.health.status || "unknown"],
          ["runtime pid", bot.runtimePid ? String(bot.runtimePid) : "none"],
          ["healthy", payload.health.healthy ? "yes" : "no"],
          ["desired version", payload.health.desiredVersion || "v1"],
          ["running version", payload.health.runningVersion || "none"],
        ]);
        renderKV("overview-telegram", [
          ["paired", config.channels?.telegram?.enabled ? "yes" : "no"],
          ["bot username", config.channels?.telegram?.botUsername ? "@" + config.channels.telegram.botUsername : "none"],
          ["private access", (payload.access.privateChats || []).join(", ") || "(none)"],
          ["group users", (payload.access.groupUsers || []).join(", ") || "(none)"],
          ["mention required", String(config.channels?.telegram?.groups?.requireExplicitMention ?? true)],
        ]);
        renderKV("overview-workspace", [
          ["workspace", compactPath(payload.detail.paths.homePath + "/workspace")],
          ["config", compactPath(payload.detail.paths.configPath)],
          ["runtime log", compactPath(payload.detail.paths.runtimeLogPath)],
          ["bridge log", compactPath(payload.detail.paths.bridgeLogPath)],
        ]);
        document.getElementById("overview-error").textContent = payload.health.lastError || "No error.";
        const telegramPairingRows = [
          ["paired", config.channels?.telegram?.enabled ? "yes" : "no"],
          ["bot username", config.channels?.telegram?.botUsername ? "@" + config.channels.telegram.botUsername : "none"],
          ["token present", config.channels?.telegram?.botToken ? "yes" : "no"],
          ["mention required", String(config.channels?.telegram?.groups?.requireExplicitMention ?? true)],
        ];
        renderKV("telegram-pairing-panel", telegramPairingRows);
        renderKV("telegram-pairing-inspector", telegramPairingRows);
        renderKV("feishu-settings-panel", [
          ["enabled", config.channels?.feishu?.enabled ? "yes" : "no"],
          ["app id", config.channels?.feishu?.appId || "none"],
          ["secret present", config.channels?.feishu?.appSecret ? "yes" : "no"],
          ["mention required", String(config.channels?.feishu?.requireExplicitMention ?? true)],
          ["mention names", (config.channels?.feishu?.botMentionNames || []).join(", ") || "(none)"],
        ]);
        document.getElementById("telegram-private-access").textContent = JSON.stringify(payload.access.privateChats || [], null, 2);
        document.getElementById("telegram-group-access").textContent = JSON.stringify({
          groupChats: payload.access.groupChats || [],
          groupUsers: payload.access.groupUsers || [],
          mentionRequired: config.channels?.telegram?.groups?.requireExplicitMention ?? true,
        }, null, 2);
        const chats = config.channels?.telegram?.metadata?.chats || {};
        const users = config.channels?.telegram?.metadata?.users || {};
        document.getElementById("telegram-seen-chats").innerHTML = renderList(
          Object.entries(chats).map(([id, entry]) => renderBotItem(
            entry.label || entry.title || entry.username || id,
            id,
            [
              "<button onclick=\\\"window.__allowTelegramAccess('private_chat', decodeURIComponent('" + encodeURIComponent(id) + "'))\\\">Allow Private</button>",
              "<button onclick=\\\"window.__allowTelegramAccess('group_chat', decodeURIComponent('" + encodeURIComponent(id) + "'))\\\">Allow Group</button>",
            ],
          )),
          "No known chats yet."
        );
        document.getElementById("telegram-seen-users").innerHTML = renderList(
          Object.entries(users).map(([id, entry]) => renderBotItem(
            entry.label || entry.username || id,
            id,
            [
              "<button onclick=\\\"window.__allowTelegramAccess('group_user', decodeURIComponent('" + encodeURIComponent(id) + "'))\\\">Allow Group User</button>",
            ],
          )),
          "No known users yet."
        );
        document.getElementById("config-editor").value = JSON.stringify(payload.detail.config, null, 2);
        applyFormFromConfig(payload.detail.config);
        document.getElementById("chat-bot-name").textContent = bot.name;
        await Promise.all([
          loadSessions(botId),
          loadGoals(botId),
          loadSchedules(botId),
          loadOperations(botId),
          loadWorkspace(botId),
          loadSkills(botId),
          loadLogs(botId),
          loadChatStatus(botId),
        ]);
      }

      document.getElementById('save-config').onclick = async () => {
        if (!state.selectedBotId) return;
        await saveConfig(state.selectedBotId);
        showToast("Saved raw config");
      };

      document.getElementById('save-form-config').onclick = async () => {
        if (!state.selectedBotId) return;
        await saveFormConfig(state.selectedBotId);
      };
      document.getElementById('save-telegram-settings').onclick = async () => {
        if (!state.selectedBotId) return;
        await saveTelegramSettings(state.selectedBotId);
      };
      document.getElementById('save-feishu-settings').onclick = async () => {
        if (!state.selectedBotId) return;
        await saveFeishuSettings(state.selectedBotId);
      };

      document.getElementById('action-start').onclick = async () => state.selectedBotId && mutateBot(state.selectedBotId, 'start');
      document.getElementById('action-stop').onclick = async () => state.selectedBotId && mutateBot(state.selectedBotId, 'stop');
      document.getElementById('action-restart').onclick = async () => state.selectedBotId && mutateBot(state.selectedBotId, 'restart');
      document.getElementById('action-enable').onclick = async () => {
        if (!state.selectedBotId || !state.detail) return;
        const action = state.detail.detail.bot.enabled ? 'disable' : 'enable';
        await mutateBot(state.selectedBotId, action);
      };
      document.getElementById('action-use').onclick = async () => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/use', { method: 'POST' });
        showToast('Current bot set to ' + state.selectedBotId);
        await loadBots();
        await loadDetail(state.selectedBotId);
      };
      document.getElementById('fleet-set-current').onclick = async () => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/use', { method: 'POST' });
        showToast('Current bot set to ' + state.selectedBotId);
        await loadBots();
        await loadDetail(state.selectedBotId);
      };
      document.getElementById('fleet-delete').onclick = async () => {
        if (!state.selectedBotId) return;
        if (!confirm('Delete bot ' + state.selectedBotId + '?')) return;
        await request('/api/bots/' + state.selectedBotId, { method: 'DELETE' });
        showToast('Deleted bot ' + state.selectedBotId);
        state.selectedBotId = null;
        await loadBots();
        if (state.currentBotId) {
          await loadDetail(state.currentBotId);
        }
      };
      document.getElementById('telegram-repair').onclick = async () => {
        if (!state.selectedBotId) return;
        const token = document.getElementById('telegram-token-input').value.trim();
        if (!token) {
          showToast('Paste a real Telegram token first.');
          return;
        }
        document.getElementById("chat-output").textContent = "Send one Telegram message to the bot, then click Pair / Re-pair again if needed.";
        await request('/api/bots/' + state.selectedBotId + '/telegram/pair', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        showToast('Telegram pairing complete');
        await loadBots();
        await loadDetail(state.selectedBotId);
      };
      document.getElementById('telegram-refresh-meta').onclick = async () => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/telegram/refresh', { method: 'POST' });
        showToast('Telegram metadata refreshed');
        await loadDetail(state.selectedBotId);
      };
      document.getElementById('logs-refresh').onclick = async () => state.selectedBotId && loadDetail(state.selectedBotId);
      document.getElementById('bridge-logs-refresh').onclick = async () => state.selectedBotId && loadLogs(state.selectedBotId);
      document.getElementById('create-session').onclick = async () => {
        if (!state.selectedBotId) return;
        const label = document.getElementById('session-label-input').value.trim();
        await request('/api/bots/' + state.selectedBotId + '/sessions', {
          method: 'POST',
          body: JSON.stringify({ label }),
        });
        showToast('Session ready: ' + label);
        document.getElementById('session-label-input').value = '';
        await loadSessions(state.selectedBotId);
      };
      document.getElementById('run-chat').onclick = async () => {
        if (!state.selectedBotId) return;
        const prompt = document.getElementById('chat-input').value;
        await runChatPrompt(prompt);
      };
      document.getElementById('stop-chat').onclick = async () => {
        if (!state.selectedBotId) return;
        const sessionLabel = document.getElementById('chat-session-label').textContent.trim();
        await request('/api/bots/' + state.selectedBotId + '/chat/stop', {
          method: 'POST',
          body: JSON.stringify({ sessionLabel }),
        });
        showToast('Stop requested');
        await loadChatStatus(state.selectedBotId);
      };
      document.getElementById('send-chat').onclick = async () => {
        document.getElementById('run-chat').click();
      };
      document.getElementById('quick-test-chat').onclick = async () => {
        await runQuickTest();
      };
      document.getElementById('create-goal').onclick = async () => {
        if (!state.selectedBotId) return;
        const objective = document.getElementById('goal-objective-input').value.trim();
        await request('/api/bots/' + state.selectedBotId + '/goals', {
          method: 'POST',
          body: JSON.stringify({ objective, sessionLabel: document.getElementById('chat-session-label').textContent.trim() }),
        });
        showToast('Goal started');
        document.getElementById('goal-objective-input').value = '';
        await loadGoals(state.selectedBotId);
      };
      document.getElementById('create-schedule').onclick = async () => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/schedules', {
          method: 'POST',
          body: JSON.stringify({
            cron: document.getElementById('schedule-cron-input').value.trim(),
            timezone: document.getElementById('schedule-timezone-input').value.trim(),
            objective: document.getElementById('schedule-objective-input').value.trim(),
          }),
        });
        showToast('Schedule created');
        document.getElementById('schedule-objective-input').value = '';
        await loadSchedules(state.selectedBotId);
      };
      document.getElementById('operations-refresh').onclick = async () => state.selectedBotId && loadOperations(state.selectedBotId);
      document.getElementById('operations-grant').onclick = async () => {
        if (!state.selectedBotId) return;
        const userId = document.getElementById('operations-user-id').value.trim();
        const amount = Number.parseInt(document.getElementById('operations-credit-amount').value, 10);
        await request('/api/bots/' + state.selectedBotId + '/users/' + encodeURIComponent(userId) + '/grant', {
          method: 'POST',
          body: JSON.stringify({ amount }),
        });
        showToast('Credits granted');
        await loadOperations(state.selectedBotId);
      };
      document.getElementById('operations-deduct').onclick = async () => {
        if (!state.selectedBotId) return;
        const userId = document.getElementById('operations-user-id').value.trim();
        const amount = Number.parseInt(document.getElementById('operations-credit-amount').value, 10);
        await request('/api/bots/' + state.selectedBotId + '/users/' + encodeURIComponent(userId) + '/adjust', {
          method: 'POST',
          body: JSON.stringify({ amount: -Math.abs(amount), reason: 'manual_deduct' }),
        });
        showToast('Credits deducted');
        await loadOperations(state.selectedBotId);
      };
      document.getElementById('operations-unlock').onclick = async () => {
        if (!state.selectedBotId) return;
        await updateOperationsPrivate(true);
      };
      document.getElementById('operations-lock').onclick = async () => {
        if (!state.selectedBotId) return;
        await updateOperationsPrivate(false);
      };
      document.getElementById('operations-ban').onclick = async () => {
        if (!state.selectedBotId) return;
        await updateOperationsStatus('banned');
      };
      document.getElementById('operations-unban').onclick = async () => {
        if (!state.selectedBotId) return;
        await updateOperationsStatus('free');
      };
      document.getElementById('workspace-open').onclick = async () => {
        if (!state.selectedBotId) return;
        await openWorkspaceFile(state.selectedBotId, document.getElementById('workspace-file-path').value.trim());
      };
      document.getElementById('save-workspace').onclick = async () => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/workspace/file', {
          method: 'POST',
          body: JSON.stringify({
            path: document.getElementById('workspace-file-path').value.trim(),
            content: document.getElementById('workspace-editor').value,
          }),
        });
        showToast('Workspace file saved');
        await loadWorkspace(state.selectedBotId);
      };
      document.getElementById('install-skill').onclick = async () => {
        if (!state.selectedBotId) return;
        const sourcePath = document.getElementById('skill-source-input').value.trim();
        await request('/api/bots/' + state.selectedBotId + '/skills', {
          method: 'POST',
          body: JSON.stringify({ sourcePath }),
        });
        showToast('Skill installed');
        document.getElementById('skill-source-input').value = '';
        await loadSkills(state.selectedBotId);
      };
      document.getElementById('restart-all').onclick = async () => {
        const result = await request('/api/rollout/restart-all', { method: 'POST' });
        document.getElementById('chat-output').textContent = JSON.stringify(result, null, 2);
        showToast('Restart all complete');
        await loadBots();
        state.selectedBotId && await loadDetail(state.selectedBotId);
      };
      document.getElementById('run-canary').onclick = async () => {
        if (!state.selectedBotId) return;
        const desiredVersion = document.getElementById('rollout-version-input').value.trim() || 'v1';
        const result = await request('/api/rollout/canary', {
          method: 'POST',
          body: JSON.stringify({ botIds: [state.selectedBotId], desiredVersion }),
        });
        document.getElementById('chat-output').textContent = JSON.stringify(result, null, 2);
        showToast('Canary complete');
        await loadBots();
        await loadDetail(state.selectedBotId);
      };
      document.getElementById('run-rollback').onclick = async () => {
        if (!state.selectedBotId) return;
        const version = document.getElementById('rollout-version-input').value.trim() || 'v1';
        const result = await request('/api/rollout/rollback/' + state.selectedBotId, {
          method: 'POST',
          body: JSON.stringify({ version }),
        });
        document.getElementById('chat-output').textContent = JSON.stringify(result, null, 2);
        showToast('Rollback complete');
        await loadBots();
        await loadDetail(state.selectedBotId);
      };
      document.getElementById('open-create-bot').onclick = () => { createBotModal.style.display = 'flex'; };
      document.getElementById('close-create-bot').onclick = () => { createBotModal.style.display = 'none'; };
      document.getElementById('close-demo-modal').onclick = () => { demoModal.style.display = 'none'; };
      document.getElementById('submit-create-bot').onclick = async () => {
        const id = document.getElementById('create-bot-id').value.trim();
        const name = document.getElementById('create-bot-name').value.trim() || id;
        const enabled = document.getElementById('create-bot-enabled').value === 'true';
        if (!id) {
          showToast('Bot id is required');
          return;
        }
        try {
          await request('/api/bots', {
            method: 'POST',
            body: JSON.stringify({ id, name, enabled }),
          });
          createBotModal.style.display = 'none';
          document.getElementById('create-bot-id').value = '';
          document.getElementById('create-bot-name').value = '';
          showToast('Created bot ' + id);
          state.selectedBotId = id;
          await loadBots();
          await loadDetail(id);
        } catch (error) {
          showToast(error.message);
        }
      };

      createBotModal.onclick = (event) => {
        if (event.target === createBotModal) createBotModal.style.display = 'none';
      };
      demoModal.onclick = (event) => {
        if (event.target === demoModal) demoModal.style.display = 'none';
      };

      tabButtons.forEach((button) => {
        button.onclick = () => setSelectedTab(button.dataset.tab);
      });

      window.__openSetupStep = (tabName) => {
        setSelectedTab(tabName);
        showToast('Opened ' + tabName);
      };

      window.__allowTelegramAccess = async (accessType, id) => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/telegram/access', {
          method: 'POST',
          body: JSON.stringify({ accessType, id }),
        });
        showToast('Telegram access updated');
        await loadDetail(state.selectedBotId);
      };

      window.__useSession = async (label) => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/sessions/' + encodeURIComponent(label) + '/use', { method: 'POST' });
        showToast('Using session ' + label);
        await loadSessions(state.selectedBotId);
        await loadChatStatus(state.selectedBotId);
      };

      window.__openWorkspaceFile = async (filePath) => {
        if (!state.selectedBotId) return;
        await openWorkspaceFile(state.selectedBotId, filePath);
      };

      window.__stopFlow = async (sessionLabel) => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/chat/stop', {
          method: 'POST',
          body: JSON.stringify({ sessionLabel }),
        });
        showToast('Stop requested');
        await loadGoals(state.selectedBotId);
        await loadChatStatus(state.selectedBotId);
      };

      window.__toggleSchedule = async (scheduleId, action) => {
        if (!state.selectedBotId) return;
        await request('/api/bots/' + state.selectedBotId + '/schedules/' + encodeURIComponent(scheduleId) + '/' + action, { method: 'POST' });
        showToast('Schedule ' + action + 'd');
        await loadSchedules(state.selectedBotId);
      };

      window.__selectOperationsUser = (userId) => {
        document.getElementById('operations-user-id').value = userId;
        setSelectedTab('operations');
      };

      async function updateOperationsPrivate(privateEnabled) {
        const userId = document.getElementById('operations-user-id').value.trim();
        await request('/api/bots/' + state.selectedBotId + '/users/' + encodeURIComponent(userId) + '/private', {
          method: 'POST',
          body: JSON.stringify({ privateEnabled }),
        });
        showToast(privateEnabled ? 'Private unlocked' : 'Private locked');
        await loadOperations(state.selectedBotId);
      }

      async function updateOperationsStatus(status) {
        const userId = document.getElementById('operations-user-id').value.trim();
        await request('/api/bots/' + state.selectedBotId + '/users/' + encodeURIComponent(userId) + '/status', {
          method: 'POST',
          body: JSON.stringify({ status }),
        });
        showToast('Status set to ' + status);
        await loadOperations(state.selectedBotId);
      }

      void loadBots().then(async () => {
        if (state.selectedBotId) {
          await loadDetail(state.selectedBotId);
        }
      });
    </script>
  </body>
</html>`;
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/current-bot") {
    return json(response, 200, { currentBotId: await readActiveBotId() });
  }

  if (request.method === "GET" && pathname === "/api/bots") {
    return json(response, 200, await getControlPlaneSnapshot());
  }

  if (request.method === "POST" && pathname === "/api/bots") {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await createBot({
        id: body.id,
        name: body.name,
        enabled: body.enabled === true,
      }),
    );
  }

  const botMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (request.method === "GET" && botMatch) {
    return json(response, 200, redactControlPlaneDetail(await getBotControlPlaneDetail(decodeURIComponent(botMatch[1]))));
  }

  const botDeleteMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (request.method === "DELETE" && botDeleteMatch) {
    const botId = decodeURIComponent(botDeleteMatch[1]);
    await deleteBot(botId);
    return json(response, 200, { botId, deleted: true });
  }

  const botUseMatch = pathname.match(/^\/api\/bots\/([^/]+)\/use$/);
  if (request.method === "POST" && botUseMatch) {
    const botId = decodeURIComponent(botUseMatch[1]);
    await setActiveBot(botId);
    return json(response, 200, { currentBotId: botId });
  }

  const botToggleMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(enable|disable)$/);
  if (request.method === "POST" && botToggleMatch) {
    const botId = decodeURIComponent(botToggleMatch[1]);
    const enabled = botToggleMatch[2] === "enable";
    return json(response, 200, await setBotEnabled(botId, enabled));
  }

  const botLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/logs$/);
  if (request.method === "GET" && botLogsMatch) {
    return json(response, 200, await readBotLogs(decodeURIComponent(botLogsMatch[1]), 200));
  }

  const botBridgeLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/bridge-logs$/);
  if (request.method === "GET" && botBridgeLogsMatch) {
    return json(response, 200, await readBridgeLogs(decodeURIComponent(botBridgeLogsMatch[1]), 200));
  }

  const botActionMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(start|stop|restart)$/);
  if (request.method === "POST" && botActionMatch) {
    const botId = decodeURIComponent(botActionMatch[1]);
    const action = botActionMatch[2];
    if (action === "start") {
      return json(response, 200, { botId, pid: await startBot(botId) });
    }
    if (action === "stop") {
      return json(response, 200, { botId, stopped: await stopBot(botId) });
    }
    return json(response, 200, { botId, pid: await restartBot(botId) });
  }

  const botConfigMatch = pathname.match(/^\/api\/bots\/([^/]+)\/config$/);
  if (request.method === "POST" && botConfigMatch) {
    const botId = decodeURIComponent(botConfigMatch[1]);
    const body = await readJsonBody(request);
    const currentConfig = (await inspectBot(botId)).config;
    await updateBotConfig(botId, () => applySafeConfigPatch(currentConfig, body));
    const persistedConfig = (await inspectBot(botId)).config;
    return json(response, 200, redactConfigSecrets(persistedConfig));
  }

  const botSessionsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/sessions$/);
  if (request.method === "GET" && botSessionsMatch) {
    return json(response, 200, await readBotSessions(decodeURIComponent(botSessionsMatch[1])));
  }
  if (request.method === "POST" && botSessionsMatch) {
    const botId = decodeURIComponent(botSessionsMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await createBotSession(botId, body.label));
  }

  const botSessionUseMatch = pathname.match(/^\/api\/bots\/([^/]+)\/sessions\/([^/]+)\/use$/);
  if (request.method === "POST" && botSessionUseMatch) {
    return json(
      response,
      200,
      await activateBotSession(decodeURIComponent(botSessionUseMatch[1]), decodeURIComponent(botSessionUseMatch[2])),
    );
  }

  const botChatMatch = pathname.match(/^\/api\/bots\/([^/]+)\/chat$/);
  if (request.method === "GET" && botChatMatch) {
    const botId = decodeURIComponent(botChatMatch[1]);
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await readChatStatus(botId, url.searchParams.get("sessionLabel")));
  }
  if (request.method === "POST" && botChatMatch) {
    const botId = decodeURIComponent(botChatMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await startBotChat(botId, body));
  }

  const botChatStopMatch = pathname.match(/^\/api\/bots\/([^/]+)\/chat\/stop$/);
  if (request.method === "POST" && botChatStopMatch) {
    const botId = decodeURIComponent(botChatStopMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await stopBotChat(botId, body.sessionLabel));
  }

  const botQuickTestMatch = pathname.match(/^\/api\/bots\/([^/]+)\/quick-test$/);
  if (request.method === "POST" && botQuickTestMatch) {
    return json(response, 200, await startQuickTestForBot(decodeURIComponent(botQuickTestMatch[1])));
  }

  const botTelegramPairMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/pair$/);
  if (request.method === "POST" && botTelegramPairMatch) {
    const body = await readJsonBody(request);
    const payload = await pairTelegramForBot(decodeURIComponent(botTelegramPairMatch[1]), body.token);
    return json(response, 200, {
      ...payload,
      detail: redactControlPlaneDetail(payload.detail),
    });
  }

  const botTelegramAccessMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/access$/);
  if (request.method === "POST" && botTelegramAccessMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, redactControlPlaneDetail(await allowTelegramAccessForBot(
      decodeURIComponent(botTelegramAccessMatch[1]),
      body,
    )));
  }

  const botTelegramRefreshMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/refresh$/);
  if (request.method === "POST" && botTelegramRefreshMatch) {
    const botId = decodeURIComponent(botTelegramRefreshMatch[1]);
    const detail = await inspectBot(botId);
    await hydrateTelegramMetadata(detail.bot.homePath);
    return json(response, 200, redactControlPlaneDetail(await getBotControlPlaneDetail(botId)));
  }

  const botGoalsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/goals$/);
  if (request.method === "GET" && botGoalsMatch) {
    return json(response, 200, await listBotGoals(decodeURIComponent(botGoalsMatch[1])));
  }
  if (request.method === "POST" && botGoalsMatch) {
    const botId = decodeURIComponent(botGoalsMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await startGoalForBot(botId, body));
  }

  const botSchedulesMatch = pathname.match(/^\/api\/bots\/([^/]+)\/schedules$/);
  if (request.method === "GET" && botSchedulesMatch) {
    return json(response, 200, await listBotSchedules(decodeURIComponent(botSchedulesMatch[1])));
  }
  if (request.method === "POST" && botSchedulesMatch) {
    const botId = decodeURIComponent(botSchedulesMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await createScheduleForBot(botId, body));
  }

  const botScheduleToggleMatch = pathname.match(/^\/api\/bots\/([^/]+)\/schedules\/([^/]+)\/(enable|disable)$/);
  if (request.method === "POST" && botScheduleToggleMatch) {
    return json(
      response,
      200,
      await toggleScheduleForBot(
        decodeURIComponent(botScheduleToggleMatch[1]),
        decodeURIComponent(botScheduleToggleMatch[2]),
        botScheduleToggleMatch[3] === "enable",
      ),
    );
  }

  const botUsersMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users$/);
  if (request.method === "GET" && botUsersMatch) {
    return json(response, 200, await listBotUsers(decodeURIComponent(botUsersMatch[1])));
  }

  const botUserGrantMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/grant$/);
  if (request.method === "POST" && botUserGrantMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await grantCreditsForBot(
        decodeURIComponent(botUserGrantMatch[1]),
        decodeURIComponent(botUserGrantMatch[2]),
        body.amount,
      ),
    );
  }

  const botUserAdjustMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/adjust$/);
  if (request.method === "POST" && botUserAdjustMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await adjustCreditsForBot(
        decodeURIComponent(botUserAdjustMatch[1]),
        decodeURIComponent(botUserAdjustMatch[2]),
        body.amount,
        body.reason || "manual_adjustment",
      ),
    );
  }

  const botUserStatusMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/status$/);
  if (request.method === "POST" && botUserStatusMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await updateUserStatusForBot(
        decodeURIComponent(botUserStatusMatch[1]),
        decodeURIComponent(botUserStatusMatch[2]),
        body.status,
      ),
    );
  }

  const botUserPrivateMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/private$/);
  if (request.method === "POST" && botUserPrivateMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await updatePrivateEnabledForBot(
        decodeURIComponent(botUserPrivateMatch[1]),
        decodeURIComponent(botUserPrivateMatch[2]),
        body.privateEnabled === true,
      ),
    );
  }

  const botUsageMatch = pathname.match(/^\/api\/bots\/([^/]+)\/usage$/);
  if (request.method === "GET" && botUsageMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listUsageForBot(decodeURIComponent(botUsageMatch[1]), {
      userId: url.searchParams.get("userId"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botRunsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/runs$/);
  if (request.method === "GET" && botRunsMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listRunsForBot(decodeURIComponent(botRunsMatch[1]), {
      userId: url.searchParams.get("userId"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botAdminAuditMatch = pathname.match(/^\/api\/bots\/([^/]+)\/admin-audit$/);
  if (request.method === "GET" && botAdminAuditMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listAdminAuditForBot(decodeURIComponent(botAdminAuditMatch[1]), {
      userId: url.searchParams.get("userId"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botMetricsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/metrics$/);
  if (request.method === "GET" && botMetricsMatch) {
    return json(response, 200, await getMetricsForBot(decodeURIComponent(botMetricsMatch[1])));
  }

  const botConversationLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-logs$/);
  if (request.method === "GET" && botConversationLogsMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listConversationLogsForBot(decodeURIComponent(botConversationLogsMatch[1]), {
      userId: url.searchParams.get("userId"),
      runId: url.searchParams.get("runId"),
      direction: url.searchParams.get("direction"),
      riskLabel: url.searchParams.get("riskLabel"),
      riskOnly: url.searchParams.get("riskOnly"),
      reviewStatus: url.searchParams.get("reviewStatus"),
      createdAfter: url.searchParams.get("createdAfter"),
      createdBefore: url.searchParams.get("createdBefore"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botConversationReviewsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-reviews$/);
  if (request.method === "GET" && botConversationReviewsMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listConversationReviewsForBot(decodeURIComponent(botConversationReviewsMatch[1]), {
      eventId: url.searchParams.get("eventId"),
      status: url.searchParams.get("status"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botConversationReviewMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-logs\/([^/]+)\/review$/);
  if (request.method === "POST" && botConversationReviewMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await reviewConversationLogForBot(
      decodeURIComponent(botConversationReviewMatch[1]),
      decodeURIComponent(botConversationReviewMatch[2]),
      body,
    ));
  }

  const botWorkspaceMatch = pathname.match(/^\/api\/bots\/([^/]+)\/workspace$/);
  if (request.method === "GET" && botWorkspaceMatch) {
    return json(response, 200, await listWorkspaceFiles(decodeURIComponent(botWorkspaceMatch[1])));
  }

  const botWorkspaceFileMatch = pathname.match(/^\/api\/bots\/([^/]+)\/workspace\/file$/);
  if (request.method === "GET" && botWorkspaceFileMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(
      response,
      200,
      await readWorkspaceFileForBot(decodeURIComponent(botWorkspaceFileMatch[1]), url.searchParams.get("path")),
    );
  }
  if (request.method === "POST" && botWorkspaceFileMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await writeWorkspaceFileForBot(decodeURIComponent(botWorkspaceFileMatch[1]), body.path, body.content),
    );
  }

  const botSkillsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/skills$/);
  if (request.method === "GET" && botSkillsMatch) {
    return json(response, 200, await listBotSkills(decodeURIComponent(botSkillsMatch[1])));
  }
  if (request.method === "POST" && botSkillsMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await installSkillForBot(decodeURIComponent(botSkillsMatch[1]), body.sourcePath));
  }

  if (request.method === "POST" && pathname === "/api/rollout/restart-all") {
    return json(response, 200, await rollingRestartBots());
  }

  if (request.method === "POST" && pathname === "/api/rollout/canary") {
    const body = await readJsonBody(request);
    return json(response, 200, await canaryRollout(body.botIds || [], body.desiredVersion || "v1"));
  }

  const rollbackMatch = pathname.match(/^\/api\/rollout\/rollback\/([^/]+)$/);
  if (request.method === "POST" && rollbackMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await rollbackBot(decodeURIComponent(rollbackMatch[1]), body.version || "v1"));
  }

  return false;
}

export async function startControlPlaneWebServer({ port = 8787, host = "127.0.0.1" } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      if (!isWebRequestAuthorized(request)) {
        unauthorized(response);
        return;
      }
      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      if (url.pathname === "/") {
        html(response, 200, renderHtmlPage());
        return;
      }
      const handled = await handleApi(request, response, url.pathname);
      if (handled === false) {
        json(response, 404, { error: "Not found" });
      }
    } catch (error) {
      const publicError = toPublicError(error);
      json(response, publicError.statusCode, publicError.payload);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    port: resolvedPort,
    host,
    close: async () => await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
