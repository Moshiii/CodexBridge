import {
  NodeProcessCodexCommandRunner,
  type CodexCommandRunner,
  type CodexCommandRunnerResult
} from "@autoaide/executor-codex";
import { applyWorkPlan, planOwnerGoal } from "@autoaide/manager-core";
import { InMemoryManagerMemory } from "@autoaide/memory-system";
import { InMemoryTaskStore, type Task } from "@autoaide/task-system";
import type {
  CodexManagerInvocation,
  CodexManagerPolicy,
  CodexManagerResponse,
  ManagerConversationContext,
  ManagerGrounding,
  ManagerIntent,
  ManagerOwnerMessage,
  ManagerReplyDraft,
  ManagerRuntime,
  ManagerRuntimeResponse,
  ManagerToolCall,
  PlanStep
} from "../contracts.js";
import { buildManagerGrounding } from "../policy/manager-state.js";
import { classifyOwnerMessageMode, interpretOwnerMessage, normalizeConversation } from "../policy/owner-intent.js";

function ensureNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return normalized;
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
    mode: input.response.intent.needsClarification ? "managed_task" : classifyOwnerMessageMode(input.message.text),
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

function isPriority(value: unknown): value is Task["priority"] {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function hasTaskRef(value: Record<string, unknown>): boolean {
  return typeof value.taskId === "string" || typeof value.taskTitle === "string";
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
      return { kind: "ask_owner", question: parsed.question, reason: parsed.reason };
    case "create_tasks": {
      if (!Array.isArray(parsed.steps) || typeof parsed.reason !== "string") {
        throw new Error("invalid create_tasks tool call");
      }
      return {
        kind: "create_tasks",
        steps: parsed.steps.map((step) => {
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
        }),
        reason: parsed.reason
      };
    }
    case "assign_worker":
      if (
        !hasTaskRef(parsed) ||
        typeof parsed.objective !== "string" ||
        typeof parsed.reason !== "string"
      ) {
        throw new Error("invalid assign_worker tool call");
      }
      if (parsed.preferredWorkerId !== undefined && typeof parsed.preferredWorkerId !== "string") {
        throw new Error("invalid assign_worker preferredWorkerId");
      }
      if (parsed.deliverable !== undefined && typeof parsed.deliverable !== "string") {
        throw new Error("invalid assign_worker deliverable");
      }
      if (parsed.completionSignal !== undefined && typeof parsed.completionSignal !== "string") {
        throw new Error("invalid assign_worker completionSignal");
      }
      if (parsed.selectionReason !== undefined && typeof parsed.selectionReason !== "string") {
        throw new Error("invalid assign_worker selectionReason");
      }
      return {
        kind: "assign_worker",
        taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
        taskTitle: typeof parsed.taskTitle === "string" ? parsed.taskTitle : undefined,
        objective: parsed.objective,
        deliverable: typeof parsed.deliverable === "string" ? parsed.deliverable : undefined,
        completionSignal:
          typeof parsed.completionSignal === "string" ? parsed.completionSignal : undefined,
        preferredWorkerId: parsed.preferredWorkerId,
        selectionReason:
          typeof parsed.selectionReason === "string" ? parsed.selectionReason : undefined,
        reason: parsed.reason
      };
    case "schedule_followup":
      if (
        !hasTaskRef(parsed) ||
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
        taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
        taskTitle: typeof parsed.taskTitle === "string" ? parsed.taskTitle : undefined,
        summary: parsed.summary,
        dueInMinutes: parsed.dueInMinutes,
        reason: parsed.reason
      };
    case "replan_task":
      if (!hasTaskRef(parsed) || typeof parsed.reason !== "string") {
        throw new Error("invalid replan_task tool call");
      }
      return {
        kind: "replan_task",
        taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
        taskTitle: typeof parsed.taskTitle === "string" ? parsed.taskTitle : undefined,
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
    case "nudge_worker":
      if (
        !hasTaskRef(parsed) ||
        typeof parsed.workerId !== "string" ||
        typeof parsed.message !== "string" ||
        typeof parsed.reason !== "string"
      ) {
        throw new Error("invalid nudge_worker tool call");
      }
      return {
        kind: "nudge_worker",
        taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
        taskTitle: typeof parsed.taskTitle === "string" ? parsed.taskTitle : undefined,
        workerId: parsed.workerId,
        message: parsed.message,
        reason: parsed.reason
      };
    case "replace_worker":
      if (!hasTaskRef(parsed) || typeof parsed.reason !== "string") {
        throw new Error("invalid replace_worker tool call");
      }
      if (parsed.objective !== undefined && typeof parsed.objective !== "string") {
        throw new Error("invalid replace_worker objective");
      }
      if (parsed.deliverable !== undefined && typeof parsed.deliverable !== "string") {
        throw new Error("invalid replace_worker deliverable");
      }
      if (parsed.completionSignal !== undefined && typeof parsed.completionSignal !== "string") {
        throw new Error("invalid replace_worker completionSignal");
      }
      if (parsed.preferredWorkerId !== undefined && typeof parsed.preferredWorkerId !== "string") {
        throw new Error("invalid replace_worker preferredWorkerId");
      }
      return {
        kind: "replace_worker",
        taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
        taskTitle: typeof parsed.taskTitle === "string" ? parsed.taskTitle : undefined,
        objective: typeof parsed.objective === "string" ? parsed.objective : undefined,
        deliverable: typeof parsed.deliverable === "string" ? parsed.deliverable : undefined,
        completionSignal:
          typeof parsed.completionSignal === "string" ? parsed.completionSignal : undefined,
        preferredWorkerId:
          typeof parsed.preferredWorkerId === "string" ? parsed.preferredWorkerId : undefined,
        reason: parsed.reason
      };
    case "mark_task_done":
      if (!hasTaskRef(parsed) || typeof parsed.summary !== "string" || typeof parsed.reason !== "string") {
        throw new Error("invalid mark_task_done tool call");
      }
      return {
        kind: "mark_task_done",
        taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
        taskTitle: typeof parsed.taskTitle === "string" ? parsed.taskTitle : undefined,
        summary: parsed.summary,
        reason: parsed.reason
      };
    default:
      throw new Error("unknown manager tool call");
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
  const interpreted = interpretOwnerMessage(input.message);
  return [
    "You are the persistent manager agent for AutoAide.",
    "Your job is to interpret the owner's request, decide whether clarification is needed, and produce a structured manager reply.",
    "You are a communication-only manager. You do not perform concrete execution work yourself.",
    "You may only act through structured orchestration tool calls. Do not claim that you already executed code or tools.",
    `Preclassified request mode: ${interpreted.mode}`,
    `Owner message: ${input.message.text}`,
    `Manager grounding JSON: ${JSON.stringify(input.grounding)}`,
    `Conversation context JSON: ${JSON.stringify(conversation ?? { recentMessages: [] })}`,
    "Return exactly one JSON object and nothing else.",
    'Use this schema: {"intent":{"title":"<string>","goal":"<string>","needsClarification":<boolean>,"clarificationQuestion":"<optional string>"},"reply":{"kind":"summary|clarification|alert","text":"<string>"},"plan":{"steps":[{"title":"<string>","goal":"<string>","priority":"low|medium|high|critical"}]},"toolCalls":[{"kind":"ask_owner","question":"<string>","reason":"<string>"}|{"kind":"create_tasks","reason":"<string>","steps":[{"title":"<string>","goal":"<string>","priority":"low|medium|high|critical"}]}|{"kind":"assign_worker","taskId":"<preferred task id>","taskTitle":"<optional display title>","objective":"<string>","deliverable":"<optional string>","completionSignal":"<optional string>","preferredWorkerId":"<optional string>","selectionReason":"<optional string>","reason":"<string>"}|{"kind":"schedule_followup","taskId":"<preferred task id>","taskTitle":"<optional display title>","summary":"<string>","dueInMinutes":<number>,"reason":"<string>"}|{"kind":"replan_task","taskId":"<preferred task id>","taskTitle":"<optional display title>","reason":"<string>"}|{"kind":"nudge_worker","taskId":"<preferred task id>","taskTitle":"<optional display title>","workerId":"<string>","message":"<string>","reason":"<string>"}|{"kind":"replace_worker","taskId":"<preferred task id>","taskTitle":"<optional display title>","objective":"<optional string>","deliverable":"<optional string>","completionSignal":"<optional string>","preferredWorkerId":"<optional string>","reason":"<string>"}|{"kind":"mark_task_done","taskId":"<preferred task id>","taskTitle":"<optional display title>","summary":"<string>","reason":"<string>"}|{"kind":"record_decision","summary":"<string>"}]}',
    "If no clarification is needed, include a short plan with 0-3 steps.",
    "Prefer toolCalls that describe management actions such as asking the owner, creating tasks, assigning workers, scheduling follow-up, replanning, or recording a decision.",
    "When referencing an existing planned task, prefer taskId. taskTitle is only a fallback display label.",
    "When assigning a worker, include a concrete objective and, when possible, a deliverable and completionSignal.",
    "Prefer reusing an existing idle worker when the grounding shows a strong match in strengths, recentTaskTypes, or reuseHint. Only create or request a new worker when the current pool is a poor fit.",
    "When a worker result is already in review, prefer either mark_task_done, assign_worker for follow-up work, replace_worker, nudge_worker, replan_task, or ask_owner instead of creating a brand-new plan.",
    'If request mode is "conversation_only", answer directly, do not create tasks, and return an empty toolCalls array.',
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
    const interpreted = interpretOwnerMessage(input.message);
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

    if (interpreted.mode === "conversation_only") {
      return {
        intent: {
          ...intent,
          mode: "conversation_only",
          needsClarification: false,
          clarificationQuestion: undefined
        },
        reply: response.reply,
        toolCalls: []
      };
    }

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

export function createCodexManagerRuntime(options?: {
  workspaceRoot?: string;
  maxRuntimeMs?: number;
}): ManagerRuntime {
  return new CodexManagerRuntime(new NodeProcessCodexCommandRunner(), {
    workspaceRoot: options?.workspaceRoot ?? process.cwd(),
    maxRuntimeMs: options?.maxRuntimeMs ?? 120_000
  });
}
