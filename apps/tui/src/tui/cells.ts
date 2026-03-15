export type TuiStepType = "event" | "ran" | "edited" | "explored" | "waited" | "failed";
export type TuiCellStatus = "pending" | "streaming" | "final" | "error";

export type ManagerThreadItemType =
  | "userMessage"
  | "agentMessage"
  | "plan"
  | "reasoning"
  | "commandExecution"
  | "fileChange"
  | "webSearch"
  | "contextCompaction"
  | "dynamicToolCall"
  | "mcpToolCall"
  | "imageView";

type TuiBaseCell = {
  status?: TuiCellStatus;
};

export type TuiSystemCell = TuiBaseCell & {
  kind: "system";
  text: string;
};

export type TuiOwnerCell = TuiBaseCell & {
  kind: "owner";
  text: string;
};

export type TuiAgentCell = TuiBaseCell & {
  kind: "agent" | "manager";
  text: string;
};

export type TuiPlanCell = TuiBaseCell & {
  kind: "plan";
  threadItemType: "plan";
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiReasoningCell = TuiBaseCell & {
  kind: "reasoning";
  threadItemType: "reasoning";
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiCommandCell = TuiBaseCell & {
  kind: "command";
  threadItemType: "commandExecution";
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiToolCallCell = TuiBaseCell & {
  kind: "tool_call";
  threadItemType: "dynamicToolCall" | "mcpToolCall";
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiFileChangeCell = TuiBaseCell & {
  kind: "file_change";
  threadItemType: "fileChange";
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiWebSearchCell = TuiBaseCell & {
  kind: "web_search";
  threadItemType: "webSearch";
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiImageCell = TuiBaseCell & {
  kind: "image";
  threadItemType: "imageView";
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiContextCell = TuiBaseCell & {
  kind: "context";
  threadItemType: "contextCompaction";
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiLegacyStepCell = TuiBaseCell & {
  kind: "step";
  threadItemType: ManagerThreadItemType;
  stepType: TuiStepType;
  title: string;
  text?: string;
};

export type TuiCell =
  | TuiSystemCell
  | TuiOwnerCell
  | TuiAgentCell
  | TuiPlanCell
  | TuiReasoningCell
  | TuiCommandCell
  | TuiToolCallCell
  | TuiFileChangeCell
  | TuiWebSearchCell
  | TuiImageCell
  | TuiContextCell
  | TuiLegacyStepCell;

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function truncateVisible(value: string, width: number): string {
  const plain = stripAnsi(value);
  return plain.length <= width ? value : `${plain.slice(0, Math.max(0, width - 1))}…`;
}

function wrapPlainText(value: string, width: number): string[] {
  const plain = stripAnsi(value);
  if (width <= 1) {
    return [plain];
  }
  const paragraphs = plain.split("\n");
  const wrapped: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= width) {
        current = candidate;
        continue;
      }
      if (current) {
        wrapped.push(current);
      }
      current = word.length <= width ? word : `${word.slice(0, Math.max(0, width - 1))}…`;
    }
    if (current) {
      wrapped.push(current);
    }
  }
  return wrapped.length > 0 ? wrapped : [""];
}

export function formatConversationCell(entry: TuiCell, width: number): string[] {
  const contentWidth = Math.max(20, width - 4);

  switch (entry.kind) {
    case "owner":
      return wrapPlainText(entry.text, contentWidth).map((line, index) => (index === 0 ? `› ${line}` : `  ${line}`));
    case "system":
    case "agent":
    case "manager":
      return wrapPlainText(entry.text, contentWidth).map((line, index) => (index === 0 ? `• ${line}` : `  ${line}`));
    case "command":
      return formatCommandCell(entry, contentWidth);
    case "tool_call":
      return formatToolCallCell(entry, contentWidth);
    case "file_change":
      return formatFileChangeCell(entry, contentWidth);
    case "web_search":
      return formatWebSearchCell(entry, contentWidth);
    case "plan":
      return formatPlanCell(entry, contentWidth);
    case "reasoning":
      return formatReasoningCell(entry, contentWidth);
    case "image":
      return formatSimpleBlock(`• Viewed Image${liveSuffix(entry)}`, entry.text, contentWidth);
    case "context":
      return formatSimpleBlock(`• Compacted Context${liveSuffix(entry)}`, entry.text, contentWidth);
    case "step":
      return formatLegacyStepCell(entry, contentWidth);
  }
}

function formatLegacyStepCell(entry: TuiLegacyStepCell, contentWidth: number): string[] {
  switch (entry.threadItemType) {
    case "commandExecution":
      return formatCommandCell(
        {
          kind: "command",
          threadItemType: "commandExecution",
          stepType: entry.stepType,
          title: entry.title,
          text: entry.text,
          status: entry.status
        },
        contentWidth
      );
    case "dynamicToolCall":
    case "mcpToolCall":
      return formatToolCallCell(
        {
          kind: "tool_call",
          threadItemType: entry.threadItemType,
          stepType: entry.stepType,
          title: entry.title,
          text: entry.text,
          status: entry.status
        },
        contentWidth
      );
    case "fileChange":
      return formatFileChangeCell(
        {
          kind: "file_change",
          threadItemType: "fileChange",
          stepType: entry.stepType,
          title: entry.title,
          text: entry.text,
          status: entry.status
        },
        contentWidth
      );
    case "webSearch":
      return formatWebSearchCell(
        {
          kind: "web_search",
          threadItemType: "webSearch",
          stepType: entry.stepType,
          title: entry.title,
          text: entry.text,
          status: entry.status
        },
        contentWidth
      );
    case "plan":
      return formatPlanCell(
        {
          kind: "plan",
          threadItemType: "plan",
          stepType: entry.stepType,
          title: entry.title,
          text: entry.text,
          status: entry.status
        },
        contentWidth
      );
    case "reasoning":
      return formatReasoningCell(
        {
          kind: "reasoning",
          threadItemType: "reasoning",
          stepType: entry.stepType,
          title: entry.title,
          text: entry.text,
          status: entry.status
        },
        contentWidth
      );
    case "imageView":
      return formatConversationCell(
        {
          kind: "image",
          threadItemType: "imageView",
          stepType: entry.stepType,
          title: entry.title,
          text: entry.text,
          status: entry.status
        },
        contentWidth + 4
      );
    case "contextCompaction":
      return formatConversationCell(
        {
          kind: "context",
          threadItemType: "contextCompaction",
          stepType: entry.stepType,
          title: entry.title,
          text: entry.text,
          status: entry.status
        },
        contentWidth + 4
      );
    default:
      return formatSimpleBlock(`${stepPrefix(entry.stepType)} ${entry.title}${liveSuffix(entry)}`, entry.text, contentWidth);
  }
}

function formatPlanCell(entry: TuiPlanCell, contentWidth: number): string[] {
  const bodyWidth = Math.max(16, contentWidth - 4);
  const bodyLines = formatPlanBody(entry.text, bodyWidth);
  return bodyLines.length === 0
    ? [`• Updated Plan${liveSuffix(entry)}`]
    : [`• Updated Plan${liveSuffix(entry)}`, ...formatIndentedBlock(bodyLines)];
}

function formatReasoningCell(entry: TuiReasoningCell, contentWidth: number): string[] {
  if (entry.title === "Clarification Requested" || entry.title === "Followup Waiting Owner") {
    return formatSimpleBlock("• Waited for owner input", entry.text, contentWidth);
  }
  if (entry.title === "Followup Escalate Owner") {
    return formatSimpleBlock("• Waited for owner decision", entry.text, contentWidth);
  }
  if (entry.title === "Followup Blocked Task") {
    return formatSimpleBlock("• Failed", entry.text, contentWidth);
  }
  if (entry.title === "Followup Replan Task") {
    return formatSimpleBlock("• Updated Plan", entry.text, contentWidth);
  }
  return formatSimpleBlock(`• Explored${liveSuffix(entry)}`, entry.text, contentWidth);
}

function formatCommandCell(entry: TuiCommandCell, contentWidth: number): string[] {
  const header =
    entry.title === "Worker Started"
      ? `• Waited for worker execution${liveSuffix(entry)}`
      : entry.title === "Worker Completed"
        ? "• Ran worker execution"
        : entry.title === "Worker Failed"
          ? "• Failed worker execution"
          : `${stepPrefix(entry.stepType)} ${truncateVisible(entry.text || entry.title, 72)}`;
  const bodyWidth = Math.max(16, contentWidth - 4);
  const bodyLines = collapseLongBodyLines(formatCommandExecutionBody(entry.text, bodyWidth));
  return bodyLines.length === 0 ? [header] : [header, ...formatCommandBlock(bodyLines)];
}

function formatToolCallCell(entry: TuiToolCallCell, contentWidth: number): string[] {
  const header =
    entry.title === "Tool Calls Emitted"
      ? `• Ran orchestration${liveSuffix(entry)}`
      : `• Called ${normalizeStepCallName(entry.title)}${liveSuffix(entry)}`;
  const bodyWidth = Math.max(16, contentWidth - 4);
  const bodyLines = collapseLongBodyLines(formatToolCallBody(entry.text, bodyWidth));
  return bodyLines.length === 0 ? [header] : [header, ...formatCommandBlock(bodyLines)];
}

function formatFileChangeCell(entry: TuiFileChangeCell, contentWidth: number): string[] {
  const header = `${stepPrefix(entry.stepType)} ${truncateVisible(extractFileChangeHeadline(entry.text, entry.title), 72)}`;
  const bodyWidth = Math.max(16, contentWidth - 4);
  const bodyLines = extractFileChangeBody(entry.text).map((line) => truncateVisible(line, bodyWidth));
  return bodyLines.length === 0 ? [header] : [header, ...formatIndentedBlock(bodyLines)];
}

function formatWebSearchCell(entry: TuiWebSearchCell, contentWidth: number): string[] {
  return [entry.text ? `• Searched ${truncateVisible(entry.text, contentWidth)}${liveSuffix(entry)}` : `• Searched${liveSuffix(entry)}`];
}

function formatSimpleBlock(header: string, text: string | undefined, contentWidth: number): string[] {
  const bodyWidth = Math.max(16, contentWidth - 4);
  const bodyLines = text ? wrapPlainText(text, bodyWidth) : [];
  return bodyLines.length === 0 ? [header] : [header, ...formatIndentedBlock(bodyLines)];
}

function formatIndentedBlock(lines: string[]): string[] {
  return lines.map((line) => `  └ ${line}`);
}

function formatCommandBlock(lines: string[]): string[] {
  if (lines.length === 1) {
    return [`  └ ${lines[0]}`];
  }
  return lines.map((line, index) => (index === lines.length - 1 ? `  └ ${line}` : `  │ ${line}`));
}

function collapseLongBodyLines(lines: string[], maxLines = 4): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }
  const visibleHead = lines.slice(0, Math.max(1, maxLines - 2));
  const visibleTail = lines.slice(-1);
  const hiddenCount = lines.length - visibleHead.length - visibleTail.length;
  return [...visibleHead, `… +${hiddenCount} lines`, ...visibleTail];
}

function formatPlanBody(text: string | undefined, width: number): string[] {
  const trimmed = text?.trim();
  if (!trimmed) {
    return [];
  }

  const rawLines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  if (rawLines.length <= 1) {
    return wrapPlainText(trimmed, width);
  }

  return rawLines.flatMap((line) => {
    const normalized = line.match(/^[-*]\s+/) ? `□ ${line.replace(/^[-*]\s+/, "")}` : line;
    return wrapPlainText(normalized, width);
  });
}

function formatCommandExecutionBody(text: string | undefined, bodyWidth: number): string[] {
  const trimmed = text?.trim();
  if (!trimmed) {
    return [];
  }

  const started = trimmed.match(/^(\S+)\s+started\s+(.+)$/i);
  if (started) {
    return [...wrapPlainText(`worker ${started[1]}`, bodyWidth), ...wrapPlainText(`task ${started[2]}`, bodyWidth)];
  }

  const finished = trimmed.match(/^(\S+)\s+(succeeded|failed)\s+(.+?):\s+(.+)$/i);
  if (finished) {
    return [
      ...wrapPlainText(`worker ${finished[1]}`, bodyWidth),
      ...wrapPlainText(`task ${finished[3]}`, bodyWidth),
      ...wrapPlainText(`result ${finished[4]}`, bodyWidth)
    ];
  }

  return wrapPlainText(trimmed, bodyWidth);
}

function extractFileChangeHeadline(text: string | undefined, title: string): string {
  const trimmed = text?.trim();
  if (!trimmed) {
    return title;
  }
  const match = trimmed.match(/^(updated|edited|changed)\s+(.+?)(\s+\(\+[0-9]+\s+-[0-9]+\))?$/i);
  if (!match) {
    return trimmed;
  }
  return `${match[2]}${match[3] ?? ""}`.trim();
}

function extractFileChangeBody(text: string | undefined): string[] {
  const trimmed = text?.trim();
  if (!trimmed) {
    return [];
  }
  const match = trimmed.match(/^(updated|edited|changed)\s+(.+?)(\s+\(\+[0-9]+\s+-[0-9]+\))?$/i);
  if (!match) {
    return [trimmed];
  }
  const lines: string[] = [];
  if (match[3]) {
    const stats = match[3].replace(/[()]/g, "").trim();
    lines.push(`delta ${stats}`);
  }
  if (match[1].toLowerCase() !== "updated") {
    lines.push(`${match[1]} ${match[2]}`.trim());
  }
  return lines;
}

function formatToolCallBody(text: string | undefined, bodyWidth: number): string[] {
  const trimmed = text?.trim();
  if (!trimmed) {
    return [];
  }
  const statusMatch = trimmed.match(/^\[([^\]]+)\]\s+(.+)$/);
  if (!statusMatch) {
    return wrapPlainText(trimmed, bodyWidth);
  }
  return [
    ...wrapPlainText(`status ${statusMatch[1].toLowerCase()}`, bodyWidth),
    ...wrapPlainText(statusMatch[2], bodyWidth)
  ];
}

function normalizeStepCallName(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "_");
}

function liveSuffix(entry: TuiBaseCell): string {
  return entry.status === "pending" || entry.status === "streaming" ? "…" : "";
}

function stepPrefix(stepType: TuiStepType): string {
  switch (stepType) {
    case "ran":
      return "• Ran";
    case "edited":
      return "• Edited";
    case "explored":
      return "• Explored";
    case "waited":
      return "• Waited";
    case "failed":
      return "• Failed";
    default:
      return "•";
  }
}

export function classifyStepType(label: string): TuiStepType {
  const threadItemType = classifyThreadItemType(label);
  switch (threadItemType) {
    case "commandExecution":
      return label.includes("failed") ? "failed" : "ran";
    case "fileChange":
      return label.includes("failed") ? "failed" : "edited";
    case "webSearch":
      return "explored";
    case "plan":
    case "reasoning":
      return "explored";
    case "contextCompaction":
      return "event";
    case "dynamicToolCall":
    case "mcpToolCall":
      return label.includes("failed") ? "failed" : "ran";
    case "imageView":
      return "explored";
    default:
      return "event";
  }
}

export function classifyThreadItemType(label: string): ManagerThreadItemType {
  if (label.startsWith("worker_")) {
    return "commandExecution";
  }
  if (label.includes("plan")) {
    return "plan";
  }
  if (label.includes("intent") || label.includes("clarification") || label.includes("followup") || label.includes("thinking")) {
    return "reasoning";
  }
  if (label.includes("search")) {
    return "webSearch";
  }
  if (label.includes("compact")) {
    return "contextCompaction";
  }
  if (label.includes("assign_worker") || label.includes("record_decision") || label.includes("schedule_followup") || label.includes("replan_task")) {
    return "dynamicToolCall";
  }
  if (label.includes("tool_calls")) {
    return "mcpToolCall";
  }
  return "reasoning";
}

function humanizeEventLabel(label: string): string {
  return label
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildEventCell(label: string, text: string, status: TuiCellStatus = "final"): TuiCell {
  const threadItemType = classifyThreadItemType(label);
  const title = humanizeEventLabel(label);
  const stepType = classifyStepType(label);

  switch (threadItemType) {
    case "plan":
      return { kind: "plan", threadItemType, title, text, stepType, status };
    case "commandExecution":
      return { kind: "command", threadItemType, title, text, stepType, status };
    case "dynamicToolCall":
    case "mcpToolCall":
      return { kind: "tool_call", threadItemType, title, text, stepType, status };
    case "fileChange":
      return { kind: "file_change", threadItemType, title, text, stepType, status };
    case "webSearch":
      return { kind: "web_search", threadItemType, title, text, stepType, status };
    case "imageView":
      return { kind: "image", threadItemType, title, text, stepType, status };
    case "contextCompaction":
      return { kind: "context", threadItemType, title, text, stepType, status };
    case "reasoning":
    default:
      return { kind: "reasoning", threadItemType: "reasoning", title, text, stepType, status };
  }
}
