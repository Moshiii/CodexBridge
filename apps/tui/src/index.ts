import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import {
  CommandCodexExecutorAdapter,
  InMemoryCodexRunRegistry,
  NodeProcessCodexCommandRunner,
  runCodexWorkerAssignment,
  type CodexExecutor
} from "@autoaide/executor-codex";
import {
  createDefaultManagerRuntime,
  type ManagerConversationContext,
  type ManagerRuntime
} from "@autoaide/manager-runtime";
import { InMemoryMemoryStore, InMemoryManagerMemory } from "@autoaide/memory-system";
import {
  InMemoryChannelBridge,
  buildManagerFollowupReceipts,
  ingestOwnerGoalAndPlan
} from "@autoaide/owner-interface";
import { createTask, InMemoryTaskStore } from "@autoaide/task-system";
import { buildOperatorSnapshot, renderOperatorDashboard } from "@autoaide/terminal-ui";
import { InMemoryWorkerRegistry, assignTaskToWorker, spawnWorker } from "@autoaide/worker-orchestrator";

export type CodexConnectivityCheckResult = {
  dashboard: string;
  receipts: Awaited<ReturnType<typeof runCodexWorkerAssignment>>[];
};

export type CodexConnectivityEvent =
  | { type: "check_started"; text: string }
  | { type: "worker_started"; workerId: string; assignmentId: string; text: string }
  | { type: "worker_completed"; workerId: string; assignmentId: string; text: string }
  | { type: "check_completed"; text: string };

export type CodexConnectivityEventHandler = (event: CodexConnectivityEvent) => void | Promise<void>;

export type TuiMessage =
  | {
      kind: "system" | "owner" | "manager";
      text: string;
    }
  | {
      kind: "event";
      label: string;
      text: string;
    };

export type TuiScreenState = {
  dashboard: string;
  compactStatus: string;
  messages: TuiMessage[];
  statusLine: string;
  promptLabel: string;
};

export type SlashCommandDefinition = {
  name: string;
  description: string;
};

export type ParsedSlashCommand = {
  name: string;
  args: string;
};

export type OperatorRuntimeState = ReturnType<typeof createOperatorRuntimeState>;

type PendingClarification = {
  originalText: string;
  question: string;
  openedAt: number;
};

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function visibleWidth(value: string): number {
  return stripAnsi(value).length;
}

function padRight(value: string, width: number): string {
  const visible = visibleWidth(value);
  if (visible >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - visible)}`;
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
  const words = plain.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word.length <= width ? word : `${word.slice(0, Math.max(0, width - 1))}…`;
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

export function formatConversationMessage(entry: TuiMessage, width: number): string[] {
  const label = entry.kind === "event" ? `[event:${entry.label}]` : `[${entry.kind}]`;
  const contentWidth = Math.max(10, width - label.length - 1);
  return wrapPlainText(entry.text, contentWidth).map((line, index) =>
    index === 0 ? `${label} ${line}` : `${" ".repeat(label.length)} ${line}`
  );
}

function renderPanel(title: string, lines: string[], width: number): string[] {
  const top = `┌${"─".repeat(width - 2)}┐`;
  const middle = `│${padRight(truncateVisible(title, width - 4), width - 2)}│`;
  const body = lines.map((line) => `│${padRight(truncateVisible(line, width - 2), width - 2)}│`);
  const bottom = `└${"─".repeat(width - 2)}┘`;
  return [top, middle, ...body, bottom];
}

export function renderInteractiveScreen(
  state: TuiScreenState,
  options: { width?: number; height?: number } = {}
): string {
  const width = Math.max(80, options.width ?? 120);
  const height = Math.max(24, options.height ?? 32);
  const panelWidth = width;
  const logs = state.messages.flatMap((entry) => formatConversationMessage(entry, panelWidth - 2));
  const maxPanelBody = Math.max(10, height - 8);
  const conversationPanel = renderPanel("Manager Conversation", logs.slice(-maxPanelBody), panelWidth);
  const footer = [
    state.compactStatus,
    state.statusLine,
    `${state.promptLabel} type a goal or use /help  /status  /tasks  /workers  /clear  /quit`
  ];

  return [...conversationPanel, "", ...footer].join("\n");
}

function redrawScreen(state: TuiScreenState): void {
  process.stdout.write("\u001b[?1049h\u001b[2J\u001b[H");
  process.stdout.write(
    `${renderInteractiveScreen(state, {
      width: process.stdout.columns,
      height: process.stdout.rows
    })}\n`
  );
}

function restoreTerminalScreen(): void {
  process.stdout.write("\u001b[?1049l");
}

export function getSlashCommands(): SlashCommandDefinition[] {
  return [
    { name: "/help", description: "Show help" },
    { name: "/status", description: "Re-render the dashboard" },
    { name: "/tasks", description: "Show the tasks section" },
    { name: "/workers", description: "Show the workers section" },
    { name: "/clear", description: "Clear the conversation panel" },
    { name: "/quit", description: "Exit" },
    { name: "/exit", description: "Alias for /quit" }
  ];
}

function interactiveHelp(): string {
  return ["AutoAide TUI commands:", ...getSlashCommands().map((command) => `  ${command.name.padEnd(21, " ")} ${command.description}`)].join("\n");
}

function extractSection(text: string, heading: string, nextHeading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) {
    return text;
  }
  const end = text.indexOf(nextHeading, start + heading.length);
  return text.slice(start, end >= 0 ? end : text.length).trimEnd();
}

export function parseSlashCommand(input: string): ParsedSlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { name: "", args: trimmed };
  }
  const [name, ...rest] = trimmed.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args: rest.join(" ").trim()
  };
}

export function completeSlashCommand(input: string): [string[], string] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return [[], input];
  }
  const parsed = parseSlashCommand(trimmed);
  if (parsed.args) {
    return [[], input];
  }
  const matches = getSlashCommands()
    .map((command) => command.name)
    .filter((command) => command.startsWith(parsed.name || "/"));
  return [matches, parsed.name || "/"];
}

function createDefaultExecutor(): CodexExecutor {
  return new CommandCodexExecutorAdapter(new NodeProcessCodexCommandRunner());
}

function buildDashboardFromState(input: {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  memoryStore: InMemoryMemoryStore;
  now: number;
}) {
  for (const worker of input.registry.listWorkers()) {
    input.memoryStore.upsertWorker(worker);
  }

  const memory = new InMemoryManagerMemory(input.store, input.memoryStore);
  const snapshot = buildOperatorSnapshot({
    store: input.store,
    registry: input.registry,
    memory,
    now: input.now
  });

  return renderOperatorDashboard(snapshot, {
    rich: Boolean(process.stdout.isTTY),
    width: process.stdout.columns
  });
}

function buildCompactStatusFromState(input: {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  memoryStore: InMemoryMemoryStore;
  now: number;
}): string {
  for (const worker of input.registry.listWorkers()) {
    input.memoryStore.upsertWorker(worker);
  }

  const memory = new InMemoryManagerMemory(input.store, input.memoryStore);
  const snapshot = buildOperatorSnapshot({
    store: input.store,
    registry: input.registry,
    memory,
    now: input.now
  });

  return [
    `manager`,
    `tasks ${snapshot.overview.totalTasks}`,
    `workers ${snapshot.overview.workerCount}`,
    `busy ${snapshot.overview.busyWorkers}`,
    `alerts ${snapshot.overview.alertCount}`,
    `reminders ${snapshot.overview.reminderCount}`
  ].join("  ");
}

function createOperatorRuntimeState(now = Date.now()) {
  return {
    now,
    store: new InMemoryTaskStore(),
    registry: new InMemoryWorkerRegistry(),
    memoryStore: new InMemoryMemoryStore(now),
    runRegistry: new InMemoryCodexRunRegistry(),
    executor: createDefaultExecutor(),
    pendingClarification: undefined as PendingClarification | undefined,
    activeRootTaskId: undefined as string | undefined,
    activeTaskTitle: undefined as string | undefined
  };
}

export function buildOperatorDashboard(): string {
  const runtime = createOperatorRuntimeState();
  return buildDashboardFromState(runtime);
}

function refreshDashboard(state: TuiScreenState, runtime: OperatorRuntimeState, now = Date.now()): void {
  runtime.now = now;
  state.dashboard = buildDashboardFromState({
    store: runtime.store,
    registry: runtime.registry,
    memoryStore: runtime.memoryStore,
    now
  });
  state.compactStatus = buildCompactStatusFromState({
    store: runtime.store,
    registry: runtime.registry,
    memoryStore: runtime.memoryStore,
    now
  });
}

function pushMessage(state: TuiScreenState, message: TuiMessage): void {
  state.messages.push(message);
  if (state.messages.length > 40) {
    state.messages = state.messages.slice(-40);
  }
}

function appendConversationTurn(
  runtime: OperatorRuntimeState,
  input: {
    role: "owner" | "manager" | "system" | "event";
    text: string;
    now: number;
  }
): void {
  const conversationId = "terminal-owner-local";
  runtime.memoryStore.appendConversationTurn({
    id: `turn-${input.now}-${runtime.memoryStore.listConversationTurns(conversationId).length + 1}`,
    conversationId,
    ownerId: "owner-local",
    role: input.role,
    text: input.text,
    createdAt: input.now
  });
}

function upsertConversationState(runtime: OperatorRuntimeState, now: number): void {
  const conversationId = "terminal-owner-local";
  const existing = runtime.memoryStore.listConversations("owner-local")[0];
  const turns = runtime.memoryStore.listConversationTurns(conversationId);
  runtime.memoryStore.upsertConversation({
    id: conversationId,
    ownerId: "owner-local",
    channel: "web",
    peerId: "local-terminal",
    activeTaskId: runtime.activeRootTaskId,
    activeTaskTitle: runtime.activeTaskTitle,
    pendingClarificationQuestion: runtime.pendingClarification?.question,
    rollingSummary: turns
      .slice(-4)
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join(" | "),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
}

async function processPendingAssignments(
  state: TuiScreenState,
  runtime: OperatorRuntimeState
): Promise<void> {
  const runnableAssignments = runtime.store
    .listAssignments()
    .filter(
      (assignment) =>
        assignment.status === "starting" && !runtime.runRegistry.getRun(`run-${assignment.id}`)
    );

  for (const assignment of runnableAssignments) {
    const task = runtime.store.getTask(assignment.taskId);
    if (!task) {
      continue;
    }

    pushMessage(state, {
      kind: "event",
      label: "worker_started",
      text: `${assignment.workerId} started ${task.title}`
    });
    appendConversationTurn(runtime, {
      role: "event",
      text: `worker_started: ${assignment.workerId} started ${task.title}`,
      now: Date.now()
    });

    let receipt: Awaited<ReturnType<typeof runCodexWorkerAssignment>>;
    try {
      receipt = await runCodexWorkerAssignment({
        store: runtime.store,
        registry: runtime.registry,
        runRegistry: runtime.runRegistry,
        executor: runtime.executor,
        assignmentId: assignment.id,
        runId: `run-${assignment.id}`,
        policy: {
          workspaceRoot: process.cwd(),
          allowedTools: ["read"],
          maxRuntimeMs: 120_000,
          managerVisibility: "summary_only"
        }
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      runtime.store.upsertTask({
        ...task,
        status: "blocked",
        blockers: [errorText],
        updatedAt: Date.now(),
        lastProgressAt: Date.now()
      });
      pushMessage(state, {
        kind: "event",
        label: "worker_failed",
        text: `${assignment.workerId} failed ${task.title}: ${errorText}`
      });
      pushMessage(state, {
        kind: "manager",
        text: `真实 Codex 执行失败，无法继续《${task.title}》：${errorText}`
      });
      appendConversationTurn(runtime, {
        role: "event",
        text: `worker_failed: ${assignment.workerId} failed ${task.title}: ${errorText}`,
        now: Date.now()
      });
      appendConversationTurn(runtime, {
        role: "manager",
        text: `真实 Codex 执行失败，无法继续《${task.title}》：${errorText}`,
        now: Date.now()
      });
      upsertConversationState(runtime, Date.now());
      continue;
    }

    pushMessage(state, {
      kind: "event",
      label: receipt.result.status === "succeeded" ? "worker_completed" : "worker_failed",
      text: `${assignment.workerId} ${receipt.result.status} ${task.title}: ${receipt.managerView.summary}`
    });
    appendConversationTurn(runtime, {
      role: "event",
      text: `${receipt.result.status === "succeeded" ? "worker_completed" : "worker_failed"}: ${assignment.workerId} ${receipt.result.status} ${task.title}: ${receipt.managerView.summary}`,
      now: receipt.result.finishedAt
    });
    pushMessage(state, {
      kind: "manager",
      text:
        receipt.result.status === "succeeded"
          ? `执行器 ${assignment.workerId} 已完成《${task.title}》：${receipt.managerView.summary}`
          : `执行器 ${assignment.workerId} 在《${task.title}》上遇到问题：${receipt.managerView.summary}`
    });
    appendConversationTurn(runtime, {
      role: "manager",
      text:
        receipt.result.status === "succeeded"
          ? `执行器 ${assignment.workerId} 已完成《${task.title}》：${receipt.managerView.summary}`
          : `执行器 ${assignment.workerId} 在《${task.title}》上遇到问题：${receipt.managerView.summary}`,
      now: receipt.result.finishedAt
    });
    upsertConversationState(runtime, receipt.result.finishedAt);
  }
}

function emitManagerFollowups(state: TuiScreenState, runtime: OperatorRuntimeState, now: number): void {
  const receipts = buildManagerFollowupReceipts({
    ownerId: "owner-local",
    store: runtime.store,
    memoryStore: runtime.memoryStore,
    conversationId: "terminal-owner-local"
  });

  for (const receipt of receipts) {
    pushMessage(state, {
      kind: "event",
      label: receipt.kind,
      text: receipt.summary
    });
    pushMessage(state, {
      kind: "manager",
      text: receipt.ownerText
    });
    appendConversationTurn(runtime, {
      role: "event",
      text: `${receipt.kind}: ${receipt.summary}`,
      now
    });
    appendConversationTurn(runtime, {
      role: "manager",
      text: receipt.ownerText,
      now
    });
  }
}

function buildManagerConversationContext(
  state: TuiScreenState,
  runtime: OperatorRuntimeState
): ManagerConversationContext {
  const conversationId = "terminal-owner-local";
  const conversation = runtime.memoryStore.listConversations("owner-local")[0];
  const turns = runtime.memoryStore.listConversationTurns(conversationId);

  return {
    activeRootTaskId: conversation?.activeTaskId ?? runtime.activeRootTaskId,
    activeTaskTitle: conversation?.activeTaskTitle ?? runtime.activeTaskTitle,
    pendingClarificationQuestion:
      conversation?.pendingClarificationQuestion ?? runtime.pendingClarification?.question,
    recentMessages:
      turns.length > 0
        ? turns.slice(-8).map((turn) => ({
            role: turn.role,
            text: turn.text
          }))
        : state.messages.slice(-8).map((message) => ({
            role: message.kind,
            text: message.kind === "event" ? `${message.label}: ${message.text}` : message.text
          }))
  };
}

export async function submitOwnerMessage(input: {
  text: string;
  state: TuiScreenState;
  runtime: OperatorRuntimeState;
  managerRuntime?: ManagerRuntime;
  ownerId?: string;
  peerId?: string;
  now?: number;
}): Promise<void> {
  const now = input.now ?? Date.now();
  const bridge = new InMemoryChannelBridge();
  const managerMemory = new InMemoryManagerMemory(input.runtime.store, input.runtime.memoryStore);
  const effectiveText = input.runtime.pendingClarification
    ? [input.runtime.pendingClarification.originalText, input.text].join("\n")
    : input.text;
  appendConversationTurn(input.runtime, {
    role: "owner",
    text: input.text,
    now
  });
  upsertConversationState(input.runtime, now);

  bridge.register("web", {
    send: async (reply) => {
      pushMessage(input.state, {
        kind: "manager",
        text: reply.text
      });
      appendConversationTurn(input.runtime, {
        role: "manager",
        text: reply.text,
        now
      });
    }
  });

  const result = await ingestOwnerGoalAndPlan({
    message: {
      id: `msg-${now}`,
      ownerId: input.ownerId ?? "owner-local",
      channel: "web",
      peerId: input.peerId ?? "local-terminal",
      text: effectiveText,
      createdAt: now
    },
    store: input.runtime.store,
    bridge,
    runtime: input.managerRuntime,
    memory: managerMemory,
    conversation: buildManagerConversationContext(input.state, input.runtime),
    memoryStore: input.runtime.memoryStore,
    workerRegistry: input.runtime.registry,
    rootTaskId: `task-root-${now}`,
    now
  });

  for (const receipt of result.behaviorReceipts) {
    pushMessage(input.state, {
      kind: "event",
      label: receipt.kind,
      text: receipt.summary
    });
    appendConversationTurn(input.runtime, {
      role: "event",
      text: `${receipt.kind}: ${receipt.summary}`,
      now
    });
  }

  for (const receipt of result.actionReceipts) {
    pushMessage(input.state, {
      kind: "event",
      label: receipt.toolCall,
      text: `[${receipt.status}] ${receipt.summary}`
    });
    appendConversationTurn(input.runtime, {
      role: "event",
      text: `${receipt.toolCall}: [${receipt.status}] ${receipt.summary}`,
      now
    });
  }

  await processPendingAssignments(input.state, input.runtime);

  if (result.response.intent.needsClarification) {
    input.runtime.pendingClarification = {
      originalText: input.runtime.pendingClarification?.originalText ?? input.text,
      question:
        result.response.intent.clarificationQuestion ?? result.response.reply.text,
      openedAt: input.runtime.pendingClarification?.openedAt ?? now
    };
    input.runtime.activeRootTaskId = undefined;
    input.runtime.activeTaskTitle = undefined;
  } else {
    input.runtime.pendingClarification = undefined;
    input.runtime.activeRootTaskId = result.plan?.rootTask.id;
    input.runtime.activeTaskTitle = result.plan?.rootTask.title;
  }
  upsertConversationState(input.runtime, now);
  emitManagerFollowups(input.state, input.runtime, now);
  upsertConversationState(input.runtime, now);

  refreshDashboard(input.state, input.runtime, now);
  input.state.statusLine = result.plan
    ? `Planned ${1 + result.plan.tasks.length} task(s) for ${result.intent.title}`
    : `Waiting for clarification: ${result.response.intent.clarificationQuestion ?? result.response.reply.text}`;
}

export async function runCodexConnectivityCheck(input: {
  executor?: CodexExecutor;
  onEvent?: CodexConnectivityEventHandler;
} = {}): Promise<CodexConnectivityCheckResult> {
  const now = Date.now();
  const store = new InMemoryTaskStore();
  const registry = new InMemoryWorkerRegistry();
  const memoryStore = new InMemoryMemoryStore(now);
  const runRegistry = new InMemoryCodexRunRegistry();
  const executor = input.executor ?? createDefaultExecutor();

  store.upsertTask(
    createTask({
      id: "task-multi-1",
      ownerId: "owner-1",
      title: "Prepare implementation notes",
      goal: "Have worker one summarize the implementation plan",
      now,
      priority: "high"
    })
  );
  store.updateTaskStatus("task-multi-1", "planned", now + 1);

  store.upsertTask(
    createTask({
      id: "task-multi-2",
      ownerId: "owner-1",
      title: "Prepare test checklist",
      goal: "Have worker two summarize the validation plan",
      now: now + 2,
      priority: "high"
    })
  );
  store.updateTaskStatus("task-multi-2", "planned", now + 3);

  spawnWorker(registry, { workerId: "worker-multi-1", now: now + 4, strengths: ["planning"] });
  spawnWorker(registry, { workerId: "worker-multi-2", now: now + 5, strengths: ["testing"] });

  assignTaskToWorker({
    store,
    registry,
    taskId: "task-multi-1",
    workerId: "worker-multi-1",
    assignmentId: "assignment-multi-1",
    objective: "Return a success result whose summary is exactly WORKER_1_OK.",
    now: now + 6
  });
  assignTaskToWorker({
    store,
    registry,
    taskId: "task-multi-2",
    workerId: "worker-multi-2",
    assignmentId: "assignment-multi-2",
    objective: "Return a success result whose summary is exactly WORKER_2_OK.",
    now: now + 7
  });

  await input.onEvent?.({
    type: "check_started",
    text: "Starting Codex connectivity check."
  });

  await input.onEvent?.({
    type: "worker_started",
    workerId: "worker-multi-1",
    assignmentId: "assignment-multi-1",
    text: "worker-multi-1 started assignment-multi-1"
  });
  await input.onEvent?.({
    type: "worker_started",
    workerId: "worker-multi-2",
    assignmentId: "assignment-multi-2",
    text: "worker-multi-2 started assignment-multi-2"
  });

  const receipt1Promise = runCodexWorkerAssignment({
      store,
      registry,
      runRegistry,
      executor,
      assignmentId: "assignment-multi-1",
      runId: "run-multi-1",
      policy: {
        workspaceRoot: process.cwd(),
        allowedTools: ["read"],
        maxRuntimeMs: 120_000,
        managerVisibility: "summary_only"
      }
    }).then(async (receipt) => {
      await input.onEvent?.({
        type: "worker_completed",
        workerId: "worker-multi-1",
        assignmentId: "assignment-multi-1",
        text: `worker-multi-1 completed with ${receipt.managerView.summary}`
      });
      return receipt;
    });
  const receipt2Promise = runCodexWorkerAssignment({
      store,
      registry,
      runRegistry,
      executor,
      assignmentId: "assignment-multi-2",
      runId: "run-multi-2",
      policy: {
        workspaceRoot: process.cwd(),
        allowedTools: ["read"],
        maxRuntimeMs: 120_000,
        managerVisibility: "summary_only"
      }
    }).then(async (receipt) => {
      await input.onEvent?.({
        type: "worker_completed",
        workerId: "worker-multi-2",
        assignmentId: "assignment-multi-2",
        text: `worker-multi-2 completed with ${receipt.managerView.summary}`
      });
      return receipt;
    });

  const receipts = await Promise.all([receipt1Promise, receipt2Promise]);

  await input.onEvent?.({
    type: "check_completed",
    text: `Codex connectivity check completed: ${receipts.map((receipt) => receipt.managerView.summary).join(", ")}`
  });

  return {
    receipts,
    dashboard: buildDashboardFromState({
      store,
      registry,
      memoryStore,
      now: Date.now()
    })
  };
}

export async function runInteractiveTui(): Promise<void> {
  const runtime = createOperatorRuntimeState();
  const managerRuntime = createDefaultManagerRuntime({
    mode: process.env.AUTOAIDE_MANAGER_RUNTIME === "deterministic" ? "deterministic" : "codex",
    workspaceRoot: process.cwd()
  });
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: completeSlashCommand
  });
  const state: TuiScreenState = {
    dashboard: buildOperatorDashboard(),
    compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
    messages: [
      {
        kind: "system",
        text: "AutoAide interactive TUI ready. Type a goal directly or use /help."
      }
    ],
    statusLine: "Interactive mode active",
    promptLabel: "Input:"
  };
  refreshDashboard(state, runtime);

  try {
    while (true) {
      redrawScreen(state);
      let rawValue = "";
      try {
        rawValue = await readline.question("\nautoaide> ");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ABORT_ERR") {
          restoreTerminalScreen();
          console.log("Exiting AutoAide TUI.");
          return;
        }
        throw error;
      }
      const value = rawValue.trim();
      if (!value) {
        continue;
      }
      pushMessage(state, { kind: "owner", text: value });
      if (!value.startsWith("/")) {
        await submitOwnerMessage({
          text: value,
          state,
          runtime,
          managerRuntime
        });
        continue;
      }

      const command = parseSlashCommand(value);

      switch (command.name) {
        case "/help":
          pushMessage(state, { kind: "manager", text: interactiveHelp() });
          state.statusLine = "Showing command help";
          break;
        case "/status":
          refreshDashboard(state, runtime);
          pushMessage(state, { kind: "manager", text: state.dashboard });
          state.statusLine = "Showing full status";
          break;
        case "/tasks":
          pushMessage(state, {
            kind: "manager",
            text: extractSection(state.dashboard, "Tasks", "Workers")
          });
          state.statusLine = "Showing tasks section";
          break;
        case "/workers":
          pushMessage(state, {
            kind: "manager",
            text: extractSection(state.dashboard, "Workers", "Alerts")
          });
          state.statusLine = "Showing workers section";
          break;
        case "/clear":
          state.messages = [{ kind: "system", text: "Conversation cleared." }];
          state.statusLine = "Conversation cleared";
          break;
        case "/quit":
        case "/exit":
          restoreTerminalScreen();
          return;
        default:
          pushMessage(state, { kind: "manager", text: `Unknown command: ${value}` });
          pushMessage(state, { kind: "manager", text: interactiveHelp() });
          state.statusLine = "Unknown command";
      }
    }
  } finally {
    restoreTerminalScreen();
    readline.close();
  }
}

async function main() {
  console.log(buildOperatorDashboard());
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  await main();
}
