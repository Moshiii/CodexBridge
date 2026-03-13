import { InMemoryTaskStore } from "@autoaide/task-system";
import { describe, expect, it } from "vitest";
import { DeterministicManagerRuntime } from "@autoaide/manager-runtime";
import { InMemoryMemoryStore } from "@autoaide/memory-system";
import { InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";
import {
  applyManagerToolCalls,
  buildManagerFollowupReceipts,
  buildSupervisionReplies,
  createReminderReply,
  dispatchSupervisionRepliesSafely,
  dispatchSupervisionReplies,
  InMemoryChannelBridge,
  createEscalationReply,
  createSummaryReply,
  handleOwnerIngress,
  ingestOwnerGoalAndPlan,
  parseOwnerMessage,
  summarizeManagerBehaviors
} from "./index.js";

describe("owner-interface", () => {
  it("parses owner messages into task intents", () => {
    expect(
      parseOwnerMessage({
        id: "message-1",
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        text: "实现 AutoAide\n先把 owner-interface 做出来",
        createdAt: 100
      })
    ).toEqual({
      ownerId: "owner-1",
      title: "实现 AutoAide",
      goal: "先把 owner-interface 做出来",
      sourceMessageId: "message-1",
      needsClarification: false,
      clarificationQuestion: undefined
    });
  });

  it("requests clarification for underspecified owner messages", async () => {
    const bridge = new InMemoryChannelBridge();
    const delivered: string[] = [];
    bridge.register("telegram", {
      async send(reply) {
        delivered.push(reply.text);
      }
    });

    const intent = await handleOwnerIngress({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        text: "修一下",
        createdAt: 100
      },
      bridge,
      runtime: new DeterministicManagerRuntime(),
      now: 120
    });

    expect(intent.needsClarification).toBe(true);
    expect(delivered).toEqual(["请补充更具体的目标、范围或完成标准。"]);
  });

  it("builds summary replies", () => {
    expect(
      createSummaryReply({
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        title: "实现 AutoAide",
        tasksCreated: 3,
        nextStep: "开始派发第一个任务",
        now: 100
      })
    ).toEqual({
      ownerId: "owner-1",
      channel: "telegram",
      peerId: "peer-1",
      kind: "summary",
      text: "已记录任务《实现 AutoAide》，当前拆出 3 个任务。 下一步：开始派发第一个任务",
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
          reason: "缺少验收标准"
        },
        now: 100
      }).text
    ).toBe("需要你补充或确认：缺少验收标准");
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
          summary: "今天回复验收标准"
        },
        now: 100
      }).text
    ).toBe("提醒：你承诺的事项已到期，今天回复验收标准");
  });

  it("summarizes manager behaviors from a runtime response", () => {
    const receipts = summarizeManagerBehaviors({
      intent: {
        ownerId: "owner-1",
        title: "整理 AutoAide TUI",
        goal: "改成 conversation-first",
        sourceMessageId: "message-1",
        needsClarification: false
      },
      reply: {
        kind: "summary",
        text: "已开始安排。"
      },
      plan: {
        rootTask: {
          id: "task-root",
          ownerId: "owner-1",
          title: "整理 AutoAide TUI",
          goal: "改成 conversation-first",
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
          taskTitle: "整理 AutoAide TUI",
          objective: "改布局",
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

  it("ingests an owner goal, creates a plan, and sends a summary reply", async () => {
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

    const result = await ingestOwnerGoalAndPlan({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "telegram",
        peerId: "peer-1",
        text: "实现 AutoAide\n先把 owner-interface 做出来",
        createdAt: 100
      },
      store,
      bridge,
      runtime: new DeterministicManagerRuntime(),
      memoryStore,
      workerRegistry,
      rootTaskId: "task-root",
      now: 120
    });

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
    expect(delivered).toEqual(["已记录任务《实现 AutoAide》，当前拆出 1 个任务。 下一步：经理将继续安排执行器处理"]);
  });

  it("applies manager tool calls into memory, follow-up, and worker assignment state", () => {
    const store = new InMemoryTaskStore();
    const now = 100;
    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "整理 AutoAide TUI",
      goal: "把默认界面改成对话优先",
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
          summary: "默认 TUI 保持对话优先"
        },
        {
          kind: "schedule_followup",
          taskTitle: "整理 AutoAide TUI",
          summary: "一小时后回看进度",
          dueInMinutes: 60,
          reason: "monitor_progress"
        },
        {
          kind: "assign_worker",
          taskTitle: "整理 AutoAide TUI",
          objective: "调整默认界面布局",
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
      title: "整理 AutoAide TUI",
      goal: "改成 conversation-first",
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
      activeTaskTitle: "整理 AutoAide TUI",
      pendingClarificationQuestion: "请确认验收标准",
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
      title: "整理 AutoAide TUI",
      goal: "改成 conversation-first",
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
      activeTaskTitle: "整理 AutoAide TUI",
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
        summary: "manager marked 整理 AutoAide TUI as blocked",
        ownerText: "《整理 AutoAide TUI》当前被阻塞：worker execution failed"
      },
      {
        kind: "followup_replan_task",
        summary: "manager is preparing a replan path for 整理 AutoAide TUI",
        ownerText: "我正在为《整理 AutoAide TUI》重新规划下一步，避免这条任务线停住。"
      }
    ]);
  });

  it("escalates blocked tasks back to the owner when blocker requires owner input", () => {
    const store = new InMemoryTaskStore();
    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "整理 AutoAide TUI",
      goal: "改成 conversation-first",
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
      activeTaskTitle: "整理 AutoAide TUI",
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
            summary: "缺少验收标准"
          }
        ],
        actions: [
          {
            kind: "follow_up_owner",
            taskId: "task-1",
            priority: "high",
            reason: "缺少验收标准"
          }
        ],
        reminders: [
          {
            kind: "followup_due",
            ownerId: "owner-1",
            taskId: "task-1",
            summary: "实现 AutoAide needs follow-up"
          }
        ]
      }
    });

    expect(replies).toHaveLength(2);
    expect(delivered).toEqual([
      "需要你补充或确认：缺少验收标准",
      "提醒：实现 AutoAide needs follow-up"
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
            reason: "缺少验收标准"
          },
          {
            kind: "follow_up_owner",
            taskId: "task-1",
            priority: "high",
            reason: "缺少验收标准"
          }
        ],
        reminders: [
          {
            kind: "followup_due",
            ownerId: "owner-1",
            taskId: "task-1",
            summary: "实现 AutoAide needs follow-up"
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
            summary: "实现 AutoAide needs follow-up"
          }
        ]
      }
    });

    expect(report.sent).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.error).toBe("channel offline");
  });
});
