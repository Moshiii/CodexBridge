import type { TuiComposerState } from "./composer.js";

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function truncateVisible(value: string, width: number): string {
  const plain = stripAnsi(value);
  return plain.length <= width ? value : `${plain.slice(0, Math.max(0, width - 1))}…`;
}

export function buildFooterLines(state: TuiComposerState, width: number): string[] {
  if (state.footerMode === "shortcuts") {
    return [
      truncateVisible(state.compactStatus, width),
      truncateVisible(state.statusLine || buildDefaultStatusLine(state), width),
      truncateVisible("Shortcuts: Enter send  Alt+Enter newline  Tab complete  Ctrl+P/N history", width),
      truncateVisible("Ctrl+A/E move  Ctrl+W delete word  PgUp/PgDn scroll  End follow tail  Esc close", width)
    ];
  }
  return [
    truncateVisible(state.compactStatus, width),
    truncateVisible(state.statusLine || buildDefaultStatusLine(state), width),
    truncateVisible(buildFooterHintLine(state), width)
  ];
}

function buildDefaultStatusLine(state: TuiComposerState): string {
  if (state.pendingTurn) {
    return "Working";
  }
  if ((state.followTail ?? true) === false) {
    return "Browsing transcript history";
  }
  return "Ready";
}

function buildFooterHintLine(state: TuiComposerState): string {
  const hasDraft = Boolean((state.inputBuffer ?? "").trim());
  if (state.pendingTurn) {
    return hasDraft
      ? "manager busy  draft kept live  enter waits  esc clear input  ? shortcuts"
      : "ctrl+c quit  pgup/pgdn scroll  end follow tail  ? shortcuts";
  }
  if (hasDraft) {
    return "enter send  alt+enter newline  tab complete  ctrl+p/n history  ? shortcuts";
  }
  return "/ for commands  ctrl+p history  pgup/pgdn scroll  ctrl+c quit  ? shortcuts";
}
