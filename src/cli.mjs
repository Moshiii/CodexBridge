import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import { pairTelegramChannel } from "./telegram-pairing.mjs";
import {
  AUTOAIDE_HOME,
  BOOTSTRAP_STATE_PATH,
  TELEGRAM_BRIDGE_PATH,
  TELEGRAM_STATE_PATH,
  WORKSPACE_PATH,
  ensureAutoAideHome,
  readCliState,
  readConfig,
  writeCliState,
  writeConfig,
  createDefaultCliState,
} from "./config.mjs";
import { buildCommandConfig, runCliTurn } from "./codex-runner.mjs";
import { completeBootstrap, ensureWorkspaceBootstrap } from "./workspace-bootstrap.mjs";
import { buildWorkspacePrompt } from "./workspace-context.mjs";

function printBanner() {
  console.log("AutoAide is ready.");
  console.log(`Home: ${AUTOAIDE_HOME}`);
  console.log(`Workspace: ${WORKSPACE_PATH}`);
  console.log("Talk naturally, or use /channel to connect Telegram.");
  console.log("Use /help to see commands.\n");
}

function formatCliStatus(config, bridgeProcess, cliState, bootstrapInfo) {
  const telegram = config.channels?.telegram;
  const telegramOnline = Boolean(bridgeProcess && !bridgeProcess.killed && bridgeProcess.exitCode == null);
  return [
    `Home: ${AUTOAIDE_HOME}`,
    `Workspace: ${WORKSPACE_PATH}`,
    `Bootstrap state: ${BOOTSTRAP_STATE_PATH}`,
    `Telegram state: ${TELEGRAM_STATE_PATH}`,
    `Model: ${config.model || "gpt-5.4"}`,
    `Bootstrap completed: ${bootstrapInfo.bootstrapPending ? "no" : "yes"}`,
    `CLI active session: ${cliState.activeSessionLabel}`,
    `Telegram paired: ${telegram?.enabled ? "yes" : "no"}`,
    `Telegram daemon online: ${telegramOnline ? "yes" : "no"}`,
    telegram?.enabled
      ? `Telegram chat ids: ${(telegram.allowedChatIds ?? []).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function printBootstrapHint(bootstrapInfo) {
  if (!bootstrapInfo.bootstrapPending) {
    return;
  }

  console.log("Bootstrap is still pending.");
  console.log("Use your first conversation to establish:");
  console.log("- what the user should be called");
  console.log("- what the assistant should be called");
  console.log("- tone, vibe, and basic preferences");
  console.log("Those details belong in IDENTITY.md, USER.md, and SOUL.md.\n");
}

async function askBootstrapQuestion(rl, prompt, fallback = "") {
  try {
    const answer = (await rl.question(prompt)).trim();
    return answer || fallback;
  } catch (error) {
    if (error?.code === "ERR_USE_AFTER_CLOSE") {
      return fallback;
    }
    throw error;
  }
}

async function runBootstrapFlow(rl, bootstrapInfoRef) {
  if (!bootstrapInfoRef.current.bootstrapPending) {
    return;
  }

  console.log("Let's finish first-run setup.");
  console.log("I need a few basics so I can keep them in the workspace and remember them later.\n");

  const userName = await askBootstrapQuestion(rl, "What should I call you? ");
  if (!userName) {
    console.log("Bootstrap is still pending. I need your name to continue.\n");
    return;
  }

  const assistantName = await askBootstrapQuestion(
    rl,
    "What should I be called? [AutoAide] ",
    "AutoAide",
  );
  const assistantType = await askBootstrapQuestion(
    rl,
    "What kind of assistant do you want me to be? [personal operator] ",
    "personal operator",
  );
  const vibe = await askBootstrapQuestion(
    rl,
    "What vibe should I have? [pragmatic, clear, and steady] ",
    "pragmatic, clear, and steady",
  );
  const userPreference = await askBootstrapQuestion(
    rl,
    "Any one-line preference I should remember? [keep it concise] ",
    "keep it concise",
  );

  bootstrapInfoRef.current = await completeBootstrap({
    userName,
    assistantName,
    assistantType,
    vibe,
    userPreference,
    creature: "AI assistant",
  });

  console.log("\nBootstrap complete.");
  console.log(`I'll call you ${userName}.`);
  console.log(`My name is now ${assistantName}.\n`);
  console.log("Saved:");
  console.log("- IDENTITY.md");
  console.log("- USER.md");
  console.log("- SOUL.md\n");
}

function renderCliResult(result) {
  if (result.ok) {
    return result.output || "Codex completed without output.";
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

function startTelegramBridge(config) {
  const telegram = config.channels?.telegram;
  if (!telegram?.enabled || !telegram.botToken || !(telegram.allowedChatIds ?? []).length) {
    return null;
  }

  const child = spawn(
    process.env.SHELL || "zsh",
    [
      "-lc",
      `node "${TELEGRAM_BRIDGE_PATH}"`,
    ],
    {
      cwd: WORKSPACE_PATH,
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: telegram.botToken,
        TELEGRAM_ALLOWED_CHAT_IDS: telegram.allowedChatIds.join(","),
        AUTOAIDE_HOME,
        CODEX_CWD: process.env.CODEX_CWD?.trim() || WORKSPACE_PATH,
        CODEX_START_COMMAND:
          process.env.CODEX_START_COMMAND?.trim() ||
          "codex exec --skip-git-repo-check --json -",
        CODEX_RESUME_COMMAND_TEMPLATE:
          process.env.CODEX_RESUME_COMMAND_TEMPLATE?.trim() ||
          "codex exec resume --skip-git-repo-check --json __SESSION_ID__ -",
      },
      stdio: "ignore",
    },
  );

  child.unref();
  return child;
}

async function handleChannelCommand(rl, config, bridgeProcessRef) {
  console.log("Available channels:");
  console.log("1. Telegram\n");
  const selection = (await rl.question("Select a channel [telegram]: ")).trim().toLowerCase();
  if (selection && selection !== "1" && selection !== "telegram") {
    console.log("Only Telegram is available right now.\n");
    return;
  }

  console.log("\nOpen Telegram and message @BotFather.");
  console.log("Create a bot with /newbot, then paste the bot token here.\n");

  const token = (await rl.question("Telegram bot token: ")).trim();
  if (!token) {
    console.log("Pairing cancelled.\n");
    return;
  }

  console.log("\nNow send one message to your bot in Telegram, then press Enter here.");
  await rl.question("");

  try {
    const paired = await pairTelegramChannel(token);
    config.channels.telegram = {
      enabled: true,
      botToken: token,
      allowedChatIds: [paired.chatId],
    };
    await writeConfig(config);

    if (bridgeProcessRef.current && bridgeProcessRef.current.exitCode == null) {
      bridgeProcessRef.current.kill("SIGTERM");
    }
    bridgeProcessRef.current = startTelegramBridge(config);

    console.log(
      `Paired successfully.\nTelegram chat connected: ${paired.chatId}${paired.username ? ` (@${paired.username})` : ""}\n`,
    );
  } catch (error) {
    console.log(`Pairing failed: ${error.message}\n`);
  }
}

async function handleCliMessage(line, cliState, config) {
  const active = cliState.sessions[cliState.activeSessionLabel];
  const commandConfig = buildCommandConfig(config);
  const prompt = await buildWorkspacePrompt(line);
  console.log(`Running on [${active.label}]...\n`);
  const result = await runCliTurn(prompt, active.cliSessionRef, commandConfig);
  if (result.ok && result.cliSessionRef) {
    active.cliSessionRef = result.cliSessionRef;
    active.updatedAt = new Date().toISOString();
    await writeCliState(cliState);
  }
  console.log(`${renderCliResult(result)}\n`);
}

async function handleSlashCommand(line, rl, config, bridgeProcessRef, cliState, bootstrapInfoRef) {
  const [command, ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (command) {
    case "/help":
      console.log("/channel  pair Telegram");
      console.log("/status   show paths, model, and daemon status");
      console.log("/where    show current CLI session");
      console.log("/exit     quit AutoAide\n");
      return true;
    case "/channel":
      await handleChannelCommand(rl, config, bridgeProcessRef);
      return true;
    case "/status":
      console.log(`${formatCliStatus(config, bridgeProcessRef.current, cliState, bootstrapInfoRef.current)}\n`);
      return true;
    case "/where":
      console.log(`CLI current session: ${cliState.activeSessionLabel}\n`);
      return true;
    case "/exit":
      if (bridgeProcessRef.current && bridgeProcessRef.current.exitCode == null) {
        bridgeProcessRef.current.kill("SIGTERM");
      }
      rl.close();
      return "exit";
    default:
      if (command.startsWith("/")) {
        console.log(`Unknown command: ${command}\n`);
        return true;
      }
      return false;
  }
}

export async function startCli() {
  await ensureAutoAideHome();
  const bootstrapInfoRef = {
    current: await ensureWorkspaceBootstrap(),
  };
  const rl = createInterface({ input, output });
  const config = await readConfig();
  const cliState = await readCliState();
  const bridgeProcessRef = {
    current: startTelegramBridge(config),
  };

  if (!cliState.sessions?.main) {
    const fresh = createDefaultCliState();
    cliState.sessions = fresh.sessions;
    cliState.activeSessionLabel = fresh.activeSessionLabel;
    await writeCliState(cliState);
  }

  printBanner();
  printBootstrapHint(bootstrapInfoRef.current);
  await runBootstrapFlow(rl, bootstrapInfoRef);

  while (true) {
    let line;
    try {
      line = (await rl.question("autoaide> ")).trim();
    } catch (error) {
      if (error?.code === "ERR_USE_AFTER_CLOSE") {
        return;
      }
      throw error;
    }
    if (!line) {
      continue;
    }
    const handled = await handleSlashCommand(line, rl, config, bridgeProcessRef, cliState, bootstrapInfoRef);
    if (handled === "exit") {
      return;
    }
    if (handled) {
      continue;
    }
    await handleCliMessage(line, cliState, config);
  }
}
