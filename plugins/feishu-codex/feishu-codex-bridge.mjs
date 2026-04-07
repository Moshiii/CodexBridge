import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import * as Lark from "@larksuiteoapi/node-sdk";

import { buildCommandConfig, startCliTurn } from "../../src/codex-runner.mjs";
import {
  getChannelStatePath,
  getFeishuBridgePidPath,
  getWorkspacePath,
  readCliState,
  readConfig,
  resolveBotHome,
  writeCliState,
  writeConfig,
} from "../../src/config.mjs";
import { buildWorkspacePrompt } from "../../src/workspace-context.mjs";

const DEFAULT_BOT_HOME = resolveBotHome();
const DEFAULT_PID_PATH = getFeishuBridgePidPath(DEFAULT_BOT_HOME);
const ROUTER_STATE_PATH = path.join(getChannelStatePath("feishu", DEFAULT_BOT_HOME), "router.json");

function nowIso() {
  return new Date().toISOString();
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

async function readPidFile(filePath) {
  try {
    const raw = (await readFile(filePath, "utf8")).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
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
        throw new Error(`Feishu bridge already running with pid ${existingPid}`);
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
    // ignore cleanup failures
  }
}

function createDefaultRouterState() {
  return {
    version: 1,
    chats: {},
    processedMessageIds: [],
  };
}

async function readRouterState(filePath) {
  const parsed = await readJsonFile(filePath, createDefaultRouterState());
  return {
    version: 1,
    chats: parsed?.chats && typeof parsed.chats === "object" ? parsed.chats : {},
    processedMessageIds: Array.isArray(parsed?.processedMessageIds) ? parsed.processedMessageIds : [],
  };
}

async function writeRouterState(filePath, state) {
  await writeJsonFile(filePath, state);
}

function ensureChatState(state, chatId) {
  if (!state.chats[chatId]) {
    state.chats[chatId] = {
      sessionLabel: `feishu-${chatId.slice(-8).toLowerCase()}`,
      cliSessionRef: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }
  return state.chats[chatId];
}

function rememberProcessedMessage(state, messageId) {
  state.processedMessageIds = [...state.processedMessageIds.filter((id) => id !== messageId), messageId].slice(-200);
}

function hasProcessedMessage(state, messageId) {
  return state.processedMessageIds.includes(messageId);
}

async function captureFeishuMetadata(botHome, event) {
  const chatId = event.message?.chat_id;
  const senderOpenId = event.sender?.sender_id?.open_id ?? null;
  if (!chatId) {
    return;
  }

  const config = await readConfig(botHome);
  const feishu = config.channels?.feishu ?? {};
  const chats = feishu.metadata?.chats ?? {};
  const users = feishu.metadata?.users ?? {};
  const currentChat = chats[chatId] ?? {};
  const currentUser = senderOpenId ? users[senderOpenId] ?? {} : null;
  const nextChat = {
    chatType: event.message?.chat_type ?? null,
    lastMessageType: event.message?.message_type ?? null,
    label: chatId,
  };
  const nextUser = senderOpenId
    ? {
        senderType: event.sender?.sender_type ?? null,
        label: senderOpenId,
      }
    : null;
  const chatChanged =
    currentChat.chatType !== nextChat.chatType ||
    currentChat.lastMessageType !== nextChat.lastMessageType ||
    currentChat.label !== nextChat.label;
  const userChanged =
    senderOpenId &&
    (currentUser.senderType !== nextUser.senderType || currentUser.label !== nextUser.label);

  if (!chatChanged && !userChanged) {
    return;
  }

  await writeConfig({
    ...config,
    channels: {
      ...config.channels,
      feishu: {
        ...feishu,
        metadata: {
          chats: {
            ...chats,
            [chatId]: {
              ...currentChat,
              ...nextChat,
            },
          },
          users: senderOpenId
            ? {
                ...users,
                [senderOpenId]: {
                  ...currentUser,
                  ...nextUser,
                },
              }
            : users,
        },
      },
    },
  }, botHome);
}

function parseTextMessage(content) {
  if (!content) {
    return "";
  }
  try {
    const parsed = JSON.parse(content);
    return String(parsed?.text || "").trim();
  } catch {
    return "";
  }
}

function normalizeMentionName(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveBotIdentity(client, appId, config) {
  const configuredNames = Array.isArray(config.channels?.feishu?.botMentionNames)
    ? config.channels.feishu.botMentionNames
    : [];
  const names = new Set(
    [config.name, ...configuredNames].map(normalizeMentionName).filter(Boolean),
  );

  try {
    const response = await client.application.v6.application.get({
      params: {
        lang: "zh_cn",
      },
      path: {
        app_id: appId,
      },
    });
    const app = response?.data?.app;
    if (app?.app_name) {
      names.add(normalizeMentionName(app.app_name));
    }
    if (Array.isArray(app?.i18n)) {
      for (const item of app.i18n) {
        if (item?.name) {
          names.add(normalizeMentionName(item.name));
        }
      }
    }
  } catch (error) {
    console.warn("failed to resolve feishu app identity", error?.message || error);
  }

  return {
    openId: null,
    mentionNames: names,
  };
}

function rememberBotOpenId(botIdentity, response) {
  const sender = response?.data?.sender;
  if (!sender?.id || sender.id_type !== "open_id") {
    return;
  }
  botIdentity.openId = sender.id;
}

function isBotMention(mention, botIdentity) {
  if (!mention) {
    return false;
  }
  if (botIdentity.openId && mention.id?.open_id === botIdentity.openId) {
    return true;
  }
  const mentionName = normalizeMentionName(mention.name);
  return Boolean(mentionName) && botIdentity.mentionNames.has(mentionName);
}

function hasExplicitMention(event, botIdentity) {
  if (String(event.message?.chat_type || "").toLowerCase() === "p2p") {
    return true;
  }
  if (!Array.isArray(event.message?.mentions) || event.message.mentions.length === 0) {
    return false;
  }
  return event.message.mentions.some((mention) => isBotMention(mention, botIdentity));
}

function stripMentionMarkup(text) {
  return String(text || "")
    .replace(/<at\b[^>]*>.*?<\/at>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFeishuPrompt(text, event) {
  const cleaned = stripMentionMarkup(text);
  if (!cleaned) {
    return "";
  }

  if (event.message?.chat_type === "p2p") {
    return cleaned;
  }

  const senderOpenId = event.sender?.sender_id?.open_id || "unknown";
  return [
    "This is a Feishu group chat message that explicitly @mentioned you.",
    `Sender open_id: ${senderOpenId}`,
    "Respond naturally to the sender's actual request in the shared conversation.",
    "Do not rewrite the user's message as a template or suggest what others should say unless the user explicitly asks for copywriting help.",
    "",
    `User request: ${cleaned}`,
  ].join("\n");
}

function normalizeFeishuOutput(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return "Done.";
  }
  return trimmed.length > 3500 ? `${trimmed.slice(0, 3497)}...` : trimmed;
}

function renderRunningMessage(sessionLabel, hasSessionRef) {
  return `Running ${hasSessionRef ? "Codex resume" : "Codex"} on [${sessionLabel}]...`;
}

function renderQueuedMessage(sessionLabel, aheadCount) {
  return `Queued on [${sessionLabel}]. ${aheadCount} request(s) ahead.`;
}

async function sendText(client, chatId, text, options = {}) {
  const content = JSON.stringify({ text: normalizeFeishuOutput(text) });
  if (options.replyToMessageId) {
    return client.im.message.reply({
      path: {
        message_id: options.replyToMessageId,
      },
      data: {
        msg_type: "text",
        content,
      },
    });
  }

  return client.im.message.create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content,
    },
  });
}

async function ensureSession(botHome, chatState) {
  const cliState = await readCliState(botHome);
  if (!cliState.sessions[chatState.sessionLabel]) {
    cliState.sessions[chatState.sessionLabel] = {
      label: chatState.sessionLabel,
      cliSessionRef: chatState.cliSessionRef || null,
      createdAt: chatState.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
  }
  cliState.sessions[chatState.sessionLabel].updatedAt = nowIso();
  if (chatState.cliSessionRef) {
    cliState.sessions[chatState.sessionLabel].cliSessionRef = chatState.cliSessionRef;
  }
  await writeCliState(cliState, botHome);
  return cliState;
}

async function handleSlashCommand(command, chatState, client, chatId, options = {}) {
  if (command === "/where") {
    const sessionRef = chatState.cliSessionRef ? `resume=${chatState.cliSessionRef}` : "resume=not-started";
    await sendText(client, chatId, `Current session: ${chatState.sessionLabel}\n${sessionRef}`, options);
    return true;
  }
  return false;
}

async function main() {
  const botHome = resolveBotHome();
  const config = await readConfig(botHome);
  const feishu = config.channels?.feishu ?? {};
  if (!feishu.appId || !feishu.appSecret) {
    throw new Error("Feishu bridge cannot start: bot-scoped appId/appSecret is missing.");
  }
  const requireExplicitMention = feishu.requireExplicitMention ?? true;

  await writePidFile(DEFAULT_PID_PATH);

  const client = new Lark.Client({
    appId: feishu.appId,
    appSecret: feishu.appSecret,
    domain: Lark.Domain.Feishu,
  });

  const wsClient = new Lark.WSClient({
    appId: feishu.appId,
    appSecret: feishu.appSecret,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.info,
  });

  const activeRuns = new Map();
  const chatQueues = new Map();
  const pendingCounts = new Map();
  const commandConfig = buildCommandConfig(config);
  const botIdentity = await resolveBotIdentity(client, feishu.appId, config);

  const shutdown = async (signal) => {
    console.log(`feishu bridge shutting down: ${signal}`);
    await clearPidFile(DEFAULT_PID_PATH);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("exit", () => {
    void clearPidFile(DEFAULT_PID_PATH);
  });

  console.log("feishu bridge started");
  console.log(`feishu app id: ${feishu.appId}`);
  console.log(`feishu mention required: ${String(requireExplicitMention)}`);
  console.log(`feishu mention names: ${Array.from(botIdentity.mentionNames).join(", ") || "(none)"}`);

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": (event) => {
        void (async () => {
          const messageId = event.message?.message_id;
          const chatId = event.message?.chat_id;
          if (!messageId || !chatId) {
            return;
          }

          const routerState = await readRouterState(ROUTER_STATE_PATH);
          if (hasProcessedMessage(routerState, messageId)) {
            return;
          }
          rememberProcessedMessage(routerState, messageId);
          await writeRouterState(ROUTER_STATE_PATH, routerState);

          await captureFeishuMetadata(botHome, event);

          if (String(event.sender?.sender_type || "").toLowerCase() !== "user") {
            return;
          }
          if (event.message?.message_type !== "text") {
            const response = await sendText(client, chatId, "Only plain text messages are supported on the Feishu channel right now.", {
              replyToMessageId: messageId,
            });
            rememberBotOpenId(botIdentity, response);
            return;
          }

          const text = parseTextMessage(event.message?.content);
          if (!text) {
            return;
          }

          if (requireExplicitMention && !hasExplicitMention(event, botIdentity)) {
            return;
          }

          const chatState = ensureChatState(routerState, chatId);
          chatState.updatedAt = nowIso();
          await ensureSession(botHome, chatState);
          await writeRouterState(ROUTER_STATE_PATH, routerState);

          if (await handleSlashCommand(text.trim(), chatState, client, chatId, { replyToMessageId: messageId })) {
            return;
          }

          const promptText = buildFeishuPrompt(text, event);
          if (!promptText) {
            return;
          }

          const pendingBefore = pendingCounts.get(chatId) || 0;
          pendingCounts.set(chatId, pendingBefore + 1);
          if (pendingBefore > 0) {
            const queuedResponse = await sendText(client, chatId, renderQueuedMessage(chatState.sessionLabel, pendingBefore), {
              replyToMessageId: messageId,
            });
            rememberBotOpenId(botIdentity, queuedResponse);
          }

          const previous = chatQueues.get(chatId) ?? Promise.resolve();
          const next = previous
            .catch(() => {})
            .then(async () => {
              const runningResponse = await sendText(client, chatId, renderRunningMessage(chatState.sessionLabel, Boolean(chatState.cliSessionRef)), {
                replyToMessageId: messageId,
              });
              rememberBotOpenId(botIdentity, runningResponse);

              const prompt = await buildWorkspacePrompt(promptText, { botHome });
              const started = startCliTurn(prompt, chatState.cliSessionRef, commandConfig);
              activeRuns.set(chatId, started.child);

              const result = await started.result;
              activeRuns.delete(chatId);

              const latestState = await readRouterState(ROUTER_STATE_PATH);
              const latestChatState = ensureChatState(latestState, chatId);
              if (result.ok && result.cliSessionRef) {
                latestChatState.cliSessionRef = result.cliSessionRef;
              }
              latestChatState.updatedAt = nowIso();
              await writeRouterState(ROUTER_STATE_PATH, latestState);

              const cliState = await readCliState(botHome);
              if (!cliState.sessions[latestChatState.sessionLabel]) {
                cliState.sessions[latestChatState.sessionLabel] = {
                  label: latestChatState.sessionLabel,
                  cliSessionRef: latestChatState.cliSessionRef || null,
                  createdAt: latestChatState.createdAt || nowIso(),
                  updatedAt: nowIso(),
                };
              }
              cliState.sessions[latestChatState.sessionLabel].cliSessionRef = latestChatState.cliSessionRef || null;
              cliState.sessions[latestChatState.sessionLabel].updatedAt = nowIso();
              await writeCliState(cliState, botHome);

              if (!result.ok) {
                const failureResponse = await sendText(client, chatId, `Request failed.\n${result.stderr || result.output || "Unknown error."}`, {
                  replyToMessageId: messageId,
                });
                rememberBotOpenId(botIdentity, failureResponse);
                return;
              }

              const successResponse = await sendText(client, chatId, result.output || "Done.", {
                replyToMessageId: messageId,
              });
              rememberBotOpenId(botIdentity, successResponse);
            })
            .finally(() => {
              const remaining = (pendingCounts.get(chatId) || 1) - 1;
              if (remaining <= 0) {
                pendingCounts.delete(chatId);
                if (chatQueues.get(chatId) === next) {
                  chatQueues.delete(chatId);
                }
                return;
              }
              pendingCounts.set(chatId, remaining);
            });

          chatQueues.set(chatId, next);
          await next;
        })().catch(async (error) => {
          console.error("feishu event handler failed", error);
          const chatId = event.message?.chat_id;
          const messageId = event.message?.message_id;
          if (chatId) {
            const errorResponse = await sendText(client, chatId, `Request failed.\n${error.message}`, {
              replyToMessageId: messageId,
            });
            rememberBotOpenId(botIdentity, errorResponse);
          }
        });
      },
    }),
  });

  await new Promise(() => {});
}

await main();
