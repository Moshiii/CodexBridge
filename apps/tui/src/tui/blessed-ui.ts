import process from "node:process";
import blessedModule from "blessed";
import type * as Blessed from "blessed";
import type { TuiComposerState } from "./composer.js";
import { buildFooterLines } from "./footer.js";
import { buildTranscriptContent, type TuiHistoryState } from "./history.js";

const blessed = blessedModule as typeof Blessed;

export type BlessedTuiState = TuiComposerState & {
  messages: TuiHistoryState["messages"];
  activeCell?: TuiHistoryState["activeCell"];
  threadHeader?: string;
};

export type BlessedTuiView = {
  readonly screen: Blessed.Widgets.Screen;
  readonly transcript: Blessed.Widgets.BoxElement;
  readonly input: Blessed.Widgets.TextboxElement;
  render(): void;
  destroy(): void;
  focusInput(): void;
  startInput(): void;
  clearInput(): void;
  setInputValue(value: string): void;
  getInputValue(): string;
  scrollTranscript(delta: number): void;
  scrollTranscriptToTop(): void;
  scrollTranscriptToTail(): void;
  isTranscriptNearTail(): boolean;
  isRendering(): boolean;
};

export function createBlessedTuiView(state: BlessedTuiState): BlessedTuiView {
  let rendering = false;
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    dockBorders: true,
    title: "AutoAide"
  });

  const transcript = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%-7",
    tags: false,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: false,
    mouse: true,
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    scrollbar: {
      ch: " ",
      track: { bg: "#3a3a3a" },
      style: { bg: "#9a9a9a" }
    },
    style: {
      bg: "default",
      fg: "white"
    }
  });

  const inputWrapper = blessed.box({
    parent: screen,
    bottom: 4,
    left: 0,
    width: "100%",
    height: 3,
    style: {
      bg: "#3a3a3a"
    }
  });

  const inputLabel = blessed.box({
    parent: inputWrapper,
    top: 1,
    left: 1,
    width: 8,
    height: 1,
    content: state.promptLabel,
    style: {
      bg: "#3a3a3a",
      fg: "#cfcfcf",
      bold: true
    }
  });

  const input = blessed.textbox({
    parent: inputWrapper,
    inputOnFocus: true,
    top: 1,
    left: 8,
    width: "100%-10",
    height: 1,
    mouse: true,
    keys: true,
    style: {
      bg: "#3a3a3a",
      fg: "white"
    }
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 4,
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    style: {
      bg: "#3a3a3a",
      fg: "#b8b8b8"
    }
  });

  const render = () => {
    rendering = true;
    const screenWidth =
      Number(process.stdout.columns) || Number((screen as { width?: number | string }).width) || 120;
    const transcriptWidth = Math.max(24, screenWidth - 8);
    transcript.setContent(buildTranscriptContent(state, transcriptWidth));
    if (state.followTail ?? true) {
      transcript.setScrollPerc(100);
    }
    inputLabel.setContent(state.pendingTurn ? `${state.promptLabel} [running]` : state.promptLabel);
    footer.setContent(["", ...buildFooterLines(state, Math.max(24, screenWidth - 4))].join("\n"));
    screen.render();
    rendering = false;
  };

  return {
    screen,
    transcript,
    input,
    render,
    destroy() {
      screen.destroy();
    },
    focusInput() {
      input.focus();
    },
    startInput() {
      input.readInput();
    },
    clearInput() {
      input.clearValue();
    },
    setInputValue(value: string) {
      input.setValue(value);
    },
    getInputValue() {
      return input.getValue();
    },
    scrollTranscript(delta: number) {
      transcript.scroll(delta);
    },
    scrollTranscriptToTop() {
      transcript.setScroll(0);
    },
    scrollTranscriptToTail() {
      transcript.setScrollPerc(100);
    },
    isTranscriptNearTail() {
      return transcript.getScrollPerc() >= 99;
    },
    isRendering() {
      return rendering;
    }
  };
}
