import type { Widgets } from "blessed";
import type { BlessedTuiView } from "./blessed-ui.js";
import { jumpTranscriptToTail, type TuiScreenState } from "./screen.js";

export function bindGlobalTuiKeys(input: {
  screen: Widgets.Screen;
  state: TuiScreenState;
  view: BlessedTuiView;
  requestRedraw: () => void;
  exitTui: () => Promise<void>;
}): void {
  input.screen.key(["C-c"], () => {
    void input.exitTui();
  });
  input.screen.key(["pageup"], () => {
    input.view.scrollTranscript(-10);
    input.state.followTail = false;
    input.state.statusLine = "Scrolled transcript up";
    input.requestRedraw();
  });
  input.screen.key(["pagedown"], () => {
    input.view.scrollTranscript(10);
    input.state.followTail = false;
    input.state.statusLine = "Scrolled transcript down";
    input.requestRedraw();
  });
  input.screen.key(["end"], () => {
    jumpTranscriptToTail(input.state);
    input.state.statusLine = "Following live transcript";
    input.requestRedraw();
  });
  input.screen.key(["home"], () => {
    input.view.scrollTranscriptToTop();
    input.state.followTail = false;
    input.state.statusLine = "Showing oldest transcript lines";
    input.requestRedraw();
  });
  input.screen.key(["?"], () => {
    if (input.view.getInputValue()) {
      return;
    }
    input.state.footerMode = input.state.footerMode === "shortcuts" ? "default" : "shortcuts";
    input.state.statusLine = input.state.footerMode === "shortcuts" ? "Showing shortcuts" : "Closed shortcuts";
    input.requestRedraw();
  });
}

export function bindTranscriptEvents(input: {
  transcript: Widgets.BoxElement;
  state: TuiScreenState;
  view: BlessedTuiView;
  requestRedraw: () => void;
}): void {
  input.transcript.on("scroll", () => {
    input.state.followTail = input.view.isTranscriptNearTail();
    if (!input.state.followTail) {
      input.state.statusLine = "Browsing transcript history";
    }
    input.requestRedraw();
  });
}
