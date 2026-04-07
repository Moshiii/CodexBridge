#!/usr/bin/env node

import { startCli } from "../src/cli.mjs";
import {
  canaryRollout,
  createBot,
  deleteBot,
  ensureDefaultBot,
  getActiveBot,
  getBot,
  healthCheckBot,
  inspectBot,
  listBots,
  readBotLogs,
  restartBot,
  rollingRestartBots,
  rollbackBot,
  runBotRuntime,
  setActiveBot,
  setBotEnabled,
  startBot,
  stopBot,
  updateBotConfig,
} from "../src/bots.mjs";
import { readActiveBotId, readConfig } from "../src/config.mjs";
import { getChannelAdapter } from "../src/channel-adapters.mjs";
import {
  formatSkillInstallResult,
  formatSkillsOverview,
  installSkillFromPath,
  listSkills,
} from "../src/skills.mjs";
import {
  ensureWebRuntime,
  getWebRuntimeStatus,
  restartWebRuntime,
  runWebRuntime,
  stopWebRuntime,
} from "../src/web-runtime.mjs";

function parseFlags(values) {
  const flags = {};
  for (let index = 0; index < values.length; index += 1) {
    const entry = values[index];
    if (!entry.startsWith("--")) {
      continue;
    }
    const key = entry.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

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

async function ensureConfiguredCurrentBotOnline() {
  const activeBot = await getActiveBot();
  if (activeBot.runtimePid) {
    return;
  }

  const config = await readConfig(activeBot.homePath);
  if (!config.enabled) {
    return;
  }
  const adapter = getChannelAdapter(activeBot.channel);
  if (!adapter?.isConfigured(config)) {
    return;
  }

  await startBot(activeBot.id);
}

await ensureDefaultBot();

const [command, subcommand, ...rest] = process.argv.slice(2);

if (command === "web") {
  const flags = parseFlags([subcommand, ...rest].filter(Boolean));
  const port = Number.parseInt(String(flags.port || "8787"), 10);
  const host = String(flags.host || "127.0.0.1");
  if (subcommand === "run") {
    await runWebRuntime({ port, host });
    await new Promise(() => {});
  }
  if (subcommand === "status") {
    printJson(await getWebRuntimeStatus());
    process.exit(0);
  }
  if (subcommand === "stop") {
    printJson(await stopWebRuntime());
    process.exit(0);
  }
  if (subcommand === "restart") {
    const runtime = await restartWebRuntime({ port, host });
    console.log(`AutoAide control plane web running at ${runtime.url}`);
    process.exit(0);
  }
  const runtime = await ensureWebRuntime({ port, host });
  console.log(`AutoAide control plane web running at ${runtime.url}`);
  process.exit(0);
}

if (command === "skills") {
  if (!subcommand || subcommand === "list") {
    console.log(formatSkillsOverview(await listSkills()));
    process.exit(0);
  }
  if (subcommand === "install") {
    const source = rest.join(" ").trim();
    if (!source) {
      console.error("Usage: autoaide skills install <zip-or-path>");
      process.exit(1);
    }
    const installed = await installSkillFromPath(source, { force: true });
    console.log(formatSkillInstallResult(installed));
    process.exit(0);
  }
  console.error("Usage: autoaide skills [list] | autoaide skills install <zip-or-path>");
  process.exit(1);
}

if (command === "bots") {
  printJson(await listBots());
  process.exit(0);
}

if (command === "bot") {
  const botId = rest[0];
  const flags = parseFlags(rest.slice(1));

  switch (subcommand) {
    case "create": {
      const id = rest[0];
      if (!id) {
        console.error("Usage: autoaide bot create <id> [--name <name>]");
        process.exit(1);
      }
      const bot = await createBot({
        id,
        name: flags.name || id,
        enabled: flags.enabled === true ? true : flags.enabled === "false" ? false : true,
      });
      printJson(bot);
      process.exit(0);
    }
    case "show":
      printJson(await inspectBot(botId));
      process.exit(0);
    case "use":
      if (!botId) {
        console.error("Usage: autoaide bot use <id>");
        process.exit(1);
      }
      printJson(await setActiveBot(botId));
      process.exit(0);
    case "current":
      printJson(await getActiveBot());
      process.exit(0);
    case "run":
      if (!botId) {
        console.error("Usage: autoaide bot run <id>");
        process.exit(1);
      }
      await runBotRuntime(botId);
      process.exit(0);
    case "start":
      printJson({ id: botId, pid: await startBot(botId) });
      process.exit(0);
    case "stop":
      printJson({ id: botId, stopped: await stopBot(botId) });
      process.exit(0);
    case "restart":
      printJson({ id: botId, pid: await restartBot(botId) });
      process.exit(0);
    case "enable":
      printJson(await setBotEnabled(botId, true));
      process.exit(0);
    case "disable":
      printJson(await setBotEnabled(botId, false));
      process.exit(0);
    case "delete":
      await deleteBot(botId);
      printJson({ id: botId, deleted: true });
      process.exit(0);
    case "logs":
      printJson(await readBotLogs(botId));
      process.exit(0);
    case "config": {
      if (!botId) {
        console.error("Usage: autoaide bot config <id>");
        process.exit(1);
      }
      const bot = await getBot(botId);
      printJson(await readConfig(bot.homePath));
      process.exit(0);
    }
    case "set-config": {
      if (!botId || !flags.json) {
        console.error("Usage: autoaide bot set-config <id> --json '<json>'");
        process.exit(1);
      }
      const patch = JSON.parse(flags.json);
      printJson(await updateBotConfig(botId, (config) => deepMergeConfig(config, patch)));
      process.exit(0);
    }
    case "health":
      printJson(await healthCheckBot(botId));
      process.exit(0);
    default:
      console.error(
        "Usage: autoaide bot <create|show|use|current|run|start|stop|restart|enable|disable|delete|logs|config|set-config|health> ...",
      );
      process.exit(1);
  }
}

if (command === "rollout") {
  const flags = parseFlags(rest);
  if (subcommand === "restart-all") {
    printJson(await rollingRestartBots());
    process.exit(0);
  }
  if (subcommand === "canary") {
    const ids = String(flags.bots || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!ids.length || !flags.version) {
      console.error("Usage: autoaide rollout canary --bots <id1,id2> --version <version>");
      process.exit(1);
    }
    printJson(await canaryRollout(ids, String(flags.version)));
    process.exit(0);
  }
  if (subcommand === "rollback") {
    const botId = rest[0];
    if (!botId || !flags.version) {
      console.error("Usage: autoaide rollout rollback <id> --version <version>");
      process.exit(1);
    }
    printJson(await rollbackBot(botId, String(flags.version)));
    process.exit(0);
  }
  console.error("Usage: autoaide rollout <restart-all|canary|rollback> ...");
  process.exit(1);
}

if (!command) {
  await ensureConfiguredCurrentBotOnline();
}

await startCli({ botId: await readActiveBotId() });
