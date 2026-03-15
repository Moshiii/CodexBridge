import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import {
  CommandCodexExecutorAdapter,
  InMemoryCodexRunRegistry,
  NodeProcessCodexCommandRunner,
  runCodexWorkerAssignment,
  type CodexExecutor
} from "@autoaide/executor-codex";
import {
  buildManagerFollowupReceipts,
  createDefaultManagerRuntime,
  DeterministicManagerRuntime,
  executeManagerTurn,
  type ManagerConversationContext,
  type ManagerRuntime
} from "@autoaide/manager-runtime";
import { InMemoryMemoryStore, InMemoryManagerMemory } from "@autoaide/memory-system";
import { createTask, createWorkstream, InMemoryTaskStore, type Task, type WorkstreamStatus } from "@autoaide/task-system";
import { InMemoryWorkerRegistry, assignTaskToWorker, spawnWorker } from "@autoaide/worker-orchestrator";
import {
  appendConversationEvent,
  listPersistedThreads,
  persistRuntimeState,
  readConversationEvents,
  resolveAutoAideStatePaths,
  restorePersistedRuntime
} from "./persistence.js";
import { buildOperatorSnapshot, renderOperatorDashboard } from "./dashboard.js";
import {
  buildInputLines,
  deleteInputBackward,
  deleteInputWordBackward,
  insertInputText,
  moveInputCursor,
} from "./tui/composer.js";
import {
  buildEventCell,
  formatConversationCell,
  type TuiAgentCell,
  type TuiCell,
  type TuiStepType,
  type ManagerThreadItemType
} from "./tui/cells.js";
import { completeEditorInput, extractSection } from "./tui/editor-actions.js";
import { InputHistory } from "./tui/input-history.js";
import { bindComposerEvents } from "./tui/controller.js";
import { bindGlobalTuiKeys, bindTranscriptEvents } from "./tui/interactive-session.js";
import { buildMessagesFromConversationEventsFor, pushMessage } from "./tui/messages.js";
import {
  jumpTranscriptToTail,
  renderInteractiveScreen,
  scrollTranscriptBy,
  shouldUseAlternateScreen,
  type TuiScreenState
} from "./tui/screen.js";
import {
  completeSlashCommand,
  getSlashCommands,
  parseSlashCommand
} from "./tui/slash-commands.js";
import { createBlessedTuiView } from "./tui/blessed-ui.js";

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
export type { TuiStepType, ManagerThreadItemType, TuiCell as TuiMessage, TuiScreenState };
export { formatConversationCell as formatConversationMessage, renderInteractiveScreen, scrollTranscriptBy };
export { runManagerExec } from "./exec.js";
export type { AutoAideExecEvent, AutoAideExecEventHandler, AutoAideExecItem } from "./exec.js";
export {
  buildTranscriptPagerMessage,
  completeSlashCommand,
  getSlashCommands,
  parseSlashCommand
} from "./tui/slash-commands.js";
export type { ParsedSlashCommand, SlashCommandDefinition } from "./tui/slash-commands.js";

export type TuiEvent =
  | { type: "manager_thinking"; text: string }
  | { type: "manager_reply"; text: string }
  | { type: "manager_behavior"; label: string; text: string }
  | { type: "manager_action"; label: string; status: "applied" | "skipped"; text: string }
  | { type: "worker_started"; workerId: string; taskTitle: string }
  | { type: "worker_completed"; workerId: string; taskTitle: string; summary: string }
  | { type: "worker_failed"; workerId: string; taskTitle: string; summary: string }
  | { type: "followup"; label: string; summary: string; ownerText: string }
  | { type: "status"; text: string };

export type TuiEventHandler = (event: TuiEvent, state: TuiScreenState) => void | Promise<void>;

export type OperatorRuntimeState = ReturnType<typeof createOperatorRuntimeState>;

type PendingClarification = {
  originalText: string;
  question: string;
  openedAt: number;
};

const LOCAL_CONVERSATION_ID = "terminal-owner-local";
const LOCAL_OWNER_ID = "owner-local";

class RenderScheduler {
  private pending = false;

  request(state: TuiScreenState): void {
    if (this.pending) {
      return;
    }
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      redrawScreen(state);
    });
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function truncateVisible(value: string, width: number): string {
  const plain = stripAnsi(value);
  return plain.length <= width ? value : `${plain.slice(0, Math.max(0, width - 1))}…`;
}

function redrawScreen(state: TuiScreenState): void {
  if (shouldUseAlternateScreen()) {
    process.stdout.write("\u001b[?1049h");
  }
  process.stdout.write("\u001b[2J\u001b[H");
  process.stdout.write(
    `${renderInteractiveScreen(state, {
      width: process.stdout.columns,
      height: process.stdout.rows
    })}\n`
  );
}

function restoreTerminalScreen(): void {
  if (shouldUseAlternateScreen()) {
    process.stdout.write("\u001b[?1049l");
  }
}

function createDefaultExecutor(): CodexExecutor {
  return new CommandCodexExecutorAdapter(new NodeProcessCodexCommandRunner());
}

function buildMessagesFromConversationEvents(): TuiCell[] {
  return buildMessagesFromConversationEventsFor(LOCAL_CONVERSATION_ID);
}

function formatThreadTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

type ThreadSummary = {
  id: string;
  turnCount: number;
  updatedAt?: number;
  preview: string;
};

function buildThreadSummaries(rootDir: string): ThreadSummary[] {
  return listPersistedThreads(rootDir)
    .map((threadId) => {
      const events = readConversationEvents(resolveAutoAideStatePaths(threadId));
      const latestEvent = events.at(-1);
      const latestVisibleTurn = [...events]
        .reverse()
        .find((event) => event.role === "owner" || event.role === "manager" || event.role === "system");
      const preview = latestVisibleTurn?.text.trim() || "(empty)";
      return {
        id: threadId,
        turnCount: events.filter((event) => event.role !== "event").length,
        updatedAt: latestEvent?.createdAt,
        preview
      };
    })
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
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
  return createOperatorRuntimeStateFor(LOCAL_CONVERSATION_ID, now);
}

function createOperatorRuntimeStateFor(conversationId: string, now = Date.now()) {
  const restored = restorePersistedRuntime({
    now,
    conversationId
  });
  const existingConversation = restored.memoryStore
    .listConversations(LOCAL_OWNER_ID)
    .find((conversation) => conversation.id === conversationId);
  return {
    now,
    paths: restored.paths,
    conversationId,
    ownerId: LOCAL_OWNER_ID,
    store: restored.store,
    registry: restored.registry,
    memoryStore: restored.memoryStore,
    runRegistry: new InMemoryCodexRunRegistry(),
    executor: createDefaultExecutor(),
    pendingClarification: existingConversation?.pendingClarificationQuestion
      ? ({
          originalText: existingConversation.activeTaskTitle ?? "",
          question: existingConversation.pendingClarificationQuestion,
          openedAt: existingConversation.updatedAt
        } as PendingClarification)
      : undefined,
    activeWorkstreamId: existingConversation?.activeWorkstreamId as string | undefined,
    activeWorkstreamTitle: existingConversation?.activeWorkstreamTitle as string | undefined,
    activeRootTaskId: existingConversation?.activeTaskId as string | undefined,
    activeTaskTitle: existingConversation?.activeTaskTitle as string | undefined
  };
}

function mapTaskStatusToWorkstreamStatus(task?: Task, waitingForOwner = false): WorkstreamStatus {
  if (waitingForOwner) {
    return "waiting_owner";
  }
  switch (task?.status) {
    case "blocked":
      return "blocked";
    case "reviewing":
      return "reviewing";
    case "done":
      return "done";
    case "cancelled":
      return "archived";
    default:
      return "active";
  }
}

function syncActiveWorkstream(
  runtime: OperatorRuntimeState,
  now: number,
  input: { goal?: string } = {}
): void {
  if (!runtime.activeRootTaskId || !runtime.activeTaskTitle) {
    runtime.activeWorkstreamId = undefined;
    runtime.activeWorkstreamTitle = undefined;
    return;
  }

  const task = runtime.store.getTask(runtime.activeRootTaskId);
  const existing =
    (runtime.activeWorkstreamId ? runtime.store.getWorkstream(runtime.activeWorkstreamId) : undefined) ??
    runtime.store.listWorkstreams({ rootTaskId: runtime.activeRootTaskId })[0];
  const workstreamId = existing?.id ?? `workstream-${runtime.activeRootTaskId}`;
  const goal = task?.goal ?? input.goal ?? runtime.activeTaskTitle;

  runtime.store.upsertWorkstream({
    ...(existing ??
      createWorkstream({
        id: workstreamId,
        ownerId: runtime.ownerId,
        rootTaskId: runtime.activeRootTaskId,
        title: runtime.activeTaskTitle,
        goal,
        activeTaskId: task?.id ?? runtime.activeRootTaskId,
        activeWorkerId: task?.workerId,
        now
      })),
    ownerId: runtime.ownerId,
    rootTaskId: runtime.activeRootTaskId,
    title: runtime.activeTaskTitle,
    goal,
    status: mapTaskStatusToWorkstreamStatus(task, Boolean(runtime.pendingClarification)),
    priority: task?.priority ?? existing?.priority ?? "medium",
    activeTaskId: task?.id ?? runtime.activeRootTaskId,
    activeWorkerId: task?.workerId,
    nextFollowupAt: task?.nextFollowupAt ?? existing?.nextFollowupAt,
    updatedAt: now
  });

  runtime.activeWorkstreamId = workstreamId;
  runtime.activeWorkstreamTitle = runtime.activeTaskTitle;
}

export function buildOperatorDashboard(): string {
  const runtime = createOperatorRuntimeState();
  return buildDashboardFromState(runtime);
}

export function buildThreadListMessage(runtime: OperatorRuntimeState): string {
  const threads = buildThreadSummaries(runtime.paths.rootDir);
  if (threads.length === 0) {
    return "Saved threads:\n  (none yet)";
  }

  return [
    "Saved threads:",
    ...threads.map((thread) => {
      const marker = thread.id === runtime.conversationId ? "*" : " ";
      const suffix = thread.updatedAt
        ? `  turns ${thread.turnCount}  updated ${formatThreadTimestamp(thread.updatedAt)}`
        : `  turns ${thread.turnCount}`;
      return `${marker} ${thread.id}${suffix}\n    ${truncateVisible(thread.preview, 96)}`;
    })
  ].join("\n");
}

function createThreadId(now: number): string {
  const iso = new Date(now).toISOString().replace(/[:]/g, "-");
  return `thread-${iso.replace(/\.\d{3}Z$/, "Z")}`;
}

export function switchRuntimeThread(
  state: TuiScreenState,
  runtime: OperatorRuntimeState,
  conversationId: string,
  now = Date.now()
): void {
  const restored = createOperatorRuntimeStateFor(conversationId, now);
  runtime.now = restored.now;
  runtime.paths = restored.paths;
  runtime.conversationId = restored.conversationId;
  runtime.ownerId = restored.ownerId;
  runtime.store = restored.store;
  runtime.registry = restored.registry;
  runtime.memoryStore = restored.memoryStore;
  runtime.runRegistry = new InMemoryCodexRunRegistry();
  runtime.pendingClarification = restored.pendingClarification;
  runtime.activeWorkstreamId = restored.activeWorkstreamId;
  runtime.activeWorkstreamTitle = restored.activeWorkstreamTitle;
  runtime.activeRootTaskId = restored.activeRootTaskId;
  runtime.activeTaskTitle = restored.activeTaskTitle;

  const threadMessages = buildMessagesFromConversationEventsFor(conversationId);
  state.messages =
    threadMessages.length > 0
      ? [{ kind: "system", text: `Switched to thread ${conversationId}` }, ...threadMessages]
      : [{ kind: "system", text: `Switched to empty thread ${conversationId}` }];
  jumpTranscriptToTail(state);
  refreshDashboard(state, runtime, now);
  state.statusLine = `Viewing thread ${conversationId}`;
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
  state.threadHeader = buildThreadHeader(runtime, now);
}

function buildThreadHeader(runtime: OperatorRuntimeState, now: number): string {
  const activeTask = runtime.activeTaskTitle ? `task ${runtime.activeTaskTitle}` : "task idle";
  const workers = runtime.registry.listWorkers();
  const busyWorkers = workers.filter((worker) => worker.status === "busy").length;
  return [
    `thread ${runtime.conversationId}`,
    activeTask,
    `workers ${workers.length}`,
    `busy ${busyWorkers}`,
    `at ${new Date(now).toLocaleTimeString("en-US", { hour12: false })}`
  ].join("  ·  ");
}

function buildStreamingCell(
  label: string,
  text: string,
  status: "pending" | "streaming" | "final" | "error"
): TuiCell {
  return buildEventCell(label, text, status);
}

async function emitTuiEvent(
  state: TuiScreenState,
  event: TuiEvent,
  onEvent?: TuiEventHandler
): Promise<void> {
  switch (event.type) {
    case "manager_thinking":
      state.statusLine = event.text;
      state.activeCell = buildStreamingCell("manager_thinking", event.text, "streaming");
      break;
    case "manager_reply":
      state.activeCell = undefined;
      pushMessage(state, { kind: "manager", text: event.text });
      break;
    case "manager_behavior":
      state.activeCell = buildStreamingCell(event.label, event.text, "streaming");
      pushMessage(state, buildStreamingCell(event.label, event.text, "final"));
      state.activeCell = undefined;
      break;
    case "manager_action":
      pushMessage(
        state,
        buildStreamingCell(event.label, `[${event.status}] ${event.text}`, event.status === "applied" ? "final" : "error")
      );
      break;
    case "worker_started":
      state.activeCell = buildStreamingCell(
        "worker_started",
        `${event.workerId} started ${event.taskTitle}`,
        "streaming"
      );
      break;
    case "worker_completed":
      state.activeCell = undefined;
      pushMessage(
        state,
        buildStreamingCell("worker_completed", `${event.workerId} succeeded ${event.taskTitle}: ${event.summary}`, "final")
      );
      break;
    case "worker_failed":
      state.activeCell = undefined;
      pushMessage(
        state,
        buildStreamingCell("worker_failed", `${event.workerId} failed ${event.taskTitle}: ${event.summary}`, "error")
      );
      break;
    case "followup":
      state.activeCell = undefined;
      pushMessage(state, buildEventCell(event.label, event.summary));
      pushMessage(state, { kind: "manager", text: event.ownerText });
      break;
    case "status":
      state.statusLine = event.text;
      break;
  }

  await onEvent?.(event, state);
}

function appendConversationTurn(
  runtime: OperatorRuntimeState,
  input: {
    role: "owner" | "manager" | "system" | "event";
    text: string;
    now: number;
  }
): void {
  runtime.memoryStore.appendConversationTurn({
    id: `turn-${input.now}-${runtime.memoryStore.listConversationTurns(runtime.conversationId).length + 1}`,
    conversationId: runtime.conversationId,
    ownerId: runtime.ownerId,
    role: input.role,
    text: input.text,
    createdAt: input.now
  });
  appendConversationEvent(runtime.paths, {
    schemaVersion: 1,
    kind: "conversation_turn",
    conversationId: runtime.conversationId,
    ownerId: runtime.ownerId,
    role: input.role,
    text: input.text,
    createdAt: input.now
  });
  persistRuntimeState(runtime);
}

function upsertConversationState(runtime: OperatorRuntimeState, now: number): void {
  const existing = runtime.memoryStore.listConversations(runtime.ownerId)[0];
  const turns = runtime.memoryStore.listConversationTurns(runtime.conversationId);
  syncActiveWorkstream(runtime, now);
  runtime.memoryStore.upsertConversation({
    id: runtime.conversationId,
    ownerId: runtime.ownerId,
    channel: "web",
    peerId: "local-terminal",
    activeWorkstreamId: runtime.activeWorkstreamId,
    activeWorkstreamTitle: runtime.activeWorkstreamTitle,
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
  persistRuntimeState(runtime);
}

async function processPendingAssignments(
  state: TuiScreenState,
  runtime: OperatorRuntimeState,
  onEvent?: TuiEventHandler
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

    await emitTuiEvent(
      state,
      {
        type: "worker_started",
        workerId: assignment.workerId,
        taskTitle: task.title
      },
      onEvent
    );
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
      await emitTuiEvent(
        state,
        {
          type: "worker_failed",
          workerId: assignment.workerId,
          taskTitle: task.title,
          summary: errorText
        },
        onEvent
      );
      await emitTuiEvent(
        state,
        {
          type: "manager_reply",
          text: `Failed "${task.title}": ${errorText}`
        },
        onEvent
      );
      appendConversationTurn(runtime, {
        role: "event",
        text: `worker_failed: ${assignment.workerId} failed ${task.title}: ${errorText}`,
        now: Date.now()
      });
      appendConversationTurn(runtime, {
        role: "manager",
        text: `Failed "${task.title}": ${errorText}`,
        now: Date.now()
      });
      upsertConversationState(runtime, Date.now());
      continue;
    }

    await emitTuiEvent(
      state,
      receipt.result.status === "succeeded"
        ? {
            type: "worker_completed",
            workerId: assignment.workerId,
            taskTitle: task.title,
            summary: receipt.managerView.summary
          }
        : {
            type: "worker_failed",
            workerId: assignment.workerId,
            taskTitle: task.title,
            summary: receipt.managerView.summary
          },
      onEvent
    );
    appendConversationTurn(runtime, {
      role: "event",
      text: `${receipt.result.status === "succeeded" ? "worker_completed" : "worker_failed"}: ${assignment.workerId} ${receipt.result.status} ${task.title}: ${receipt.managerView.summary}`,
      now: receipt.result.finishedAt
    });
    await emitTuiEvent(
      state,
      {
        type: "manager_reply",
        text:
          receipt.result.status === "succeeded"
            ? `Completed "${task.title}": ${receipt.managerView.summary}`
            : `Failed "${task.title}": ${receipt.managerView.summary}`
      },
      onEvent
    );
    appendConversationTurn(runtime, {
      role: "manager",
      text:
        receipt.result.status === "succeeded"
          ? `Completed "${task.title}": ${receipt.managerView.summary}`
          : `Failed "${task.title}": ${receipt.managerView.summary}`,
      now: receipt.result.finishedAt
    });
    upsertConversationState(runtime, receipt.result.finishedAt);
  }
}

async function emitManagerFollowups(
  state: TuiScreenState,
  runtime: OperatorRuntimeState,
  now: number,
  onEvent?: TuiEventHandler
): Promise<void> {
  const receipts = buildManagerFollowupReceipts({
    ownerId: runtime.ownerId,
    store: runtime.store,
    memoryStore: runtime.memoryStore,
    conversationId: runtime.conversationId
  });

  for (const receipt of receipts) {
    await emitTuiEvent(
      state,
      {
        type: "followup",
        label: receipt.kind,
        summary: receipt.summary,
        ownerText: receipt.ownerText
      },
      onEvent
    );
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

function shouldUseAutomaticManagerFollowup(runtime?: ManagerRuntime): boolean {
  return !runtime || !(runtime instanceof DeterministicManagerRuntime);
}

function findAutomaticFollowupTask(runtime: OperatorRuntimeState, now: number): Task | undefined {
  const activeTaskId =
    runtime.memoryStore.listConversations(runtime.ownerId)[0]?.activeTaskId ?? runtime.activeRootTaskId;
  const activeTask = activeTaskId ? runtime.store.getTask(activeTaskId) : undefined;
  if (
    activeTask &&
    (activeTask.status === "reviewing" ||
      activeTask.status === "blocked" ||
      (typeof activeTask.nextFollowupAt === "number" && activeTask.nextFollowupAt <= now))
  ) {
    return activeTask;
  }

  return runtime.store
    .listTasks()
    .find(
      (task) =>
        task.status === "reviewing" ||
        task.status === "blocked" ||
        (typeof task.nextFollowupAt === "number" && task.nextFollowupAt <= now)
    );
}

function buildAutomaticFollowupPrompt(task: Task, now: number): string {
  if (task.status === "reviewing") {
    return [
      `Review the active task "${task.title}" and decide the next manager action.`,
      `Task ID: ${task.id}`,
      "If the worker result is sufficient, use mark_task_done.",
      "If more execution is needed, use assign_worker, replace_worker, nudge_worker, replan_task, or ask_owner."
    ].join("\n");
  }

  if (task.status === "blocked") {
    return [
      `Follow up on the blocked task "${task.title}" and decide the next manager action.`,
      `Task ID: ${task.id}`,
      `Current blockers: ${(task.blockers ?? []).join("; ") || "unknown"}`,
      "Use replace_worker, replan_task, ask_owner, or nudge_worker when appropriate."
    ].join("\n");
  }

  return [
    `Follow up on the active task "${task.title}" and decide the next manager action.`,
    `Task ID: ${task.id}`,
    `Current status: ${task.status}`,
    `Current time: ${now}`,
    "Decide whether to wait, nudge_worker, replace_worker, replan_task, ask_owner, or mark_task_done."
  ].join("\n");
}

async function maybeRunAutomaticManagerFollowup(input: {
  state: TuiScreenState;
  runtime: OperatorRuntimeState;
  managerRuntime?: ManagerRuntime;
  now: number;
  onEvent?: TuiEventHandler;
}): Promise<boolean> {
  if (!shouldUseAutomaticManagerFollowup(input.managerRuntime)) {
    return false;
  }

  const task = findAutomaticFollowupTask(input.runtime, input.now);
  if (!task) {
    return false;
  }

  const followupNow = input.now + 1;
  await emitTuiEvent(
    input.state,
    {
      type: "manager_thinking",
      text: `Manager is reviewing ${task.title} and deciding the next step...`
    },
    input.onEvent
  );

  const result = await executeManagerTurn({
    message: {
      id: `followup-${followupNow}`,
      ownerId: input.runtime.ownerId,
      channel: "web",
      peerId: "local-terminal",
      text: buildAutomaticFollowupPrompt(task, followupNow),
      createdAt: followupNow
    },
    store: input.runtime.store,
    runtime: input.managerRuntime,
    memory: new InMemoryManagerMemory(input.runtime.store, input.runtime.memoryStore),
    conversation: buildManagerConversationContext(input.state, input.runtime),
    memoryStore: input.runtime.memoryStore,
    workerRegistry: input.runtime.registry,
    rootTaskId: input.runtime.activeRootTaskId ?? task.id,
    now: followupNow
  });

  for (const receipt of result.behaviorReceipts) {
    await emitTuiEvent(
      input.state,
      {
        type: "manager_behavior",
        label: receipt.kind,
        text: receipt.summary
      },
      input.onEvent
    );
    appendConversationTurn(input.runtime, {
      role: "event",
      text: `${receipt.kind}: ${receipt.summary}`,
      now: followupNow
    });
  }

  for (const receipt of result.actionReceipts) {
    await emitTuiEvent(
      input.state,
      {
        type: "manager_action",
        label: receipt.toolCall,
        status: receipt.status,
        text: receipt.summary
      },
      input.onEvent
    );
    appendConversationTurn(input.runtime, {
      role: "event",
      text: `${receipt.toolCall}: [${receipt.status}] ${receipt.summary}`,
      now: followupNow
    });
  }

  await emitTuiEvent(input.state, { type: "manager_reply", text: result.reply.text }, input.onEvent);
  appendConversationTurn(input.runtime, {
    role: "manager",
    text: result.reply.text,
    now: followupNow
  });

  await processPendingAssignments(input.state, input.runtime, input.onEvent);

  if (result.response.intent.needsClarification) {
    input.runtime.pendingClarification = {
      originalText: input.runtime.pendingClarification?.originalText ?? task.title,
      question: result.response.intent.clarificationQuestion ?? result.response.reply.text,
      openedAt: input.runtime.pendingClarification?.openedAt ?? followupNow
    };
  } else if (result.plan?.rootTask) {
    input.runtime.activeWorkstreamId = `workstream-${result.plan.rootTask.id}`;
    input.runtime.activeWorkstreamTitle = result.plan.rootTask.title;
    input.runtime.activeRootTaskId = result.plan.rootTask.id;
    input.runtime.activeTaskTitle = result.plan.rootTask.title;
    syncActiveWorkstream(input.runtime, followupNow, { goal: result.plan.rootTask.goal });
  } else {
    const latestTask = input.runtime.store.getTask(task.id);
    if (latestTask?.status === "done" || latestTask?.status === "cancelled") {
      input.runtime.activeWorkstreamId = undefined;
      input.runtime.activeWorkstreamTitle = undefined;
      input.runtime.activeRootTaskId = undefined;
      input.runtime.activeTaskTitle = undefined;
    }
  }

  upsertConversationState(input.runtime, followupNow);
  return true;
}

function buildManagerConversationContext(
  state: TuiScreenState,
  runtime: OperatorRuntimeState
): ManagerConversationContext {
  const conversation = runtime.memoryStore.listConversations(runtime.ownerId)[0];
  const turns = runtime.memoryStore.listConversationTurns(runtime.conversationId);

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
	        : state.messages.slice(-8).map((message) => normalizeConversationMessageForContext(message))
	  };
}

function normalizeConversationMessageForContext(message: TuiCell): { role: "owner" | "manager" | "system" | "event"; text: string } {
  switch (message.kind) {
    case "owner":
      return { role: "owner", text: message.text };
    case "agent":
    case "manager":
      return { role: "manager", text: message.text };
    case "system":
      return { role: "system", text: message.text };
    default:
      return {
        role: "event",
        text: `${message.title}: ${message.text ?? ""}`.trim()
      };
  }
}

export async function submitOwnerMessage(input: {
  text: string;
  state: TuiScreenState;
  runtime: OperatorRuntimeState;
  managerRuntime?: ManagerRuntime;
  ownerId?: string;
  peerId?: string;
  now?: number;
  onEvent?: TuiEventHandler;
}): Promise<void> {
  const now = input.now ?? Date.now();
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

  await emitTuiEvent(
    input.state,
    {
      type: "manager_thinking",
      text: "Manager is thinking and preparing a plan..."
    },
    input.onEvent
  );

  const result = await executeManagerTurn({
    message: {
      id: `msg-${now}`,
      ownerId: input.ownerId ?? input.runtime.ownerId,
      channel: "web",
      peerId: input.peerId ?? "local-terminal",
      text: effectiveText,
      createdAt: now
    },
    store: input.runtime.store,
    runtime: input.managerRuntime,
    memory: managerMemory,
    conversation: buildManagerConversationContext(input.state, input.runtime),
    memoryStore: input.runtime.memoryStore,
    workerRegistry: input.runtime.registry,
    rootTaskId: `task-root-${now}`,
    now
  });

  for (const receipt of result.behaviorReceipts) {
    await emitTuiEvent(
      input.state,
      {
        type: "manager_behavior",
        label: receipt.kind,
        text: receipt.summary
      },
      input.onEvent
    );
    appendConversationTurn(input.runtime, {
      role: "event",
      text: `${receipt.kind}: ${receipt.summary}`,
      now
    });
  }

  for (const receipt of result.actionReceipts) {
    await emitTuiEvent(
      input.state,
      {
        type: "manager_action",
        label: receipt.toolCall,
        status: receipt.status,
        text: receipt.summary
      },
      input.onEvent
    );
    appendConversationTurn(input.runtime, {
      role: "event",
      text: `${receipt.toolCall}: [${receipt.status}] ${receipt.summary}`,
      now
    });
  }

  await emitTuiEvent(input.state, { type: "manager_reply", text: result.reply.text }, input.onEvent);
  appendConversationTurn(input.runtime, {
    role: "manager",
    text: result.reply.text,
    now
  });

  await processPendingAssignments(input.state, input.runtime, input.onEvent);

  if (result.response.intent.needsClarification) {
    input.runtime.pendingClarification = {
      originalText: input.runtime.pendingClarification?.originalText ?? input.text,
      question:
        result.response.intent.clarificationQuestion ?? result.response.reply.text,
      openedAt: input.runtime.pendingClarification?.openedAt ?? now
    };
    input.runtime.activeWorkstreamId = undefined;
    input.runtime.activeWorkstreamTitle = undefined;
    input.runtime.activeRootTaskId = undefined;
    input.runtime.activeTaskTitle = undefined;
  } else {
    input.runtime.pendingClarification = undefined;
    input.runtime.activeWorkstreamId = result.plan?.rootTask.id
      ? `workstream-${result.plan.rootTask.id}`
      : input.runtime.activeWorkstreamId;
    input.runtime.activeWorkstreamTitle = result.plan?.rootTask.title;
    input.runtime.activeRootTaskId = result.plan?.rootTask.id;
    input.runtime.activeTaskTitle = result.plan?.rootTask.title;
    if (result.plan?.rootTask) {
      syncActiveWorkstream(input.runtime, now, { goal: result.plan.rootTask.goal });
    }
  }
  upsertConversationState(input.runtime, now);
  const ranAutomaticFollowup = await maybeRunAutomaticManagerFollowup({
    state: input.state,
    runtime: input.runtime,
    managerRuntime: input.managerRuntime,
    now,
    onEvent: input.onEvent
  });
  if (!ranAutomaticFollowup) {
    await emitManagerFollowups(input.state, input.runtime, now, input.onEvent);
  }
  upsertConversationState(input.runtime, now);

  refreshDashboard(input.state, input.runtime, now);
  await emitTuiEvent(
    input.state,
    {
      type: "status",
      text: result.plan
        ? `Planned ${1 + result.plan.tasks.length} task(s) for ${result.intent.title}`
        : `Waiting for clarification: ${result.response.intent.clarificationQuestion ?? result.response.reply.text}`
    },
    input.onEvent
  );
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
  const restoredMessages = buildMessagesFromConversationEventsFor(LOCAL_CONVERSATION_ID);
  const state: TuiScreenState = {
    dashboard: buildOperatorDashboard(),
    compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
    messages:
      restoredMessages.length > 0
        ? [
            {
              kind: "system",
              text: `Restored conversation from ${runtime.paths.conversationFile}`
            },
            ...restoredMessages
          ]
        : [
            {
              kind: "system",
              text: `Talk to the manager directly. Start with a real goal. Session log: ${runtime.paths.conversationFile}`
            }
          ],
    statusLine: "Manager is ready for your first goal",
    promptLabel: "Goal:",
    scrollOffset: 0,
    followTail: true,
    inputBuffer: "",
    inputCursor: 0,
    pendingTurn: false,
    footerMode: "default"
  };
  refreshDashboard(state, runtime);

  const view = createBlessedTuiView(state);
  const { screen, transcript, input } = view;

  let pendingSubmission: Promise<void> | undefined;
  const inputHistory = new InputHistory();
  let resolveExit: (() => void) | undefined;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const syncInputValue = () => {
    view.setInputValue(state.inputBuffer ?? "");
    view.render();
  };

  const requestRedraw = () => {
    view.render();
  };

  const exitTui = async () => {
    await pendingSubmission;
    view.destroy();
    resolveExit?.();
  };

  bindComposerEvents({
    input,
    view,
    state,
    runtime,
    managerRuntime,
    inputHistory,
    requestRedraw,
    syncInputValue,
    exitTui,
    pushMessage: (message) => pushMessage(state, message),
    completeEditorInput: () => completeEditorInput(state),
    buildThreadListMessage: () => buildThreadListMessage(runtime),
    switchRuntimeThread: (threadId) => switchRuntimeThread(state, runtime, threadId),
    createThreadId: () => createThreadId(Date.now()),
    refreshDashboard: () => refreshDashboard(state, runtime),
    extractSection: (heading, nextHeading) => extractSection(state.dashboard, heading, nextHeading),
    setPendingSubmission: (promise) => {
      pendingSubmission = promise;
    },
    submitOwnerMessage: (input) =>
      submitOwnerMessage({
        text: input.text,
        state: input.state,
        runtime: runtime,
        managerRuntime: input.managerRuntime,
        onEvent: input.onEvent as TuiEventHandler | undefined
      })
  });

  bindGlobalTuiKeys({
    screen,
    state,
    view,
    requestRedraw,
    exitTui
  });
  screen.on("resize", () => {
    requestRedraw();
  });
  bindTranscriptEvents({
    transcript,
    state,
    view,
    requestRedraw
  });

  requestRedraw();
  view.focusInput();
  view.startInput();
  await exitPromise;
}

async function main() {
  if (process.stdout.isTTY && process.stdin.isTTY) {
    await runInteractiveTui();
    return;
  }
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
