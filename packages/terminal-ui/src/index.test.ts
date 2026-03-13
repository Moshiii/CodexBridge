import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore, InMemoryManagerMemory } from "@autoaide/memory-system";
import { createCommitment, createTask, InMemoryTaskStore } from "@autoaide/task-system";
import { InMemoryWorkerRegistry, assignTaskToWorker, spawnWorker } from "@autoaide/worker-orchestrator";
import { buildOperatorSnapshot, renderOperatorDashboard } from "./index.js";

describe("terminal-ui", () => {
  it("builds an operator snapshot with tasks, workers, alerts, and reminders", () => {
    const store = new InMemoryTaskStore();
    const registry = new InMemoryWorkerRegistry();
    const memoryStore = new InMemoryMemoryStore();
    const now = 10_000;

    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Unblock migration",
        goal: "Fix blocked task",
        now: now - 5_000,
        priority: "critical"
      })
    );
    store.updateTaskStatus("task-1", "planned", now - 4_000);
    store.upsertTask({
      ...store.getTask("task-1")!,
      status: "blocked",
      blockers: ["Need owner decision"],
      updatedAt: now - 2_000
    });

    store.upsertTask(
      createTask({
        id: "task-2",
        ownerId: "owner-1",
        title: "Prepare mitigation",
        goal: "Give worker a fallback task",
        now: now - 4_800,
        priority: "high"
      })
    );
    store.updateTaskStatus("task-2", "planned", now - 4_500);

    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        summary: "Owner owes approval",
        now: now - 10_000,
        dueAt: now - 100
      })
    );

    spawnWorker(registry, { workerId: "worker-1", now: now - 3_000 });
    assignTaskToWorker({
      store,
      registry,
      taskId: "task-2",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Try a mitigation",
      now: now - 2_500
    });

    memoryStore.upsertWorker(registry.getWorker("worker-1")!);
    const memory = new InMemoryManagerMemory(store, memoryStore);

    const snapshot = buildOperatorSnapshot({
      store,
      registry,
      memory,
      now
    });

    expect(snapshot.overview.workerCount).toBe(1);
    expect(snapshot.alerts.some((line) => line.includes("overdue") || line.includes("block"))).toBe(true);
    expect(snapshot.reminders).toContain("Owner owes approval");
  });

  it("renders a terminal dashboard without ansi when rich mode is disabled", () => {
    const output = renderOperatorDashboard(
      {
        generatedAt: 10_000,
        overview: {
          totalTasks: 2,
          blockedTasks: 1,
          overdueCommitments: 1,
          schedulableTasks: 1,
          workerCount: 2,
          busyWorkers: 1,
          alertCount: 1,
          reminderCount: 1
        },
        tasks: [
          {
            taskId: "task-1",
            title: "Plan release",
            status: "planned",
            priority: "high",
            workerId: "-",
            updatedAt: 9_000
          }
        ],
        workers: [
          {
            workerId: "worker-1",
            status: "busy",
            currentAssignmentId: "assignment-1",
            updatedAt: 9_500
          }
        ],
        alerts: ["Plan release is overdue"],
        reminders: ["Follow up with owner"]
      },
      { rich: false, width: 80 }
    );

    expect(output).toContain("AutoAide Terminal Console");
    expect(output).toContain("Overview");
    expect(output).toContain("Tasks");
    expect(output).toContain("Workers");
    expect(output).toContain("Alerts");
    expect(output).toContain("Reminders");
    expect(output).not.toContain("\u001b[");
  });
});
