import { buildManagerOverview as buildManagerOverviewPolicy } from "@autoaide/manager-core";
import { InMemoryManagerMemory, type ManagerMemorySnapshot } from "@autoaide/memory-system";
import { runSupervisionCycle as runSupervisionCyclePolicy } from "@autoaide/supervision-core";
import type { InMemoryTaskStore } from "@autoaide/task-system";
import type {
  ManagerFollowupReceipt,
  ManagerGrounding,
  ManagerOverview,
  Reminder,
  SupervisionResult
} from "../contracts.js";

function resolveManagerMemory(input: {
  store: InMemoryTaskStore;
  memory?: InMemoryManagerMemory;
}): InMemoryManagerMemory {
  return input.memory ?? new InMemoryManagerMemory(input.store);
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
      strengths: worker.strengths,
      preferredTaskTypes: worker.preferredTaskTypes,
      recentTaskTypes: worker.recentTaskTypes,
      lastHeartbeatAgeMs:
        typeof worker.lastHeartbeatAt === "number" ? Math.max(0, now - worker.lastHeartbeatAt) : undefined,
      recentOutcome: worker.lastOutcome,
      reuseHint: worker.reuseHint,
      summary: worker.summary
    })),
    recentDecisions: snapshot.decisionRecords.slice(-5).map((record) => record.summary)
  };
}

export function buildManagerOverview(input: {
  store: InMemoryTaskStore;
  memory: InMemoryManagerMemory;
  now: number;
}): ManagerOverview {
  return buildManagerOverviewPolicy(input);
}

export function runManagerSupervisionCycle(input: {
  store: InMemoryTaskStore;
  memory: InMemoryManagerMemory;
  now: number;
  staleAfterMs?: number;
}): SupervisionResult {
  return runSupervisionCyclePolicy(input);
}

export function buildManagerFollowupReceipts(input: {
  ownerId: string;
  store: InMemoryTaskStore;
  memoryStore: import("@autoaide/memory-system").InMemoryMemoryStore;
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
      ownerText: `I am still waiting for your clarification: ${conversation.pendingClarificationQuestion}`
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
      ownerText: `I received the result for "${activeTask.title}" and I am preparing the next step.`
    });
  }

  if (activeTask.status === "blocked") {
    receipts.push({
      kind: "followup_blocked_task",
      summary: `manager marked ${activeTask.title} as blocked`,
      ownerText: `"${activeTask.title}" is currently blocked: ${(activeTask.blockers ?? []).join("; ") || "missing more information"}`
    });

    receipts.push({
      kind: "followup_replan_task",
      summary: `manager is preparing a replan path for ${activeTask.title}`,
      ownerText: `I am replanning the next step for "${activeTask.title}" so this workstream does not stall.`
    });

    const blockerText = (activeTask.blockers ?? []).join(" ").toLowerCase();
    if (blockerText.includes("owner") || blockerText.includes("clarification")) {
      receipts.push({
        kind: "followup_escalate_owner",
        summary: `manager escalated ${activeTask.title} back to owner for decision`,
        ownerText: `"${activeTask.title}" needs your decision or confirmation before I can continue.`
      });
    }
  }

  return receipts;
}

export type { Reminder };
