import { clearInputBuffer, replaceInputBuffer, type TuiComposerState } from "./composer.js";
import type { InputHistory } from "./input-history.js";

export type TuiKeypress = {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  full?: string;
  sequence?: string;
};

export type ComposerKeybindingResult =
  | { handled: false }
  | { handled: true; statusLine?: string; footerMode?: "default" | "shortcuts"; inputValue?: string; clearInput?: boolean };

export function handleComposerKeypress(input: {
  key: TuiKeypress;
  state: TuiComposerState;
  inputValue: string;
  history: InputHistory;
  completeEditorInput: () => string;
}): ComposerKeybindingResult {
  if (input.key.name === "tab") {
    return {
      handled: true,
      statusLine: input.completeEditorInput()
    };
  }

  if (input.key.name === "escape") {
    if (input.state.footerMode === "shortcuts") {
      return {
        handled: true,
        footerMode: "default",
        statusLine: "Closed shortcuts"
      };
    }
    clearInputBuffer(input.state);
    return {
      handled: true,
      clearInput: true,
      statusLine: "Input cleared"
    };
  }

  if (input.key.full === "C-p" || (input.key.name === "up" && !input.inputValue)) {
    const previous = input.history.previous();
    if (!previous) {
      return { handled: true };
    }
    replaceInputBuffer(input.state, previous.value);
    return {
      handled: true,
      inputValue: previous.value,
      statusLine: previous.label
    };
  }

  if (input.key.full === "C-n") {
    const next = input.history.next();
    if (!next) {
      return { handled: true };
    }
    replaceInputBuffer(input.state, next.value);
    return {
      handled: true,
      inputValue: next.value,
      clearInput: next.value.length === 0,
      statusLine: next.label
    };
  }

  return {
    handled: false
  };
}
