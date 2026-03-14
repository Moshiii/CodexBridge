export const AUTOAIDE_TUI_PROTOCOL_VERSION = 1;

export type BridgeCellKind =
  | "user"
  | "assistant"
  | "status"
  | "plan"
  | "command"
  | "tool_call"
  | "file_change"
  | "warning"
  | "system";

export type BridgeCell = {
  id: string;
  kind: BridgeCellKind;
  label?: string;
  body: string;
  status?: "pending" | "streaming" | "final" | "error";
};

export type BridgeThreadSummary = {
  id: string;
  turnCount: number;
  updatedAt?: number;
  preview: string;
};

export type BridgeRequest =
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "ready";
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "submit_input";
      text: string;
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "request_threads";
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "resume_thread";
      threadId: string;
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "new_thread";
      threadId?: string;
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "shutdown";
    };

export type BridgeResponse =
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "session_state";
      conversationId: string;
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "history_reset";
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "history_cell";
      cell: BridgeCell;
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "active_cell_patch";
      cell?: BridgeCell;
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "status_update";
      message: string;
      manager: number;
      tasks: number;
      workers: number;
      busy: number;
      alerts: number;
      reminders: number;
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "thread_list";
      currentThreadId: string;
      threads: BridgeThreadSummary[];
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "command_result";
      level: "info" | "error";
      message: string;
    }
  | {
      protocolVersion: typeof AUTOAIDE_TUI_PROTOCOL_VERSION;
      type: "shutdown_ack";
    };
