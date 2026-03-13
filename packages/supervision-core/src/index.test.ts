import { describe, expect, it } from "vitest";
import { InMemoryTaskStore, createCommitment, createTask } from "@autoaide/task-system";
import { InMemoryManagerMemory } from "@autoaide/memory-system";
import {
  InMemorySupervisionScheduler,
  buildCommitmentReminders,
  buildFollowupReminders,
  listBlockedTasks,
  listOverdueTasks,
  planCronSupervisionJobs,
  runDueSupervisionJobs,
  runSupervisionCycle
} from "./index.js";

describe("supervision-core", () => {
  it("finds overdue and blocked tasks", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      ...createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Blocked task",
        goal: "Need input",
        dueAt: 120,
        now: 100
      }),
      status: "blocked",
      blockers: ["Need owner reply"],
      updatedAt: 110
    });

    expect(listBlockedTasks(store)).toHaveLength(1);
    expect(listOverdueTasks(store, 200)).toHaveLength(1);
  });

  it("builds commitment and follow-up reminders", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      ...createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Follow up task",
        goal: "Needs owner update",
        now: 100
      }),
      nextFollowupAt: 150,
      updatedAt: 110
    });
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "Reply before noon",
        dueAt: 120,
        now: 100
      })
    );

    const memory = new InMemoryManagerMemory(store);

    expect(buildCommitmentReminders(memory, 200)).toHaveLength(1);
    expect(buildFollowupReminders(store, 200)).toHaveLength(1);
  });

  it("plans cron-style supervision jobs", () => {
    expect(planCronSupervisionJobs({ now: 100, intervalMs: 10_000 })).toEqual([
      { kind: "scan_blocked_tasks", scheduledAt: 100 },
      { kind: "scan_overdue_commitments", scheduledAt: 10_100 },
      { kind: "scan_stalled_tasks", scheduledAt: 20_100 },
      { kind: "send_reminders", scheduledAt: 30_100 }
    ]);
  });

  it("runs a supervision cycle with alerts, actions and reminders", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      ...createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Blocked task",
        goal: "Need owner answer",
        dueAt: 120,
        now: 100
      }),
      status: "blocked",
      blockers: ["Need owner answer"],
      nextFollowupAt: 140,
      updatedAt: 110
    });
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "Reply before noon",
        dueAt: 130,
        now: 100
      })
    );

    const memory = new InMemoryManagerMemory(store);
    const result = runSupervisionCycle({
      store,
      memory,
      now: 200,
      staleAfterMs: 50
    });

    expect(result.alerts.length).toBeGreaterThanOrEqual(2);
    expect(result.actions.length).toBeGreaterThanOrEqual(2);
    expect(result.reminders.length).toBeGreaterThanOrEqual(2);
  });

  it("runs due supervision jobs from the scheduler", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      ...createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Blocked task",
        goal: "Need owner answer",
        dueAt: 120,
        now: 100
      }),
      status: "blocked",
      blockers: ["Need owner answer"],
      updatedAt: 110
    });
    const memory = new InMemoryManagerMemory(store);
    const scheduler = new InMemorySupervisionScheduler(
      planCronSupervisionJobs({ now: 100, intervalMs: 10 })
    );

    const executions = runDueSupervisionJobs({
      scheduler,
      store,
      memory,
      now: 200,
      staleAfterMs: 50
    });

    expect(executions).toHaveLength(4);
    expect(scheduler.listJobs()).toHaveLength(0);
    expect(executions[0]?.result.alerts.length).toBeGreaterThanOrEqual(1);
  });
});
