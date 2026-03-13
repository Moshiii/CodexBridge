import { describe, expect, it } from "vitest";
import {
  InMemoryTaskStore,
  createAssignment,
  createCommitment,
  createTask
} from "@autoaide/task-system";
import {
  InMemoryManagerMemory,
  InMemoryMemorySnapshotRepository,
  InMemoryMemoryStore,
  migrateMemorySnapshot,
  MEMORY_SYSTEM_SCHEMA_VERSION,
  repairMemorySnapshot,
  validateMemorySnapshot,
  buildManagerMemorySnapshot
} from "./index.js";

describe("memory-system", () => {
  it("builds manager memory summaries from structured state", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Migrate tasks",
        goal: "Build task-system package",
        now: 100
      })
    );
    store.upsertAssignment(
      createAssignment({
        id: "assignment-1",
        taskId: "task-1",
        workerId: "worker-1",
        objective: "Implement domain models",
        now: 110
      })
    );
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "Show first progress update",
        dueAt: 150,
        now: 120
      })
    );
    store.appendProgressEvent({
      id: "event-1",
      taskId: "task-1",
      assignmentId: "assignment-1",
      source: "worker",
      kind: "work_started",
      summary: "Started implementation",
      createdAt: 130
    });

    const snapshot = buildManagerMemorySnapshot({
      store,
      decisionRecords: [
        {
          id: "decision-1",
          ownerId: "owner-1",
          taskId: "task-1",
          summary: "Use task-system first",
          createdAt: 140
        }
      ],
      workers: [
        {
          id: "worker-1",
          executorType: "codex",
          status: "busy",
          currentAssignmentId: "assignment-1",
          createdAt: 100,
          updatedAt: 130,
          strengths: ["typescript"]
        }
      ],
      projects: [
        {
          id: "project-1",
          name: "AutoAide Core",
          goal: "Build the manager system",
          ownerId: "owner-1",
          status: "active",
          createdAt: 90,
          updatedAt: 130
        }
      ]
    });

    expect(snapshot.taskSummaries).toHaveLength(1);
    expect(snapshot.commitmentSummaries).toHaveLength(1);
    expect(snapshot.workerSummaries).toHaveLength(1);
    expect(snapshot.projectSummaries).toHaveLength(1);
    expect(snapshot.decisionRecords).toHaveLength(1);
  });

  it("supports blocked-task and overdue-commitment lookups", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      ...createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Blocked task",
        goal: "Wait for input",
        now: 100
      }),
      status: "blocked",
      blockers: ["Need owner clarification"],
      updatedAt: 110
    });
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        summary: "Reply by noon",
        dueAt: 150,
        now: 120
      })
    );

    const memory = new InMemoryManagerMemory(store);

    expect(memory.listBlockedTasks()).toHaveLength(1);
    expect(memory.listOverdueCommitments(200)).toHaveLength(1);
  });

  it("supports text and status search across task summaries", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Migrate memory",
        goal: "Create memory-system package",
        now: 100
      })
    );
    store.upsertTask({
      ...createTask({
        id: "task-2",
        ownerId: "owner-1",
        title: "Fix blocked item",
        goal: "Resolve owner question",
        now: 120
      }),
      status: "blocked",
      updatedAt: 130,
      workerId: "worker-2"
    });

    const memory = new InMemoryManagerMemory(store);

    expect(memory.searchTasks({ text: "memory-system" })).toHaveLength(1);
    expect(memory.searchTasks({ status: "blocked" })).toHaveLength(1);
    expect(memory.searchTasks({ workerId: "worker-2" })).toHaveLength(1);
  });

  it("supports commitment search and owner-level open commitment lookups", () => {
    const store = new InMemoryTaskStore();
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "Send first weekly update",
        dueAt: 150,
        now: 100
      })
    );
    store.upsertCommitment({
      ...createCommitment({
        id: "commitment-2",
        ownerId: "owner-1",
        projectId: "project-1",
        summary: "Close planning loop",
        dueAt: 160,
        now: 110
      }),
      status: "fulfilled",
      updatedAt: 170
    });

    const memory = new InMemoryManagerMemory(store);

    expect(memory.searchCommitments({ text: "weekly" })).toHaveLength(1);
    expect(memory.searchCommitments({ ownerId: "owner-1", status: "fulfilled" })).toHaveLength(1);
    expect(memory.listOwnerOpenCommitments("owner-1")).toHaveLength(1);
  });

  it("stores projects, workers and decision records with snapshot support", () => {
    const memoryStore = new InMemoryMemoryStore(50);
    memoryStore.upsertProject({
      id: "project-1",
      name: "AutoAide Core",
      goal: "Build the manager system",
      ownerId: "owner-1",
      status: "active",
      createdAt: 100,
      updatedAt: 120
    });
    memoryStore.upsertWorker({
      id: "worker-1",
      executorType: "codex",
      status: "busy",
      currentAssignmentId: "assignment-1",
      createdAt: 100,
      updatedAt: 130
    });
    memoryStore.appendDecisionRecord({
      id: "decision-1",
      ownerId: "owner-1",
      projectId: "project-1",
      summary: "Prioritize stable foundations first",
      createdAt: 140
    });
    memoryStore.upsertConversation({
      id: "conversation-1",
      ownerId: "owner-1",
      channel: "web",
      peerId: "peer-1",
      activeTaskTitle: "Review plan",
      rollingSummary: "Owner asked for a first plan.",
      createdAt: 145,
      updatedAt: 150
    });
    memoryStore.appendConversationTurn({
      id: "turn-1",
      conversationId: "conversation-1",
      ownerId: "owner-1",
      role: "owner",
      text: "Please review the plan.",
      createdAt: 146
    });

    const snapshot = memoryStore.toSnapshot();
    expect(snapshot.schemaVersion).toBe(MEMORY_SYSTEM_SCHEMA_VERSION);

    const restored = InMemoryMemoryStore.fromSnapshot(snapshot);
    expect(restored.listProjects()).toHaveLength(1);
    expect(restored.listWorkers()).toHaveLength(1);
    expect(restored.listDecisionRecords()).toHaveLength(1);
    expect(restored.listConversations()).toHaveLength(1);
    expect(restored.listConversationTurns("conversation-1")).toHaveLength(1);
  });

  it("can rebuild manager memory from a persisted memory snapshot", () => {
    const taskStore = new InMemoryTaskStore();
    taskStore.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Review plan",
        goal: "Verify manager memory restore flow",
        now: 100
      })
    );

    const memoryStore = new InMemoryMemoryStore(50);
    memoryStore.upsertProject({
      id: "project-1",
      name: "AutoAide Core",
      goal: "Build the manager system",
      ownerId: "owner-1",
      status: "active",
      createdAt: 100,
      updatedAt: 120
    });

    const restoredManager = InMemoryManagerMemory.fromSnapshots({
      taskStore,
      memorySnapshot: memoryStore.toSnapshot()
    });

    expect(restoredManager.snapshot().projectSummaries).toHaveLength(1);
    expect(restoredManager.exportMemorySnapshot().schemaVersion).toBe(MEMORY_SYSTEM_SCHEMA_VERSION);
  });

  it("persists manager conversation memory in snapshots", () => {
    const taskStore = new InMemoryTaskStore();
    const memoryStore = new InMemoryMemoryStore(50);
    memoryStore.upsertConversation({
      id: "conversation-1",
      ownerId: "owner-1",
      channel: "web",
      peerId: "peer-1",
      activeTaskId: "task-1",
      activeTaskTitle: "整理 AutoAide TUI",
      pendingClarificationQuestion: "请确认验收标准",
      rollingSummary: "Owner wants a conversation-first TUI.",
      createdAt: 100,
      updatedAt: 120
    });
    memoryStore.appendConversationTurn({
      id: "turn-1",
      conversationId: "conversation-1",
      ownerId: "owner-1",
      role: "owner",
      text: "整理一下 TUI",
      createdAt: 101
    });
    memoryStore.appendConversationTurn({
      id: "turn-2",
      conversationId: "conversation-1",
      ownerId: "owner-1",
      role: "manager",
      text: "请确认验收标准",
      createdAt: 102
    });

    const memory = new InMemoryManagerMemory(taskStore, memoryStore);
    const snapshot = memory.snapshot();

    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.conversationTurns).toHaveLength(2);
    expect(memory.getConversation("conversation-1")?.pendingClarificationQuestion).toBe("请确认验收标准");
    expect(memory.listConversationTurns("conversation-1")[1]?.role).toBe("manager");
  });

  it("persists and restores manager memory through a repository boundary", () => {
    const taskStore = new InMemoryTaskStore();
    const repository = new InMemoryMemorySnapshotRepository();
    const memory = new InMemoryManagerMemory(taskStore);

    memory.persist(repository);

    const restored = InMemoryManagerMemory.restore({
      taskStore,
      repository
    });

    expect(restored.exportMemorySnapshot().schemaVersion).toBe(MEMORY_SYSTEM_SCHEMA_VERSION);
  });

  it("migrates legacy memory snapshots to the current schema", () => {
    const migrated = migrateMemorySnapshot(
      {
        projects: [
          {
            id: "project-1",
            name: "AutoAide Core",
            goal: "Build the manager system",
            ownerId: "owner-1",
            status: "active",
            createdAt: 100,
            updatedAt: 120
          }
        ],
        workers: [
          {
            id: "worker-1",
            executorType: "codex",
            status: "idle",
            createdAt: 110,
            updatedAt: 110
          }
        ],
        decisionRecords: [
          {
            id: "decision-1",
            ownerId: "owner-1",
            summary: "Keep manager lightweight",
            createdAt: 130
          }
        ]
      },
      500
    );

    expect(migrated.schemaVersion).toBe(MEMORY_SYSTEM_SCHEMA_VERSION);
    expect(migrated.createdAt).toBe(500);
    expect(migrated.data.projects).toHaveLength(1);
    expect(migrated.data.workers).toHaveLength(1);
    expect(migrated.data.decisionRecords).toHaveLength(1);
  });

  it("repairs malformed memory snapshots before restore", () => {
    const repaired = repairMemorySnapshot(
      {
        schemaVersion: MEMORY_SYSTEM_SCHEMA_VERSION,
        createdAt: 10,
        updatedAt: 20,
        data: {
          projects: undefined as never,
          workers: undefined as never,
          decisionRecords: undefined as never,
          conversations: undefined as never,
          conversationTurns: undefined as never
        }
      },
      100
    );

    expect(validateMemorySnapshot(repaired)).toEqual([]);

    const restored = InMemoryMemoryStore.fromSnapshot(repaired);
    expect(restored.listProjects()).toEqual([]);
    expect(restored.listWorkers()).toEqual([]);
    expect(restored.listDecisionRecords()).toEqual([]);
    expect(restored.listConversations()).toEqual([]);
    expect(restored.listConversationTurns("conversation-1")).toEqual([]);
  });
});
