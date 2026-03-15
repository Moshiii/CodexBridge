import { describe, expect, it } from "vitest";
import { InMemoryTaskStore, createTask } from "@autoaide/task-system";
import {
  InMemoryWorkerRegistry,
  assignTaskToWorker,
  detectStalledAssignments,
  recordWorkerHeartbeat,
  recordWorkerResult,
  spawnWorker
} from "./index.js";

describe("worker-orchestrator", () => {
  it("registers workers and lists idle workers", () => {
    const registry = new InMemoryWorkerRegistry();
    spawnWorker(registry, {
      workerId: "worker-1",
      strengths: ["typescript"],
      now: 100
    });

    expect(registry.listWorkers()).toHaveLength(1);
    expect(registry.listIdleWorkers()).toHaveLength(1);
  });

  it("assigns a task to an idle worker and updates task state", () => {
    const store = new InMemoryTaskStore();
    const registry = new InMemoryWorkerRegistry();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Implement orchestrator",
        goal: "Create assignment routing",
        now: 100
      })
    );
    store.updateTaskStatus("task-1", "planned", 110);
    spawnWorker(registry, {
      workerId: "worker-1",
      now: 120
    });

    const assignment = assignTaskToWorker({
      store,
      registry,
      taskId: "task-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Implement worker orchestrator",
      now: 130
    });

    expect(assignment.status).toBe("starting");
    expect(store.getTask("task-1")?.status).toBe("assigned");
    expect(registry.getWorker("worker-1")?.status).toBe("busy");
    expect(registry.getWorker("worker-1")).toMatchObject({
      lastTaskId: "task-1",
      recentTaskTypes: ["Implement orchestrator"],
      lastAssignmentAt: 130
    });
  });

  it("records heartbeat and promotes the assignment to running", () => {
    const store = new InMemoryTaskStore();
    const registry = new InMemoryWorkerRegistry();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Implement orchestrator",
        goal: "Create assignment routing",
        now: 100
      })
    );
    store.updateTaskStatus("task-1", "planned", 110);
    spawnWorker(registry, { workerId: "worker-1", now: 120 });
    assignTaskToWorker({
      store,
      registry,
      taskId: "task-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Implement worker orchestrator",
      now: 130
    });

    const assignment = recordWorkerHeartbeat({
      store,
      registry,
      workerId: "worker-1",
      assignmentId: "assignment-1",
      now: 150
    });

    expect(assignment.status).toBe("running");
    expect(assignment.heartbeatAt).toBe(150);
    expect(store.getTask("task-1")?.status).toBe("running");
    expect(registry.getWorker("worker-1")?.lastHeartbeatAt).toBe(150);
  });

  it("records worker results and clears worker occupancy", () => {
    const store = new InMemoryTaskStore();
    const registry = new InMemoryWorkerRegistry();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Implement orchestrator",
        goal: "Create assignment routing",
        now: 100
      })
    );
    store.updateTaskStatus("task-1", "planned", 110);
    spawnWorker(registry, { workerId: "worker-1", now: 120 });
    assignTaskToWorker({
      store,
      registry,
      taskId: "task-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Implement worker orchestrator",
      now: 130
    });

    const success = recordWorkerResult({
      store,
      registry,
      assignmentId: "assignment-1",
      outcome: "succeeded",
      summary: "Implementation completed",
      now: 160
    });

    expect(success.status).toBe("succeeded");
    expect(store.getTask("task-1")?.status).toBe("reviewing");
    expect(registry.getWorker("worker-1")).toMatchObject({
      status: "idle",
      lastOutcome: "succeeded",
      lastOutcomeAt: 160
    });
  });

  it("detects stalled assignments from stale worker heartbeats", () => {
    const store = new InMemoryTaskStore();
    const registry = new InMemoryWorkerRegistry();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Implement orchestrator",
        goal: "Create assignment routing",
        now: 100
      })
    );
    store.updateTaskStatus("task-1", "planned", 110);
    spawnWorker(registry, { workerId: "worker-1", now: 120 });
    assignTaskToWorker({
      store,
      registry,
      taskId: "task-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Implement worker orchestrator",
      now: 130
    });

    const stalled = detectStalledAssignments(store, registry, 500, 200);
    expect(stalled).toHaveLength(1);
    expect(stalled[0]?.assignmentId).toBe("assignment-1");
  });

  it("restores worker registry snapshots", () => {
    const registry = new InMemoryWorkerRegistry();
    spawnWorker(registry, { workerId: "worker-1", now: 100 });
    const restored = InMemoryWorkerRegistry.fromSnapshot(registry.toSnapshot());

    expect(restored.getWorker("worker-1")?.status).toBe("idle");
  });
});
