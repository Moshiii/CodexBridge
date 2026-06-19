import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import * as Lark from "@larksuiteoapi/node-sdk";
import { pairTelegramChannel } from "./telegram-pairing.mjs";
import {
  CODEXBRIDGE_HOME,
  getBootstrapStatePath,
  getBotRuntimePidPath,
  getFeishuStatePath,
  getTelegramStatePath,
  getWorkspacePath,
  ensureCodexBridgeHome,
  readCliState,
  readConfig,
  writeCliState,
  writeConfig,
  createDefaultCliState,
} from "./config.mjs";
import { DEFAULT_BOT_ID } from "./config.mjs";
import { buildCommandConfig, startCliTurn } from "./codex-runner.mjs";
import { hydrateTelegramMetadata } from "./telegram-metadata.mjs";
import { completeBootstrap, ensureWorkspaceBootstrap } from "./workspace-bootstrap.mjs";
import { buildWorkspacePrompt } from "./workspace-context.mjs";
import { createBot, ensureDefaultBot, getBot, listBots, normalizeBotId, restartBot, setActiveBot, startBot, stopBot, updateBotConfig } from "./bots.mjs";
import { promptSelect } from "./interactive-menu.mjs";
import { chargeTurnCredits, getUserCredits, renderInsufficientCreditsMessage, resolveCliCreditsUserId } from "./user-credits.mjs";
import {
  formatSkillInstallResult,
  formatSkillsList,
  formatSkillsOverview,
  installSkillFromPath,
  listSkills,
} from "./skills.mjs";
import { formatKeyValueCard, formatListCard, formatMessageCard, showStartupBanner } from "./ui/banner.mjs";

function formatBotPrompt(botId) {
  return `codexbridge:${botId}> `;
}

function isReadlineAbortError(error) {
  return error?.code === "ABORT_ERR" || error?.name === "AbortError";
}

function clearCliViewport() {
  if (!output?.isTTY) {
    return;
  }
  output.write("\x1b[2J\x1b[H");
}

function getTelegramConfigView(config) {
  const telegram = config.channels?.telegram ?? {};
  return {
    ...telegram,
    privateAllowedChatIds: telegram.private?.allowedChatIds ?? [],
    groupAllowedChatIds: telegram.groups?.allowedChatIds ?? [],
    groupAllowedUserIds: telegram.groups?.allowedUserIds ?? [],
  };
}

function getFeishuConfigView(config) {
  const feishu = config.channels?.feishu ?? {};
  return {
    ...feishu,
    metadataChats: feishu.metadata?.chats ?? {},
    metadataUsers: feishu.metadata?.users ?? {},
  };
}

function formatTelegramEntity(id, entry, fallbackLabel = null) {
  if (entry?.label) {
    return `${entry.label} (${id})`;
  }
  if (entry?.username) {
    return `@${entry.username.replace(/^@+/, "")} (${id})`;
  }
  if (entry?.title) {
    return `${entry.title} (${id})`;
  }
  return fallbackLabel ? `${fallbackLabel} (${id})` : String(id);
}

function formatTelegramEntityList(ids, metadata, kind) {
  if (!ids?.length) {
    return kind === "chat" ? "(all chats)" : "(none)";
  }
  const source = kind === "user" ? metadata?.users : metadata?.chats;
  return ids
    .map((id) => formatTelegramEntity(id, source?.[id]))
    .join(", ");
}

function formatStatusOverview(botContext, config, bridgeProcess, cliState, bootstrapInfo, creditsInfo = null) {
  const telegram = getTelegramConfigView(config);
  const feishu = getFeishuConfigView(config);
  const runtimeOnline = Boolean(bridgeProcess?.pid);
  const activeChannel = config.channel || "telegram";
  const creditsBalance = creditsInfo?.account?.balance;
  const creditsDisplay = Number.isFinite(creditsBalance) ? String(creditsBalance) : "unknown";
  return formatKeyValueCard("Current Bot", [
    ["bot", botContext.botId],
    ["channel", activeChannel],
    ["runtime", runtimeOnline ? "online" : "offline"],
    ["bootstrap", bootstrapInfo.bootstrapPending ? "pending" : "done"],
    ["session", cliState.activeSessionLabel],
    ["credits", creditsDisplay],
    ["telegram", telegram?.enabled ? "paired" : "unpaired"],
    ["feishu", feishu?.enabled ? "configured" : "not configured"],
  ]);
}

function restoreCliPrompt(rl, botId) {
  if (!output?.isTTY || typeof rl?.write !== "function") {
    return;
  }
  output.write(formatBotPrompt(botId));
  rl.write("");
}

function formatCliStatus(botContext, config, bridgeProcess, cliState, bootstrapInfo, creditsInfo = null) {
  const telegram = getTelegramConfigView(config);
  const feishu = getFeishuConfigView(config);
  const runtimeOnline = Boolean(bridgeProcess?.pid);
  const activeChannel = config.channel || "telegram";
  const telegramOnline = runtimeOnline && activeChannel === "telegram" && telegram?.enabled;
  const feishuOnline = runtimeOnline && activeChannel === "feishu" && feishu?.enabled;
  const creditsBalance = creditsInfo?.account?.balance;
  const creditsDisplay = Number.isFinite(creditsBalance) ? String(creditsBalance) : "unknown";
  return formatKeyValueCard("CodexBridge Status", [
    ["home", CODEXBRIDGE_HOME],
    ["bot", botContext.botId],
    ["workspace", getWorkspacePath(botContext.botHome)],
    ["bootstrap state", getBootstrapStatePath(botContext.botHome)],
    ["runtime pid file", getBotRuntimePidPath(botContext.botHome)],
    ["telegram state", getTelegramStatePath(botContext.botHome)],
    ["feishu state", getFeishuStatePath(botContext.botHome)],
    ["active channel", activeChannel],
    ["owner user id", config.ownerUserId || "unset"],
    ["admin count", String((config.adminUserIds ?? []).length)],
    ["credits user id", creditsInfo?.account?.userId || resolveCliCreditsUserId(config)],
    ["credits remaining", creditsDisplay],
    ["model", config.runtime?.model || "gpt-5.4"],
    ["bootstrap completed", bootstrapInfo.bootstrapPending ? "no" : "yes"],
    ["active session", cliState.activeSessionLabel],
    ["bot runtime online", runtimeOnline ? "yes" : "no"],
    ["telegram paired", telegram?.enabled ? "yes" : "no"],
    ["telegram bridge online", telegramOnline ? "yes" : "no"],
    ["feishu enabled", feishu?.enabled ? "yes" : "no"],
    ["feishu bridge online", feishuOnline ? "yes" : "no"],
    ["feishu app id", feishu?.appId || "none"],
    ["feishu mention required", String(feishu?.requireExplicitMention ?? true)],
    ...(telegram?.enabled
      ? [
          ["private chats", formatTelegramEntityList(telegram.privateAllowedChatIds, telegram.metadata, "chat")],
          ["group chats", formatTelegramEntityList(telegram.groupAllowedChatIds, telegram.metadata, "chat")],
          ["group users", formatTelegramEntityList(telegram.groupAllowedUserIds, telegram.metadata, "user")],
        ]
      : []),
  ]);
}

function getRunningTurn(runningTurns, label) {
  return runningTurns.get(label) || null;
}

function formatCliSessions(cliState, runningTurns) {
  const sessions = Object.values(cliState.sessions).sort((a, b) => a.label.localeCompare(b.label));
  return formatListCard(
    "Sessions",
    sessions.map((session) => {
      const tags = [
        session.label === cliState.activeSessionLabel ? "active" : null,
        session.cliSessionRef ? "started" : "empty",
        getRunningTurn(runningTurns, session.label) ? "running" : null,
      ].filter(Boolean);
      return `- ${session.label} [${tags.join(", ")}]`;
    }),
  );
}

async function resolveFeishuAppOwnerUserId(appId, appSecret) {
  const client = new Lark.Client({
    appId,
    appSecret,
    domain: Lark.Domain.Feishu,
  });
  const response = await client.application.v6.application.get({
    params: {
      lang: "zh_cn",
      user_id_type: "user_id",
    },
    path: {
      app_id: appId,
    },
  });
  return String(response?.data?.app?.creator_id || "").trim() || null;
}

function buildBootstrapSummaryLines() {
  return [
    "Use your first conversation to establish:",
    "- what the user should be called",
    "- what the assistant should be called",
    "- tone, vibe, and basic preferences",
    "Those details belong in IDENTITY.md, USER.md, and SOUL.md.",
  ];
}

async function askBootstrapQuestion(rl, prompt, fallback = "") {
  try {
    const answer = (await rl.question(prompt)).trim();
    return answer || fallback;
  } catch (error) {
    if (isReadlineAbortError(error)) {
      throw error;
    }
    if (error?.code === "ERR_USE_AFTER_CLOSE") {
      return fallback;
    }
    throw error;
  }
}

async function runBootstrapFlow(rl, bootstrapInfoRef, botContextRef) {
  if (!bootstrapInfoRef.current.bootstrapPending) {
    return;
  }

  console.log(
    `${formatMessageCard("First-Run Setup", [
      "Let's finish first-run setup.",
      "I need a few basics so I can keep them in the workspace and remember them later.",
    ])}\n`,
  );

  const userName = await askBootstrapQuestion(rl, "What should I call you? ");
  if (!userName) {
    console.log(`${formatMessageCard("Bootstrap Pending", ["I need your name to continue."])}\n`);
    return;
  }

  const assistantName = await askBootstrapQuestion(
    rl,
    "What should I be called? [CodexBridge] ",
    "CodexBridge",
  );
  const useDefaults = await askBootstrapQuestion(
    rl,
    "Use the default assistant style and preferences? [Y/n] ",
    "y",
  );
  const wantsCustomSetup = /^n/i.test(useDefaults);
  const assistantType = wantsCustomSetup
    ? await askBootstrapQuestion(
      rl,
      "What kind of assistant do you want me to be? [personal operator] ",
      "personal operator",
    )
    : "personal operator";
  const vibe = wantsCustomSetup
    ? await askBootstrapQuestion(
      rl,
      "What vibe should I have? [pragmatic, clear, and steady] ",
      "pragmatic, clear, and steady",
    )
    : "pragmatic, clear, and steady";
  const userPreference = wantsCustomSetup
    ? await askBootstrapQuestion(
      rl,
      "Any one-line preference I should remember? [keep it concise] ",
      "keep it concise",
    )
    : "keep it concise";

  bootstrapInfoRef.current = await completeBootstrap({
    userName,
    assistantName,
    assistantType,
    vibe,
    userPreference,
    creature: "AI assistant",
  }, botContextRef.current.botHome);

  console.log(
    `\n${formatListCard("Bootstrap Complete", [
      `I'll call you ${userName}.`,
      `My name is now ${assistantName}.`,
      "Saved:",
      "- IDENTITY.md",
      "- USER.md",
      "- SOUL.md",
    ])}\n`,
  );
}

async function maybeHandlePendingBootstrap(rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns) {
  while (bootstrapInfoRef.current.bootstrapPending) {
    const choice = await promptSelect({
      rl,
      input,
      output,
      title: "First-Run Setup",
      items: [
        { label: "Finish setup now", value: "finish" },
        { label: "Skip for now", value: "skip" },
        { label: "Switch to another bot", value: "switch-bot" },
        { label: "Exit CodexBridge", value: "exit" },
      ],
      defaultIndex: 0,
      bodyLines: buildBootstrapSummaryLines(),
      hintLines: [
        "A new bot can stay unconfigured until you are ready.",
      ],
      fullscreen: true,
      fallbackPrompt: "Setup [1=finish, 2=skip, 3=switch bot, 4=exit]: ",
    });

    if (choice.action === "cancel" || choice.value === "skip") {
      return true;
    }
    if (choice.value === "exit") {
      rl.close();
      return "exit";
    }
    if (choice.value === "switch-bot") {
      await openBotPicker(rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns);
      continue;
    }
    await runBootstrapFlow(rl, bootstrapInfoRef, botContextRef);
    if (!bootstrapInfoRef.current.bootstrapPending) {
      return true;
    }
  }
  return true;
}

function renderCliResult(result) {
  if (result.ok) {
    return result.output || "Codex completed without output.";
  }
  if (result.signal) {
    const parts = [`Codex interrupted (${result.signal}).`];
    if (result.stderr) {
      parts.push(`stderr:\n${result.stderr}`);
    }
    return parts.join("\n\n");
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

async function autoFillTelegramChatIdIfNeeded(config, botHome) {
  const telegram = getTelegramConfigView(config);
  if (!telegram.enabled || !telegram.botToken || telegram.privateAllowedChatIds.length) {
    return;
  }

  try {
    const paired = await pairTelegramChannel(telegram.botToken);
    config.channels.telegram.private = {
      ...(config.channels.telegram.private ?? {}),
      allowedChatIds: [paired.chatId],
    };
    await writeConfig(config, botHome);
  } catch {
    // Keep running without chat filter if we can't resolve latest private chat.
  }
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

async function selectChannelType(rl) {
  const selection = await promptSelect({
    rl,
    input,
    output,
    title: "Connect A Channel",
    items: [
      { label: "Telegram  Pair a bot token and private chat", value: "telegram" },
      { label: "Feishu   Configure a self-built app", value: "feishu" },
    ],
    hintLines: [
      "Use ↑/↓ and Enter. Esc cancels.",
    ],
    fullscreen: true,
    defaultIndex: 0,
    fallbackPrompt: "Channel [1=Telegram, 2=Feishu, q=cancel]: ",
  });

  if (selection.action === "cancel") {
    return null;
  }
  return selection.value;
}

async function handleTelegramChannelSetup(rl, botContextRef, config, bridgeProcessRef) {
  console.log(
    `\n${formatListCard("Telegram Pairing", [
      "Open Telegram and message @BotFather.",
      "Create a bot with /newbot, then paste the bot token here.",
      "After pasting the token, send one message to your bot so CodexBridge can pair the private chat.",
    ])}\n`,
  );

  const token = (await rl.question("Telegram bot token: ")).trim();
  if (!token) {
    console.log(`${formatMessageCard("Telegram Pairing", ["Pairing cancelled."])}\n`);
    return;
  }

  const currentBot = await getBot(botContextRef.current.botId);
  const currentTelegram = config.channels?.telegram ?? {};
  const hadRunningRuntime = Boolean(currentBot.runtimePid);
  let shouldRestoreRuntime = hadRunningRuntime;

  if (hadRunningRuntime) {
    console.log(`${formatMessageCard("Telegram Pairing", ["Pausing the current bot runtime so pairing can read Telegram updates cleanly..."])}\n`);
    await stopBot(botContextRef.current.botId).catch(() => {});
    bridgeProcessRef.current = { pid: null };
  }

  console.log(`\n${formatMessageCard("Telegram Pairing", ["Now send one message to your bot in Telegram, then press Enter here."])}\n`);
  await rl.question("");

  try {
    let paired = null;
    try {
      paired = await pairTelegramChannel(token);
    } catch (error) {
      const existingChatId = currentTelegram.private?.allowedChatIds?.[0] ?? null;
      if (currentTelegram.botToken === token && existingChatId) {
        paired = {
          chatId: String(existingChatId),
          userId: String(currentTelegram.groups?.allowedUserIds?.[0] ?? currentTelegram.private?.allowedChatIds?.[0]),
          username: currentTelegram.botUsername || null,
        };
      } else {
        throw error;
      }
    }
    config = await updateBotConfig(botContextRef.current.botId, (currentConfig) => {
      const existingGroupUserIds = currentConfig.channels?.telegram?.groups?.allowedUserIds ?? [];
      return {
        ...currentConfig,
        channel: "telegram",
        ownerUserId: currentConfig.ownerUserId || paired.userId,
        adminUserIds: currentConfig.adminUserIds?.length
          ? currentConfig.adminUserIds
          : [paired.userId],
        enabled: true,
        channels: {
          ...currentConfig.channels,
          telegram: {
            enabled: true,
            botToken: token,
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
    shouldRestoreRuntime = false;
    try {
      bridgeProcessRef.current = {
        pid: await startBot(botContextRef.current.botId),
      };
    } catch {
      bridgeProcessRef.current = {
        pid: (await getBot(botContextRef.current.botId)).runtimePid,
      };
    }

    console.log(
      `${formatKeyValueCard("Telegram Paired", [
        ["status", "paired successfully"],
        ["chat id", String(paired.chatId)],
        ["owner user id", String(config.ownerUserId || paired.userId)],
        ...(paired.botUsername ? [["bot username", `@${paired.botUsername}`]] : []),
        ...(paired.userUsername ? [["paired user", `@${paired.userUsername}`]] : []),
      ])}\n`,
    );
  } catch (error) {
    console.log(`${formatMessageCard("Telegram Pairing Failed", [error.message])}\n`);
    if (shouldRestoreRuntime && currentTelegram.enabled && currentTelegram.botToken) {
      try {
        bridgeProcessRef.current = {
          pid: await startBot(botContextRef.current.botId),
        };
      } catch {
        bridgeProcessRef.current = {
          pid: (await getBot(botContextRef.current.botId)).runtimePid,
        };
      }
    }
  }
}

async function handleFeishuChannelSetup(rl, botContextRef, config, bridgeProcessRef) {
  console.log(
    `\n${formatListCard("Feishu Setup", [
      "Create a self-built app in Feishu Open Platform.",
      "Enable bot capability, IM permissions, and subscribe to im.message.receive_v1.",
      "This bridge uses long connection mode, so no public webhook URL is required.",
      "Install or publish the app into the tenant where you want to chat with it.",
      "Then open a chat with the app and send a plain text message.",
    ])}\n`,
  );

  console.log(
    `${formatListCard("Feishu Checklist", [
      "1. Open https://open.feishu.cn/app and create a self-built app.",
      "2. In App Features, enable the bot so the app can be chatted with in Feishu.",
      "3. In Permission Management, enable the IM message scopes needed for receiving and sending messages.",
      "4. In Event Subscriptions, add im.message.receive_v1.",
      "5. This bridge uses long connection mode, so you do not need to configure a public request URL.",
      "6. Install or publish the app to the target workspace or tenant before testing.",
      "7. If the bot is intended for group chats, make sure it can be added to chats/groups.",
    ])}\n`,
  );

  const appId = (await rl.question("Feishu app id: ")).trim();
  const appSecret = (await rl.question("Feishu app secret: ")).trim();
  if (!appId || !appSecret) {
    console.log(`${formatMessageCard("Feishu Setup", ["Setup cancelled."])}\n`);
    return;
  }

  try {
    let detectedOwnerUserId = null;
    try {
      detectedOwnerUserId = await resolveFeishuAppOwnerUserId(appId, appSecret);
    } catch {
      detectedOwnerUserId = null;
    }
    const currentBot = await getBot(botContextRef.current.botId);
    const hadRunningRuntime = Boolean(currentBot.runtimePid);
    if (hadRunningRuntime) {
      console.log(`${formatMessageCard("Feishu Setup", ["Restarting the current bot runtime so the Feishu bridge can take over..."])}\n`);
      await stopBot(botContextRef.current.botId).catch(() => {});
      bridgeProcessRef.current = { pid: null };
    }

    config = await updateBotConfig(botContextRef.current.botId, (currentConfig) => ({
      ...currentConfig,
      channel: "feishu",
      ownerUserId: currentConfig.ownerUserId || detectedOwnerUserId || "",
      adminUserIds:
        currentConfig.adminUserIds?.length
          ? currentConfig.adminUserIds
          : detectedOwnerUserId
            ? [detectedOwnerUserId]
            : [],
      enabled: true,
      channels: {
        ...currentConfig.channels,
        feishu: {
          ...(currentConfig.channels?.feishu ?? {}),
          enabled: true,
          appId,
          appSecret,
          requireExplicitMention: currentConfig.channels?.feishu?.requireExplicitMention ?? true,
        },
      },
    }));

    try {
      bridgeProcessRef.current = {
        pid: await startBot(botContextRef.current.botId),
      };
    } catch {
      bridgeProcessRef.current = {
        pid: (await getBot(botContextRef.current.botId)).runtimePid,
      };
    }

    console.log(
      `${formatKeyValueCard("Feishu Enabled", [
        ["status", "configured successfully"],
        ["app id", appId],
        ["owner user id", config.ownerUserId || detectedOwnerUserId || "unknown"],
        ["mode", "long connection"],
        ["next step", "In Feishu, send a plain text message to the app after bot capability, event subscription, and tenant installation are all configured"],
        ["if no reply", "Check App Features -> Bot, Event Subscriptions -> im.message.receive_v1, and whether the app is installed/published in your tenant"],
      ])}\n`,
    );
  } catch (error) {
    console.log(`${formatMessageCard("Feishu Setup Failed", [error.message])}\n`);
  }
}

async function handleChannelCommand(rl, botContextRef, config, bridgeProcessRef) {
  const selection = await selectChannelType(rl);
  if (!selection) {
    return;
  }
  if (selection === "telegram") {
    await handleTelegramChannelSetup(rl, botContextRef, config, bridgeProcessRef);
    return;
  }
  await handleFeishuChannelSetup(rl, botContextRef, config, bridgeProcessRef);
}

function requestStop(turn) {
  if (!turn || !turn.child || turn.child.exitCode != null || turn.child.killed) {
    return false;
  }
  turn.stopRequested = true;
  try {
    turn.child.kill("SIGTERM");
  } catch {
    return false;
  }
  setTimeout(() => {
    if (turn.child.exitCode == null && !turn.child.killed) {
      try {
        turn.child.kill("SIGKILL");
      } catch {
        // ignore hard-kill failures
      }
    }
  }, 3000).unref?.();
  return true;
}

async function loadCliBotContext(botId) {
  const bot = await getBot(botId);
  const botHome = bot.homePath;
  let config = await readConfig(botHome);
  config = await hydrateTelegramMetadata(botHome).catch(() => config);
  await autoFillTelegramChatIdIfNeeded(config, botHome);
  const cliState = await readCliState(botHome);
  if (!cliState.sessions?.main) {
    const fresh = createDefaultCliState();
    cliState.sessions = fresh.sessions;
    cliState.activeSessionLabel = fresh.activeSessionLabel;
    await writeCliState(cliState, botHome);
  }
  return {
    botId: bot.id,
    botHome,
    bot,
    config: await readConfig(botHome),
    cliState,
    bootstrapInfo: await ensureWorkspaceBootstrap(botHome),
    runtimePid: (await getBot(bot.id)).runtimePid,
  };
}

async function switchCliBot(botId, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef) {
  const next = await loadCliBotContext(botId);
  botContextRef.current = {
    botId: next.botId,
    botHome: next.botHome,
  };
  configRef.current = next.config;
  cliStateRef.current = next.cliState;
  bootstrapInfoRef.current = next.bootstrapInfo;
  bridgeProcessRef.current = {
    pid: next.runtimePid,
  };
  await setActiveBot(next.botId);
  return next;
}

function formatBotPickerLabel(bot, currentBotId) {
  const tags = [
    bot.id === currentBotId ? "current" : null,
    bot.enabled ? "enabled" : "disabled",
    bot.runtimePid ? "online" : "offline",
    bot.channel || "telegram",
  ].filter(Boolean).join(", ");
  return `${bot.id.padEnd(14)} ${bot.name} [${tags}]`;
}

async function promptForBotBasics(rl, defaults = {}) {
  const providedName = String(defaults.name || "").trim();
  const name = (await rl.question(`Bot name${providedName ? ` [${providedName}]` : ""}: `)).trim() || providedName;
  if (!name) {
    return null;
  }
  const derivedId = normalizeBotId(name) || defaults.id || "";
  const providedId = String(defaults.id || "").trim();
  const id = normalizeBotId((await rl.question(`Bot id [${providedId || derivedId}]: `)).trim() || providedId || derivedId);
  if (!id) {
    return null;
  }
  return { id, name };
}

async function createBotInteractive(rl, botContextRef) {
  console.log(`${formatMessageCard("New Bot", ["Create a bot with a short name. I will derive the id for you if needed."])}\n`);
  const basics = await promptForBotBasics(rl);
  if (!basics) {
    console.log(`${formatMessageCard("New Bot", ["Creation cancelled."])}\n`);
    return null;
  }
  const created = await createBot({
    id: basics.id,
    name: basics.name,
    enabled: false,
  });
  console.log(
    `${formatKeyValueCard("Bot Created", [
      ["id", created.id],
      ["name", basics.name],
      ["status", "disabled until configured"],
      ["next step", "Open /bots and press Enter to switch, or use /connect to configure a channel"],
    ])}\n`,
  );
  return created;
}

async function renameBotInteractive(rl, botId, botContextRef, configRef) {
  const bot = await getBot(botId);
  const config = await readConfig(bot.homePath);
  const nextName = (await rl.question(`Rename bot ${botId} [${config.name || bot.name}]: `)).trim();
  if (!nextName) {
    console.log(`${formatMessageCard("Rename Bot", ["Rename cancelled."])}\n`);
    return false;
  }
  await updateBotConfig(botId, (currentConfig) => ({
    ...currentConfig,
    name: nextName,
  }));
  if (botId === botContextRef.current.botId) {
    configRef.current = await readConfig(botContextRef.current.botHome);
  }
  console.log(`${formatMessageCard("Rename Bot", [`${botId} is now "${nextName}".`])}\n`);
  return true;
}

async function toggleBotEnabled(botId, botContextRef, configRef, bridgeProcessRef) {
  const bot = await getBot(botId);
  const config = await readConfig(bot.homePath);
  const nextEnabled = !(config.enabled ?? bot.enabled);
  await updateBotConfig(botId, (currentConfig) => ({
    ...currentConfig,
    enabled: nextEnabled,
  }));
  if (!nextEnabled && bot.runtimePid) {
    await stopBot(botId).catch(() => {});
  }
  if (botId === botContextRef.current.botId) {
    configRef.current = await readConfig(botContextRef.current.botHome);
    bridgeProcessRef.current = {
      pid: (await getBot(botContextRef.current.botId)).runtimePid,
    };
  }
  console.log(
    `${formatMessageCard("Bot Updated", [
      `${botId} is now ${nextEnabled ? "enabled" : "disabled"}.`,
    ])}\n`,
  );
  return true;
}

async function showBotDetails(botId) {
  const bot = await getBot(botId);
  const config = await readConfig(bot.homePath);
  console.log(
    `${formatKeyValueCard("Bot Details", [
      ["id", bot.id],
      ["name", config.name || bot.name],
      ["enabled", config.enabled ? "yes" : "no"],
      ["runtime", bot.runtimePid ? "online" : "offline"],
      ["channel", config.channel || "telegram"],
      ["telegram", config.channels?.telegram?.enabled ? "paired" : "unpaired"],
      ["feishu", config.channels?.feishu?.enabled ? "configured" : "not configured"],
      ["home", bot.homePath],
    ])}\n`,
  );
}

async function openBotPicker(rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns) {
  let highlightedBotId = botContextRef.current.botId;

  while (true) {
    const bots = await listBots();
    const currentIndex = Math.max(0, bots.findIndex((bot) => bot.id === highlightedBotId || bot.id === botContextRef.current.botId));
    const choice = await promptSelect({
      rl,
      input,
      output,
      title: "Bots",
      items: bots.map((bot) => ({
        label: formatBotPickerLabel(bot, botContextRef.current.botId),
        value: bot.id,
      })),
      defaultIndex: currentIndex,
      hintLines: [
        "Enter switches to the highlighted bot.",
        "Esc returns to the prompt.",
      ],
      fullscreen: true,
      shortcuts: [
        { key: "n", label: "new bot", action: "create" },
        { key: "r", label: "rename", action: "rename" },
        { key: "space", label: "enable/disable", action: "toggle-enabled" },
        { key: "c", label: "connect channel", action: "connect-channel" },
        { key: "i", label: "details", action: "details" },
      ],
      fallbackPrompt: "Bot [number, n, r, c, i, space, q]: ",
    });

    if (choice.action === "cancel") {
      return false;
    }

    const targetBotId = choice.value || bots[currentIndex]?.id || botContextRef.current.botId;
    highlightedBotId = targetBotId;

    if (choice.action === "shortcut") {
      if (choice.shortcut === "create") {
        const created = await createBotInteractive(rl, botContextRef);
        if (created?.id) {
          highlightedBotId = created.id;
        }
        continue;
      }
      if (choice.shortcut === "rename") {
        await renameBotInteractive(rl, targetBotId, botContextRef, configRef);
        continue;
      }
      if (choice.shortcut === "toggle-enabled") {
        await toggleBotEnabled(targetBotId, botContextRef, configRef, bridgeProcessRef);
        continue;
      }
      if (choice.shortcut === "details") {
        await showBotDetails(targetBotId);
        continue;
      }
      if (choice.shortcut === "connect-channel") {
        if (targetBotId !== botContextRef.current.botId) {
          if (Array.from(runningTurns.values()).some(Boolean)) {
            console.log(`${formatMessageCard("Bot Switch Failed", ["Stop running turns before switching bots."])}\n`);
            continue;
          }
          await switchCliBot(targetBotId, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef);
        }
        await handleChannelCommand(rl, botContextRef, configRef.current, bridgeProcessRef);
        configRef.current = await readConfig(botContextRef.current.botHome);
        continue;
      }
      continue;
    }

    if (targetBotId === botContextRef.current.botId) {
      return true;
    }
    if (Array.from(runningTurns.values()).some(Boolean)) {
      console.log(`${formatMessageCard("Bot Switch Failed", ["Stop running turns before switching bots."])}\n`);
      return true;
    }
    await switchCliBot(targetBotId, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef);
    return true;
  }
}

async function startCliMessage(line, rl, botContextRef, cliState, config, runningTurns) {
  const active = cliState.sessions[cliState.activeSessionLabel];
  if (getRunningTurn(runningTurns, active.label)) {
    console.log(`${formatMessageCard("Session Busy", [`${active.label} is already running. Use /stop first.`])}\n`);
    restoreCliPrompt(rl, botContextRef.current.botId);
    return;
  }
  const billingUserId = resolveCliCreditsUserId(config);
  const chargeResult = await chargeTurnCredits({
    userId: billingUserId,
    botHome: botContextRef.current.botHome,
  });
  if (!chargeResult.ok) {
    console.log(`${formatMessageCard("No Credits", [renderInsufficientCreditsMessage(chargeResult, { userId: billingUserId })])}\n`);
    restoreCliPrompt(rl, botContextRef.current.botId);
    return;
  }
  const commandConfig = {
    ...buildCommandConfig(config),
    onStatus(status) {
      console.log(`[status] ${status}`);
      restoreCliPrompt(rl, botContextRef.current.botId);
    },
  };
  const prompt = await buildWorkspacePrompt(line, { workspacePath: getWorkspacePath(botContextRef.current.botHome) });
  console.log(`Running on [${active.label}]...\n`);

  const started = startCliTurn(prompt, active.cliSessionRef, commandConfig);
  const turn = {
    child: started.child,
    stopRequested: false,
  };
  runningTurns.set(active.label, turn);

  void started.result
    .then(async (result) => {
      if (runningTurns.get(active.label) === turn) {
        runningTurns.delete(active.label);
      }
      if (result.ok && result.cliSessionRef) {
        active.cliSessionRef = result.cliSessionRef;
        active.updatedAt = new Date().toISOString();
        await writeCliState(cliState, botContextRef.current.botHome);
      }
      console.log(`\n${renderCliResult(result)}\n`);
      restoreCliPrompt(rl, botContextRef.current.botId);
    })
    .catch((error) => {
      if (runningTurns.get(active.label) === turn) {
        runningTurns.delete(active.label);
      }
      console.log(`\n${formatMessageCard("Turn Failed", [error.message])}\n`);
      restoreCliPrompt(rl, botContextRef.current.botId);
    });
}

async function restartBotRuntime(botId) {
  return await restartBot(botId);
}

function printHelpCard() {
  console.log(
    `${formatListCard("Commands", [
      "/bots     open the interactive bot picker",
      "/new      create a new bot with prompts",
      "/connect  configure Telegram or Feishu",
      "/me       show a compact status summary",
      "/status   same as /me, use /status full for full details",
      "/credits  show remaining credits for this bot",
      "/stop     stop the current running turn",
      "/restart  restart the current bot runtime",
      "/exit     quit CodexBridge",
      "text      run a normal Codex turn",
    ])}\n`,
  );
}

async function showCliStatus(botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns, options = {}) {
  const mode = options.mode || "summary";
  configRef.current = await readConfig(botContextRef.current.botHome);
  bridgeProcessRef.current = {
    pid: (await getBot(botContextRef.current.botId)).runtimePid,
  };
  const creditsInfo = await getUserCredits(
    resolveCliCreditsUserId(configRef.current),
    botContextRef.current.botHome,
  );
  console.log(
    `${formatStatusOverview(
      botContextRef.current,
      configRef.current,
      bridgeProcessRef.current,
      cliStateRef.current,
      bootstrapInfoRef.current,
      creditsInfo,
    )}\n`,
  );
  if (mode === "full") {
    console.log(
      `${formatCliStatus(
        botContextRef.current,
        configRef.current,
        bridgeProcessRef.current,
        cliStateRef.current,
        bootstrapInfoRef.current,
        creditsInfo,
      )}\n`,
    );
  }
  console.log(
    `${formatKeyValueCard("Run State", [
      ["current session", cliStateRef.current.activeSessionLabel],
      ["running", getRunningTurn(runningTurns, cliStateRef.current.activeSessionLabel) ? "yes" : "no"],
    ])}\n`,
  );
}

async function openMainMenu(rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns) {
  const items = [
    { label: "Chat with the current bot", value: "chat" },
    { label: "Switch bots", value: "bots" },
    { label: "Create a new bot", value: "new-bot" },
    { label: "Connect Telegram or Feishu", value: "connect" },
    { label: "Show current status", value: "status" },
  ];
  if (bootstrapInfoRef.current.bootstrapPending) {
    items.push({ label: "Finish first-run setup", value: "bootstrap" });
  }
  items.push(
    { label: "Show help", value: "help" },
    { label: "Exit CodexBridge", value: "exit" },
  );

  const choice = await promptSelect({
    rl,
    input,
    output,
    title: "Quick Actions",
    items,
    defaultIndex: 0,
    hintLines: [
      "Use ↑/↓ and Enter. Esc returns to the prompt.",
    ],
    fullscreen: true,
    fallbackPrompt: `Action [1-${items.length}, q=cancel]: `,
  });

  if (choice.action === "cancel") {
    return true;
  }

  if (choice.value === "chat") {
    console.log(`${formatMessageCard("Chat", ["Type any request and press Enter to run it on the current bot."])}\n`);
    return true;
  }
  if (choice.value === "bots") {
    await openBotPicker(rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns);
    return true;
  }
  if (choice.value === "new-bot") {
    await createBotInteractive(rl, botContextRef);
    return true;
  }
  if (choice.value === "connect") {
    await handleChannelCommand(rl, botContextRef, configRef.current, bridgeProcessRef);
    configRef.current = await readConfig(botContextRef.current.botHome);
    return true;
  }
  if (choice.value === "status") {
    await showCliStatus(botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns, { mode: "summary" });
    return true;
  }
  if (choice.value === "bootstrap") {
    await runBootstrapFlow(rl, bootstrapInfoRef, botContextRef);
    return true;
  }
  if (choice.value === "help") {
    printHelpCard();
    return true;
  }
  if (choice.value === "exit") {
    rl.close();
    return "exit";
  }
  return true;
}

async function handleSlashCommand(line, rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns) {
  const [command, ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(" ").trim();
  const cliState = cliStateRef.current;

  switch (command) {
    case "/help":
      printHelpCard();
      return true;
    case "/bots":
      await openBotPicker(rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns);
      return true;
    case "/new":
      try {
        await createBotInteractive(rl, botContextRef);
      } catch (error) {
        console.log(`${formatMessageCard("Bot Create Failed", [error.message])}\n`);
      }
      return true;
    case "/connect":
      await handleChannelCommand(rl, botContextRef, configRef.current, bridgeProcessRef);
      configRef.current = await readConfig(botContextRef.current.botHome);
      return true;
    case "/me":
      await showCliStatus(botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns, { mode: "summary" });
      return true;
    case "/bot": {
      const [subcommand, ...botRest] = arg.split(/\s+/).filter(Boolean);
      if (!subcommand || subcommand === "list") {
        await openBotPicker(rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns);
        return true;
      }
      if (subcommand === "create") {
        try {
          const id = botRest.shift();
          const name = botRest.join(" ").trim();
          if (!id) {
            await createBotInteractive(rl, botContextRef);
            return true;
          }
          const created = await createBot({ id, name: name || id, enabled: false });
          console.log(`${formatMessageCard("Bot Created", [`${created.id} at ${created.homePath}`])}\n`);
        } catch (error) {
          console.log(`${formatMessageCard("Bot Create Failed", [error.message])}\n`);
        }
        return true;
      }
      if (subcommand === "use") {
        const botId = botRest[0];
        if (!botId) {
          console.log(`${formatMessageCard("Usage", ["/bot use <id>"])}\n`);
          return true;
        }
        if (Array.from(runningTurns.values()).some(Boolean)) {
          console.log(`${formatMessageCard("Bot Switch Failed", ["Stop running turns before switching bots."])}\n`);
          return true;
        }
        try {
          await switchCliBot(botId, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef);
        } catch (error) {
          console.log(`${formatMessageCard("Bot Switch Failed", [error.message])}\n`);
        }
        return true;
      }
      if (subcommand === "show") {
        const botId = botRest[0] || botContextRef.current.botId;
        try {
          const bot = await getBot(botId);
          const config = await readConfig(bot.homePath);
          console.log(`${formatKeyValueCard("Bot", [
            ["id", bot.id],
            ["name", bot.name],
            ["status", bot.status],
            ["home", bot.homePath],
            ["enabled", bot.enabled ? "yes" : "no"],
            ["channel", config.channel || "telegram"],
            ["telegram paired", config.channels?.telegram?.enabled ? "yes" : "no"],
            ["feishu enabled", config.channels?.feishu?.enabled ? "yes" : "no"],
          ])}\n`);
        } catch (error) {
          console.log(`${formatMessageCard("Bot Show Failed", [error.message])}\n`);
        }
        return true;
      }
      console.log(`${formatMessageCard("Usage", ["/bots", "/bot create <id> [name]", "/bot use <id>", "/bot show [id]"])}\n`);
      return true;
    }
    case "/channel":
      await handleChannelCommand(rl, botContextRef, configRef.current, bridgeProcessRef);
      configRef.current = await readConfig(botContextRef.current.botHome);
      return true;
    case "/status":
      await showCliStatus(botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns, {
        mode: rest[0] === "full" ? "full" : "summary",
      });
      return true;
    case "/credits": {
      configRef.current = await readConfig(botContextRef.current.botHome);
      const creditsInfo = await getUserCredits(
        resolveCliCreditsUserId(configRef.current),
        botContextRef.current.botHome,
      );
      console.log(
        `${formatKeyValueCard("Credits", [
          ["user id", creditsInfo.account.userId],
          ["remaining", String(creditsInfo.account.balance)],
          ["turn cost", String(creditsInfo.defaults.turnCost)],
          ["total consumed", String(creditsInfo.account.totalConsumed)],
        ])}\n`,
      );
      return true;
    }
    case "/stop": {
      const turn = getRunningTurn(runningTurns, cliState.activeSessionLabel);
      if (!turn) {
        console.log(`${formatMessageCard("Stop", [`No running task for ${cliState.activeSessionLabel}.`])}\n`);
        return true;
      }
      const stopped = requestStop(turn);
      console.log(
        `${formatMessageCard("Stop", [
          stopped ? `Stop requested for ${cliState.activeSessionLabel}.` : `Unable to stop ${cliState.activeSessionLabel}.`,
        ])}\n`,
      );
      return true;
    }
    case "/restart":
      console.log(`${formatMessageCard("Restarting", [`Restarting bot ${botContextRef.current.botId}...`])}\n`);
      bridgeProcessRef.current = {
        pid: await restartBotRuntime(botContextRef.current.botId),
      };
      console.log(
        `${formatKeyValueCard("Runtime Restarted", [["runtime pid", String(bridgeProcessRef.current.pid)]])}\n`,
      );
      return true;
    case "/exit":
      rl.close();
      return "exit";
    default:
      if (command.startsWith("/")) {
        console.log(`${formatMessageCard("Unknown Command", [command])}\n`);
        return true;
      }
      return false;
  }
}

export async function startCli({ botId = DEFAULT_BOT_ID } = {}) {
  await ensureCodexBridgeHome();
  await ensureDefaultBot();
  const initial = await loadCliBotContext(botId);
  const botContextRef = {
    current: {
      botId: initial.botId,
      botHome: initial.botHome,
    },
  };
  const bootstrapInfoRef = { current: initial.bootstrapInfo };
  const configRef = { current: initial.config };
  const cliStateRef = { current: initial.cliState };
  const bridgeProcessRef = { current: { pid: initial.runtimePid } };
  const runningTurns = new Map();

  await showStartupBanner({
    model: configRef.current.runtime?.model || "gpt-5.4",
    workspacePath: getWorkspacePath(botContextRef.current.botHome),
  });
  clearCliViewport();
  const rl = createInterface({ input, output });
  const bootstrapAction = await maybeHandlePendingBootstrap(
    rl,
    botContextRef,
    configRef,
    bridgeProcessRef,
    cliStateRef,
    bootstrapInfoRef,
    runningTurns,
  );
  if (bootstrapAction === "exit") {
    return;
  }

  while (true) {
    let line;
    try {
      line = (await rl.question(formatBotPrompt(botContextRef.current.botId))).trim();
    } catch (error) {
      if (isReadlineAbortError(error)) {
        rl.close();
        output.write("\n");
        return;
      }
      if (error?.code === "ERR_USE_AFTER_CLOSE") {
        return;
      }
      throw error;
    }
    if (!line) {
      const action = await openMainMenu(rl, botContextRef, configRef, bridgeProcessRef, cliStateRef, bootstrapInfoRef, runningTurns);
      if (action === "exit") {
        return;
      }
      continue;
    }
    const handled = await handleSlashCommand(
      line,
      rl,
      botContextRef,
      configRef,
      bridgeProcessRef,
      cliStateRef,
      bootstrapInfoRef,
      runningTurns,
    );
    if (handled === "exit") {
      return;
    }
    if (handled) {
      continue;
    }
    configRef.current = await readConfig(botContextRef.current.botHome);
    await startCliMessage(line, rl, botContextRef, cliStateRef.current, configRef.current, runningTurns);
  }
}
