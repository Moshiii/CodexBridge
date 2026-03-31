import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pairTelegramChannel } from "./telegram-pairing.mjs";
import {
  AUTOAIDE_HOME,
  BOOTSTRAP_STATE_PATH,
  DAEMON_PID_PATH,
  TELEGRAM_STATE_PATH,
  WORKSPACE_PATH,
  ensureAutoAideHome,
  readCliState,
  readConfig,
  writeCliState,
  writeConfig,
  createDefaultCliState,
} from "./config.mjs";
import { buildCommandConfig, startCliTurn } from "./codex-runner.mjs";
import { isDaemonRunning } from "./daemon.mjs";
import { ensureDaemonRunning } from "./launcher.mjs";
import { completeBootstrap, ensureWorkspaceBootstrap } from "./workspace-bootstrap.mjs";
import { buildWorkspacePrompt } from "./workspace-context.mjs";
import { formatKeyValueCard, formatListCard, formatMessageCard, showStartupBanner } from "./ui/banner.mjs";

function formatCliStatus(config, bridgeProcess, cliState, bootstrapInfo) {
  const telegram = config.channels?.telegram;
  const daemonOnline = Boolean(bridgeProcess?.pid);
  const telegramOnline = daemonOnline && telegram?.enabled;
  const telegramChatIds = telegram?.enabled
    ? (telegram.allowedChatIds ?? []).length
      ? (telegram.allowedChatIds ?? []).join(", ")
      : "(all chats, no filter)"
    : null;
  return formatKeyValueCard("AutoAide Status", [
    ["home", AUTOAIDE_HOME],
    ["workspace", WORKSPACE_PATH],
    ["bootstrap state", BOOTSTRAP_STATE_PATH],
    ["daemon pid file", DAEMON_PID_PATH],
    ["telegram state", TELEGRAM_STATE_PATH],
    ["model", config.model || "gpt-5.4"],
    ["bootstrap completed", bootstrapInfo.bootstrapPending ? "no" : "yes"],
    ["active session", cliState.activeSessionLabel],
    ["daemon online", daemonOnline ? "yes" : "no"],
    ["telegram paired", telegram?.enabled ? "yes" : "no"],
    ["telegram daemon online", telegramOnline ? "yes" : "no"],
    ...(telegram?.enabled ? [["telegram chat ids", telegramChatIds]] : []),
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

function printBootstrapHint(bootstrapInfo) {
  if (!bootstrapInfo.bootstrapPending) {
    return;
  }

  console.log(
    `${formatListCard("Bootstrap Pending", [
      "Use your first conversation to establish:",
      "- what the user should be called",
      "- what the assistant should be called",
      "- tone, vibe, and basic preferences",
      "Those details belong in IDENTITY.md, USER.md, and SOUL.md.",
    ])}\n`,
  );
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

function renderCliResult(result) {
  if (result.ok) {
    return result.output || "Codex completed without output.";
  }
  if (result.signal) {
    return `Codex interrupted (${result.signal}).`;
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

async function autoFillTelegramChatIdIfNeeded(config) {
  const telegram = config.channels?.telegram;
  if (!telegram?.enabled || !telegram.botToken || (telegram.allowedChatIds ?? []).length) {
    return;
  }

  try {
    const paired = await pairTelegramChannel(telegram.botToken);
    telegram.allowedChatIds = [paired.chatId];
    await writeConfig(config);
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

async function handleChannelCommand(rl, config, bridgeProcessRef) {
  console.log(`${formatListCard("Available Channels", ["1. Telegram"])}\n`);
  const selection = (await rl.question("Select a channel [telegram]: ")).trim().toLowerCase();
  if (selection && selection !== "1" && selection !== "telegram") {
    console.log(`${formatMessageCard("Channel Selection", ["Only Telegram is available right now."])}\n`);
    return;
  }

  console.log(
    `\n${formatListCard("Telegram Pairing", [
      "Open Telegram and message @BotFather.",
      "Create a bot with /newbot, then paste the bot token here.",
    ])}\n`,
  );

  const token = (await rl.question("Telegram bot token: ")).trim();
  if (!token) {
    console.log(`${formatMessageCard("Telegram Pairing", ["Pairing cancelled."])}\n`);
    return;
  }

  console.log(`\n${formatMessageCard("Telegram Pairing", ["Now send one message to your bot in Telegram, then press Enter here."])}\n`);
  await rl.question("");

  try {
    const paired = await pairTelegramChannel(token);
    config.channels.telegram = {
      enabled: true,
      botToken: token,
      allowedChatIds: [paired.chatId],
    };
    await writeConfig(config);
    bridgeProcessRef.current = {
      pid: await isDaemonRunning(),
    };

    console.log(
      `${formatKeyValueCard("Telegram Paired", [
        ["status", "paired successfully"],
        ["chat id", String(paired.chatId)],
        ...(paired.username ? [["username", `@${paired.username}`]] : []),
      ])}\n`,
    );
  } catch (error) {
    console.log(`${formatMessageCard("Telegram Pairing Failed", [error.message])}\n`);
  }
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

async function startCliMessage(line, cliState, config, runningTurns) {
  const active = cliState.sessions[cliState.activeSessionLabel];
  if (getRunningTurn(runningTurns, active.label)) {
    console.log(`${formatMessageCard("Session Busy", [`${active.label} is already running. Use /stop first.`])}\n`);
    return;
  }
  const commandConfig = {
    ...buildCommandConfig(config),
    onStatus(status) {
      console.log(`[status] ${status}`);
    },
  };
  const prompt = await buildWorkspacePrompt(line);
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
        await writeCliState(cliState);
      }
      console.log(`\n${renderCliResult(result)}\n`);
    })
    .catch((error) => {
      if (runningTurns.get(active.label) === turn) {
        runningTurns.delete(active.label);
      }
      console.log(`\n${formatMessageCard("Turn Failed", [error.message])}\n`);
    });
}

async function restartDaemon() {
  const currentPid = await isDaemonRunning();
  if (currentPid) {
    process.kill(currentPid, "SIGTERM");

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const pid = await isDaemonRunning();
      if (!pid) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return await ensureDaemonRunning();
}

async function handleSlashCommand(line, rl, config, bridgeProcessRef, cliState, bootstrapInfoRef, runningTurns) {
  const [command, ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (command) {
    case "/help":
      console.log(
        `${formatListCard("Commands", [
          "/channel  pair Telegram",
          "/home     switch to main session",
          "/new      create a session",
          "/switch   switch session",
          "/sessions list sessions",
          "/stop     stop the running session job",
          "/restart  restart the AutoAide daemon",
          "/status   show paths, model, and daemon status",
          "/where    show current CLI session",
          "/exit     quit AutoAide",
        ])}\n`,
      );
      return true;
    case "/home":
      cliState.activeSessionLabel = "main";
      await writeCliState(cliState);
      console.log(`${formatMessageCard("Session", ["Switched to main."])}\n`);
      return true;
    case "/sessions":
      console.log(`${formatCliSessions(cliState, runningTurns)}\n`);
      return true;
    case "/new": {
      const label = slugifySessionLabel(arg);
      if (!label) {
        console.log(`${formatMessageCard("Usage", ["Use /new <label>."])}\n`);
        return true;
      }
      if (!cliState.sessions[label]) {
        cliState.sessions[label] = {
          label,
          cliSessionRef: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      cliState.activeSessionLabel = label;
      await writeCliState(cliState);
      console.log(`${formatMessageCard("Session", [`Switched to ${label}.`])}\n`);
      return true;
    }
    case "/switch": {
      const label = slugifySessionLabel(arg);
      if (!label) {
        console.log(`${formatMessageCard("Usage", ["Use /switch <label>."])}\n`);
        return true;
      }
      if (!cliState.sessions[label]) {
        console.log(`${formatMessageCard("Unknown Session", [label])}\n`);
        return true;
      }
      cliState.activeSessionLabel = label;
      await writeCliState(cliState);
      console.log(`${formatMessageCard("Session", [`Switched to ${label}.`])}\n`);
      return true;
    }
    case "/channel":
      await handleChannelCommand(rl, config, bridgeProcessRef);
      return true;
    case "/status":
      bridgeProcessRef.current = {
        pid: await isDaemonRunning(),
      };
      console.log(
        `${formatCliStatus(config, bridgeProcessRef.current, cliState, bootstrapInfoRef.current)}\n`,
      );
      console.log(
        `${formatKeyValueCard("Run State", [
          ["current session", cliState.activeSessionLabel],
          ["running", getRunningTurn(runningTurns, cliState.activeSessionLabel) ? "yes" : "no"],
        ])}\n`,
      );
      return true;
    case "/where":
      console.log(
        `${formatKeyValueCard("Session", [
          ["current session", cliState.activeSessionLabel],
          ["running", getRunningTurn(runningTurns, cliState.activeSessionLabel) ? "yes" : "no"],
        ])}\n`,
      );
      return true;
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
      console.log(`${formatMessageCard("Restarting", ["Restarting the AutoAide daemon..."])}\n`);
      bridgeProcessRef.current = {
        pid: await restartDaemon(),
      };
      console.log(
        `${formatKeyValueCard("Daemon Restarted", [["daemon pid", String(bridgeProcessRef.current.pid)]])}\n`,
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

export async function startCli() {
  await ensureAutoAideHome();
  const bootstrapInfoRef = {
    current: await ensureWorkspaceBootstrap(),
  };
  const config = await readConfig();
  await autoFillTelegramChatIdIfNeeded(config);
  const cliState = await readCliState();
  const bridgeProcessRef = {
    current: {
      pid: await isDaemonRunning(),
    },
  };
  const runningTurns = new Map();

  if (!cliState.sessions?.main) {
    const fresh = createDefaultCliState();
    cliState.sessions = fresh.sessions;
    cliState.activeSessionLabel = fresh.activeSessionLabel;
    await writeCliState(cliState);
  }

  await showStartupBanner({
    model: config.model || "gpt-5.4",
    workspacePath: WORKSPACE_PATH,
  });
  const rl = createInterface({ input, output });
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
    const handled = await handleSlashCommand(
      line,
      rl,
      config,
      bridgeProcessRef,
      cliState,
      bootstrapInfoRef,
      runningTurns,
    );
    if (handled === "exit") {
      return;
    }
    if (handled) {
      continue;
    }
    await startCliMessage(line, cliState, config, runningTurns);
  }
}
