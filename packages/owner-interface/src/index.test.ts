import { InMemoryTaskStore } from "@autoaide/task-system";
import { describe, expect, it } from "vitest";
import {
  buildManagerFollowupReceipts,
  DeterministicManagerRuntime,
  applyManagerToolCalls,
  executeManagerTurn,
  interpretOwnerMessage,
  previewOwnerMessage,
  summarizeManagerBehaviors
} from "@autoaide/manager-runtime";
import { InMemoryMemoryStore } from "@autoaide/memory-system";
import { InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";
import {
  buildSupervisionReplies,
  createReminderReply,
  dispatchSupervisionRepliesSafely,
  dispatchSupervisionReplies,
  InMemoryChannelBridge,
  createEscalationReply,
  createSummaryReply
} from "./index.js";

describe("owner-interface", () => {
  it("parses owner messages into task intents through manager-runtime", () => {
    expect(
      interpretOwnerMessage({
        id: "message-1",
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        text: "Implement AutoAide\nStart with owner-interface",
        createdAt: 100
      })
    ).toEqual({
      ownerId: "owner-1",
      title: "Implement AutoAide",
      goal: "Start with owner-interface",
      sourceMessageId: "message-1",
      mode: "managed_task",
      needsClarification: false,
      clarificationQuestion: undefined
    });
  });

  it("requests clarification for underspecified owner messages through manager-runtime preview", async () => {
    const bridge = new InMemoryChannelBridge();
    const delivered: string[] = [];
    bridge.register("telegram", {
      async send(reply) {
        delivered.push(reply.text);
      }
    });

    const preview = await previewOwnerMessage({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        text: "Fix it",
        createdAt: 100
      },
      runtime: new DeterministicManagerRuntime(),
      now: 120
    });

    await bridge.send(preview.reply);

    expect(preview.intent.needsClarification).toBe(true);
    expect(delivered).toEqual(["Please provide a more specific goal, scope, or completion criteria."]);
  });

  it("builds summary replies", () => {
    expect(
      createSummaryReply({
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        title: "Implement AutoAide",
        tasksCreated: 3,
        nextStep: "Start assigning the first task",
        now: 100
      })
    ).toEqual({
      ownerId: "owner-1",
      channel: "telegram",
      peerId: "peer-1",
      kind: "summary",
      text: "Captured \"Implement AutoAide\" and created 3 tasks. Next: Start assigning the first task",
      createdAt: 100
    });
  });

  it("builds escalation replies for owner follow-up", () => {
    expect(
      createEscalationReply({
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        action: {
          kind: "follow_up_owner",
          taskId: "task-1",
          priority: "high",
          reason: "Missing acceptance criteria"
        },
        now: 100
      }).text
    ).toBe("Need your clarification or confirmation: Missing acceptance criteria");
  });

  it("builds reminder replies", () => {
    expect(
      createReminderReply({
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        reminder: {
          kind: "commitment_reminder",
          ownerId: "owner-1",
          taskId: "task-1",
          commitmentId: "commitment-1",
          summary: "Reply with acceptance criteria today"
        },
        now: 100
      }).text
    ).toBe("Reminder: your commitment is due, Reply with acceptance criteria today");
  });

  it("summarizes manager behaviors from a runtime response", () => {
    const receipts = summarizeManagerBehaviors({
      intent: {
        ownerId: "owner-1",
        title: "Refine AutoAide TUI",
        goal: "Make it conversation-first",
        sourceMessageId: "message-1",
        mode: "managed_task",
        needsClarification: false
      },
      reply: {
        kind: "summary",
        text: "I have started coordinating the work."
      },
      plan: {
        rootTask: {
          id: "task-root",
          ownerId: "owner-1",
          title: "Refine AutoAide TUI",
          goal: "Make it conversation-first",
          status: "planned",
          priority: "high",
          createdAt: 100,
          updatedAt: 100
        },
        tasks: []
      },
      toolCalls: [
        {
          kind: "assign_worker",
          taskTitle: "Refine AutoAide TUI",
          objective: "Update the layout",
          reason: "ready"
        }
      ]
    });

    expect(receipts.map((receipt) => receipt.kind)).toEqual([
      "intent_interpreted",
      "reply_prepared",
      "plan_created",
      "tool_calls_emitted"
    ]);
  });

  it("executes an owner goal through manager-runtime and sends a summary reply", async () => {
    const store = new InMemoryTaskStore();
    const memoryStore = new InMemoryMemoryStore(120);
    const workerRegistry = new InMemoryWorkerRegistry();
    const bridge = new InMemoryChannelBridge();
    const delivered: string[] = [];
    bridge.register("telegram", {
      async send(reply) {
        delivered.push(reply.text);
      }
    });

    const result = await executeManagerTurn({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        text: "Implement AutoAide\nStart with owner-interface",
        createdAt: 100
      },
      store,
      runtime: new DeterministicManagerRuntime(),
      memoryStore,
      workerRegistry,
      rootTaskId: "task-root",
      now: 120
    });

    await bridge.send(result.reply);

    expect(result.plan?.rootTask.id).toBe("task-root");
    expect(store.listTasks()).toHaveLength(1);
    expect(store.listAssignments()).toHaveLength(1);
    expect(store.listCommitments()).toHaveLength(1);
    expect(memoryStore.listDecisionRecords()).toHaveLength(1);
    expect(result.actionReceipts.map((receipt) => receipt.toolCall)).toEqual([
      "create_tasks",
      "record_decision",
      "assign_worker",
      "schedule_followup"
    ]);
    expect(result.behaviorReceipts.map((receipt) => receipt.kind)).toEqual([
      "intent_interpreted",
      "reply_prepared",
      "plan_created",
      "tool_calls_emitted"
    ]);
    expect(delivered).toEqual(["Captured \"Implement AutoAide\" and created 1 tasks. Next: the manager will continue assigning executors."]);
  });

  it("applies manager tool calls into memory, follow-up, and worker assignment state", () => {
    const store = new InMemoryTaskStore();
    const now = 100;
    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Refine AutoAide TUI",
      goal: "Make the default UI conversation-first",
      status: "planned",
      priority: "high",
      createdAt: now,
      updatedAt: now
    });
    const memoryStore = new InMemoryMemoryStore(now);
    const workerRegistry = new InMemoryWorkerRegistry();

    const receipts = applyManagerToolCalls({
      ownerId: "owner-1",
      store,
      memoryStore,
      workerRegistry,
      now,
      toolCalls: [
        {
          kind: "record_decision",
          summary: "Keep the default TUI conversation-first"
        },
        {
          kind: "schedule_followup",
          taskTitle: "Refine AutoAide TUI",
          summary: "Review progress in one hour",
          dueInMinutes: 60,
          reason: "monitor_progress"
        },
        {
          kind: "assign_worker",
          taskTitle: "Refine AutoAide TUI",
          objective: "Adjust the default layout",
          reason: "step_ready_for_execution"
        }
      ]
    });

    expect(receipts.every((receipt) => receipt.status === "applied")).toBe(true);
    expect(memoryStore.listDecisionRecords()).toHaveLength(1);
    expect(store.listCommitments()).toHaveLength(1);
    expect(store.listAssignments()).toHaveLength(1);
    expect(workerRegistry.listWorkers()).toHaveLength(1);
    expect(store.getTask("task-1")?.status).toBe("assigned");
  });

  it("builds manager follow-up receipts from conversation and task state", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Refine AutoAide TUI",
      goal: "Make it conversation-first",
      status: "reviewing",
      priority: "high",
      createdAt: 100,
      updatedAt: 120
    });
    const memoryStore = new InMemoryMemoryStore(100);
    memoryStore.upsertConversation({
      id: "conversation-1",
      ownerId: "owner-1",
      channel: "web",
      peerId: "peer-1",
      activeTaskId: "task-1",
      activeTaskTitle: "Refine AutoAide TUI",
      pendingClarificationQuestion: "Please confirm the acceptance criteria",
      createdAt: 100,
      updatedAt: 120
    });

    const receipts = buildManagerFollowupReceipts({
      ownerId: "owner-1",
      store,
      memoryStore,
      conversationId: "conversation-1"
    });

    expect(receipts.map((receipt) => receipt.kind)).toEqual([
      "followup_waiting_owner",
      "followup_reviewing_result"
    ]);
  });

  it("builds blocked-task follow-up receipts when the active task is blocked", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Refine AutoAide TUI",
      goal: "Make it conversation-first",
      status: "blocked",
      priority: "high",
      blockers: ["worker execution failed"],
      createdAt: 100,
      updatedAt: 120
    });
    const memoryStore = new InMemoryMemoryStore(100);
    memoryStore.upsertConversation({
      id: "conversation-1",
      ownerId: "owner-1",
      channel: "web",
      peerId: "peer-1",
      activeTaskId: "task-1",
      activeTaskTitle: "Refine AutoAide TUI",
      createdAt: 100,
      updatedAt: 120
    });

    const receipts = buildManagerFollowupReceipts({
      ownerId: "owner-1",
      store,
      memoryStore,
      conversationId: "conversation-1"
    });

    expect(receipts).toEqual([
      {
        kind: "followup_blocked_task",
        summary: "manager marked Refine AutoAide TUI as blocked",
        ownerText: "\"Refine AutoAide TUI\" is currently blocked: worker execution failed"
      },
      {
        kind: "followup_replan_task",
        summary: "manager is preparing a replan path for Refine AutoAide TUI",
        ownerText: "I am replanning the next step for \"Refine AutoAide TUI\" so this workstream does not stall."
      }
    ]);
  });

  it("escalates blocked tasks back to the owner when blocker requires owner input", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Refine AutoAide TUI",
      goal: "Make it conversation-first",
      status: "blocked",
      priority: "high",
      blockers: ["Need owner clarification on acceptance criteria"],
      createdAt: 100,
      updatedAt: 120
    });
    const memoryStore = new InMemoryMemoryStore(100);
    memoryStore.upsertConversation({
      id: "conversation-1",
      ownerId: "owner-1",
      channel: "web",
      peerId: "peer-1",
      activeTaskId: "task-1",
      activeTaskTitle: "Refine AutoAide TUI",
      createdAt: 100,
      updatedAt: 120
    });

    const receipts = buildManagerFollowupReceipts({
      ownerId: "owner-1",
      store,
      memoryStore,
      conversationId: "conversation-1"
    });

    expect(receipts.map((receipt) => receipt.kind)).toEqual([
      "followup_blocked_task",
      "followup_replan_task",
      "followup_escalate_owner"
    ]);
  });

  it("dispatches supervision reminders and escalation replies through the bridge", async () => {
    const bridge = new InMemoryChannelBridge();
    const delivered: string[] = [];
    bridge.register("telegram", {
      async send(reply) {
        delivered.push(reply.text);
      }
    });

    const replies = await dispatchSupervisionReplies({
      bridge,
      targets: [
        {
          ownerId: "owner-1",
          channel: "telegram",
          peerId: "peer-1"
        }
      ],
      now: 100,
      supervision: {
        alerts: [
          {
            kind: "blocked_task",
            taskId: "task-1",
            summary: "Missing acceptance criteria"
          }
        ],
        actions: [
          {
            kind: "follow_up_owner",
            taskId: "task-1",
            priority: "high",
            reason: "Missing acceptance criteria"
          }
        ],
        reminders: [
          {
            kind: "followup_due",
            ownerId: "owner-1",
            taskId: "task-1",
            summary: "Implement AutoAide needs follow-up"
          }
        ]
      }
    });

    expect(replies).toHaveLength(2);
    expect(delivered).toEqual([
      "Need your clarification or confirmation: Missing acceptance criteria",
      "Reminder: Implement AutoAide needs follow-up"
    ]);
  });

  it("dedupes repeated supervision replies before dispatch", async () => {
    const replies = await buildSupervisionReplies({
      targets: [
        {
          ownerId: "owner-1",
          channel: "telegram",
          peerId: "peer-1"
        }
      ],
      now: 100,
      supervision: {
        alerts: [],
        actions: [
          {
            kind: "follow_up_owner",
            taskId: "task-1",
            priority: "high",
            reason: "Missing acceptance criteria"
          },
          {
            kind: "follow_up_owner",
            taskId: "task-1",
            priority: "high",
            reason: "Missing acceptance criteria"
          }
        ],
        reminders: [
          {
            kind: "followup_due",
            ownerId: "owner-1",
            taskId: "task-1",
            summary: "Implement AutoAide needs follow-up"
          }
        ]
      }
    });

    expect(replies).toHaveLength(2);
  });

  it("degrades gracefully when channel dispatch fails", async () => {
    const bridge = new InMemoryChannelBridge();
    bridge.register("telegram", {
      async send(reply) {
        if (reply.kind === "alert") {
          throw new Error("channel offline");
        }
      }
    });

    const report = await dispatchSupervisionRepliesSafely({
      bridge,
      targets: [
        {
          ownerId: "owner-1",
          channel: "telegram",
          peerId: "peer-1"
        }
      ],
      now: 100,
      supervision: {
        alerts: [],
        actions: [],
        reminders: [
          {
            kind: "followup_due",
            ownerId: "owner-1",
            taskId: "task-1",
            summary: "Implement AutoAide needs follow-up"
          }
        ]
      }
    });

    expect(report.sent).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.error).toBe("channel offline");
  });
});
