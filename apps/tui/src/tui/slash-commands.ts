import { formatConversationCell } from "./cells.js";
import type { TuiScreenState } from "./screen.js";

export type SlashCommandDefinition = {
  name: string;
  description: string;
};

export type ParsedSlashCommand = {
  name: string;
  args: string;
};

export function getSlashCommands(): SlashCommandDefinition[] {
  return [
    { name: "/help", description: "Show help" },
    { name: "/status", description: "Re-render the dashboard" },
    { name: "/transcript", description: "Open transcript-style history view" },
    { name: "/threads", description: "List saved threads" },
    { name: "/resume", description: "Resume a saved thread" },
    { name: "/new", description: "Create and switch to a new thread" },
    { name: "/pageup", description: "Scroll transcript up" },
    { name: "/pagedown", description: "Scroll transcript down" },
    { name: "/tail", description: "Jump back to live tail" },
    { name: "/tasks", description: "Show the tasks section" },
    { name: "/workers", description: "Show the workers section" },
    { name: "/clear", description: "Clear the conversation panel" },
    { name: "/quit", description: "Exit" },
    { name: "/exit", description: "Alias for /quit" }
  ];
}

export function buildInteractiveHelp(): string {
  return [
    "Talk to the manager directly.",
    "Example: fix the task persistence bug and tell me what changed.",
    "",
    "Commands:",
    ...getSlashCommands().map((command) => `  ${command.name.padEnd(21, " ")} ${command.description}`)
  ].join("\n");
}

export function buildTranscriptPagerMessage(state: TuiScreenState): string {
  const lines = state.messages.flatMap((entry, index) => {
    const formatted = formatConversationCell(entry, 96);
    return index === 0 ? formatted : ["", ...formatted];
  });
  return ["Transcript:", ...lines].join("\n");
}

export function parseSlashCommand(input: string): ParsedSlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { name: "", args: trimmed };
  }
  const [name, ...rest] = trimmed.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args: rest.join(" ").trim()
  };
}

export function completeSlashCommand(input: string): [string[], string] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return [[], input];
  }
  const parsed = parseSlashCommand(trimmed);
  if (parsed.args) {
    return [[], input];
  }
  const matches = getSlashCommands()
    .map((command) => command.name)
    .filter((command) => command.startsWith(parsed.name || "/"));
  return [matches, parsed.name || "/"];
}
