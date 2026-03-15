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
import { InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";
import {
  appendConversationEvent,
  persistRuntimeState,
  restorePersistedRuntime
} from "./persistence.js";

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
      upsertConversationState(runtime, Date.now());
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
  runtime: OperatorExecRuntimeState;
  managerRuntime?: ManagerRuntime;
  now: number;
  onEvent?: AutoAideExecEventHandler;
}): Promise<boolean> {
  if (!shouldUseAutomaticManagerFollowup(input.managerRuntime)) {
    return false;
  }
  const task = findAutomaticFollowupTask(input.runtime, input.now);
  if (!task) {
    return false;
  }

  const followupNow = input.now + 1;
  await emit(
    {
      type: "item.started",
      item: {
        id: nextId("reasoning"),
        type: "reasoning",
        text: `Manager is reviewing ${task.title}...`,
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
      text: buildAutomaticFollowupPrompt(task, followupNow),
      createdAt: followupNow
    },
    store: input.runtime.store,
    runtime: input.managerRuntime,
    memory: new InMemoryManagerMemory(input.runtime.store, input.runtime.memoryStore),
    conversation: buildManagerConversationContext(input.runtime),
    memoryStore: input.runtime.memoryStore,
    workerRegistry: input.runtime.registry,
    rootTaskId: input.runtime.activeRootTaskId ?? task.id,
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
  upsertConversationState(runtime, now);

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
    const ranAutomaticFollowup = await maybeRunAutomaticManagerFollowup({
      runtime,
      managerRuntime: input.managerRuntime,
      now,
      onEvent: input.onEvent
    });
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
