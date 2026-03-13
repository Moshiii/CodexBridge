import { describe, expect, it } from "vitest";
import { InMemoryTaskStore, createCommitment, createTask } from "@autoaide/task-system";
import { InMemoryManagerMemory } from "@autoaide/memory-system";
import {
  applyTaskGraphUpdate,
  applyWorkPlan,
  buildEscalationActions,
  buildManagerOverview,
  computeManagerAlerts,
  listSchedulableTasks,
  planOwnerGoal,
  scheduleNextTask,
  selectTaskForReplan
} from "./index.js";

describe("manager-core", () => {
  it("plans an owner goal into a root task and subtasks", () => {
    const plan = planOwnerGoal({
      ownerId: "owner-1",
      rootTaskId: "task-root",
      title: "Launch AutoAide planner",
      goal: "Build planner and scheduler foundations",
      now: 100,
      steps: [
        {
          id: "task-1",
          title: "Build planner",
          goal: "Create manager-core plan function",
          priority: "critical"
        },
        {
          id: "task-2",
          title: "Build scheduler",
          goal: "Create next-task selection logic"
        }
      ]
    });

    expect(plan.rootTask.status).toBe("planned");
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0]?.parentTaskId).toBe("task-root");
  });

  it("applies plans and schedules the highest priority ready task", () => {
    const store = new InMemoryTaskStore();
    applyWorkPlan(
      store,
      planOwnerGoal({
        ownerId: "owner-1",
        rootTaskId: "task-root",
        title: "Launch AutoAide planner",
        goal: "Build planner and scheduler foundations",
        now: 100,
        steps: [
          {
            id: "task-1",
            title: "Build planner",
            goal: "Create manager-core plan function",
            priority: "critical"
          },
          {
            id: "task-2",
            title: "Build scheduler",
            goal: "Create next-task selection logic",
            priority: "medium"
          }
        ]
      })
    );

    expect(listSchedulableTasks(store)).toHaveLength(3);
    expect(scheduleNextTask(store)?.taskId).toBe("task-1");
  });

  it("computes blocked, overdue, and stalled alerts", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      ...createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Blocked task",
        goal: "Wait for owner answer",
        now: 100
      }),
      status: "blocked",
      blockers: ["Need clarification"],
      updatedAt: 110
    });
    store.upsertTask({
      ...createTask({
        id: "task-2",
        ownerId: "owner-1",
        title: "Running task",
        goal: "Await progress signal",
        now: 100
      }),
      status: "running",
      lastProgressAt: 120,
      updatedAt: 120
    });
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "Reply before noon",
        dueAt: 150,
        now: 100
      })
    );

    const memory = new InMemoryManagerMemory(store);
    const alerts = computeManagerAlerts({
      store,
      memory,
      now: 500,
      staleAfterMs: 200
    });

    expect(alerts).toHaveLength(3);
  });

  it("builds a manager overview from current state", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Planned task",
        goal: "Ready to assign",
        now: 100
      })
    );
    store.updateTaskStatus("task-1", "planned", 110);
    const memory = new InMemoryManagerMemory(store);

    expect(buildManagerOverview({ store, memory, now: 200 })).toEqual({
      totalTasks: 1,
      blockedTasks: 0,
      overdueCommitments: 0,
      schedulableTasks: 1
    });
  });

  it("updates the task graph for blocked, replanned, and follow-up states", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Needs input",
        goal: "Wait for clarification",
        now: 100
      })
    );

    const blocked = applyTaskGraphUpdate(store, {
      kind: "task_blocked",
      taskId: "task-1",
      blockers: ["Need owner clarification"],
      now: 120
    });
    expect(blocked?.status).toBe("blocked");
    expect(blocked?.blockers).toEqual(["Need owner clarification"]);

    const followedUp = applyTaskGraphUpdate(store, {
      kind: "task_followup_scheduled",
      taskId: "task-1",
      nextFollowupAt: 300,
      now: 130
    });
    expect(followedUp?.nextFollowupAt).toBe(300);

    const replanned = applyTaskGraphUpdate(store, {
      kind: "task_replanned",
      taskId: "task-1",
      now: 140
    });
    expect(replanned?.status).toBe("planned");
    expect(replanned?.blockers).toEqual([]);
  });

  it("turns alerts into structured escalation actions", () => {
    const actions = buildEscalationActions([
      {
        kind: "blocked_task",
        taskId: "task-1",
        summary: "Need owner clarification"
      },
      {
        kind: "overdue_commitment",
        taskId: "task-2",
        commitmentId: "commitment-1",
        summary: "Reply before noon"
      },
      {
        kind: "stalled_task",
        taskId: "task-3",
        summary: "Worker has been quiet"
      }
    ]);

    expect(actions).toEqual([
      {
        kind: "follow_up_owner",
        taskId: "task-1",
        priority: "high",
        reason: "Need owner clarification"
      },
      {
        kind: "follow_up_owner",
        taskId: "task-2",
        commitmentId: "commitment-1",
        priority: "high",
        reason: "Commitment overdue: Reply before noon"
      },
      {
        kind: "check_worker",
        taskId: "task-3",
        priority: "medium",
        reason: "Worker has been quiet"
      }
    ]);
  });

  it("selects the most event-heavy blocked task for replanning", () => {
    const selected = selectTaskForReplan([
      {
        taskId: "task-1",
        title: "Blocked task",
        goal: "Need replan",
        status: "blocked",
        priority: "high",
        blockers: ["Need input"],
        eventCount: 4,
        summary: "Blocked",
        workerId: undefined,
        projectId: undefined,
        lastProgressAt: undefined,
        nextFollowupAt: undefined
      },
      {
        taskId: "task-2",
        title: "Less urgent blocked task",
        goal: "Need replan",
        status: "blocked",
        priority: "high",
        blockers: ["Need input"],
        eventCount: 2,
        summary: "Blocked",
        workerId: undefined,
        projectId: undefined,
        lastProgressAt: undefined,
        nextFollowupAt: undefined
      }
    ]);

    expect(selected?.taskId).toBe("task-1");
  });
});
