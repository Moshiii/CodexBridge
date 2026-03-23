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
import { createWorkstream, type Task, type WorkstreamStatus } from "@autoaide/task-system";
import { InMemoryWorkerRegistry, detectStalledAssignments } from "@autoaide/worker-orchestrator";
import {
  appendConversationEvent,
  persistRuntimeState,
  restorePersistedRuntime
} from "./persistence.js";
import { resolveWorkstreamStatusQuery } from "./workstream-status.js";
import { startPeriodicScheduler, type PeriodicSchedulerHandle } from "./scheduler.js";

type PendingClarification = {
  originalText: string;
  question: string;
  openedAt: number;
};

export type AutoAideExecItem =
  | {
      id: string;
      type: "reasoning";
      text: string;
      status: "in_progress" | "completed";
    }
  | {
      id: string;
      type: "plan";
      text: string;
      status: "completed";
    }
  | {
      id: string;
      type: "tool_call";
      label: string;
      text: string;
      status: "completed" | "failed";
    }
  | {
      id: string;
      type: "subagent_run";
      label: string;
      text: string;
      status: "in_progress" | "completed" | "failed";
    }
  | {
      id: string;
      type: "assistant_message";
      text: string;
      status: "completed";
    }
  | {
      id: string;
      type: "warning";
      text: string;
      status: "completed" | "failed";
    }
  | {
      id: string;
      type: "status";
      text: string;
      status: "completed";
    };

export type AutoAideExecEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "turn.started"; text: string }
  | { type: "item.started"; item: AutoAideExecItem }
  | { type: "item.completed"; item: AutoAideExecItem }
  | { type: "turn.completed"; text: string; threadId: string }
  | { type: "turn.failed"; error: string; threadId: string };

export type AutoAideExecEventHandler = (event: AutoAideExecEvent) => void | Promise<void>;

export type OperatorExecRuntimeState = ReturnType<typeof createOperatorExecRuntimeStateFor>;

const LOCAL_CONVERSATION_ID = "terminal-owner-local";
const LOCAL_OWNER_ID = "owner-local";

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createDefaultExecutor(): CodexExecutor {
  return new CommandCodexExecutorAdapter(new NodeProcessCodexCommandRunner());
}

function createOperatorExecRuntimeStateFor(conversationId: string, now = Date.now()) {
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
    sessionId: `manager-session-${conversationId}`,
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
  runtime: OperatorExecRuntimeState,
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

function syncManagerSession(runtime: OperatorExecRuntimeState, now: number, lastWakeReason?: import("@autoaide/memory-system").ManagerWakeReason): void {
  const sessionId = runtime.sessionId ?? `manager-session-${runtime.conversationId}`;
  runtime.sessionId = sessionId;
  const existing = runtime.memoryStore.listManagerSessions(runtime.ownerId).find((session) => session.id === sessionId);
  const pendingInboxCount = runtime.memoryStore
    .listManagerInboxEvents(sessionId)
    .filter((event) => event.status === "pending").length;

  runtime.memoryStore.upsertManagerSession({
    id: sessionId,
    ownerId: runtime.ownerId,
    activeWorkstreamId: runtime.activeWorkstreamId,
    lastWakeReason: lastWakeReason ?? existing?.lastWakeReason,
    lastWakeAt: lastWakeReason ? now : existing?.lastWakeAt,
    pendingInboxCount,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
}

function appendManagerInboxEvent(
  runtime: OperatorExecRuntimeState,
  input: {
    reason: import("@autoaide/memory-system").ManagerWakeReason;
    summary: string;
    now: number;
    workstreamId?: string;
    status?: "pending" | "processed";
    metadata?: Record<string, unknown>;
  }
): void {
  const sessionId = runtime.sessionId ?? `manager-session-${runtime.conversationId}`;
  runtime.sessionId = sessionId;
  runtime.memoryStore.appendManagerInboxEvent({
    id: `inbox-${input.now}-${runtime.memoryStore.listManagerInboxEvents(sessionId).length + 1}`,
    sessionId,
    ownerId: runtime.ownerId,
    workstreamId: input.workstreamId ?? runtime.activeWorkstreamId,
    reason: input.reason,
    status: input.status ?? "pending",
    summary: input.summary,
    createdAt: input.now,
    processedAt: input.status === "processed" ? input.now : undefined,
    metadata: input.metadata
  });
  syncManagerSession(runtime, input.now, input.reason);
}

function markManagerInboxEventsProcessed(
  runtime: OperatorExecRuntimeState,
  input: {
    now: number;
    ids?: string[];
    predicate?: (event: import("@autoaide/memory-system").ManagerInboxEvent) => boolean;
  }
): void {
  const ids = new Set(input.ids ?? []);
  const events = runtime.memoryStore.listManagerInboxEvents(runtime.sessionId);
  let changed = false;

  for (const event of events) {
    const shouldProcess =
      event.status === "pending" &&
      ((ids.size > 0 && ids.has(event.id)) || (input.predicate ? input.predicate(event) : false));
    if (!shouldProcess) {
      continue;
    }

    runtime.memoryStore.appendManagerInboxEvent({
      ...event,
      status: "processed",
      processedAt: input.now
    });
    changed = true;
  }

  if (changed) {
    syncManagerSession(runtime, input.now);
  }
}

function appendConversationTurn(
  runtime: OperatorExecRuntimeState,
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

function upsertConversationState(runtime: OperatorExecRuntimeState, now: number): void {
  const existing = runtime.memoryStore.listConversations(runtime.ownerId)[0];
  const turns = runtime.memoryStore.listConversationTurns(runtime.conversationId);
  syncActiveWorkstream(runtime, now);
  runtime.memoryStore.upsertConversation({
    id: runtime.conversationId,
    ownerId: runtime.ownerId,
    channel: "cli",
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
  syncManagerSession(runtime, now);
  persistRuntimeState(runtime);
}

function buildManagerConversationContext(runtime: OperatorExecRuntimeState): ManagerConversationContext {
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

function summarizeActionLabel(toolCall: string): string {
  switch (toolCall) {
    case "assign_worker":
      return "assign worker";
    case "create_tasks":
      return "create tasks";
    case "ask_owner":
      return "ask owner";
    case "replan_task":
      return "replan";
    case "nudge_worker":
      return "nudge worker";
    case "replace_worker":
      return "replace worker";
    case "mark_task_done":
      return "mark done";
    case "record_decision":
      return "record decision";
    default:
      return toolCall.replace(/_/g, " ");
  }
}

async function emit(event: AutoAideExecEvent, onEvent?: AutoAideExecEventHandler): Promise<void> {
  await onEvent?.(event);
}

async function processPendingAssignments(
  runtime: OperatorExecRuntimeState,
  onEvent?: AutoAideExecEventHandler
): Promise<void> {
  const runnableAssignments = runtime.store
    .listAssignments()
    .filter((assignment) => assignment.status === "starting" && !runtime.runRegistry.getRun(`run-${assignment.id}`));

  for (const assignment of runnableAssignments) {
    const task = runtime.store.getTask(assignment.taskId);
    if (!task) {
      continue;
    }

    const startedId = nextId("subagent");
    await emit(
      {
        type: "item.started",
        item: {
          id: startedId,
          type: "subagent_run",
          label: assignment.workerId,
          text: `${assignment.workerId} started ${task.title}`,
          status: "in_progress"
        }
      },
      onEvent
    );
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

      const ok = receipt.result.status === "succeeded";
      await emit(
        {
          type: "item.completed",
          item: {
            id: startedId,
            type: "subagent_run",
            label: assignment.workerId,
            text: `${assignment.workerId} ${receipt.result.status} ${task.title}: ${receipt.managerView.summary}`,
            status: ok ? "completed" : "failed"
          }
        },
        onEvent
      );
      appendConversationTurn(runtime, {
        role: "event",
        text: `${ok ? "worker_completed" : "worker_failed"}: ${assignment.workerId} ${receipt.result.status} ${task.title}: ${receipt.managerView.summary}`,
        now: receipt.result.finishedAt
      });
      appendManagerInboxEvent(runtime, {
        reason: "worker_result",
        summary: `${assignment.workerId} ${receipt.result.status} ${task.title}`,
        now: receipt.result.finishedAt,
        metadata: {
          assignmentId: assignment.id,
          taskId: task.id,
          workerId: assignment.workerId,
          resultStatus: receipt.result.status
        }
      });
      upsertConversationState(runtime, receipt.result.finishedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emit(
        {
          type: "item.completed",
          item: {
            id: startedId,
            type: "subagent_run",
            label: assignment.workerId,
            text: `${assignment.workerId} failed ${task.title}: ${message}`,
            status: "failed"
          }
        },
        onEvent
      );
      appendConversationTurn(runtime, {
        role: "event",
        text: `worker_failed: ${assignment.workerId} failed ${task.title}: ${message}`,
        now: Date.now()
      });
      const failedAt = Date.now();
      appendManagerInboxEvent(runtime, {
        reason: "blocked_task",
        summary: `${task.title} is blocked after worker failure`,
        now: failedAt,
        metadata: {
          assignmentId: assignment.id,
          taskId: task.id,
          workerId: assignment.workerId,
          error: message
        }
      });
      upsertConversationState(runtime, failedAt);
    }
  }
}

async function emitFollowups(
  runtime: OperatorExecRuntimeState,
  now: number,
  onEvent?: AutoAideExecEventHandler
): Promise<void> {
  const receipts = buildManagerFollowupReceipts({
    ownerId: runtime.ownerId,
    store: runtime.store,
    memoryStore: runtime.memoryStore,
    conversationId: runtime.conversationId
  });

  for (const receipt of receipts) {
    if (receipt.kind !== "followup_waiting_owner") {
      await emit(
        {
          type: "item.completed",
          item: {
            id: nextId("status"),
            type: "status",
            text: receipt.summary,
            status: "completed"
          }
        },
        onEvent
      );
    }
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
    appendManagerInboxEvent(runtime, {
      reason:
        receipt.kind === "followup_blocked_task"
          ? "blocked_task"
          : receipt.kind === "followup_replan_task"
            ? "followup_due"
            : "followup_due",
      summary: receipt.summary,
      now,
      status: "processed"
    });
  }
}

function shouldUseAutomaticManagerFollowup(runtime?: ManagerRuntime): boolean {
  return !runtime || !(runtime instanceof DeterministicManagerRuntime);
}

function findAutomaticFollowupTask(runtime: OperatorExecRuntimeState, now: number): Task | undefined {
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

function ensureAutomaticWakeEvent(runtime: OperatorExecRuntimeState, now: number): void {
  const task = findAutomaticFollowupTask(runtime, now);
  if (!task) {
    return;
  }

  const reason = task.status === "blocked" ? "blocked_task" : "followup_due";
  const alreadyPending = runtime.memoryStore
    .listManagerInboxEvents(runtime.sessionId)
    .some(
      (event) =>
        event.status === "pending" &&
        event.metadata?.taskId === task.id
    );

  if (alreadyPending) {
    return;
  }

  appendManagerInboxEvent(runtime, {
    reason,
    summary:
      reason === "blocked_task"
        ? `${task.title} remains blocked and needs manager review`
        : `${task.title} needs a scheduled manager follow-up`,
    now,
    metadata: {
      taskId: task.id,
      taskStatus: task.status
    }
  });
}

function ensureStalledAssignmentWakeEvents(runtime: OperatorExecRuntimeState, now: number): void {
  const stalledAssignments = detectStalledAssignments(runtime.store, runtime.registry, now, 5 * 60_000);
  for (const assignment of stalledAssignments) {
    const alreadyPending = runtime.memoryStore
      .listManagerInboxEvents(runtime.sessionId)
      .some(
        (event) =>
          event.status === "pending" &&
          event.reason === "stalled_assignment" &&
          event.metadata?.assignmentId === assignment.assignmentId
      );
    if (alreadyPending) {
      continue;
    }

    const task = runtime.store.getTask(assignment.taskId);
    appendManagerInboxEvent(runtime, {
      reason: "stalled_assignment",
      summary: `${task?.title ?? assignment.taskId} appears stalled`,
      now,
      metadata: {
        assignmentId: assignment.assignmentId,
        taskId: assignment.taskId,
        workerId: assignment.workerId,
        lastHeartbeatAt: assignment.lastHeartbeatAt
      }
    });
  }
}

function ensureWorkerHeartbeatWakeEvents(runtime: OperatorExecRuntimeState, now: number): void {
  const session = runtime.memoryStore.listManagerSessions(runtime.ownerId).find((item) => item.id === runtime.sessionId);
  const lastWakeAt = session?.lastWakeAt ?? 0;

  for (const worker of runtime.registry.listWorkers()) {
    if (
      worker.status !== "busy" ||
      !worker.currentAssignmentId ||
      typeof worker.lastHeartbeatAt !== "number" ||
      worker.lastHeartbeatAt <= lastWakeAt
    ) {
      continue;
    }

    const assignment = runtime.store.getAssignment(worker.currentAssignmentId);
    if (!assignment) {
      continue;
    }

    const alreadyPending = runtime.memoryStore
      .listManagerInboxEvents(runtime.sessionId)
      .some(
        (event) =>
          event.status === "pending" &&
          event.reason === "worker_heartbeat" &&
          event.metadata?.assignmentId === assignment.id &&
          event.metadata?.lastHeartbeatAt === worker.lastHeartbeatAt
      );
    if (alreadyPending) {
      continue;
    }

    const task = runtime.store.getTask(assignment.taskId);
    appendManagerInboxEvent(runtime, {
      reason: "worker_heartbeat",
      summary: `${worker.id} reported heartbeat on ${task?.title ?? assignment.taskId}`,
      now,
      metadata: {
        assignmentId: assignment.id,
        taskId: assignment.taskId,
        workerId: worker.id,
        lastHeartbeatAt: worker.lastHeartbeatAt
      }
    });
  }
}

function resolveWakeEventTask(
  runtime: OperatorExecRuntimeState,
  event: import("@autoaide/memory-system").ManagerInboxEvent
): Task | undefined {
  const taskId =
    (typeof event.metadata?.taskId === "string" ? event.metadata.taskId : undefined) ??
    runtime.store.getWorkstream(event.workstreamId ?? "")?.activeTaskId ??
    runtime.store.getWorkstream(event.workstreamId ?? "")?.rootTaskId ??
    runtime.activeRootTaskId;

  return taskId ? runtime.store.getTask(taskId) : undefined;
}

function pickNextWakeEvent(
  runtime: OperatorExecRuntimeState,
  now: number
): import("@autoaide/memory-system").ManagerInboxEvent | undefined {
  ensureAutomaticWakeEvent(runtime, now);
  ensureWorkerHeartbeatWakeEvents(runtime, now);
  ensureStalledAssignmentWakeEvents(runtime, now);
  const priority: Record<import("@autoaide/memory-system").ManagerWakeReason, number> = {
    owner_message: 99,
    blocked_task: 1,
    worker_result: 2,
    followup_due: 3,
    stalled_assignment: 4,
    worker_heartbeat: 5,
    status_query: 6
  };

  return runtime.memoryStore
    .listManagerInboxEvents(runtime.sessionId)
    .filter((event) => event.status === "pending" && event.reason !== "owner_message")
    .sort((left, right) => {
      const byPriority = priority[left.reason] - priority[right.reason];
      return byPriority !== 0 ? byPriority : left.createdAt - right.createdAt;
    })[0];
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

function buildSessionTickPrompt(input: {
  event: import("@autoaide/memory-system").ManagerInboxEvent;
  task?: Task;
  now: number;
}): string {
  const task = input.task;
  if (!task) {
    return [
      `Review manager wake event "${input.event.reason}" and decide the next action.`,
      `Event summary: ${input.event.summary}`,
      `Current time: ${input.now}`,
      "If no action is needed, explain the current status clearly."
    ].join("\n");
  }

  if (input.event.reason === "worker_result" || task.status === "reviewing") {
    return [
      `Review the active task "${task.title}" after a worker result and decide the next manager action.`,
      `Task ID: ${task.id}`,
      `Inbox summary: ${input.event.summary}`,
      "If the worker result is sufficient, use mark_task_done.",
      "If more execution is needed, use assign_worker, replace_worker, nudge_worker, replan_task, or ask_owner."
    ].join("\n");
  }

  if (input.event.reason === "blocked_task" || task.status === "blocked") {
    return [
      `Follow up on the blocked task "${task.title}" and decide the next manager action.`,
      `Task ID: ${task.id}`,
      `Inbox summary: ${input.event.summary}`,
      `Current blockers: ${(task.blockers ?? []).join("; ") || "unknown"}`,
      "Use replace_worker, replan_task, ask_owner, or nudge_worker when appropriate."
    ].join("\n");
  }

  if (input.event.reason === "stalled_assignment") {
    return [
      `Review the stalled assignment for "${task.title}" and decide the next manager action.`,
      `Task ID: ${task.id}`,
      `Inbox summary: ${input.event.summary}`,
      `Last known heartbeat: ${String(input.event.metadata?.lastHeartbeatAt ?? "unknown")}`,
      "Decide whether to nudge_worker, replace_worker, replan_task, ask_owner, or continue waiting."
    ].join("\n");
  }

  if (input.event.reason === "worker_heartbeat") {
    return [
      `Review the worker heartbeat for "${task.title}" and decide whether any manager action is needed.`,
      `Task ID: ${task.id}`,
      `Inbox summary: ${input.event.summary}`,
      `Last heartbeat: ${String(input.event.metadata?.lastHeartbeatAt ?? "unknown")}`,
      "Usually continue waiting unless the context suggests nudging, replacing, or replanning."
    ].join("\n");
  }

  return [
    `Follow up on the active task "${task.title}" and decide the next manager action.`,
    `Task ID: ${task.id}`,
    `Wake reason: ${input.event.reason}`,
    `Inbox summary: ${input.event.summary}`,
    `Current status: ${task.status}`,
    `Current time: ${input.now}`,
    "Decide whether to wait, nudge_worker, replace_worker, replan_task, ask_owner, or mark_task_done."
  ].join("\n");
}

async function runManagerSessionTick(input: {
  runtime: OperatorExecRuntimeState;
  managerRuntime?: ManagerRuntime;
  now: number;
  onEvent?: AutoAideExecEventHandler;
}): Promise<boolean> {
  if (!shouldUseAutomaticManagerFollowup(input.managerRuntime)) {
    return false;
  }
  const wakeEvent = pickNextWakeEvent(input.runtime, input.now);
  if (!wakeEvent) {
    return false;
  }
  const task = resolveWakeEventTask(input.runtime, wakeEvent);

  const followupNow = input.now + 1;
  await emit(
    {
      type: "item.started",
      item: {
        id: nextId("reasoning"),
        type: "reasoning",
        text: task
          ? `Manager is reviewing ${task.title} after ${wakeEvent.reason}...`
          : `Manager is reviewing ${wakeEvent.reason}...`,
        status: "in_progress"
      }
    },
    input.onEvent
  );

  const result = await executeManagerTurn({
    message: {
      id: `followup-${followupNow}`,
      ownerId: input.runtime.ownerId,
      channel: "web",
      peerId: "local-terminal",
      text: buildSessionTickPrompt({
        event: wakeEvent,
        task,
        now: followupNow
      }),
      createdAt: followupNow
    },
    store: input.runtime.store,
    runtime: input.managerRuntime,
    memory: new InMemoryManagerMemory(input.runtime.store, input.runtime.memoryStore),
    conversation: buildManagerConversationContext(input.runtime),
    memoryStore: input.runtime.memoryStore,
    workerRegistry: input.runtime.registry,
    rootTaskId: input.runtime.activeRootTaskId ?? task?.id ?? `tick-${followupNow}`,
    now: followupNow
  });

  for (const receipt of result.behaviorReceipts) {
    if (receipt.kind === "plan_created") {
      await emit(
        {
          type: "item.completed",
          item: {
            id: nextId("plan"),
            type: "plan",
            text: receipt.summary,
            status: "completed"
          }
        },
        input.onEvent
      );
    }
    appendConversationTurn(input.runtime, {
      role: "event",
      text: `${receipt.kind}: ${receipt.summary}`,
      now: followupNow
    });
  }

  for (const receipt of result.actionReceipts) {
    if (receipt.toolCall === "record_decision") {
      appendConversationTurn(input.runtime, {
        role: "event",
        text: `${receipt.toolCall}: [${receipt.status}] ${receipt.summary}`,
        now: followupNow
      });
      continue;
    }
    await emit(
      {
        type: "item.completed",
        item: {
          id: nextId("tool"),
          type: "tool_call",
          label: summarizeActionLabel(receipt.toolCall),
          text: receipt.summary,
          status: receipt.status === "applied" ? "completed" : "failed"
        }
      },
      input.onEvent
    );
    appendConversationTurn(input.runtime, {
      role: "event",
      text: `${receipt.toolCall}: [${receipt.status}] ${receipt.summary}`,
      now: followupNow
    });
  }

  await emit(
    {
      type: "item.completed",
      item: {
        id: nextId("assistant"),
        type: "assistant_message",
        text: result.reply.text,
        status: "completed"
      }
    },
    input.onEvent
  );
  appendConversationTurn(input.runtime, {
    role: "manager",
    text: result.reply.text,
    now: followupNow
  });

  await processPendingAssignments(input.runtime, input.onEvent);
  markManagerInboxEventsProcessed(input.runtime, {
    now: followupNow,
    ids: [wakeEvent.id]
  });

  if (result.response.intent.needsClarification) {
    input.runtime.pendingClarification = {
      originalText: input.runtime.pendingClarification?.originalText ?? task?.title ?? wakeEvent.summary,
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

async function drainManagerSessionTicks(input: {
  runtime: OperatorExecRuntimeState;
  managerRuntime?: ManagerRuntime;
  now: number;
  onEvent?: AutoAideExecEventHandler;
  limit?: number;
}): Promise<number> {
  let count = 0;
  const limit = input.limit ?? 4;
  while (count < limit) {
    const ran = await runManagerSessionTick({
      runtime: input.runtime,
      managerRuntime: input.managerRuntime,
      now: input.now + count,
      onEvent: input.onEvent
    });
    if (!ran) {
      break;
    }
    count += 1;
  }
  return count;
}

export async function runManagerExecSchedulerTick(input: {
  threadId?: string;
  managerRuntime?: ManagerRuntime;
  onEvent?: AutoAideExecEventHandler;
  now?: number;
}): Promise<{ threadId: string; tickCount: number }> {
  const now = input.now ?? Date.now();
  const runtime = createOperatorExecRuntimeStateFor(input.threadId ?? LOCAL_CONVERSATION_ID, now);
  ensureAutomaticWakeEvent(runtime, now);
  ensureWorkerHeartbeatWakeEvents(runtime, now);
  ensureStalledAssignmentWakeEvents(runtime, now);
  const tickCount = await drainManagerSessionTicks({
    runtime,
    managerRuntime: input.managerRuntime,
    now,
    onEvent: input.onEvent
  });
  upsertConversationState(runtime, now);
  return {
    threadId: runtime.conversationId,
    tickCount
  };
}

export function startManagerExecSchedulerDaemon(input: {
  threadId?: string;
  managerRuntime?: ManagerRuntime;
  onEvent?: AutoAideExecEventHandler;
  intervalMs?: number;
  onTick?: (tickCount: number) => void | Promise<void>;
}): PeriodicSchedulerHandle {
  const threadId = input.threadId ?? LOCAL_CONVERSATION_ID;
  return startPeriodicScheduler({
    intervalMs: input.intervalMs ?? 30_000,
    run: async () => {
      const result = await runManagerExecSchedulerTick({
        threadId,
        managerRuntime: input.managerRuntime,
        onEvent: input.onEvent
      });
      await input.onTick?.(result.tickCount);
    }
  });
}

export async function runManagerExec(input: {
  text: string;
  threadId?: string;
  managerRuntime?: ManagerRuntime;
  onEvent?: AutoAideExecEventHandler;
  now?: number;
}): Promise<{ threadId: string; finalText: string }> {
  const now = input.now ?? Date.now();
  const runtime = createOperatorExecRuntimeStateFor(input.threadId ?? LOCAL_CONVERSATION_ID, now);
  const managerMemory = new InMemoryManagerMemory(runtime.store, runtime.memoryStore);
  const effectiveText = runtime.pendingClarification
    ? [runtime.pendingClarification.originalText, input.text].join("\n")
    : input.text;
  const statusQuery = !runtime.pendingClarification
    ? resolveWorkstreamStatusQuery({
        text: input.text,
        memory: managerMemory,
        store: runtime.store,
        activeWorkstreamId: runtime.activeWorkstreamId
      })
    : undefined;

  await emit({ type: "thread.started", threadId: runtime.conversationId }, input.onEvent);
  await emit({ type: "turn.started", text: input.text }, input.onEvent);
  await emit(
    {
      type: "item.started",
      item: {
        id: nextId("reasoning"),
        type: "reasoning",
        text: "Working...",
        status: "in_progress"
      }
    },
    input.onEvent
  );

  appendConversationTurn(runtime, {
    role: "owner",
    text: input.text,
    now
  });
  appendManagerInboxEvent(runtime, {
    reason: "owner_message",
    summary: input.text,
    now
  });
  upsertConversationState(runtime, now);

  if (statusQuery) {
    markManagerInboxEventsProcessed(runtime, {
      now,
      predicate: (event) => event.reason === "status_query" || event.reason === "owner_message"
    });
    appendManagerInboxEvent(runtime, {
      reason: "status_query",
      summary: statusQuery.queryText || input.text,
      now,
      status: "processed",
      metadata: {
        source: "owner_message"
      }
    });
    await emit(
      {
        type: "item.completed",
        item: {
          id: nextId("assistant"),
          type: "assistant_message",
          text: statusQuery.replyText,
          status: "completed"
        }
      },
      input.onEvent
    );
    appendConversationTurn(runtime, {
      role: "manager",
      text: statusQuery.replyText,
      now
    });
    upsertConversationState(runtime, now);
    await emit(
      {
        type: "turn.completed",
        text: statusQuery.replyText,
        threadId: runtime.conversationId
      },
      input.onEvent
    );
    return {
      threadId: runtime.conversationId,
      finalText: statusQuery.replyText
    };
  }

  try {
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
      runtime: input.managerRuntime,
      memory: managerMemory,
      conversation: buildManagerConversationContext(runtime),
      memoryStore: runtime.memoryStore,
      workerRegistry: runtime.registry,
      rootTaskId: `task-root-${now}`,
      now
    });

    for (const receipt of result.behaviorReceipts) {
      if (receipt.kind === "plan_created") {
        await emit(
          {
            type: "item.completed",
            item: {
              id: nextId("plan"),
              type: "plan",
              text: receipt.summary,
              status: "completed"
            }
          },
          input.onEvent
        );
      }
      if (receipt.kind === "clarification_requested") {
        await emit(
          {
            type: "item.completed",
            item: {
              id: nextId("warning"),
              type: "warning",
              text: receipt.summary,
              status: "completed"
            }
          },
          input.onEvent
        );
      }
      appendConversationTurn(runtime, {
        role: "event",
        text: `${receipt.kind}: ${receipt.summary}`,
        now
      });
    }

    for (const receipt of result.actionReceipts) {
      if (receipt.toolCall === "record_decision") {
        appendConversationTurn(runtime, {
          role: "event",
          text: `${receipt.toolCall}: [${receipt.status}] ${receipt.summary}`,
          now
        });
        continue;
      }
      await emit(
        {
          type: "item.completed",
          item: {
            id: nextId("tool"),
            type: "tool_call",
            label: summarizeActionLabel(receipt.toolCall),
            text: receipt.summary,
            status: receipt.status === "applied" ? "completed" : "failed"
          }
        },
        input.onEvent
      );
      appendConversationTurn(runtime, {
        role: "event",
        text: `${receipt.toolCall}: [${receipt.status}] ${receipt.summary}`,
        now
      });
    }

    await emit(
      {
        type: "item.completed",
        item: {
          id: nextId("assistant"),
          type: "assistant_message",
          text: result.reply.text,
          status: "completed"
        }
      },
      input.onEvent
    );
    appendConversationTurn(runtime, {
      role: "manager",
      text: result.reply.text,
      now
    });
    markManagerInboxEventsProcessed(runtime, {
      now,
      predicate: (event) => event.reason === "owner_message"
    });

    await processPendingAssignments(runtime, input.onEvent);

    if (result.response.intent.needsClarification) {
      runtime.pendingClarification = {
        originalText: runtime.pendingClarification?.originalText ?? input.text,
        question: result.response.intent.clarificationQuestion ?? result.response.reply.text,
        openedAt: runtime.pendingClarification?.openedAt ?? now
      };
      runtime.activeWorkstreamId = undefined;
      runtime.activeWorkstreamTitle = undefined;
      runtime.activeRootTaskId = undefined;
      runtime.activeTaskTitle = undefined;
    } else {
      runtime.pendingClarification = undefined;
      runtime.activeWorkstreamId = result.plan?.rootTask.id
        ? `workstream-${result.plan.rootTask.id}`
        : runtime.activeWorkstreamId;
      runtime.activeWorkstreamTitle = result.plan?.rootTask.title;
      runtime.activeRootTaskId = result.plan?.rootTask.id;
      runtime.activeTaskTitle = result.plan?.rootTask.title;
      if (result.plan?.rootTask) {
        syncActiveWorkstream(runtime, now, { goal: result.plan.rootTask.goal });
      }
    }

    upsertConversationState(runtime, now);
    const ranAutomaticFollowup = (await drainManagerSessionTicks({
      runtime,
      managerRuntime: input.managerRuntime,
      now,
      onEvent: input.onEvent
    })) > 0;
    if (!ranAutomaticFollowup) {
      await emitFollowups(runtime, now, input.onEvent);
    }
    upsertConversationState(runtime, now);

    await emit(
      {
        type: "turn.completed",
        text: result.reply.text,
        threadId: runtime.conversationId
      },
      input.onEvent
    );

    return {
      threadId: runtime.conversationId,
      finalText: result.reply.text
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit(
      {
        type: "turn.failed",
        error: message,
        threadId: runtime.conversationId
      },
      input.onEvent
    );
    throw error;
  }
}
