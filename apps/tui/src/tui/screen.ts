import { buildInputLines, type TuiComposerState } from "./composer.js";
import { buildFooterLines } from "./footer.js";
import { buildTranscriptLines, selectViewportLines, type TuiHistoryState } from "./history.js";

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function truncateVisible(value: string, width: number): string {
  const plain = stripAnsi(value);
  return plain.length <= width ? value : `${plain.slice(0, Math.max(0, width - 1))}…`;
}

export type TuiScreenState = TuiComposerState & {
  dashboard: string;
  messages: TuiHistoryState["messages"];
  activeCell?: TuiHistoryState["activeCell"];
  threadHeader?: string;
  scrollOffset?: number;
};

export function renderInteractiveScreen(
  state: TuiScreenState,
  options: { width?: number; height?: number } = {}
): string {
  const width = Math.max(80, options.width ?? 120);
  const height = Math.max(24, options.height ?? 32);
  const headerLines = state.threadHeader ? [truncateVisible(state.threadHeader, width)] : [];
  const logs = buildTranscriptLines(state, width - 2);
  const footerLines = buildFooterLines(state, width);
  const editorLines = buildInputLines(state, width);
  const maxTranscriptBody = Math.max(8, height - (4 + footerLines.length + editorLines.length) - headerLines.length);
  const visibleLogs = selectViewportLines(logs, maxTranscriptBody, state);
  const divider = "─".repeat(width);

  return [...headerLines, "", ...visibleLogs, "", divider, ...footerLines, ...editorLines].join("\n");
}

export function scrollTranscriptBy(state: TuiScreenState, delta: number): void {
  if (delta === 0) {
    return;
  }
  if (delta < 0) {
    state.followTail = true;
    state.scrollOffset = 0;
    return;
  }
  state.followTail = false;
  state.scrollOffset = Math.max(0, (state.scrollOffset ?? 0) + delta);
}

export function jumpTranscriptToTail(state: TuiScreenState): void {
  state.followTail = true;
  state.scrollOffset = 0;
}

export function shouldUseAlternateScreen(): boolean {
  const override = process.env.AUTOAIDE_ALT_SCREEN;
  if (override === "never" || process.env.AUTOAIDE_NO_ALT_SCREEN === "1") {
    return false;
  }
  if (override === "always") {
    return true;
  }
  return !process.env.ZELLIJ;
}
