import {
  type Commitment,
  type InMemoryTaskStore,
  type Task,
  createTask
} from "@autoaide/task-system";
import { type InMemoryManagerMemory, type TaskSummary } from "@autoaide/memory-system";

export type PlanStep = {
  id: string;
  title: string;
  goal: string;
  priority?: Task["priority"];
};

export type OwnerGoal = {
  ownerId: string;
  title: string;
  goal: string;
  now?: number;
  projectId?: string;
  rootTaskId: string;
  stepPrefix?: string;
  steps?: PlanStep[];
};

export type WorkPlan = {
  rootTask: Task;
  tasks: Task[];
};

export type ScheduledTask = {
  taskId: string;
  priority: Task["priority"];
  reason: string;
};

export type ManagerAlert = {
  kind: "blocked_task" | "overdue_commitment" | "stalled_task";
  taskId?: string;
  commitmentId?: string;
  summary: string;
};

export type TaskGraphUpdate =
  | {
      kind: "task_blocked";
      taskId: string;
      blockers: string[];
      now?: number;
    }
  | {
      kind: "task_replanned";
      taskId: string;
      now?: number;
    }
  | {
      kind: "task_followup_scheduled";
      taskId: string;
      nextFollowupAt: number;
      now?: number;
    };

export type EscalationAction = {
  kind: "follow_up_owner" | "replan_task" | "check_worker";
  taskId?: string;
  commitmentId?: string;
  priority: "high" | "medium";
  reason: string;
};

export type ManagerOverview = {
  totalTasks: number;
  blockedTasks: number;
  overdueCommitments: number;
  schedulableTasks: number;
};

const PRIORITY_RANK: Record<Task["priority"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

function sortByPriorityThenAge(left: Task, right: Task): number {
  const priorityDelta = PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return left.updatedAt - right.updatedAt;
}

export function planOwnerGoal(input: OwnerGoal): WorkPlan {
  const now = input.now ?? Date.now();
  const rootTask = {
    ...createTask({
      id: input.rootTaskId,
      ownerId: input.ownerId,
      title: input.title,
      goal: input.goal,
      now,
      projectId: input.projectId,
      priority: "high"
    }),
    status: "planned" as const
  };

  const tasks =
    input.steps?.map((step, index) => ({
      ...createTask({
        id: step.id,
        ownerId: input.ownerId,
        title: step.title,
        goal: step.goal,
        now: now + index + 1,
        projectId: input.projectId,
        parentTaskId: input.rootTaskId,
        priority: step.priority ?? "medium"
      }),
      status: "planned" as const
    })) ?? [];

  return {
    rootTask,
    tasks
  };
}

export function applyWorkPlan(store: InMemoryTaskStore, plan: WorkPlan): WorkPlan {
  store.upsertTask(plan.rootTask);
  for (const task of plan.tasks) {
    store.upsertTask(task);
  }
  return plan;
}

export function listSchedulableTasks(store: InMemoryTaskStore): Task[] {
  return store
    .listTasks()
    .filter(
      (task) =>
        task.status === "planned" &&
        !task.workerId &&
        (!task.blockers || task.blockers.length === 0)
    )
    .sort(sortByPriorityThenAge);
}

export function scheduleNextTask(store: InMemoryTaskStore): ScheduledTask | undefined {
  const nextTask = listSchedulableTasks(store)[0];
  if (!nextTask) {
    return undefined;
  }

  return {
    taskId: nextTask.id,
    priority: nextTask.priority,
    reason: `Task ${nextTask.title} is planned, unassigned, and ready for execution`
  };
}

export function computeManagerAlerts(input: {
  store: InMemoryTaskStore;
  memory: InMemoryManagerMemory;
  now: number;
  staleAfterMs?: number;
}): ManagerAlert[] {
  const staleAfterMs = input.staleAfterMs ?? 60_000;
  const blocked = input.memory.listBlockedTasks().map((task) => ({
    kind: "blocked_task" as const,
    taskId: task.taskId,
    summary: task.summary
  }));
  const overdue = input.memory.listOverdueCommitments(input.now).map((commitment) => ({
    kind: "overdue_commitment" as const,
    commitmentId: commitment.commitmentId,
    taskId: commitment.taskId,
    summary: commitment.summary
  }));
  const stale = input.store
    .listTasks()
    .filter((task) => {
      if (!["assigned", "running", "reviewing"].includes(task.status)) {
        return false;
      }
      const lastSignalAt = task.lastProgressAt ?? task.updatedAt;
      return input.now - lastSignalAt > staleAfterMs;
    })
    .map((task) => ({
      kind: "stalled_task" as const,
      taskId: task.id,
      summary: `${task.title} has no recent progress signal`
    }));

  return [...blocked, ...overdue, ...stale];
}

export function buildManagerOverview(input: {
  store: InMemoryTaskStore;
  memory: InMemoryManagerMemory;
  now: number;
}): ManagerOverview {
  return {
    totalTasks: input.store.listTasks().length,
    blockedTasks: input.memory.listBlockedTasks().length,
    overdueCommitments: input.memory.listOverdueCommitments(input.now).length,
    schedulableTasks: listSchedulableTasks(input.store).length
  };
}

export function applyTaskGraphUpdate(
  store: InMemoryTaskStore,
  update: TaskGraphUpdate
): Task | undefined {
  const task = store.getTask(update.taskId);
  if (!task) {
    return undefined;
  }

  const now = update.now ?? Date.now();

  switch (update.kind) {
    case "task_blocked": {
      const nextTask: Task = {
        ...task,
        status: "blocked",
        blockers: update.blockers,
        updatedAt: now,
        lastProgressAt: now
      };
      return store.upsertTask(nextTask);
    }
    case "task_replanned": {
      const nextTask: Task = {
        ...task,
        status: "planned",
        blockers: [],
        updatedAt: now,
        lastProgressAt: now
      };
      return store.upsertTask(nextTask);
    }
    case "task_followup_scheduled": {
      const nextTask: Task = {
        ...task,
        nextFollowupAt: update.nextFollowupAt,
        updatedAt: now
      };
      return store.upsertTask(nextTask);
    }
  }
}

export function buildEscalationActions(alerts: ManagerAlert[]): EscalationAction[] {
  return alerts.map((alert) => {
    switch (alert.kind) {
      case "blocked_task":
        return {
          kind: "follow_up_owner" as const,
          taskId: alert.taskId,
          priority: "high" as const,
          reason: alert.summary
        };
      case "overdue_commitment":
        return {
          kind: "follow_up_owner" as const,
          taskId: alert.taskId,
          commitmentId: alert.commitmentId,
          priority: "high" as const,
          reason: `Commitment overdue: ${alert.summary}`
        };
      case "stalled_task":
        return {
          kind: "check_worker" as const,
          taskId: alert.taskId,
          priority: "medium" as const,
          reason: alert.summary
        };
    }
  });
}

export function selectTaskForReplan(taskSummaries: TaskSummary[]): TaskSummary | undefined {
  return [...taskSummaries]
    .filter((task) => task.status === "blocked" || task.blockers.length > 0)
    .sort((left, right) => right.eventCount - left.eventCount)[0];
}

export function collectOwnerCommitments(
  commitments: Commitment[],
  ownerId: string
): Commitment[] {
  return commitments.filter((commitment) => commitment.ownerId === ownerId);
}
