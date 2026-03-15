import type { ManagerRuntime } from "@autoaide/manager-runtime";
import type { Widgets } from "blessed";
import { clearInputBuffer, replaceInputBuffer } from "./composer.js";
import { dispatchSlashCommand } from "./command-dispatch.js";
import type { InputHistory } from "./input-history.js";
import { handleComposerKeypress, type TuiKeypress } from "./keybindings.js";
import type { BlessedTuiView } from "./blessed-ui.js";
import type { TuiCell } from "./cells.js";
import type { TuiScreenState } from "./screen.js";

export function bindComposerEvents(input: {
  input: BlessedTuiView["input"];
  view: BlessedTuiView;
  state: TuiScreenState;
  runtime: {
    [key: string]: unknown;
  };
  managerRuntime: ManagerRuntime;
  inputHistory: InputHistory;
  requestRedraw: () => void;
  syncInputValue: () => void;
  exitTui: () => Promise<void>;
  pushMessage: (message: TuiCell) => void;
  completeEditorInput: () => string;
  buildThreadListMessage: () => string;
  switchRuntimeThread: (threadId: string) => void;
  createThreadId: () => string;
  refreshDashboard: () => void;
  extractSection: (heading: string, nextHeading: string) => string;
  setPendingSubmission: (promise: Promise<void> | undefined) => void;
  submitOwnerMessage: (input: {
    text: string;
    state: TuiScreenState;
    runtime: Record<string, unknown>;
    managerRuntime: ManagerRuntime;
    onEvent?: (event: unknown, state: TuiScreenState) => void | Promise<void>;
  }) => Promise<void>;
}): void {
  const refocus = () => {
    input.view.focusInput();
    input.view.startInput();
  };

  const handleSubmit = async (rawValue: string) => {
    const value = rawValue.trim();
    if (!value) {
      input.syncInputValue();
      return;
    }
    input.inputHistory.push(value);
    clearInputBuffer(input.state);
    input.view.clearInput();
    input.pushMessage({ kind: "owner", text: value });

    if (value.startsWith("/")) {
      await dispatchSlashCommand({
        value,
        state: input.state,
        buildThreadListMessage: input.buildThreadListMessage,
        switchRuntimeThread: input.switchRuntimeThread,
        createThreadId: input.createThreadId,
        refreshDashboard: input.refreshDashboard,
        pushManagerMessage: (text) => input.pushMessage({ kind: "manager", text }),
        clearConversation: () => {
          input.state.messages = [{ kind: "system", text: "Conversation cleared." }];
          input.state.activeCell = undefined;
        },
        showTasksSection: () => input.extractSection("Tasks", "Workers"),
        showWorkersSection: () => input.extractSection("Workers", "Alerts"),
        scrollTranscriptUp: () => input.view.scrollTranscript(-10),
        scrollTranscriptDown: () => input.view.scrollTranscript(10),
        exitTui: input.exitTui
      });
      input.requestRedraw();
      refocus();
      return;
    }

    if (input.state.pendingTurn) {
      input.state.statusLine = "Manager is still processing the current turn";
      input.requestRedraw();
      refocus();
      return;
    }

    input.state.pendingTurn = true;
    input.refreshDashboard();
    input.requestRedraw();

    const pendingSubmission = input.submitOwnerMessage({
      text: value,
      state: input.state,
      runtime: input.runtime as Record<string, unknown>,
      managerRuntime: input.managerRuntime,
      onEvent() {
        input.refreshDashboard();
        input.requestRedraw();
      }
    }).finally(() => {
      input.state.pendingTurn = false;
      input.refreshDashboard();
      input.requestRedraw();
      refocus();
    });
    input.setPendingSubmission(pendingSubmission);
  };

  input.input.on("submit", (value: string) => {
    void handleSubmit(value);
  });

  input.input.on("cancel", () => {
    refocus();
  });

  input.input.on("keypress", (_ch: string, key: Widgets.Events.IKeyEventArg) => {
    input.state.inputBuffer = input.view.getInputValue();
    input.state.inputCursor = input.state.inputBuffer.length;
    const keyResult = handleComposerKeypress({
      key: key as TuiKeypress,
      state: input.state,
      inputValue: input.view.getInputValue(),
      history: input.inputHistory,
      completeEditorInput: input.completeEditorInput
    });
    if (keyResult.handled) {
      if (keyResult.footerMode) {
        input.state.footerMode = keyResult.footerMode;
      }
      if (keyResult.statusLine) {
        input.state.statusLine = keyResult.statusLine;
      }
      if (keyResult.clearInput) {
        input.view.clearInput();
      } else if (typeof keyResult.inputValue === "string") {
        input.view.setInputValue(keyResult.inputValue);
      } else if (key.name === "tab") {
        input.syncInputValue();
      }
      input.requestRedraw();
      return;
    }
    input.state.footerMode = "default";
  });
}
