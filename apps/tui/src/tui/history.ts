import { formatConversationCell, type TuiCell } from "./cells.js";

export type TuiHistoryState = {
  messages: TuiCell[];
  activeCell?: TuiCell;
  followTail?: boolean;
  scrollOffset?: number;
  threadHeader?: string;
};

export function buildTranscriptLines(state: Pick<TuiHistoryState, "messages" | "activeCell">, width: number): string[] {
  const transcriptLines = state.messages.flatMap((entry, index) => {
    const lines = formatConversationCell(entry, width);
    return index === 0 ? lines : ["", ...lines];
  });
  const activeLines =
    state.activeCell !== undefined ? [...(transcriptLines.length > 0 ? [""] : []), ...formatConversationCell(state.activeCell, width)] : [];
  return [...transcriptLines, ...activeLines];
}

export function buildTranscriptContent(
  state: Pick<TuiHistoryState, "messages" | "activeCell" | "threadHeader">,
  width: number
): string {
  return [state.threadHeader ?? "", "", ...buildTranscriptLines(state, width)].join("\n");
}

export function selectViewportLines(lines: string[], maxTranscriptBody: number, state: TuiHistoryState): string[] {
  if (lines.length <= maxTranscriptBody) {
    return lines;
  }
  if (state.followTail ?? true) {
    return lines.slice(-maxTranscriptBody);
  }
  const maxOffset = Math.max(0, lines.length - maxTranscriptBody);
  const clampedOffset = Math.min(Math.max(0, state.scrollOffset ?? 0), maxOffset);
  const end = Math.max(0, lines.length - clampedOffset);
  const start = Math.max(0, end - maxTranscriptBody);
  return lines.slice(start, end);
}
