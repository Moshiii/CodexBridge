import { applyTaskGraphUpdate } from "@autoaide/manager-core";
import { InMemoryMemoryStore } from "@autoaide/memory-system";
import { createCommitment, InMemoryTaskStore, type Task } from "@autoaide/task-system";
import { assignTaskToWorker, spawnWorker, type InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";
import type {
  ExecuteManagerTurnInput,
  ManagerActionReceipt,
  ManagerBehaviorReceipt,
  ManagerExecutionResult,
  ManagerOwnerMessage,
  ManagerReply,
  ManagerReplyDraft,
  ManagerRuntime,
  ManagerRuntimeResponse,
  ManagerToolCall
} from "../contracts.js";
import { createDefaultManagerRuntime } from "../runtime/factory.js";

function buildManagedWorkerId(registry: InMemoryWorkerRegistry): string {
  return `worker-manager-${registry.listWorkers().length + 1}`;
}

function findTaskByTitle(store: InMemoryTaskStore, title: string): Task | undefined {
  return store.listTasks().find((task) => task.title === title);
}

function resolveTask(store: InMemoryTaskStore, ref: { taskId?: string; taskTitle?: string }): Task | undefined {
  if (ref.taskId) {
    const task = store.getTask(ref.taskId);
    if (task) {
      return task;
    }
  }
  if (ref.taskTitle) {
    return findTaskByTitle(store, ref.taskTitle);
  }
  return undefined;
}

function summarizeTaskRef(ref: { taskId?: string; taskTitle?: string }): string {
  return ref.taskTitle ?? ref.taskId ?? "unknown task";
}

export function buildManagerReply(input: {
  message: ManagerOwnerMessage;
  reply: ManagerReplyDraft;
  now?: number;
}): ManagerReply {
  return {
    ownerId: input.message.ownerId,
    channel: input.message.channel,
    peerId: input.message.peerId,
    kind: input.reply.kind,
    text: input.reply.text,
    createdAt: input.now ?? Date.now()
  };
}

export function summarizeManagerBehaviors(response: ManagerRuntimeResponse): ManagerBehaviorReceipt[] {
  const receipts: ManagerBehaviorReceipt[] = [
    {
      kind: "intent_interpreted",
      summary: `manager interpreted owner intent as《${response.intent.title}》`
    },
    {
      kind: "reply_prepared",
      summary: `manager prepared a ${response.reply.kind} reply`
    }
  ];

  if (response.intent.needsClarification) {
    receipts.push({
      kind: "clarification_requested",
      summary: `manager requested clarification: ${response.intent.clarificationQuestion ?? response.reply.text}`
    });
  }

  if (response.plan) {
    receipts.push({
      kind: "plan_created",
      summary: `manager created ${1 + response.plan.tasks.length} planned task(s)`
    });
  }

  if (response.toolCalls.length > 0) {
    receipts.push({
      kind: "tool_calls_emitted",
      summary: `manager emitted ${response.toolCalls.length} orchestration tool call(s)`
    });
  }

  return receipts;
}

export function applyManagerToolCalls(input: {
  ownerId: string;
  store: InMemoryTaskStore;
  toolCalls: ManagerToolCall[];
  memoryStore?: InMemoryMemoryStore;
  workerRegistry?: InMemoryWorkerRegistry;
  now?: number;
}): ManagerActionReceipt[] {
  const now = input.now ?? Date.now();
  const receipts: ManagerActionReceipt[] = [];

  for (const [index, toolCall] of input.toolCalls.entries()) {
    switch (toolCall.kind) {
      case "ask_owner":
        receipts.push({
          toolCall: "ask_owner",
          status: "applied",
          summary: `manager requested clarification: ${toolCall.question}`
        });
        break;
      case "create_tasks":
        receipts.push({
          toolCall: "create_tasks",
          status: "applied",
          summary: `manager confirmed ${toolCall.steps.length} planned task(s)`
        });
        break;
      case "record_decision":
        if (!input.memoryStore) {
          receipts.push({
            toolCall: "record_decision",
            status: "skipped",
            summary: "decision store unavailable"
          });
          break;
        }
        input.memoryStore.appendDecisionRecord({
          id: `decision-${now}-${index + 1}`,
          ownerId: input.ownerId,
          summary: toolCall.summary,
          createdAt: now
        });
        receipts.push({
          toolCall: "record_decision",
          status: "applied",
          summary: toolCall.summary
        });
        break;
      case "nudge_worker": {
        const task = resolveTask(input.store, toolCall);
        if (!task) {
          receipts.push({
            toolCall: "nudge_worker",
            status: "skipped",
            summary: `task not found for worker nudge: ${summarizeTaskRef(toolCall)}`
          });
          break;
        }
        if (!input.workerRegistry || !input.workerRegistry.getWorker(toolCall.workerId)) {
          receipts.push({
            toolCall: "nudge_worker",
            status: "skipped",
            summary: `worker not found for nudge: ${toolCall.workerId}`
          });
          break;
        }
        receipts.push({
          toolCall: "nudge_worker",
          status: "applied",
          summary: `nudged ${toolCall.workerId} on ${task.title}: ${toolCall.message}`
        });
        break;
      }
      case "schedule_followup": {
        const task = resolveTask(input.store, toolCall);
        if (!task) {
          receipts.push({
            toolCall: "schedule_followup",
            status: "skipped",
            summary: `task not found for follow-up: ${summarizeTaskRef(toolCall)}`
          });
          break;
        }
        const dueAt = now + toolCall.dueInMinutes * 60_000;
        input.store.upsertTask({
          ...task,
          nextFollowupAt: dueAt,
          updatedAt: now
        });
        input.store.upsertCommitment(
          createCommitment({
            id: `commitment-${task.id}-${now}-${index + 1}`,
            ownerId: task.ownerId,
            taskId: task.id,
            summary: toolCall.summary,
            dueAt,
            now
          })
        );
        receipts.push({
          toolCall: "schedule_followup",
          status: "applied",
          summary: `scheduled follow-up for ${task.title}`
        });
        break;
      }
      case "replan_task": {
        const task = resolveTask(input.store, toolCall);
        if (!task) {
          receipts.push({
            toolCall: "replan_task",
            status: "skipped",
            summary: `task not found for replanning: ${summarizeTaskRef(toolCall)}`
          });
          break;
        }
        applyTaskGraphUpdate(input.store, {
          kind: "task_replanned",
          taskId: task.id,
          now
        });
        receipts.push({
          toolCall: "replan_task",
          status: "applied",
          summary: `replanned task ${task.title}`
        });
        break;
      }
      case "assign_worker": {
        const task = resolveTask(input.store, toolCall);
        if (!task) {
          receipts.push({
            toolCall: "assign_worker",
            status: "skipped",
            summary: `task not found for assignment: ${summarizeTaskRef(toolCall)}`
          });
          break;
        }
        if (!input.workerRegistry) {
          receipts.push({
            toolCall: "assign_worker",
            status: "skipped",
            summary: "worker registry unavailable"
          });
          break;
        }
        const preferredWorker = toolCall.preferredWorkerId
          ? input.workerRegistry.getWorker(toolCall.preferredWorkerId)
          : undefined;
        const idleWorker =
          (preferredWorker?.status === "idle" ? preferredWorker : undefined) ??
          input.workerRegistry.listIdleWorkers()[0] ??
          spawnWorker(input.workerRegistry, {
            workerId: toolCall.preferredWorkerId ?? buildManagedWorkerId(input.workerRegistry),
            now,
            strengths: ["general"]
          });

        assignTaskToWorker({
          store: input.store,
          registry: input.workerRegistry,
          taskId: task.id,
          workerId: idleWorker.id,
          assignmentId: `assignment-${task.id}-${now}-${index + 1}`,
          objective: toolCall.objective,
          deliverable: toolCall.deliverable,
          completionSignal: toolCall.completionSignal,
          inputs: {
            source: "manager_tool_call",
            reason: toolCall.reason,
            selectionReason: toolCall.selectionReason
          },
          now
        });
        receipts.push({
          toolCall: "assign_worker",
          status: "applied",
          summary: `assigned ${task.title} to ${idleWorker.id}`
        });
        break;
      }
      case "replace_worker": {
        const task = resolveTask(input.store, toolCall);
        if (!task) {
          receipts.push({
            toolCall: "replace_worker",
            status: "skipped",
            summary: `task not found for worker replacement: ${summarizeTaskRef(toolCall)}`
          });
          break;
        }
        if (!input.workerRegistry) {
          receipts.push({
            toolCall: "replace_worker",
            status: "skipped",
            summary: "worker registry unavailable"
          });
          break;
        }
        const preferredWorker = toolCall.preferredWorkerId
          ? input.workerRegistry.getWorker(toolCall.preferredWorkerId)
          : undefined;
        const idleWorker =
          (preferredWorker?.status === "idle" ? preferredWorker : undefined) ??
          input.workerRegistry.listIdleWorkers().find((worker) => worker.id !== task.workerId) ??
          spawnWorker(input.workerRegistry, {
            workerId: toolCall.preferredWorkerId ?? buildManagedWorkerId(input.workerRegistry),
            now,
            strengths: ["general"]
          });

        assignTaskToWorker({
          store: input.store,
          registry: input.workerRegistry,
          taskId: task.id,
          workerId: idleWorker.id,
          assignmentId: `assignment-${task.id}-${now}-${index + 1}`,
          objective: toolCall.objective ?? task.goal,
          deliverable: toolCall.deliverable,
          completionSignal: toolCall.completionSignal,
          inputs: {
            source: "manager_tool_call",
            reason: toolCall.reason,
            replacedWorkerId: task.workerId
          },
          now
        });
        receipts.push({
          toolCall: "replace_worker",
          status: "applied",
          summary: `reassigned ${task.title} to ${idleWorker.id}`
        });
        break;
      }
      case "mark_task_done": {
        const task = resolveTask(input.store, toolCall);
        if (!task) {
          receipts.push({
            toolCall: "mark_task_done",
            status: "skipped",
            summary: `task not found for completion: ${summarizeTaskRef(toolCall)}`
          });
          break;
        }
        input.store.upsertTask({
          ...task,
          status: "done",
          blockers: [],
          updatedAt: now,
          lastProgressAt: now
        });
        receipts.push({
          toolCall: "mark_task_done",
          status: "applied",
          summary: `marked ${task.title} done: ${toolCall.summary}`
        });
        break;
      }
    }
  }

  return receipts;
}

export async function previewOwnerMessage(input: {
  message: ManagerOwnerMessage;
  runtime?: ManagerRuntime;
  memory?: import("@autoaide/memory-system").InMemoryManagerMemory;
  conversation?: import("../contracts.js").ManagerConversationContext;
  now?: number;
}): Promise<{
  intent: import("../contracts.js").ManagerIntent;
  response: ManagerRuntimeResponse;
  reply: ManagerReply;
}> {
  const runtime =
    input.runtime ??
    createDefaultManagerRuntime({
      mode: process.env.AUTOAIDE_MANAGER_RUNTIME === "deterministic" ? "deterministic" : "codex"
    });
  const response = await runtime.respond({
    message: input.message,
    store: new InMemoryTaskStore(),
    memory: input.memory,
    conversation: input.conversation,
    rootTaskId: `preview-${input.message.id}`,
    now: input.now
  });

  return {
    intent: response.intent,
    response,
    reply: buildManagerReply({
      message: input.message,
      reply: response.reply,
      now: input.now
    })
  };
}

export async function executeManagerTurn(input: ExecuteManagerTurnInput): Promise<ManagerExecutionResult> {
  const runtime =
    input.runtime ??
    createDefaultManagerRuntime({
      mode: process.env.AUTOAIDE_MANAGER_RUNTIME === "deterministic" ? "deterministic" : "codex"
    });
  const response = await runtime.respond({
    message: input.message,
    store: input.store,
    memory: input.memory,
    conversation: input.conversation,
    rootTaskId: input.rootTaskId,
    now: input.now
  });

  return {
    intent: response.intent,
    plan: response.plan,
    response,
    reply: buildManagerReply({
      message: input.message,
      reply: response.reply,
      now: input.now
    }),
    behaviorReceipts: summarizeManagerBehaviors(response),
    actionReceipts: applyManagerToolCalls({
      ownerId: input.message.ownerId,
      store: input.store,
      toolCalls: response.toolCalls,
      memoryStore: input.memoryStore,
      workerRegistry: input.workerRegistry,
      now: input.now
    })
  };
}
