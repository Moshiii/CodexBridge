import { jumpTranscriptToTail, type TuiScreenState } from "./screen.js";
import { buildInteractiveHelp, buildTranscriptPagerMessage, parseSlashCommand } from "./slash-commands.js";

export type CommandDispatchResult = {
  shouldExit?: boolean;
};

export async function dispatchSlashCommand(input: {
  value: string;
  state: TuiScreenState;
  buildThreadListMessage: () => string;
  switchRuntimeThread: (threadId: string) => void;
  createThreadId: () => string;
  refreshDashboard: () => void;
  pushManagerMessage: (text: string) => void;
  clearConversation: () => void;
  showTasksSection: () => string;
  showWorkersSection: () => string;
  scrollTranscriptUp: () => void;
  scrollTranscriptDown: () => void;
  exitTui: () => Promise<void>;
}): Promise<CommandDispatchResult> {
  const command = parseSlashCommand(input.value);

  switch (command.name) {
    case "/help":
      input.pushManagerMessage(buildInteractiveHelp());
      input.state.statusLine = "Showing command help";
      break;
    case "/status":
      input.refreshDashboard();
      input.pushManagerMessage(input.state.dashboard);
      input.state.statusLine = "Showing full status";
      break;
    case "/transcript":
      input.pushManagerMessage(buildTranscriptPagerMessage(input.state));
      input.state.statusLine = "Showing transcript history";
      break;
    case "/threads":
      input.pushManagerMessage(input.buildThreadListMessage());
      input.state.statusLine = "Showing saved threads";
      break;
    case "/resume":
      if (!command.args) {
        input.pushManagerMessage(["Usage: /resume <id>", "", input.buildThreadListMessage()].join("\n"));
        input.state.statusLine = "Missing thread id";
        break;
      }
      input.switchRuntimeThread(command.args);
      break;
    case "/new": {
      const threadId = command.args || input.createThreadId();
      input.switchRuntimeThread(threadId);
      input.state.statusLine = `Created thread ${threadId}`;
      break;
    }
    case "/pageup":
      input.scrollTranscriptUp();
      input.state.followTail = false;
      input.state.statusLine = "Scrolled transcript up";
      break;
    case "/pagedown":
      input.scrollTranscriptDown();
      input.state.followTail = false;
      input.state.statusLine = "Scrolled transcript down";
      break;
    case "/tail":
      jumpTranscriptToTail(input.state);
      input.state.statusLine = "Following live transcript";
      break;
    case "/tasks":
      input.pushManagerMessage(input.showTasksSection());
      input.state.statusLine = "Showing tasks section";
      break;
    case "/workers":
      input.pushManagerMessage(input.showWorkersSection());
      input.state.statusLine = "Showing workers section";
      break;
    case "/clear":
      input.clearConversation();
      input.state.statusLine = "Conversation cleared";
      break;
    case "/quit":
    case "/exit":
      await input.exitTui();
      return { shouldExit: true };
    default:
      input.pushManagerMessage(`Unknown command: ${input.value}`);
      input.pushManagerMessage(buildInteractiveHelp());
      input.state.statusLine = "Unknown command";
  }

  input.refreshDashboard();
  return {};
}
