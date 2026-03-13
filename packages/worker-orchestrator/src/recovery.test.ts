import { describe, expect, it } from "vitest";
import { InMemoryManagerMemory, InMemoryMemoryStore } from "@autoaide/memory-system";
import { InMemoryTaskStore, createTask } from "@autoaide/task-system";
import { InMemoryWorkerRegistry, assignTaskToWorker, spawnWorker } from "./index.js";

describe("worker-orchestrator recovery", () => {
  it("restores task, memory, and worker state after a simulated restart", () => {
    const taskStore = new InMemoryTaskStore();
    taskStore.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Recover orchestrator state",
        goal: "Ensure restart recovery works",
        now: 100
      })
    );
    taskStore.updateTaskStatus("task-1", "planned", 110);

    const memoryStore = new InMemoryMemoryStore(50);
    memoryStore.upsertProject({
      id: "project-1",
      name: "AutoAide Core",
      goal: "Keep restart safe",
      ownerId: "owner-1",
      status: "active",
      createdAt: 90,
      updatedAt: 120
    });

    const registry = new InMemoryWorkerRegistry();
    spawnWorker(registry, {
      workerId: "worker-1",
      now: 120
    });
    assignTaskToWorker({
      store: taskStore,
      registry,
      taskId: "task-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Recover state",
      now: 130
    });

    const restoredTaskStore = InMemoryTaskStore.restore({
      load: () => taskStore.toSnapshot(),
      save: () => {}
    });
    const restoredMemory = InMemoryManagerMemory.fromSnapshots({
      taskStore: restoredTaskStore,
      memorySnapshot: memoryStore.toSnapshot()
    });
    const restoredRegistry = InMemoryWorkerRegistry.fromSnapshot(registry.toSnapshot());

    expect(restoredTaskStore.getTask("task-1")?.status).toBe("assigned");
    expect(restoredMemory.snapshot().projectSummaries).toHaveLength(1);
    expect(restoredRegistry.getWorker("worker-1")?.currentAssignmentId).toBe("assignment-1");
  });
});
