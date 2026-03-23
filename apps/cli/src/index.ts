#!/usr/bin/env -S node --import tsx
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildOperatorDashboard,
  runCodexConnectivityCheck,
  runManagerExec,
  runManagerExecSchedulerTick,
  startManagerExecSchedulerDaemon,
  type AutoAideExecEvent,
  type AutoAideExecItem
} from "@autoaide/tui";

type CommandHandler = (args: string[]) => Promise<number>;

type CommandDefinition = {
  name: string;
  summary: string;
  usage: string;
  handler: CommandHandler;
};

let spawnProcess: typeof spawn = spawn;

export function setSpawnProcessForTest(nextSpawn: typeof spawn): void {
  spawnProcess = nextSpawn;
}

function printTopLevelHelp(): void {
  console.log(
    [
      "AutoAide CLI",
      "",
      "Usage:",
      "  autoaide <command> [options]",
      "",
      "Commands:",
      "  tui         Open the interactive terminal UI",
      "  exec        Run one manager turn and stream results",
      "  status      Print the current operator dashboard",
      "  supervise   Run the manager scheduler loop as a foreground service",
      "  models      List mounted agent kernels",
      "  dashboard   Reserved entrypoint for a future GUI/dashboard",
      "  stop        Stop the local AutoAide supervisor process",
      "  doctor      Diagnose local runtime and Codex connectivity",
      "  help        Show help",
      "",
      "Examples:",
      "  autoaide tui",
      "  autoaide exec \"Explain this codebase\"",
      "  autoaide exec --json \"Investigate the failing test\"",
      "  autoaide supervise --once",
      "  autoaide doctor"
    ].join("\n")
  );
}

function parseExecArgs(args: string[]): { json: boolean; text?: string } {
  let json = false;
  const textParts: string[] = [];
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    textParts.push(arg);
  }
  return {
    json,
    text: textParts.join(" ").trim() || undefined
  };
}

function formatExecItem(item: AutoAideExecItem): string {
  switch (item.type) {
    case "reasoning":
      return item.text;
    case "plan":
      return `Plan: ${item.text}`;
    case "tool_call":
      return `Tool ${item.label}: ${item.text}`;
    case "subagent_run":
      return `Run ${item.label}: ${item.text}`;
    case "assistant_message":
      return item.text;
    case "warning":
      return `Warning: ${item.text}`;
    case "status":
      return `Status: ${item.text}`;
  }
}

function printHumanExecEvent(event: AutoAideExecEvent): void {
  switch (event.type) {
    case "thread.started":
      process.stdout.write(`Thread ${event.threadId}\n`);
      return;
    case "turn.started":
      process.stdout.write(`Owner: ${event.text}\n`);
      return;
    case "item.started":
    case "item.completed":
      process.stdout.write(`${formatExecItem(event.item)}\n`);
      return;
    case "turn.completed":
      process.stdout.write(`Completed thread ${event.threadId}\n`);
      return;
    case "turn.failed":
      process.stderr.write(`Exec failed for ${event.threadId}: ${event.error}\n`);
      return;
  }
}

async function runRustTui(): Promise<number> {
  const manifestPath = fileURLToPath(new URL("../../tui-rs/Cargo.toml", import.meta.url));
  const child = spawnProcess("cargo", ["run", "--quiet", "--manifest-path", manifestPath], {
    stdio: "inherit",
    env: process.env
  });

  return await new Promise<number>((resolve, reject) => {
    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to launch Rust TUI via cargo. Ensure Rust is installed and cargo is on PATH. Original error: ${error.message}`
        )
      );
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function runExec(args: string[]): Promise<number> {
  const parsed = parseExecArgs(args);
  if (!parsed.text) {
    console.log("Usage: autoaide exec [--json] <goal>");
    return 1;
  }

  let failed = false;
  try {
    await runManagerExec({
      text: parsed.text,
      onEvent: async (event) => {
        if (parsed.json) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
          return;
        }
        printHumanExecEvent(event);
        if (event.type === "turn.failed") {
          failed = true;
        }
      }
    });
  } catch (error) {
    failed = true;
    if (parsed.json) {
      process.stdout.write(
        `${JSON.stringify({
          type: "turn.failed",
          error: error instanceof Error ? error.message : String(error)
        })}\n`
      );
    }
  }
  return failed ? 1 : 0;
}

function parseSuperviseArgs(args: string[]): {
  once: boolean;
  intervalMs: number;
  maxTicks?: number;
} {
  let once = false;
  let intervalMs = 30_000;
  let maxTicks: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--once") {
      once = true;
      continue;
    }
    if (arg === "--interval-ms") {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        intervalMs = value;
        index += 1;
      }
      continue;
    }
    if (arg === "--max-ticks") {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        maxTicks = value;
        index += 1;
      }
    }
  }

  return { once, intervalMs, maxTicks };
}

async function runSupervise(args: string[]): Promise<number> {
  const parsed = parseSuperviseArgs(args);

  if (parsed.once) {
    const result = await runManagerExecSchedulerTick({});
    console.log(`AutoAide supervise tick: processed ${result.tickCount} wake event(s) on ${result.threadId}`);
    return 0;
  }

  console.log(`AutoAide supervise loop started (interval ${parsed.intervalMs}ms)`);
  let finished = false;
  let tickRuns = 0;
  const daemon = startManagerExecSchedulerDaemon({
    intervalMs: parsed.intervalMs,
    onTick: async (tickCount) => {
      tickRuns += 1;
      console.log(`AutoAide supervise tick ${tickRuns}: processed ${tickCount} wake event(s)`);
      if (parsed.maxTicks && tickRuns >= parsed.maxTicks && !finished) {
        finished = true;
        daemon.stop();
        resolveExit?.();
      }
    }
  });

  let resolveExit: (() => void) | undefined;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const stop = () => {
    if (finished) {
      return;
    }
    finished = true;
    daemon.stop();
    resolveExit?.();
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await exitPromise;
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  console.log("AutoAide supervise loop stopped");
  return 0;
}

const commands: Record<string, CommandDefinition> = {
  tui: {
    name: "tui",
    summary: "Open the interactive terminal UI",
    usage: "autoaide tui",
    handler: async () => {
      return await runRustTui();
    }
  },
  exec: {
    name: "exec",
    summary: "Run one manager turn and stream results",
    usage: "autoaide exec [--json] <goal>",
    handler: async (args) => {
      return await runExec(args);
    }
  },
  status: {
    name: "status",
    summary: "Print the current operator dashboard",
    usage: "autoaide status",
    handler: async () => {
      console.log(buildOperatorDashboard());
      return 0;
    }
  },
  supervise: {
    name: "supervise",
    summary: "Run the manager scheduler loop as a foreground service",
    usage: "autoaide supervise [--once] [--interval-ms <ms>] [--max-ticks <n>]",
    handler: async (args) => {
      return await runSupervise(args);
    }
  },
  models: {
    name: "models",
    summary: "List mounted agent kernels",
    usage: "autoaide models",
    handler: async () => {
      console.log(["Mounted models", "", "- codex  default kernel adapter  available"].join("\n"));
      return 0;
    }
  },
  dashboard: {
    name: "dashboard",
    summary: "Reserved entrypoint for a future GUI/dashboard",
    usage: "autoaide dashboard",
    handler: async () => {
      console.log("AutoAide dashboard is reserved for a future GUI entrypoint.");
      return 0;
    }
  },
  stop: {
    name: "stop",
    summary: "Stop the local AutoAide supervisor process",
    usage: "autoaide stop",
    handler: async () => {
      console.log("AutoAide stop: no long-running supervisor process is active yet.");
      return 0;
    }
  },
  doctor: {
    name: "doctor",
    summary: "Diagnose local runtime and Codex connectivity",
    usage: "autoaide doctor",
    handler: async () => {
      const result = await runCodexConnectivityCheck();
      console.log(["AutoAide doctor", "", result.dashboard].join("\n"));
      return 0;
    }
  },
  help: {
    name: "help",
    summary: "Show help",
    usage: "autoaide help [command]",
    handler: async (args) => {
      const target = args[0];
      if (!target || !commands[target]) {
        printTopLevelHelp();
        return 0;
      }
      const command = commands[target];
      console.log(
        [
          `${command.name}`,
          `${command.summary}`,
          "",
          "Usage:",
          `  ${command.usage}`
        ].join("\n")
      );
      return 0;
    }
  }
};

export async function runCli(argv: string[]): Promise<number> {
  const [commandName, ...args] = argv;
  if (!commandName || commandName === "--help" || commandName === "-h") {
    printTopLevelHelp();
    return 0;
  }
  if (commandName === "--version" || commandName === "-v") {
    console.log("autoaide dev");
    return 0;
  }

  const command = commands[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    printTopLevelHelp();
    return 1;
  }
  return await command.handler(args);
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  const code = await runCli(process.argv.slice(2));
  process.exitCode = code;
}
