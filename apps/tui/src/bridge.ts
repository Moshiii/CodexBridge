#!/usr/bin/env -S node --import tsx
import { createInterface } from "node:readline";
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
  executeManagerTurn,
  type ManagerConversationContext,
  type ManagerRuntime
} from "@autoaide/manager-runtime";
import { InMemoryMemoryStore, InMemoryManagerMemory } from "@autoaide/memory-system";
import { createTask, InMemoryTaskStore } from "@autoaide/task-system";
import { InMemoryWorkerRegistry, assignTaskToWorker, spawnWorker } from "@autoaide/worker-orchestrator";
import { buildOperatorSnapshot } from "./dashboard.js";
import {
  AUTOAIDE_TUI_PROTOCOL_VERSION,
  type BridgeCell,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeThreadSummary
} from "./bridge-protocol.js";
import {
  appendConversationEvent,
  listPersistedThreads,
  persistRuntimeState,
  readConversationEvents,
  resolveAutoAideStatePaths,
  restorePersistedRuntime
} from "./persistence.js";

type PendingClarification = {
  originalText: string;
  question: string;
  openedAt: number;
};

type OperatorRuntimeState = ReturnType<typeof createOperatorRuntimeStateFor>;

const LOCAL_CONVERSATION_ID = "terminal-owner-local";
const LOCAL_OWNER_ID = "owner-local";

function emit(response: BridgeResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function emitCell(cell: BridgeCell): void {
  emit({
    protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
    type: "history_cell",
    cell
  });
}

function emitActiveCell(cell?: BridgeCell): void {
  emit({
    protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
    type: "active_cell_patch",
    cell
  });
}

function createDefaultExecutor(): CodexExecutor {
  return new CommandCodexExecutorAdapter(new NodeProcessCodexCommandRunner());
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
    activeRootTaskId: existingConversation?.activeTaskId as string | undefined,
    activeTaskTitle: existingConversation?.activeTaskTitle as string | undefined
  };
}

function buildStatus(runtime: OperatorRuntimeState): BridgeResponse {
  const memory = new InMemoryManagerMemory(runtime.store, runtime.memoryStore);
  const snapshot = buildOperatorSnapshot({
    store: runtime.store,
    registry: runtime.registry,
    memory,
    now: Date.now()
  });
  return {
    protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
    type: "status_update",
    message: runtime.pendingClarification
      ? `Waiting for clarification: ${runtime.pendingClarification.question}`
      : runtime.activeTaskTitle
        ? `Active task: ${runtime.activeTaskTitle}`
        : "Manager is ready for your goal",
    manager: 1,
    tasks: snapshot.overview.totalTasks,
    workers: snapshot.overview.workerCount,
    busy: snapshot.overview.busyWorkers,
    alerts: snapshot.overview.alertCount,
    reminders: snapshot.overview.reminderCount
  };
}

function toPersistedCell(event: ReturnType<typeof readConversationEvents>[number], index: number): BridgeCell {
  const base = {
    id: `${event.conversationId}-${event.createdAt}-${index}`,
    body: event.text,
    status: "final" as const
  };
  switch (event.role) {
    case "owner":
      return { ...base, kind: "user", label: "You" };
    case "manager":
      return { ...base, kind: "assistant", label: "manager" };
    case "system":
      return { ...base, kind: "system", label: "system" };
    default:
      return { ...base, kind: "status", label: "event" };
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
  runtime.memoryStore.upsertConversation({
    id: runtime.conversationId,
    ownerId: runtime.ownerId,
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
  persistRuntimeState(runtime);
}

function buildManagerConversationContext(runtime: OperatorRuntimeState): ManagerConversationContext {
  const conversation = runtime.memoryStore.listConversations(runtime.ownerId)[0];
  const turns = runtime.memoryStore.listConversationTurns(runtime.conversationId);
  return {
    activeRootTaskId: conversation?.activeTaskId ?? runtime.activeRootTaskId,
    activeTaskTitle: conversation?.activeTaskTitle ?? runtime.activeTaskTitle,
    pendingClarificationQuestion:
      conversation?.pendingClarificationQuestion ?? runtime.pendingClarification?.question,
    recentMessages: turns.slice(-8).map((turn) => ({
      role: turn.role,
      text: turn.text
    }))
  };
}

function buildThreadSummaries(rootDir: string): BridgeThreadSummary[] {
  return listPersistedThreads(rootDir)
    .map((threadId) => {
      const events = readConversationEvents(resolveAutoAideStatePaths(threadId));
      const latestEvent = events.at(-1);
      const latestVisibleTurn = [...events]
        .reverse()
        .find((event) => event.role === "owner" || event.role === "manager" || event.role === "system");
      return {
        id: threadId,
        turnCount: events.filter((event) => event.role !== "event").length,
        updatedAt: latestEvent?.createdAt,
        preview: latestVisibleTurn?.text.trim() || "(empty)"
      };
    })
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function createThreadId(now: number): string {
  const iso = new Date(now).toISOString().replace(/[:]/g, "-");
  return `thread-${iso.replace(/\.\d{3}Z$/, "Z")}`;
}

function emitThreadList(runtime: OperatorRuntimeState): void {
  emit({
    protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
    type: "thread_list",
    currentThreadId: runtime.conversationId,
    threads: buildThreadSummaries(runtime.paths.rootDir)
  });
}

function emitSnapshot(runtime: OperatorRuntimeState): void {
  emit({
    protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
    type: "session_state",
    conversationId: runtime.conversationId
  });
  emit({
    protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
    type: "history_reset"
  });
  readConversationEvents(runtime.paths).forEach((event, index) => {
    emitCell(toPersistedCell(event, index));
  });
  emitThreadList(runtime);
  emit(buildStatus(runtime));
}

function nextCell(kind: BridgeCell["kind"], label: string, body: string, status: BridgeCell["status"] = "final"): BridgeCell {
  return {
    id: `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind,
    label,
    body,
    status
  };
}

function emitCommandResult(level: "info" | "error", message: string): void {
  emit({
    protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
    type: "command_result",
    level,
    message
  });
}

async function processPendingAssignments(runtime: OperatorRuntimeState): Promise<void> {
  const runnableAssignments = runtime.store
    .listAssignments()
    .filter((assignment) => assignment.status === "starting" && !runtime.runRegistry.getRun(`run-${assignment.id}`));

  for (const assignment of runnableAssignments) {
    const task = runtime.store.getTask(assignment.taskId);
    if (!task) {
      continue;
    }

    emitActiveCell(nextCell("command", "worker", `${assignment.workerId} started ${task.title}`, "streaming"));
    appendConversationTurn(runtime, {
      role: "event",
      text: `worker_started: ${assignment.workerId} started ${task.title}`,
      now: Date.now()
    });

    try {
      const receipt = await runCodexWorkerAssignment({
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
      emitActiveCell(undefined);
      emitCell(
        nextCell(
          "command",
          receipt.result.status === "succeeded" ? "worker_completed" : "worker_failed",
          `${assignment.workerId} ${receipt.result.status} ${task.title}: ${receipt.managerView.summary}`,
          receipt.result.status === "succeeded" ? "final" : "error"
        )
      );
      emitCell(
        nextCell(
          "assistant",
          "manager",
          receipt.result.status === "succeeded"
            ? `Completed "${task.title}": ${receipt.managerView.summary}`
            : `Failed "${task.title}": ${receipt.managerView.summary}`,
          receipt.result.status === "succeeded" ? "final" : "error"
        )
      );
      appendConversationTurn(runtime, {
        role: "event",
        text: `${receipt.result.status === "succeeded" ? "worker_completed" : "worker_failed"}: ${assignment.workerId} ${receipt.result.status} ${task.title}: ${receipt.managerView.summary}`,
        now: receipt.result.finishedAt
      });
      appendConversationTurn(runtime, {
        role: "manager",
        text:
          receipt.result.status === "succeeded"
            ? `Completed "${task.title}": ${receipt.managerView.summary}`
            : `Failed "${task.title}": ${receipt.managerView.summary}`,
        now: receipt.result.finishedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitActiveCell(undefined);
      emitCell(nextCell("warning", "worker_failed", `${assignment.workerId} failed ${task.title}: ${message}`, "error"));
      emitCell(nextCell("assistant", "manager", `Failed "${task.title}": ${message}`, "error"));
      appendConversationTurn(runtime, {
        role: "event",
        text: `worker_failed: ${assignment.workerId} failed ${task.title}: ${message}`,
        now: Date.now()
      });
      appendConversationTurn(runtime, {
        role: "manager",
        text: `Failed "${task.title}": ${message}`,
        now: Date.now()
      });
    }
    upsertConversationState(runtime, Date.now());
  }
}

async function handleSubmit(runtime: OperatorRuntimeState, managerRuntime: ManagerRuntime, text: string): Promise<void> {
  const now = Date.now();
  const managerMemory = new InMemoryManagerMemory(runtime.store, runtime.memoryStore);
  const effectiveText = runtime.pendingClarification
    ? [runtime.pendingClarification.originalText, text].join("\n")
    : text;

  emitCell(nextCell("user", "You", text));
  appendConversationTurn(runtime, {
    role: "owner",
    text,
    now
  });
  upsertConversationState(runtime, now);

  emitActiveCell(nextCell("assistant", "manager", "Manager is thinking and preparing a plan...", "streaming"));

  const result = await executeManagerTurn({
    message: {
      id: `msg-${now}`,
      ownerId: runtime.ownerId,
      channel: "web",
      peerId: "local-terminal",
      text: effectiveText,
      createdAt: now
    },
    store: runtime.store,
    runtime: managerRuntime,
    memory: managerMemory,
    conversation: buildManagerConversationContext(runtime),
    memoryStore: runtime.memoryStore,
    workerRegistry: runtime.registry,
    rootTaskId: `task-root-${now}`,
    now
  });

  for (const receipt of result.behaviorReceipts) {
    const kind =
      receipt.kind === "plan_created"
        ? "plan"
        : receipt.kind === "clarification_requested"
          ? "warning"
          : receipt.kind === "tool_calls_emitted"
            ? "tool_call"
            : "status";
    emitCell(nextCell(kind, receipt.kind, receipt.summary));
    appendConversationTurn(runtime, {
      role: "event",
      text: `${receipt.kind}: ${receipt.summary}`,
      now
    });
  }

  for (const receipt of result.actionReceipts) {
    emitCell(
      nextCell(
        "tool_call",
        receipt.toolCall,
        `[${receipt.status}] ${receipt.summary}`,
        receipt.status === "applied" ? "final" : "error"
      )
    );
    appendConversationTurn(runtime, {
      role: "event",
      text: `${receipt.toolCall}: [${receipt.status}] ${receipt.summary}`,
      now
    });
  }

  emitActiveCell(undefined);
  emitCell(nextCell("assistant", "manager", result.reply.text));
  appendConversationTurn(runtime, {
    role: "manager",
    text: result.reply.text,
    now
  });

  await processPendingAssignments(runtime);

  if (result.response.intent.needsClarification) {
    runtime.pendingClarification = {
      originalText: runtime.pendingClarification?.originalText ?? text,
      question: result.response.intent.clarificationQuestion ?? result.response.reply.text,
      openedAt: runtime.pendingClarification?.openedAt ?? now
    };
    runtime.activeRootTaskId = undefined;
    runtime.activeTaskTitle = undefined;
  } else {
    runtime.pendingClarification = undefined;
    runtime.activeRootTaskId = result.plan?.rootTask.id;
    runtime.activeTaskTitle = result.plan?.rootTask.title;
  }
  upsertConversationState(runtime, now);

  for (const followup of buildManagerFollowupReceipts({
    ownerId: runtime.ownerId,
    store: runtime.store,
    memoryStore: runtime.memoryStore,
    conversationId: runtime.conversationId
  })) {
    emitCell(nextCell("status", followup.kind, followup.summary));
    emitCell(nextCell("assistant", "manager", followup.ownerText));
    appendConversationTurn(runtime, {
      role: "event",
      text: `${followup.kind}: ${followup.summary}`,
      now
    });
    appendConversationTurn(runtime, {
      role: "manager",
      text: followup.ownerText,
      now
    });
  }
  upsertConversationState(runtime, now);
  emit(buildStatus(runtime));
  emitThreadList(runtime);
}

async function handleConnectivityCheck(): Promise<void> {
  const now = Date.now();
  const store = new InMemoryTaskStore();
  const registry = new InMemoryWorkerRegistry();
  const memoryStore = new InMemoryMemoryStore(now);
  const runRegistry = new InMemoryCodexRunRegistry();
  const executor = createDefaultExecutor();

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
  spawnWorker(registry, { workerId: "worker-multi-1", now: now + 4, strengths: ["planning"] });
  assignTaskToWorker({
    store,
    registry,
    taskId: "task-multi-1",
    workerId: "worker-multi-1",
    assignmentId: "assignment-multi-1",
    objective: "Return a success result whose summary is exactly AUTOAIDE_TEST_OK.",
    now: now + 6
  });
  const receipt = await runCodexWorkerAssignment({
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
  });
  emitCommandResult("info", `Codex connectivity check completed: ${receipt.managerView.summary}`);
  const memory = new InMemoryManagerMemory(store, memoryStore);
  const snapshot = buildOperatorSnapshot({ store, registry, memory, now: Date.now() });
  emit({
    protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
    type: "status_update",
    message: `Connectivity check completed: ${receipt.managerView.summary}`,
    manager: 1,
    tasks: snapshot.overview.totalTasks,
    workers: snapshot.overview.workerCount,
    busy: snapshot.overview.busyWorkers,
    alerts: snapshot.overview.alertCount,
    reminders: snapshot.overview.reminderCount
  });
}

async function runBridge(): Promise<void> {
  let runtime = createOperatorRuntimeStateFor(LOCAL_CONVERSATION_ID);
  const managerRuntime = createDefaultManagerRuntime({
    mode: process.env.AUTOAIDE_MANAGER_RUNTIME === "deterministic" ? "deterministic" : "codex",
    workspaceRoot: process.cwd()
  });

  const reader = createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let message: BridgeRequest;
    try {
      message = JSON.parse(trimmed) as BridgeRequest;
    } catch {
      emitCommandResult("error", "Received invalid JSON from Rust TUI");
      continue;
    }

    if (message.protocolVersion !== AUTOAIDE_TUI_PROTOCOL_VERSION) {
      emitCommandResult("error", "Protocol version mismatch");
      continue;
    }

    try {
      switch (message.type) {
        case "ready":
          emitSnapshot(runtime);
          break;
        case "submit_input":
          if (message.text.trim() === "/codex-check") {
            await handleConnectivityCheck();
            break;
          }
          await handleSubmit(runtime, managerRuntime, message.text);
          break;
        case "request_threads":
          emitThreadList(runtime);
          break;
        case "resume_thread":
          runtime = createOperatorRuntimeStateFor(message.threadId);
          emitSnapshot(runtime);
          emitCommandResult("info", `Resumed thread ${message.threadId}`);
          break;
        case "new_thread": {
          const threadId = message.threadId?.trim() || createThreadId(Date.now());
          runtime = createOperatorRuntimeStateFor(threadId);
          emitSnapshot(runtime);
          emitCommandResult("info", `Created thread ${threadId}`);
          break;
        }
        case "shutdown":
          emit({
            protocolVersion: AUTOAIDE_TUI_PROTOCOL_VERSION,
            type: "shutdown_ack"
          });
          return;
      }
    } catch (error) {
      emitCommandResult("error", error instanceof Error ? error.message : String(error));
      emitActiveCell(undefined);
      emit(buildStatus(runtime));
    }
  }
}

void runBridge();
