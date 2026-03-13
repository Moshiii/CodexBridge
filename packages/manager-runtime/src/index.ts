import {
  NodeProcessCodexCommandRunner,
  type CodexCommandRunner,
  type CodexCommandRunnerResult
} from "@autoaide/executor-codex";
import { applyWorkPlan, planOwnerGoal, type PlanStep, type WorkPlan } from "@autoaide/manager-core";
import { InMemoryManagerMemory, type ManagerMemorySnapshot } from "@autoaide/memory-system";
import type { InMemoryTaskStore, OwnerChannelKind, Task } from "@autoaide/task-system";

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
  needsClarification: boolean;
  clarificationQuestion?: string;
};

export type ManagerReplyDraft = {
  kind: "summary" | "clarification" | "alert";
  text: string;
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
      taskTitle: string;
      objective: string;
      preferredWorkerId?: string;
      reason: string;
    }
  | {
      kind: "schedule_followup";
      taskTitle: string;
      summary: string;
      dueInMinutes: number;
      reason: string;
    }
  | {
      kind: "replan_task";
      taskTitle: string;
      reason: string;
    }
  | {
      kind: "record_decision";
      summary: string;
    };

export type ManagerRuntimeResponse = {
  intent: ManagerIntent;
  plan?: WorkPlan;
  reply: ManagerReplyDraft;
  toolCalls: ManagerToolCall[];
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
    summary: string;
  }>;
  recentDecisions: string[];
};

function normalizeConversation(
  conversation: ManagerConversationContext | undefined
): ManagerConversationContext | undefined {
  if (!conversation) {
    return undefined;
  }

  return {
    activeRootTaskId: conversation.activeRootTaskId,
    activeTaskTitle: conversation.activeTaskTitle,
    pendingClarificationQuestion: conversation.pendingClarificationQuestion,
    recentMessages: conversation.recentMessages.slice(-8)
  };
}

function ensureNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return normalized;
}

export function interpretOwnerMessage(message: ManagerOwnerMessage): ManagerIntent {
  const text = message.text.trim();
  const segments = text
    .split("\n")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const title = segments[0] ?? text;
  const goal = segments.slice(1).join(" ") || text;
  const needsClarification = text.length < 12;

  return {
    ownerId: message.ownerId,
    title,
    goal,
    sourceMessageId: message.id,
    needsClarification,
    clarificationQuestion: needsClarification
      ? "请补充更具体的目标、范围或完成标准。"
      : undefined
  };
}

function toManagerIntent(input: {
  message: ManagerOwnerMessage;
  response: CodexManagerResponse;
}): ManagerIntent {
  return {
    ownerId: input.message.ownerId,
    title: input.response.intent.title,
    goal: input.response.intent.goal,
    sourceMessageId: input.message.id,
    needsClarification: input.response.intent.needsClarification,
    clarificationQuestion: input.response.intent.clarificationQuestion
  };
}

function buildPlanSteps(input: {
  rootTaskId: string;
  response: CodexManagerResponse;
}): PlanStep[] | undefined {
  return input.response.plan?.steps?.map((step, index) => ({
    id: `${input.rootTaskId}-step-${index + 1}`,
    title: step.title,
    goal: step.goal,
    priority: step.priority
  }));
}

function resolveManagerMemory(input: {
  store: InMemoryTaskStore;
  memory?: InMemoryManagerMemory;
}): InMemoryManagerMemory {
  return input.memory ?? new InMemoryManagerMemory(input.store);
}

function isPriority(value: unknown): value is Task["priority"] {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function parseManagerToolCall(value: unknown): ManagerToolCall {
  if (!value || typeof value !== "object") {
    throw new Error("invalid manager tool call payload");
  }

  const parsed = value as Partial<ManagerToolCall> & Record<string, unknown>;
  switch (parsed.kind) {
    case "ask_owner":
      if (typeof parsed.question !== "string" || typeof parsed.reason !== "string") {
        throw new Error("invalid ask_owner tool call");
      }
      return {
        kind: "ask_owner",
        question: parsed.question,
        reason: parsed.reason
      };
    case "create_tasks": {
      if (!Array.isArray(parsed.steps) || typeof parsed.reason !== "string") {
        throw new Error("invalid create_tasks tool call");
      }
      const steps = parsed.steps.map((step) => {
        if (!step || typeof step !== "object") {
          throw new Error("invalid create_tasks step");
        }
        const candidate = step as Record<string, unknown>;
        if (typeof candidate.title !== "string" || typeof candidate.goal !== "string") {
          throw new Error("invalid create_tasks step fields");
        }
        if (candidate.priority !== undefined && !isPriority(candidate.priority)) {
          throw new Error("invalid create_tasks step priority");
        }
        return {
          title: candidate.title,
          goal: candidate.goal,
          priority: candidate.priority
        };
      });
      return {
        kind: "create_tasks",
        steps,
        reason: parsed.reason
      };
    }
    case "assign_worker":
      if (
        typeof parsed.taskTitle !== "string" ||
        typeof parsed.objective !== "string" ||
        typeof parsed.reason !== "string"
      ) {
        throw new Error("invalid assign_worker tool call");
      }
      if (
        parsed.preferredWorkerId !== undefined &&
        typeof parsed.preferredWorkerId !== "string"
      ) {
        throw new Error("invalid assign_worker preferredWorkerId");
      }
      return {
        kind: "assign_worker",
        taskTitle: parsed.taskTitle,
        objective: parsed.objective,
        preferredWorkerId: parsed.preferredWorkerId,
        reason: parsed.reason
      };
    case "schedule_followup":
      if (
        typeof parsed.taskTitle !== "string" ||
        typeof parsed.summary !== "string" ||
        typeof parsed.reason !== "string" ||
        typeof parsed.dueInMinutes !== "number" ||
        !Number.isFinite(parsed.dueInMinutes) ||
        parsed.dueInMinutes <= 0
      ) {
        throw new Error("invalid schedule_followup tool call");
      }
      return {
        kind: "schedule_followup",
        taskTitle: parsed.taskTitle,
        summary: parsed.summary,
        dueInMinutes: parsed.dueInMinutes,
        reason: parsed.reason
      };
    case "replan_task":
      if (typeof parsed.taskTitle !== "string" || typeof parsed.reason !== "string") {
        throw new Error("invalid replan_task tool call");
      }
      return {
        kind: "replan_task",
        taskTitle: parsed.taskTitle,
        reason: parsed.reason
      };
    case "record_decision":
      if (typeof parsed.summary !== "string") {
        throw new Error("invalid record_decision tool call");
      }
      return {
        kind: "record_decision",
        summary: parsed.summary
      };
    default:
      throw new Error("unknown manager tool call");
  }
}

export function buildManagerGrounding(input: {
  store: InMemoryTaskStore;
  memory?: InMemoryManagerMemory;
  now?: number;
}): ManagerGrounding {
  const now = input.now ?? Date.now();
  const memory = resolveManagerMemory(input);
  const snapshot: ManagerMemorySnapshot = memory.snapshot();

  return {
    tasks: snapshot.taskSummaries.slice(0, 8).map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      priority: task.priority,
      summary: task.summary
    })),
    blockedTasks: snapshot.taskSummaries
      .filter((task) => task.status === "blocked")
      .slice(0, 5)
      .map((task) => task.summary),
    overdueCommitments: snapshot.commitmentSummaries
      .filter(
        (commitment) =>
          commitment.status !== "fulfilled" &&
          commitment.status !== "cancelled" &&
          typeof commitment.dueAt === "number" &&
          commitment.dueAt < now
      )
      .slice(0, 5)
      .map((commitment) => commitment.summary),
    workers: snapshot.workerSummaries.slice(0, 8).map((worker) => ({
      workerId: worker.workerId,
      status: worker.status,
      summary: worker.summary
    })),
    recentDecisions: snapshot.decisionRecords.slice(-5).map((record) => record.summary)
  };
}

export class DeterministicManagerRuntime implements ManagerRuntime {
  async respond(input: {
    message: ManagerOwnerMessage;
    store: InMemoryTaskStore;
    memory?: InMemoryManagerMemory;
    conversation?: ManagerConversationContext;
    rootTaskId: string;
    now?: number;
  }): Promise<ManagerRuntimeResponse> {
    const intent = interpretOwnerMessage(input.message);
    if (intent.needsClarification) {
      return {
        intent,
        reply: {
          kind: "clarification",
          text: intent.clarificationQuestion ?? "请补充任务信息。"
        },
        toolCalls: [
          {
            kind: "ask_owner",
            question: intent.clarificationQuestion ?? "请补充任务信息。",
            reason: "owner_goal_is_underspecified"
          }
        ]
      };
    }

    const plan = planOwnerGoal({
      ownerId: intent.ownerId,
      rootTaskId: input.rootTaskId,
      title: intent.title,
      goal: intent.goal,
      now: input.now
    });

    applyWorkPlan(input.store, plan);

    return {
      intent,
      plan,
      reply: {
        kind: "summary",
        text: `已记录任务《${intent.title}》，当前拆出 ${1 + plan.tasks.length} 个任务。 下一步：经理将继续安排执行器处理`
      },
      toolCalls: [
        {
          kind: "create_tasks",
          steps: [
            {
              title: plan.rootTask.title,
              goal: plan.rootTask.goal,
              priority: plan.rootTask.priority
            },
            ...plan.tasks.map((task) => ({
              title: task.title,
              goal: task.goal,
              priority: task.priority
            }))
          ],
          reason: "convert_owner_goal_into_task_graph"
        },
        {
          kind: "record_decision",
          summary: `为 owner 目标《${intent.title}》建立首版任务图`
        },
        {
          kind: "assign_worker",
          taskTitle: plan.tasks[0]?.title ?? plan.rootTask.title,
          objective: plan.tasks[0]?.goal ?? plan.rootTask.goal,
          reason: "first_planned_step_is_ready_for_execution"
        },
        {
          kind: "schedule_followup",
          taskTitle: plan.rootTask.title,
          summary: `跟进 owner 目标《${intent.title}》的整体进展`,
          dueInMinutes: 60,
          reason: "manager_should_revisit_new_goal"
        }
      ]
    };
  }
}

export function parseCodexManagerResponse(raw: string): CodexManagerResponse {
  const parsed = JSON.parse(raw) as Partial<CodexManagerResponse>;

  if (!parsed.intent || typeof parsed.intent !== "object") {
    throw new Error("invalid manager intent payload");
  }
  if (
    typeof parsed.intent.title !== "string" ||
    typeof parsed.intent.goal !== "string" ||
    typeof parsed.intent.needsClarification !== "boolean"
  ) {
    throw new Error("invalid manager intent fields");
  }
  if (!parsed.reply || typeof parsed.reply !== "object") {
    throw new Error("invalid manager reply payload");
  }
  if (
    parsed.reply.kind !== "summary" &&
    parsed.reply.kind !== "clarification" &&
    parsed.reply.kind !== "alert"
  ) {
    throw new Error("invalid manager reply kind");
  }
  if (typeof parsed.reply.text !== "string") {
    throw new Error("invalid manager reply text");
  }

  if (parsed.toolCalls !== undefined) {
    if (!Array.isArray(parsed.toolCalls)) {
      throw new Error("invalid manager tool calls");
    }
    parsed.toolCalls = parsed.toolCalls.map((toolCall) => parseManagerToolCall(toolCall));
  }

  return parsed as CodexManagerResponse;
}

export function decodeCodexManagerCommandResult(input: {
  commandResult: CodexCommandRunnerResult;
}): CodexManagerResponse {
  const trimmedStdout = input.commandResult.stdout.trim();

  if (trimmedStdout) {
    const lines = trimmedStdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]!;
      try {
        return parseCodexManagerResponse(line);
      } catch {
        try {
          const event = JSON.parse(line) as {
            type?: string;
            item?: { type?: string; text?: string };
          };
          if (event.type === "item.completed" && event.item?.type === "agent_message") {
            return parseCodexManagerResponse(event.item.text ?? "");
          }
        } catch {
          continue;
        }
      }
    }
  }

  throw new Error(input.commandResult.stderr.trim() || "manager runtime returned no valid response");
}

export function buildCodexManagerPrompt(input: {
  message: ManagerOwnerMessage;
  grounding: ManagerGrounding;
  conversation?: ManagerConversationContext;
}): string {
  const conversation = normalizeConversation(input.conversation);
  return [
    "You are the persistent manager agent for AutoAide.",
    "Your job is to interpret the owner's request, decide whether clarification is needed, and produce a structured manager reply.",
    "You are a communication-only manager. You do not perform concrete execution work yourself.",
    "You may only act through structured orchestration tool calls. Do not claim that you already executed code or tools.",
    `Owner message: ${input.message.text}`,
    `Manager grounding JSON: ${JSON.stringify(input.grounding)}`,
    `Conversation context JSON: ${JSON.stringify(conversation ?? { recentMessages: [] })}`,
    "Return exactly one JSON object and nothing else.",
    'Use this schema: {"intent":{"title":"<string>","goal":"<string>","needsClarification":<boolean>,"clarificationQuestion":"<optional string>"},"reply":{"kind":"summary|clarification|alert","text":"<string>"},"plan":{"steps":[{"title":"<string>","goal":"<string>","priority":"low|medium|high|critical"}]},"toolCalls":[{"kind":"ask_owner","question":"<string>","reason":"<string>"}|{"kind":"create_tasks","reason":"<string>","steps":[{"title":"<string>","goal":"<string>","priority":"low|medium|high|critical"}]}|{"kind":"assign_worker","taskTitle":"<string>","objective":"<string>","preferredWorkerId":"<optional string>","reason":"<string>"}|{"kind":"schedule_followup","taskTitle":"<string>","summary":"<string>","dueInMinutes":<number>,"reason":"<string>"}|{"kind":"replan_task","taskTitle":"<string>","reason":"<string>"}|{"kind":"record_decision","summary":"<string>"}]}',
    "If no clarification is needed, include a short plan with 0-3 steps.",
    "Prefer toolCalls that describe management actions such as asking the owner, creating tasks, assigning workers, scheduling follow-up, replanning, or recording a decision.",
    "Do not wrap the JSON in markdown fences."
  ].join("\n");
}

export function buildCodexManagerInvocation(input: {
  runId: string;
  message: ManagerOwnerMessage;
  store: InMemoryTaskStore;
  memory?: InMemoryManagerMemory;
  conversation?: ManagerConversationContext;
  policy: CodexManagerPolicy;
}): CodexManagerInvocation {
  const grounding = buildManagerGrounding({
    store: input.store,
    memory: input.memory
  });

  return {
    runId: input.runId,
    command: input.policy.command ?? "codex",
    args: ["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", "-"],
    cwd: ensureNonEmptyString(input.policy.workspaceRoot, "policy.workspaceRoot"),
    env: {
      AUTOAIDE_MANAGER_RUN_ID: input.runId,
      AUTOAIDE_OWNER_ID: input.message.ownerId,
      AUTOAIDE_CHANNEL: input.message.channel
    },
    timeoutMs: input.policy.maxRuntimeMs,
    stdin: buildCodexManagerPrompt({
      message: input.message,
      grounding,
      conversation: input.conversation
    })
  };
}

export class CodexManagerRuntime implements ManagerRuntime {
  constructor(
    private readonly runner: CodexCommandRunner,
    private readonly policy: CodexManagerPolicy
  ) {}

  async respond(input: {
    message: ManagerOwnerMessage;
    store: InMemoryTaskStore;
    memory?: InMemoryManagerMemory;
    conversation?: ManagerConversationContext;
    rootTaskId: string;
    now?: number;
  }): Promise<ManagerRuntimeResponse> {
    const invocation = buildCodexManagerInvocation({
      runId: `manager-${input.message.id}`,
      message: input.message,
      store: input.store,
      memory: input.memory,
      conversation: input.conversation,
      policy: this.policy
    });
    const commandResult = await this.runner.run(invocation);
    const response = decodeCodexManagerCommandResult({ commandResult });
    const intent = toManagerIntent({
      message: input.message,
      response
    });

    if (intent.needsClarification) {
      return {
        intent,
        reply: response.reply,
        toolCalls: response.toolCalls ?? []
      };
    }

    const plan = planOwnerGoal({
      ownerId: intent.ownerId,
      rootTaskId: input.rootTaskId,
      title: intent.title,
      goal: intent.goal,
      now: input.now,
      steps: buildPlanSteps({
        rootTaskId: input.rootTaskId,
        response
      })
    });

    applyWorkPlan(input.store, plan);

    return {
      intent,
      plan,
      reply: response.reply,
      toolCalls: response.toolCalls ?? []
    };
  }
}

export function createDefaultManagerRuntime(options?: {
  mode?: "deterministic" | "codex";
  workspaceRoot?: string;
  maxRuntimeMs?: number;
}): ManagerRuntime {
  if (options?.mode === "deterministic") {
    return new DeterministicManagerRuntime();
  }

  return new CodexManagerRuntime(new NodeProcessCodexCommandRunner(), {
    workspaceRoot: options?.workspaceRoot ?? process.cwd(),
    maxRuntimeMs: options?.maxRuntimeMs ?? 120_000
  });
}
