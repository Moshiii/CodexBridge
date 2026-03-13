#!/usr/bin/env -S node --import tsx
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildOperatorDashboard, runCodexConnectivityCheck, runInteractiveTui } from "@autoaide/tui";

type CommandHandler = (args: string[]) => Promise<number>;

type CommandDefinition = {
  name: string;
  summary: string;
  usage: string;
  handler: CommandHandler;
};

function printTopLevelHelp(): void {
  console.log(
    [
      "AutoAide CLI",
      "",
      "Usage:",
      "  autoaide <command> [options]",
      "",
      "Commands:",
      "  tui        Open the interactive terminal UI",
      "  status     Print the current operator dashboard",
      "  tasks      Print the current task view",
      "  workers    Print the current worker view",
      "  cron       Show cron/supervision status placeholder",
      "  memory     Show memory status placeholder",
      "  codex      Run Codex connectivity checks",
      "  help       Show help",
      "",
      "Examples:",
      "  autoaide tui",
      "  autoaide status",
      "  autoaide codex check"
    ].join("\n")
  );
}

function extractSection(text: string, heading: string, nextHeading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) {
    return text;
  }
  const end = text.indexOf(nextHeading, start + heading.length);
  return text.slice(start, end >= 0 ? end : text.length).trimEnd();
}

const commands: Record<string, CommandDefinition> = {
  tui: {
    name: "tui",
    summary: "Open the interactive terminal UI",
    usage: "autoaide tui",
    handler: async () => {
      await runInteractiveTui();
      return 0;
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
  tasks: {
    name: "tasks",
    summary: "Print the task section from the operator dashboard",
    usage: "autoaide tasks",
    handler: async () => {
      console.log(extractSection(buildOperatorDashboard(), "Tasks", "Workers"));
      return 0;
    }
  },
  workers: {
    name: "workers",
    summary: "Print the worker section from the operator dashboard",
    usage: "autoaide workers",
    handler: async () => {
      console.log(extractSection(buildOperatorDashboard(), "Workers", "Alerts"));
      return 0;
    }
  },
  cron: {
    name: "cron",
    summary: "Show supervision status placeholder",
    usage: "autoaide cron",
    handler: async () => {
      console.log("AutoAide cron: supervision-core is wired, formal CLI subcommands are pending.");
      return 0;
    }
  },
  memory: {
    name: "memory",
    summary: "Show memory status placeholder",
    usage: "autoaide memory",
    handler: async () => {
      console.log("AutoAide memory: manager memory is implemented, formal memory CLI is pending.");
      return 0;
    }
  },
  codex: {
    name: "codex",
    summary: "Run Codex connectivity checks",
    usage: "autoaide codex check",
    handler: async (args) => {
      const [subcommand] = args;
      if (subcommand !== "check") {
        console.log("Usage: autoaide codex check");
        return 1;
      }
      const result = await runCodexConnectivityCheck();
      console.log(result.dashboard);
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
