import {
  buildEscalationActions,
  computeManagerAlerts,
  type EscalationAction,
  type ManagerAlert
} from "@autoaide/manager-core";
import type { InMemoryManagerMemory } from "@autoaide/memory-system";
import type { InMemoryTaskStore, Task } from "@autoaide/task-system";

export type Reminder = {
  kind: "commitment_reminder" | "followup_due";
  ownerId: string;
  taskId?: string;
  commitmentId?: string;
  summary: string;
};

export type SupervisionJob = {
  kind:
    | "scan_blocked_tasks"
    | "scan_overdue_commitments"
    | "scan_stalled_tasks"
    | "send_reminders";
  scheduledAt: number;
};

export type SupervisionResult = {
  alerts: ManagerAlert[];
  actions: EscalationAction[];
  reminders: Reminder[];
};

export type SupervisionExecution = {
  job: SupervisionJob;
  result: SupervisionResult;
};

function isTaskOverdue(task: Task, now: number): boolean {
  return typeof task.dueAt === "number" && task.dueAt < now && !["done", "cancelled"].includes(task.status);
}

export function listOverdueTasks(store: InMemoryTaskStore, now: number): Task[] {
  return store.listTasks().filter((task) => isTaskOverdue(task, now));
}

export function listBlockedTasks(store: InMemoryTaskStore): Task[] {
  return store.listTasks({ status: "blocked" });
}

export function listFollowupDueTasks(store: InMemoryTaskStore, now: number): Task[] {
  return store
    .listTasks()
    .filter(
      (task) =>
        typeof task.nextFollowupAt === "number" &&
        task.nextFollowupAt <= now &&
        !["done", "cancelled"].includes(task.status)
    );
}

export function buildCommitmentReminders(
  memory: InMemoryManagerMemory,
  now: number
): Reminder[] {
  return memory.listOverdueCommitments(now).map((commitment) => ({
    kind: "commitment_reminder" as const,
    ownerId: commitment.ownerId,
    taskId: commitment.taskId,
    commitmentId: commitment.commitmentId,
    summary: commitment.summary
  }));
}

export function buildFollowupReminders(store: InMemoryTaskStore, now: number): Reminder[] {
  return listFollowupDueTasks(store, now).map((task) => ({
    kind: "followup_due" as const,
    ownerId: task.ownerId,
    taskId: task.id,
    summary: `${task.title} needs follow-up`
  }));
}

export function planCronSupervisionJobs(input: {
  now: number;
  intervalMs?: number;
}): SupervisionJob[] {
  const intervalMs = input.intervalMs ?? 60_000;
  return [
    { kind: "scan_blocked_tasks", scheduledAt: input.now },
    { kind: "scan_overdue_commitments", scheduledAt: input.now + intervalMs },
    { kind: "scan_stalled_tasks", scheduledAt: input.now + intervalMs * 2 },
    { kind: "send_reminders", scheduledAt: input.now + intervalMs * 3 }
  ];
}

export function runSupervisionCycle(input: {
  store: InMemoryTaskStore;
  memory: InMemoryManagerMemory;
  now: number;
  staleAfterMs?: number;
}): SupervisionResult {
  const overdueTaskAlerts = listOverdueTasks(input.store, input.now).map((task) => ({
    kind: "blocked_task" as const,
    taskId: task.id,
    summary: `${task.title} is overdue`
  }));
  const alerts = [
    ...computeManagerAlerts({
      store: input.store,
      memory: input.memory,
      now: input.now,
      staleAfterMs: input.staleAfterMs
    }),
    ...overdueTaskAlerts
  ];

  return {
    alerts,
    actions: buildEscalationActions(alerts),
    reminders: [
      ...buildCommitmentReminders(input.memory, input.now),
      ...buildFollowupReminders(input.store, input.now)
    ]
  };
}

export class InMemorySupervisionScheduler {
  private readonly jobs: SupervisionJob[] = [];

  constructor(initialJobs: SupervisionJob[] = []) {
    this.jobs.push(...initialJobs);
  }

  schedule(job: SupervisionJob): void {
    this.jobs.push(job);
    this.jobs.sort((left, right) => left.scheduledAt - right.scheduledAt);
  }

  scheduleMany(jobs: SupervisionJob[]): void {
    for (const job of jobs) {
      this.schedule(job);
    }
  }

  listJobs(): SupervisionJob[] {
    return [...this.jobs];
  }

  takeDueJobs(now: number): SupervisionJob[] {
    const due = this.jobs.filter((job) => job.scheduledAt <= now);
    const remaining = this.jobs.filter((job) => job.scheduledAt > now);
    this.jobs.length = 0;
    this.jobs.push(...remaining);
    return due;
  }
}

export function runDueSupervisionJobs(input: {
  scheduler: InMemorySupervisionScheduler;
  store: InMemoryTaskStore;
  memory: InMemoryManagerMemory;
  now: number;
  staleAfterMs?: number;
}): SupervisionExecution[] {
  const dueJobs = input.scheduler.takeDueJobs(input.now);

  return dueJobs.map((job) => ({
    job,
    result: runSupervisionCycle({
      store: input.store,
      memory: input.memory,
      now: input.now,
      staleAfterMs: input.staleAfterMs
    })
  }));
}
