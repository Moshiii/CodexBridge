import { replaceInputBuffer } from "./composer.js";
import { completeSlashCommand } from "./slash-commands.js";
import type { TuiScreenState } from "./screen.js";

export function extractSection(text: string, heading: string, nextHeading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) {
    return text;
  }
  const end = text.indexOf(nextHeading, start + heading.length);
  return text.slice(start, end >= 0 ? end : text.length).trimEnd();
}

export function completeEditorInput(state: TuiScreenState): string {
  const input = state.inputBuffer ?? "";
  const [matches, token] = completeSlashCommand(input);
  if (matches.length === 0) {
    return "No matching command";
  }
  if (matches.length === 1) {
    const completed = input.replace(token, `${matches[0]} `);
    replaceInputBuffer(state, completed);
    return `Completed ${matches[0]}`;
  }
  return `Commands: ${matches.join("  ")}`;
}
