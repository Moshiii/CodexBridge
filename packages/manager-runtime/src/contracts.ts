import type { WorkPlan } from "@autoaide/manager-core";
import type { InMemoryManagerMemory, InMemoryMemoryStore } from "@autoaide/memory-system";
import type { InMemoryTaskStore, OwnerChannelKind, Task } from "@autoaide/task-system";
import type { InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";

export type ManagerOwnerMessage = {
  id: string;
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  text: string;
  createdAt: number;
};

export type ManagerIntent = {
  ownerId: string;
  title: string;
  goal: string;
  sourceMessageId: string;
  mode: "conversation_only" | "managed_task";
  needsClarification: boolean;
  clarificationQuestion?: string;
};

export type ManagerReplyDraft = {
  kind: "summary" | "clarification" | "alert";
  text: string;
};

export type ManagerTaskRef = {
  taskId?: string;
  taskTitle?: string;
};

export type ManagerToolCall =
  | {
      kind: "ask_owner";
      question: string;
      reason: string;
    }
  | {
      kind: "create_tasks";
      steps: Array<{
        title: string;
        goal: string;
        priority?: Task["priority"];
      }>;
      reason: string;
    }
  | {
      kind: "assign_worker";
      taskId?: string;
      taskTitle?: string;
      objective: string;
      deliverable?: string;
      completionSignal?: string;
      preferredWorkerId?: string;
      selectionReason?: string;
      reason: string;
    }
  | {
      kind: "schedule_followup";
      taskId?: string;
      taskTitle?: string;
      summary: string;
      dueInMinutes: number;
      reason: string;
    }
  | {
      kind: "replan_task";
      taskId?: string;
      taskTitle?: string;
      reason: string;
    }
  | {
      kind: "record_decision";
      summary: string;
    }
  | {
      kind: "nudge_worker";
      taskId?: string;
      taskTitle?: string;
      workerId: string;
      message: string;
      reason: string;
    }
  | {
      kind: "replace_worker";
      taskId?: string;
      taskTitle?: string;
      objective?: string;
      deliverable?: string;
      completionSignal?: string;
      preferredWorkerId?: string;
      reason: string;
    }
  | {
      kind: "mark_task_done";
      taskId?: string;
      taskTitle?: string;
      summary: string;
      reason: string;
    };

export type ManagerRuntimeResponse = {
  intent: ManagerIntent;
  plan?: WorkPlan;
  reply: ManagerReplyDraft;
  toolCalls: ManagerToolCall[];
};

export type ManagerReply = {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  kind: "summary" | "clarification" | "alert";
  text: string;
  createdAt: number;
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

export type ManagerExecutionResult = {
  intent: ManagerIntent;
  plan?: WorkPlan;
  response: ManagerRuntimeResponse;
  reply: ManagerReply;
  behaviorReceipts: ManagerBehaviorReceipt[];
  actionReceipts: ManagerActionReceipt[];
};

export type ManagerConversationMessage = {
  role: "owner" | "manager" | "system" | "event";
  text: string;
};

export type ManagerConversationContext = {
  activeRootTaskId?: string;
  activeTaskTitle?: string;
  pendingClarificationQuestion?: string;
  recentMessages: ManagerConversationMessage[];
};

export interface ManagerRuntime {
  respond(input: {
    message: ManagerOwnerMessage;
    store: InMemoryTaskStore;
    memory?: InMemoryManagerMemory;
    conversation?: ManagerConversationContext;
    rootTaskId: string;
    now?: number;
  }): Promise<ManagerRuntimeResponse>;
}

export type CodexManagerPlan = {
  steps?: Array<{
    title: string;
    goal: string;
    priority?: Task["priority"];
  }>;
};

export type CodexManagerResponse = {
  intent: {
    title: string;
    goal: string;
    needsClarification: boolean;
    clarificationQuestion?: string;
  };
  reply: ManagerReplyDraft;
  plan?: CodexManagerPlan;
  toolCalls?: ManagerToolCall[];
};

export type CodexManagerInvocation = {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  stdin: string;
};

export type CodexManagerPolicy = {
  workspaceRoot: string;
  maxRuntimeMs: number;
  command?: string;
};

export type ManagerGrounding = {
  tasks: Array<{
    taskId: string;
    title: string;
    status: Task["status"];
    priority: Task["priority"];
    summary: string;
  }>;
  blockedTasks: string[];
  overdueCommitments: string[];
  workers: Array<{
    workerId: string;
    status: string;
    strengths: string[];
    preferredTaskTypes: string[];
    recentTaskTypes: string[];
    lastHeartbeatAgeMs?: number;
    recentOutcome?: string;
    reuseHint: string;
    summary: string;
  }>;
  recentDecisions: string[];
};

export type ExecuteManagerTurnInput = {
  message: ManagerOwnerMessage;
  store: InMemoryTaskStore;
  runtime?: ManagerRuntime;
  memory?: InMemoryManagerMemory;
  conversation?: ManagerConversationContext;
  memoryStore?: InMemoryMemoryStore;
  workerRegistry?: InMemoryWorkerRegistry;
  rootTaskId: string;
  now?: number;
};

export type { ManagerAlert, ManagerOverview, PlanStep, WorkPlan } from "@autoaide/manager-core";
export type { Reminder, SupervisionResult } from "@autoaide/supervision-core";
