import {
  createDefaultManagerRuntime,
  interpretOwnerMessage,
  type ManagerConversationContext,
  type ManagerToolCall,
  type ManagerRuntime,
  type ManagerRuntimeResponse,
  type ManagerIntent
} from "@autoaide/manager-runtime";
import { InMemoryMemoryStore, type InMemoryManagerMemory } from "@autoaide/memory-system";
import { applyTaskGraphUpdate, type EscalationAction, type WorkPlan } from "@autoaide/manager-core";
import type { Reminder, SupervisionResult } from "@autoaide/supervision-core";
import { assignTaskToWorker, spawnWorker, type InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";
import {
  createCommitment,
  InMemoryTaskStore,
  type OwnerChannelKind,
  type Task
} from "@autoaide/task-system";

export type OwnerMessage = {
  id: string;
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  text: string;
  createdAt: number;
};

export type OwnerTaskIntent = ManagerIntent;

export type ManagerReply = {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  kind: "summary" | "clarification" | "alert";
  text: string;
  createdAt: number;
};

export type OwnerChannelTarget = {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
};

export type ReplyDispatchFailure = {
  reply: ManagerReply;
  error: string;
};

export type ReplyDispatchReport = {
  sent: ManagerReply[];
  failed: ReplyDispatchFailure[];
};

export type ManagerActionReceipt = {
  toolCall: ManagerToolCall["kind"];
  status: "applied" | "skipped";
  summary: string;
};

export type ManagerBehaviorReceipt = {
  kind:
    | "intent_interpreted"
    | "clarification_requested"
    | "plan_created"
    | "reply_prepared"
    | "tool_calls_emitted";
  summary: string;
};

export type ManagerFollowupReceipt = {
  kind:
    | "followup_waiting_owner"
    | "followup_reviewing_result"
    | "followup_blocked_task"
    | "followup_replan_task"
    | "followup_escalate_owner";
  summary: string;
  ownerText: string;
};

export interface ChannelAdapter {
  send(reply: ManagerReply): Promise<void>;
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

export interface ChannelBridge {
  register(channel: OwnerChannelKind, adapter: ChannelAdapter): void;
  send(reply: ManagerReply): Promise<void>;
}

export class InMemoryChannelBridge implements ChannelBridge {
  private readonly adapters = new Map<OwnerChannelKind, ChannelAdapter>();
  private readonly sentReplies: ManagerReply[] = [];

  register(channel: OwnerChannelKind, adapter: ChannelAdapter): void {
    this.adapters.set(channel, adapter);
  }

  async send(reply: ManagerReply): Promise<void> {
    const adapter = this.adapters.get(reply.channel);
    if (!adapter) {
      throw new Error(`channel adapter not found: ${reply.channel}`);
    }
    this.sentReplies.push(reply);
    await adapter.send(reply);
  }

  listSentReplies(): ManagerReply[] {
    return [...this.sentReplies];
  }
}

export function parseOwnerMessage(message: OwnerMessage): OwnerTaskIntent {
  return interpretOwnerMessage(message);
}

export function createClarificationReply(input: {
  message: OwnerMessage;
  question: string;
  now?: number;
}): ManagerReply {
  return {
    ownerId: input.message.ownerId,
    channel: input.message.channel,
    peerId: input.message.peerId,
    kind: "clarification",
    text: input.question,
    createdAt: input.now ?? Date.now()
  };
}

export function createSummaryReply(input: {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  title: string;
  tasksCreated: number;
  nextStep?: string;
  now?: number;
}): ManagerReply {
  const nextStepLine = input.nextStep ? ` 下一步：${input.nextStep}` : "";
  return {
    ownerId: input.ownerId,
    channel: input.channel,
    peerId: input.peerId,
    kind: "summary",
    text: `已记录任务《${input.title}》，当前拆出 ${input.tasksCreated} 个任务。${nextStepLine}`.trim(),
    createdAt: input.now ?? Date.now()
  };
}

export function createEscalationReply(input: {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  action: EscalationAction;
  now?: number;
}): ManagerReply {
  const text =
    input.action.kind === "follow_up_owner"
      ? `需要你补充或确认：${input.action.reason}`
      : input.action.kind === "replan_task"
        ? `任务需要重新规划：${input.action.reason}`
        : `正在检查执行器状态：${input.action.reason}`;

  return {
    ownerId: input.ownerId,
    channel: input.channel,
    peerId: input.peerId,
    kind: "alert",
    text,
    createdAt: input.now ?? Date.now()
  };
}

export function createReminderReply(input: {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  reminder: Reminder;
  now?: number;
}): ManagerReply {
  const text =
    input.reminder.kind === "commitment_reminder"
      ? `提醒：你承诺的事项已到期，${input.reminder.summary}`
      : `提醒：${input.reminder.summary}`;

  return {
    ownerId: input.ownerId,
    channel: input.channel,
    peerId: input.peerId,
    kind: "alert",
    text,
    createdAt: input.now ?? Date.now()
  };
}

function findTaskByTitle(store: InMemoryTaskStore, title: string): Task | undefined {
  return store.listTasks().find((task) => task.title === title);
}

function buildManagedWorkerId(registry: InMemoryWorkerRegistry): string {
  return `worker-manager-${registry.listWorkers().length + 1}`;
}

export function buildManagerFollowupReceipts(input: {
  ownerId: string;
  store: InMemoryTaskStore;
  memoryStore: InMemoryMemoryStore;
  conversationId: string;
}): ManagerFollowupReceipt[] {
  const receipts: ManagerFollowupReceipt[] = [];
  const conversation = input.memoryStore
    .listConversations(input.ownerId)
    .find((item) => item.id === input.conversationId);

  if (!conversation) {
    return receipts;
  }

  if (conversation.pendingClarificationQuestion) {
    receipts.push({
      kind: "followup_waiting_owner",
      summary: `manager is waiting for owner clarification: ${conversation.pendingClarificationQuestion}`,
      ownerText: `我还在等待你补充：${conversation.pendingClarificationQuestion}`
    });
  }

  if (!conversation.activeTaskId) {
    return receipts;
  }

  const activeTask = input.store.getTask(conversation.activeTaskId);
  if (!activeTask) {
    return receipts;
  }

  if (activeTask.status === "reviewing") {
    receipts.push({
      kind: "followup_reviewing_result",
      summary: `manager is reviewing worker result for ${activeTask.title}`,
      ownerText: `我已收到《${activeTask.title}》的执行结果，正在整理下一步。`
    });
  }

  if (activeTask.status === "blocked") {
    receipts.push({
      kind: "followup_blocked_task",
      summary: `manager marked ${activeTask.title} as blocked`,
      ownerText: `《${activeTask.title}》当前被阻塞：${(activeTask.blockers ?? []).join("；") || "缺少进一步信息"}`
    });

    receipts.push({
      kind: "followup_replan_task",
      summary: `manager is preparing a replan path for ${activeTask.title}`,
      ownerText: `我正在为《${activeTask.title}》重新规划下一步，避免这条任务线停住。`
    });

    const blockerText = (activeTask.blockers ?? []).join(" ").toLowerCase();
    if (
      blockerText.includes("owner") ||
      blockerText.includes("clarification") ||
      blockerText.includes("验收") ||
      blockerText.includes("确认")
    ) {
      receipts.push({
        kind: "followup_escalate_owner",
        summary: `manager escalated ${activeTask.title} back to owner for decision`,
        ownerText: `《${activeTask.title}》需要你补充决策或确认后我才能继续推进。`
      });
    }
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
      case "schedule_followup": {
        const task = findTaskByTitle(input.store, toolCall.taskTitle);
        if (!task) {
          receipts.push({
            toolCall: "schedule_followup",
            status: "skipped",
            summary: `task not found for follow-up: ${toolCall.taskTitle}`
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
          summary: `scheduled follow-up for ${toolCall.taskTitle}`
        });
        break;
      }
      case "replan_task": {
        const task = findTaskByTitle(input.store, toolCall.taskTitle);
        if (!task) {
          receipts.push({
            toolCall: "replan_task",
            status: "skipped",
            summary: `task not found for replanning: ${toolCall.taskTitle}`
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
          summary: `replanned task ${toolCall.taskTitle}`
        });
        break;
      }
      case "assign_worker": {
        const task = findTaskByTitle(input.store, toolCall.taskTitle);
        if (!task) {
          receipts.push({
            toolCall: "assign_worker",
            status: "skipped",
            summary: `task not found for assignment: ${toolCall.taskTitle}`
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

        const assignmentId = `assignment-${task.id}-${now}-${index + 1}`;
        assignTaskToWorker({
          store: input.store,
          registry: input.workerRegistry,
          taskId: task.id,
          workerId: idleWorker.id,
          assignmentId,
          objective: toolCall.objective,
          inputs: {
            source: "manager_tool_call",
            reason: toolCall.reason
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
    }
  }

  return receipts;
}

export async function handleOwnerIngress(input: {
  message: OwnerMessage;
  bridge: ChannelBridge;
  runtime?: ManagerRuntime;
  memory?: InMemoryManagerMemory;
  conversation?: ManagerConversationContext;
  replyOnClarification?: boolean;
  now?: number;
}): Promise<OwnerTaskIntent> {
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
  const intent = response.intent;

  if (intent.needsClarification && input.replyOnClarification !== false) {
    await input.bridge.send(
      createClarificationReply({
        message: input.message,
        question: intent.clarificationQuestion ?? "请补充任务信息。",
        now: input.now
      })
    );
  }

  return intent;
}

export async function ingestOwnerGoalAndPlan(input: {
  message: OwnerMessage;
  store: InMemoryTaskStore;
  bridge: ChannelBridge;
  runtime?: ManagerRuntime;
  memory?: InMemoryManagerMemory;
  conversation?: ManagerConversationContext;
  memoryStore?: InMemoryMemoryStore;
  workerRegistry?: InMemoryWorkerRegistry;
  rootTaskId: string;
  now?: number;
}): Promise<{
  intent: OwnerTaskIntent;
  plan?: WorkPlan;
  response: ManagerRuntimeResponse;
  behaviorReceipts: ManagerBehaviorReceipt[];
  actionReceipts: ManagerActionReceipt[];
}> {
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
  const behaviorReceipts = summarizeManagerBehaviors(response);
  const actionReceipts = applyManagerToolCalls({
    ownerId: input.message.ownerId,
    store: input.store,
    toolCalls: response.toolCalls,
    memoryStore: input.memoryStore,
    workerRegistry: input.workerRegistry,
    now: input.now
  });

  await input.bridge.send({
    ownerId: input.message.ownerId,
    channel: input.message.channel,
    peerId: input.message.peerId,
    kind: response.reply.kind,
    text: response.reply.text,
    createdAt: input.now ?? Date.now()
  });

  return {
    intent: response.intent,
    plan: response.plan,
    response,
    behaviorReceipts,
    actionReceipts
  };
}

function findTarget(
  targets: OwnerChannelTarget[],
  ownerId: string
): OwnerChannelTarget | undefined {
  return targets.find((target) => target.ownerId === ownerId);
}

function dedupeReplies(replies: ManagerReply[]): ManagerReply[] {
  const seen = new Set<string>();
  const unique: ManagerReply[] = [];

  for (const reply of replies) {
    const key = `${reply.ownerId}:${reply.channel}:${reply.peerId}:${reply.kind}:${reply.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(reply);
  }

  return unique;
}

export async function dispatchSupervisionRepliesSafely(input: {
  bridge: ChannelBridge;
  targets: OwnerChannelTarget[];
  supervision: SupervisionResult;
  now?: number;
}): Promise<ReplyDispatchReport> {
  const sent: ManagerReply[] = [];
  const failed: ReplyDispatchFailure[] = [];
  const replies = await buildSupervisionReplies(input);

  for (const reply of replies) {
    try {
      await input.bridge.send(reply);
      sent.push(reply);
    } catch (error) {
      failed.push({
        reply,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { sent, failed };
}

export async function buildSupervisionReplies(input: {
  targets: OwnerChannelTarget[];
  supervision: SupervisionResult;
  now?: number;
}): Promise<ManagerReply[]> {
  const replies: ManagerReply[] = [];

  for (const action of input.supervision.actions) {
    const ownerId = input.supervision.reminders.find((reminder) => reminder.taskId === action.taskId)?.ownerId;
    if (!ownerId) {
      continue;
    }
    const target = findTarget(input.targets, ownerId);
    if (!target) {
      continue;
    }

    replies.push(
      createEscalationReply({
        ownerId: target.ownerId,
        channel: target.channel,
        peerId: target.peerId,
        action,
        now: input.now
      })
    );
  }

  for (const reminder of input.supervision.reminders) {
    const target = findTarget(input.targets, reminder.ownerId);
    if (!target) {
      continue;
    }

    replies.push(
      createReminderReply({
        ownerId: target.ownerId,
        channel: target.channel,
        peerId: target.peerId,
        reminder,
        now: input.now
      })
    );
  }

  return dedupeReplies(replies);
}

export async function dispatchPreparedReplies(input: {
  bridge: ChannelBridge;
  replies: ManagerReply[];
}): Promise<ManagerReply[]> {
  for (const reply of input.replies) {
    await input.bridge.send(reply);
  }

  return input.replies;
}

export async function dispatchSupervisionRepliesLegacy(input: {
  bridge: ChannelBridge;
  targets: OwnerChannelTarget[];
  supervision: SupervisionResult;
  now?: number;
}): Promise<ManagerReply[]> {
  const replies = await buildSupervisionReplies(input);
  return dispatchPreparedReplies({
    bridge: input.bridge,
    replies
  });
}

export async function dispatchSupervisionReplies(input: {
  bridge: ChannelBridge;
  targets: OwnerChannelTarget[];
  supervision: SupervisionResult;
  now?: number;
}): Promise<ManagerReply[]> {
  return dispatchSupervisionRepliesLegacy(input);
}
