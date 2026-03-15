import { readConversationEvents, resolveAutoAideStatePaths } from "../persistence.js";
import { buildEventCell, type TuiCell } from "./cells.js";
import type { TuiScreenState } from "./screen.js";

function parseEventMessage(text: string): { label: string; body: string } {
  const separatorIndex = text.indexOf(":");
  if (separatorIndex <= 0) {
    return { label: "event", body: text };
  }
  return {
    label: text.slice(0, separatorIndex).trim(),
    body: text.slice(separatorIndex + 1).trim()
  };
}

export function buildMessagesFromConversationEventsFor(conversationId: string): TuiCell[] {
  const paths = resolveAutoAideStatePaths(conversationId);
  return readConversationEvents(paths)
    .slice(-40)
    .map((event) => {
      if (event.role === "event") {
        const parsed = parseEventMessage(event.text);
        return buildEventCell(parsed.label, parsed.body);
      }

      return {
        kind: event.role === "owner" || event.role === "manager" ? event.role : "system",
        text: event.text
      } satisfies TuiCell;
    });
}

export function pushMessage(state: TuiScreenState, message: TuiCell): void {
  state.messages.push(message);
  if (state.messages.length > 200) {
    state.messages = state.messages.slice(-200);
  }
  if (state.followTail ?? true) {
    state.scrollOffset = 0;
  }
}
