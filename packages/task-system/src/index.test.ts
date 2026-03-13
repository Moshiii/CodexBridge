import { describe, expect, it } from "vitest";
import {
  InMemoryTaskSnapshotRepository,
  InMemoryTaskStore,
  migrateSnapshot,
  repairSnapshot,
  TASK_SYSTEM_SCHEMA_VERSION,
  validateSnapshot,
  canTransitionAssignment,
  canTransitionCommitment,
  canTransitionTask,
  createAssignment,
  createCommitment,
  createTask,
  transitionAssignment,
  transitionCommitment,
  transitionTask
} from "./index.js";

describe("task-system", () => {
  it("creates a task with defaults", () => {
    expect(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Set up project",
        goal: "Initialize repo",
        now: 100
      })
    ).toMatchObject({
      id: "task-1",
      ownerId: "owner-1",
      status: "new",
      priority: "medium",
      createdAt: 100,
      updatedAt: 100
    });
  });

  it("rejects invalid create inputs", () => {
    expect(() =>
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: " ",
        goal: "Initialize repo"
      })
    ).toThrow("task.title must be a non-empty string");

    expect(() =>
      createAssignment({
        id: "assignment-1",
        taskId: "task-1",
        workerId: "worker-1",
        objective: "",
        now: 100
      })
    ).toThrow("assignment.objective must be a non-empty string");

    expect(() =>
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        summary: "Follow up",
        dueAt: -1
      })
    ).toThrow("commitment.dueAt must be a positive timestamp");
  });

  it("allows valid task transitions and rejects invalid ones", () => {
    const task = createTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Set up project",
      goal: "Initialize repo",
      now: 100
    });

    expect(canTransitionTask("new", "planned")).toBe(true);
    expect(canTransitionTask("new", "running")).toBe(false);

    const planned = transitionTask(task, "planned", 200);
    expect(planned.status).toBe("planned");
    expect(planned.updatedAt).toBe(200);

    expect(() => transitionTask(task, "running", 300)).toThrow("invalid task transition");
  });

  it("creates assignments and tracks terminal timestamps", () => {
    const assignment = createAssignment({
      id: "assignment-1",
      taskId: "task-1",
      workerId: "worker-1",
      objective: "Do the work",
      now: 100
    });

    expect(assignment.status).toBe("queued");
    expect(canTransitionAssignment("queued", "starting")).toBe(true);
    expect(canTransitionAssignment("queued", "running")).toBe(false);

    const starting = transitionAssignment(assignment, "starting", 200);
    const running = transitionAssignment(starting, "running", 300);
    const succeeded = transitionAssignment(running, "succeeded", 400);

    expect(running.startedAt).toBe(300);
    expect(succeeded.finishedAt).toBe(400);
  });

  it("creates commitments and validates state changes", () => {
    const commitment = createCommitment({
      id: "commitment-1",
      ownerId: "owner-1",
      summary: "Send progress update",
      now: 100
    });

    expect(commitment.status).toBe("open");
    expect(canTransitionCommitment("open", "fulfilled")).toBe(true);
    expect(canTransitionCommitment("fulfilled", "open")).toBe(false);

    const overdue = transitionCommitment(commitment, "overdue", 200);
    expect(overdue.lastCheckedAt).toBe(200);

    expect(() => transitionCommitment(overdue, "open", 300)).toThrow(
      "invalid commitment transition"
    );
  });

  it("stores and queries tasks, assignments, commitments and progress events", () => {
    const store = new InMemoryTaskStore();
    const task = store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Plan work",
        goal: "Create initial plan",
        now: 100
      })
    );
    const assignment = store.upsertAssignment(
      createAssignment({
        id: "assignment-1",
        taskId: task.id,
        workerId: "worker-1",
        objective: "Draft plan",
        now: 110
      })
    );
    const commitment = store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: task.id,
        summary: "Send plan by EOD",
        now: 120
      })
    );

    store.appendProgressEvent({
      id: "event-1",
      taskId: task.id,
      assignmentId: assignment.id,
      source: "manager",
      kind: "task_assigned",
      summary: "Assigned task to worker-1",
      createdAt: 130
    });

    expect(store.listTasks({ ownerId: "owner-1" })).toHaveLength(1);
    expect(store.listAssignments({ workerId: "worker-1" })).toHaveLength(1);
    expect(store.listCommitments({ status: "open" })).toHaveLength(1);
    expect(store.listProgressEvents(task.id)).toHaveLength(1);
    expect(commitment.taskId).toBe(task.id);
  });

  it("updates statuses through the store", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Plan work",
        goal: "Create initial plan",
        now: 100
      })
    );
    store.upsertAssignment(
      createAssignment({
        id: "assignment-1",
        taskId: "task-1",
        workerId: "worker-1",
        objective: "Draft plan",
        now: 110
      })
    );
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        summary: "Send plan by EOD",
        now: 120
      })
    );

    store.updateTaskStatus("task-1", "planned", 200);
    store.updateAssignmentStatus("assignment-1", "starting", 210);
    store.updateCommitmentStatus("commitment-1", "overdue", 220);

    expect(store.getTask("task-1")?.status).toBe("planned");
    expect(store.getAssignment("assignment-1")?.status).toBe("starting");
    expect(store.getCommitment("commitment-1")?.status).toBe("overdue");
  });

  it("exports and restores store snapshots", () => {
    const store = new InMemoryTaskStore(50);
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Plan work",
        goal: "Create initial plan",
        now: 100
      })
    );
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        summary: "Send plan by EOD",
        now: 120
      })
    );

    const snapshot = store.toSnapshot();
    expect(snapshot.schemaVersion).toBe(TASK_SYSTEM_SCHEMA_VERSION);

    const restored = InMemoryTaskStore.fromSnapshot(snapshot);
    expect(restored.getTask("task-1")?.title).toBe("Plan work");
    expect(restored.getCommitment("commitment-1")?.summary).toBe("Send plan by EOD");
  });

  it("persists and restores task store through a repository boundary", () => {
    const repository = new InMemoryTaskSnapshotRepository();
    const store = new InMemoryTaskStore();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Plan work",
        goal: "Create initial plan",
        now: 100
      })
    );

    store.persist(repository);

    const restored = InMemoryTaskStore.restore(repository);
    expect(restored.getTask("task-1")?.title).toBe("Plan work");
    expect(restored.toSnapshot().schemaVersion).toBe(TASK_SYSTEM_SCHEMA_VERSION);
  });

  it("rejects unsupported snapshot versions", () => {
    const issues = validateSnapshot({
      schemaVersion: 999,
      createdAt: 1,
      updatedAt: 2,
      data: {
        tasks: [],
        assignments: [],
        commitments: [],
        progressEvents: []
      }
    });

    expect(issues).toContain("unsupported task-system schema version: 999");
  });

  it("migrates and repairs legacy snapshots", () => {
    const migrated = migrateSnapshot({
      tasks: [
        createTask({
          id: "task-1",
          ownerId: "owner-1",
          title: "Plan work",
          goal: "Create initial plan",
          now: 100
        })
      ]
    }, 500);

    expect(migrated.schemaVersion).toBe(TASK_SYSTEM_SCHEMA_VERSION);
    expect(migrated.data.tasks).toHaveLength(1);

    const repaired = repairSnapshot(
      {
        schemaVersion: TASK_SYSTEM_SCHEMA_VERSION,
        createdAt: 1,
        updatedAt: 2,
        data: {
          tasks: [],
          assignments: undefined as unknown as [],
          commitments: [],
          progressEvents: undefined as unknown as []
        }
      },
      600
    );

    expect(validateSnapshot(repaired)).toEqual([]);
    expect(repaired.data.assignments).toEqual([]);
    expect(repaired.data.progressEvents).toEqual([]);
  });
});
