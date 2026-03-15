import { describe, expect, it } from "vitest";
import { InMemoryManagerMemory, InMemoryMemoryStore } from "@autoaide/memory-system";
import { InMemoryTaskStore } from "@autoaide/task-system";
import { createCommitment, createTask } from "@autoaide/task-system";
import { InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";
import {
  CodexManagerRuntime,
  DeterministicManagerRuntime,
  applyManagerToolCalls,
  buildManagerGrounding,
  buildManagerReply,
  buildCodexManagerInvocation,
  buildCodexManagerPrompt,
  createDefaultManagerRuntime,
  decodeCodexManagerCommandResult,
  executeManagerTurn,
  interpretOwnerMessage,
  previewOwnerMessage,
  parseCodexManagerResponse
} from "./index.js";

describe("manager-runtime", () => {
  it("interprets owner messages into manager intent", () => {
    expect(
      interpretOwnerMessage({
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Refine AutoAide TUI\nMake the default view conversation-first",
        createdAt: 100
      })
    ).toEqual({
      ownerId: "owner-1",
      title: "Refine AutoAide TUI",
      goal: "Make the default view conversation-first",
      sourceMessageId: "message-1",
      mode: "managed_task",
      needsClarification: false,
      clarificationQuestion: undefined
    });
  });

  it("classifies simple questions as conversation_only", () => {
    expect(
      interpretOwnerMessage({
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "what can you do?",
        createdAt: 100
      })
    ).toMatchObject({
      mode: "conversation_only",
      needsClarification: false
    });
  });

  it("returns a clarification reply for underspecified messages", async () => {
    const runtime = new DeterministicManagerRuntime();
    const store = new InMemoryTaskStore();
    const result = await runtime.respond({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Fix it",
        createdAt: 100
      },
      store,
      rootTaskId: "task-root",
      now: 120
    });

    expect(result.plan).toBeUndefined();
    expect(result.reply.kind).toBe("clarification");
    expect(result.reply.text).toBe("Please provide a more specific goal, scope, or completion criteria.");
    expect(result.toolCalls).toEqual([
      {
        kind: "ask_owner",
        question: "Please provide a more specific goal, scope, or completion criteria.",
        reason: "owner_goal_is_underspecified"
      }
    ]);
  });

  it("answers conversation-only messages without orchestration tool calls", async () => {
    const runtime = new DeterministicManagerRuntime();
    const store = new InMemoryTaskStore();
    const result = await runtime.respond({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "what can you do?",
        createdAt: 100
      },
      store,
      rootTaskId: "task-root",
      now: 120
    });

    expect(result.intent.mode).toBe("conversation_only");
    expect(result.plan).toBeUndefined();
    expect(result.toolCalls).toEqual([]);
    expect(result.reply.kind).toBe("summary");
    expect(store.listTasks()).toHaveLength(0);
  });

  it("previews owner messages and builds a clarification reply", async () => {
    const result = await previewOwnerMessage({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Fix it",
        createdAt: 100
      },
      runtime: new DeterministicManagerRuntime(),
      now: 120
    });

    expect(result.intent.needsClarification).toBe(true);
    expect(result.reply).toEqual({
      ownerId: "owner-1",
      channel: "web",
      peerId: "peer-1",
      kind: "clarification",
      text: "Please provide a more specific goal, scope, or completion criteria.",
      createdAt: 120
    });
  });

  it("creates a plan and applies it through the deterministic runtime", async () => {
    const runtime = new DeterministicManagerRuntime();
    const store = new InMemoryTaskStore();
    const result = await runtime.respond({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Outline the next AutoAide CLI development plan and acceptance criteria",
        createdAt: 100
      },
      store,
      rootTaskId: "task-root",
      now: 120
    });

    expect(result.reply.kind).toBe("summary");
    expect(result.plan?.rootTask.id).toBe("task-root");
    expect(store.listTasks()).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      kind: "create_tasks",
      reason: "convert_owner_goal_into_task_graph"
    });
  });

  it("executes a manager turn and applies tool calls into state", async () => {
    const store = new InMemoryTaskStore();
    const memoryStore = new InMemoryMemoryStore(120);
    const workerRegistry = new InMemoryWorkerRegistry();

    const result = await executeManagerTurn({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Outline the next AutoAide CLI development plan and acceptance criteria",
        createdAt: 100
      },
      store,
      runtime: new DeterministicManagerRuntime(),
      memoryStore,
      workerRegistry,
      rootTaskId: "task-root",
      now: 120
    });

    expect(result.reply.text).toContain("Captured");
    expect(result.behaviorReceipts.map((receipt) => receipt.kind)).toEqual([
      "intent_interpreted",
      "reply_prepared",
      "plan_created",
      "tool_calls_emitted"
    ]);
    expect(result.actionReceipts.map((receipt) => receipt.toolCall)).toEqual([
      "create_tasks",
      "record_decision",
      "assign_worker",
      "schedule_followup"
    ]);
    expect(store.listTasks()).toHaveLength(1);
    expect(store.listAssignments()).toHaveLength(1);
    expect(memoryStore.listDecisionRecords()).toHaveLength(1);
    expect(store.listAssignments()[0]).toMatchObject({
      deliverable: "Return a concise progress summary and any concrete findings.",
      completionSignal: "The worker reports a concrete result summary for the assigned task."
    });
  });

  it("prefers taskId when applying assignment and follow-up tool calls", () => {
    const store = new InMemoryTaskStore();
    const memoryStore = new InMemoryMemoryStore(100);
    const workerRegistry = new InMemoryWorkerRegistry();

    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Investigate Failing Test",
      goal: "Find the failure",
      status: "planned",
      priority: "high",
      createdAt: 100,
      updatedAt: 100
    });

    const receipts = applyManagerToolCalls({
      ownerId: "owner-1",
      store,
      memoryStore,
      workerRegistry,
      now: 100,
      toolCalls: [
        {
          kind: "assign_worker",
          taskId: "task-1",
          taskTitle: "Investigate failing test",
          objective: "Investigate the failing test",
          deliverable: "Return the failing test names and likely cause",
          completionSignal: "A concise root-cause summary is returned",
          selectionReason: "worker has the best test triage context",
          reason: "step_ready_for_execution"
        },
        {
          kind: "schedule_followup",
          taskId: "task-1",
          taskTitle: "Investigate failing test",
          summary: "Check back on the investigation status",
          dueInMinutes: 30,
          reason: "track_progress"
        }
      ]
    });

    expect(receipts.every((receipt) => receipt.status === "applied")).toBe(true);
    expect(store.listAssignments()[0]).toMatchObject({
      taskId: "task-1",
      deliverable: "Return the failing test names and likely cause",
      completionSignal: "A concise root-cause summary is returned",
      inputs: {
        source: "manager_tool_call",
        reason: "step_ready_for_execution",
        selectionReason: "worker has the best test triage context"
      }
    });
    expect(store.listCommitments()).toHaveLength(1);
  });

  it("surfaces missing task receipts for assignment and follow-up tool calls", async () => {
    const store = new InMemoryTaskStore();
    const runtime = {
      async respond() {
        return {
          intent: {
            ownerId: "owner-1",
            title: "Investigate the failing test",
            goal: "Identify the failing test and the likely cause",
            sourceMessageId: "message-1",
            mode: "managed_task" as const,
            needsClarification: false
          },
          plan: {
            rootTask: createTask({
              id: "task-root",
              ownerId: "owner-1",
              title: "Investigate the failing test",
              goal: "Identify the failing test and the likely cause",
              now: 120,
              priority: "high"
            }),
            tasks: [
              createTask({
                id: "task-1",
                ownerId: "owner-1",
                title: "Capture the failing test output",
                goal: "Reproduce the failure and collect the error",
                now: 121,
                priority: "high"
              }),
              createTask({
                id: "task-2",
                ownerId: "owner-1",
                title: "Inspect the likely regression area",
                goal: "Find the code path most likely causing the failure",
                now: 122,
                priority: "medium"
              }),
              createTask({
                id: "task-3",
                ownerId: "owner-1",
                title: "Document the escalation path",
                goal: "Summarize the root cause or next escalation step",
                now: 123,
                priority: "medium"
              })
            ]
          },
          reply: {
            kind: "summary" as const,
            text: "I’ll treat this as a concrete investigation request and start a focused test-failure triage flow: identify the failing test, capture the error, and determine the likely cause or escalation path."
          },
          toolCalls: [
            {
              kind: "create_tasks" as const,
              steps: [
                {
                  title: "Capture the failing test output",
                  goal: "Reproduce the failure and collect the error",
                  priority: "high" as const
                }
              ],
              reason: "convert_owner_goal_into_task_graph"
            },
            {
              kind: "assign_worker" as const,
              taskTitle: "Investigate failing test",
              objective: "Investigate the failing test",
              reason: "step_ready_for_execution"
            },
            {
              kind: "schedule_followup" as const,
              taskTitle: "Investigate failing test",
              summary: "Check back on the investigation status",
              dueInMinutes: 30,
              reason: "track_progress"
            }
          ]
        };
      }
    };

    const result = await executeManagerTurn({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Investigate the failing test",
        createdAt: 100
      },
      store,
      runtime,
      rootTaskId: "task-root",
      now: 120
    });

    expect(result.behaviorReceipts).toEqual(
      expect.arrayContaining([
        {
          kind: "plan_created",
          summary: "manager created 4 planned task(s)"
        }
      ])
    );
    expect(result.actionReceipts).toEqual([
      {
        toolCall: "create_tasks",
        status: "applied",
        summary: "manager confirmed 1 planned task(s)"
      },
      {
        toolCall: "assign_worker",
        status: "skipped",
        summary: "task not found for assignment: Investigate failing test"
      },
      {
        toolCall: "schedule_followup",
        status: "skipped",
        summary: "task not found for follow-up: Investigate failing test"
      }
    ]);
  });

  it("applies manager tool calls directly from manager-runtime", () => {
    const store = new InMemoryTaskStore();
    const memoryStore = new InMemoryMemoryStore(100);
    const workerRegistry = new InMemoryWorkerRegistry();
    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Refine AutoAide TUI",
      goal: "Make the default UI conversation-first",
      status: "planned",
      priority: "high",
      createdAt: 100,
      updatedAt: 100
    });

    const receipts = applyManagerToolCalls({
      ownerId: "owner-1",
      store,
      memoryStore,
      workerRegistry,
      now: 100,
      toolCalls: [
        {
          kind: "record_decision",
          summary: "Keep the default TUI conversation-first"
        },
        {
          kind: "assign_worker",
          taskTitle: "Refine AutoAide TUI",
          objective: "Adjust the default UI layout",
          reason: "step_ready_for_execution"
        }
      ]
    });

    expect(receipts.every((receipt) => receipt.status === "applied")).toBe(true);
    expect(memoryStore.listDecisionRecords()).toHaveLength(1);
    expect(store.listAssignments()).toHaveLength(1);
  });

  it("applies manager review actions for nudge, replacement, and completion", () => {
    const store = new InMemoryTaskStore();
    const workerRegistry = new InMemoryWorkerRegistry();
    store.upsertTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Investigate Failing Test",
      goal: "Find and explain the failing test",
      status: "reviewing",
      priority: "high",
      workerId: "worker-1",
      createdAt: 100,
      updatedAt: 100
    });
    workerRegistry.registerWorker({
      workerId: "worker-1",
      strengths: ["testing"],
      now: 100
    });
    workerRegistry.registerWorker({
      workerId: "worker-2",
      strengths: ["testing"],
      now: 101
    });

    const receipts = applyManagerToolCalls({
      ownerId: "owner-1",
      store,
      workerRegistry,
      now: 120,
      toolCalls: [
        {
          kind: "nudge_worker",
          taskId: "task-1",
          workerId: "worker-1",
          message: "Please summarize the current blocker.",
          reason: "awaiting_progress_signal"
        },
        {
          kind: "replace_worker",
          taskId: "task-1",
          preferredWorkerId: "worker-2",
          objective: "Take over the failing test investigation",
          deliverable: "Return the test failure summary and likely cause",
          completionSignal: "A concise investigation summary is returned",
          reason: "need_fresh_executor"
        },
        {
          kind: "mark_task_done",
          taskId: "task-1",
          summary: "The failure is explained and no more execution is needed.",
          reason: "review_complete"
        }
      ]
    });

    expect(receipts).toEqual([
      {
        toolCall: "nudge_worker",
        status: "applied",
        summary: "nudged worker-1 on Investigate Failing Test: Please summarize the current blocker."
      },
      {
        toolCall: "replace_worker",
        status: "applied",
        summary: "reassigned Investigate Failing Test to worker-2"
      },
      {
        toolCall: "mark_task_done",
        status: "applied",
        summary: "marked Investigate Failing Test done: The failure is explained and no more execution is needed."
      }
    ]);
    expect(store.listAssignments()).toHaveLength(1);
    expect(store.listAssignments()[0]).toMatchObject({
      workerId: "worker-2",
      deliverable: "Return the test failure summary and likely cause",
      completionSignal: "A concise investigation summary is returned"
    });
    expect(store.getTask("task-1")?.status).toBe("done");
  });

  it("parses a codex manager response payload", () => {
    expect(
      parseCodexManagerResponse(
        JSON.stringify({
          intent: {
            title: "Refine AutoAide TUI",
            goal: "Make the default view conversation-first",
            needsClarification: false
          },
          reply: {
            kind: "summary",
            text: "I will first adjust the default conversation view, then keep /status for explicit detail."
          },
          plan: {
            steps: [
              {
                title: "Compress default status",
                goal: "Reduce the default dashboard to one compact status line",
                priority: "high"
              }
            ]
          },
          toolCalls: [
            {
              kind: "assign_worker",
              taskId: "task-1",
              taskTitle: "Compress default status",
              objective: "Adjust default TUI status presentation",
              deliverable: "Return the updated compact status approach",
              completionSignal: "The worker reports the compact status approach",
              selectionReason: "best suited for TUI status work",
              reason: "step_ready_for_execution"
            }
          ]
        })
      )
    ).toMatchObject({
      reply: {
        kind: "summary"
      },
      toolCalls: [
        {
          kind: "assign_worker",
          taskId: "task-1",
          taskTitle: "Compress default status",
          objective: "Adjust default TUI status presentation",
          deliverable: "Return the updated compact status approach",
          completionSignal: "The worker reports the compact status approach",
          selectionReason: "best suited for TUI status work",
          reason: "step_ready_for_execution"
        }
      ]
    });
  });
  it("rejects invalid manager tool call payloads", () => {
    expect(() =>
      parseCodexManagerResponse(
        JSON.stringify({
          intent: {
            title: "Refine AutoAide TUI",
            goal: "Make the default view conversation-first",
            needsClarification: false
          },
          reply: {
            kind: "summary",
            text: "Understood the request."
          },
          toolCalls: [
            {
              kind: "schedule_followup",
              taskTitle: "Refine AutoAide TUI",
              summary: "Remind in one day",
              dueInMinutes: 0,
              reason: "invalid"
            }
          ]
        })
      )
    ).toThrow("invalid schedule_followup tool call");
  });

  it("parses manager review action payloads", () => {
    expect(
      parseCodexManagerResponse(
        JSON.stringify({
          intent: {
            title: "Review failing test investigation",
            goal: "Decide the next manager action after worker review",
            needsClarification: false
          },
          reply: {
            kind: "summary",
            text: "I will close the task because the investigation already produced a sufficient explanation."
          },
          toolCalls: [
            {
              kind: "mark_task_done",
              taskId: "task-1",
              taskTitle: "Investigate Failing Test",
              summary: "The investigation is complete.",
              reason: "review_complete"
            }
          ]
        })
      )
    ).toMatchObject({
      toolCalls: [
        {
          kind: "mark_task_done",
          taskId: "task-1",
          taskTitle: "Investigate Failing Test",
          summary: "The investigation is complete.",
          reason: "review_complete"
        }
      ]
    });
  });

  it("decodes a codex manager JSONL event stream", () => {
    const response = decodeCodexManagerCommandResult({
      commandResult: {
        stdout: [
          JSON.stringify({ type: "session.started" }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({
                intent: {
                  title: "Refine AutoAide TUI",
                  goal: "Make the default view conversation-first",
                  needsClarification: false
                },
                reply: {
                  kind: "summary",
                  text: "Understood the request and will adjust the conversation-first layout first."
                }
              })
            }
          })
        ].join("\n"),
        stderr: "",
        exitCode: 0
      }
    });

    expect(response.reply.text).toContain("Understood the request");
  });

  it("builds a codex manager invocation with current task summaries", () => {
    const store = new InMemoryTaskStore();
    const now = Date.now();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Refine AutoAide TUI owner conversation experience",
        goal: "Make the default UI conversation-first",
        now,
        priority: "high"
      })
    );
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "Confirm owner conversation direction today",
        dueAt: now - 1_000,
        now
      })
    );
    const memoryStore = new InMemoryMemoryStore(now);
    memoryStore.appendDecisionRecord({
      id: "decision-1",
      ownerId: "owner-1",
      taskId: "task-1",
      summary: "Default TUI should become conversation-first",
      createdAt: now
    });
    const memory = new InMemoryManagerMemory(store, memoryStore);
    const invocation = buildCodexManagerInvocation({
      runId: "manager-run-1",
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Refine AutoAide TUI owner conversation experience",
        createdAt: 100
      },
      store,
      memory,
      conversation: {
        activeRootTaskId: "task-root-1",
        activeTaskTitle: "Refine AutoAide TUI owner conversation experience",
        pendingClarificationQuestion: "Please confirm the completion criteria",
        recentMessages: [
          { role: "owner", text: "Please review the TUI first" },
          { role: "manager", text: "Please confirm the completion criteria" }
        ]
      },
      policy: {
        workspaceRoot: process.cwd(),
        maxRuntimeMs: 30_000
      }
    });

    expect(invocation.args).toEqual(["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", "-"]);
    expect(invocation.stdin).toContain("You are the persistent manager agent for AutoAide.");
    expect(invocation.stdin).toContain("Preclassified request mode: managed_task");
    expect(invocation.stdin).toContain("Confirm owner conversation direction today");
    expect(invocation.stdin).toContain("Default TUI should become conversation-first");
    expect(invocation.stdin).toContain('"kind":"assign_worker"');
    expect(invocation.stdin).toContain('"pendingClarificationQuestion":"Please confirm the completion criteria"');
    expect(invocation.stdin).toContain('"activeRootTaskId":"task-root-1"');
  });

  it("builds a manager prompt with recent conversation context", () => {
    const prompt = buildCodexManagerPrompt({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Keep pushing AutoAide TUI forward",
        createdAt: 100
      },
      grounding: {
        tasks: [],
        blockedTasks: [],
        overdueCommitments: [],
        workers: [],
        recentDecisions: []
      },
      conversation: {
        activeRootTaskId: "task-root-1",
        activeTaskTitle: "Refine AutoAide TUI",
        pendingClarificationQuestion: "Please confirm the completion criteria",
        recentMessages: [
          { role: "owner", text: "Please review the TUI first" },
          { role: "manager", text: "Please confirm the completion criteria" },
          { role: "owner", text: "It should become conversation-first" }
        ]
      }
    });

    expect(prompt).toContain("Conversation context JSON:");
    expect(prompt).toContain('"activeTaskTitle":"Refine AutoAide TUI"');
    expect(prompt).toContain('"role":"manager"');
    expect(prompt).toContain("Please confirm the completion criteria");
  });

  it("builds manager replies from a runtime draft", () => {
    expect(
      buildManagerReply({
        message: {
          id: "message-1",
          ownerId: "owner-1",
          channel: "web",
          peerId: "peer-1",
          text: "Keep going",
          createdAt: 100
        },
        reply: {
          kind: "summary",
          text: "I have started coordinating the work."
        },
        now: 120
      })
    ).toEqual({
      ownerId: "owner-1",
      channel: "web",
      peerId: "peer-1",
      kind: "summary",
      text: "I have started coordinating the work.",
      createdAt: 120
    });
  });

  it("builds manager grounding from memory snapshots", () => {
    const now = Date.now();
    const store = new InMemoryTaskStore();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Refine AutoAide TUI",
        goal: "Make the default view conversation-first",
        now,
        priority: "high"
      })
    );
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "Add manager grounding design",
        dueAt: now - 100,
        now
      })
    );
    const memoryStore = new InMemoryMemoryStore(now);
    memoryStore.upsertWorker({
      id: "worker-1",
      executorType: "codex",
      status: "idle",
      strengths: ["typescript"],
      preferredTaskTypes: ["tui-refactor"],
      recentTaskTypes: ["Refine AutoAide TUI"],
      lastHeartbeatAt: now - 1_000,
      lastOutcome: "succeeded",
      lastOutcomeAt: now - 2_000,
      createdAt: now,
      updatedAt: now
    });
    memoryStore.appendDecisionRecord({
      id: "decision-1",
      ownerId: "owner-1",
      taskId: "task-1",
      summary: "Manager default must use Codex runtime",
      createdAt: now
    });
    const grounding = buildManagerGrounding({
      store,
      memory: new InMemoryManagerMemory(store, memoryStore),
      now
    });

    expect(grounding.tasks[0]?.title).toBe("Refine AutoAide TUI");
    expect(grounding.overdueCommitments).toContain("Add manager grounding design");
    expect(grounding.workers[0]).toMatchObject({
      workerId: "worker-1",
      strengths: ["typescript"],
      preferredTaskTypes: ["tui-refactor"],
      recentTaskTypes: ["Refine AutoAide TUI"],
      recentOutcome: "succeeded",
      reuseHint: "Recently handled Refine AutoAide TUI"
    });
    expect(grounding.workers[0]?.lastHeartbeatAgeMs).toBe(1_000);
    expect(grounding.recentDecisions).toContain("Manager default must use Codex runtime");
  });

  it("uses the codex manager runtime to apply a structured response", async () => {
    const runtime = new CodexManagerRuntime(
      {
        async run() {
          return {
            stdout: JSON.stringify({
              intent: {
                title: "Refine AutoAide TUI",
                goal: "Make the default view conversation-first",
                needsClarification: false
              },
              reply: {
                kind: "summary",
                text: "I will first adjust the default layout, then keep /status as the explicit detail entry point."
              },
              plan: {
                steps: [
                  {
                    title: "Compress status bar",
                    goal: "Keep only one compact status line",
                    priority: "high"
                  }
                ]
              },
              toolCalls: [
                {
                  kind: "record_decision",
                  summary: "Default TUI should stay owner conversation-first"
                },
                {
                  kind: "assign_worker",
                  taskTitle: "Compress status bar",
                  objective: "Keep only one compact status line",
                  reason: "step_ready_for_execution"
                }
              ]
            }),
            stderr: "",
            exitCode: 0
          };
        }
      },
      {
        workspaceRoot: process.cwd(),
        maxRuntimeMs: 30_000
      }
    );
    const store = new InMemoryTaskStore();
    const result = await runtime.respond({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "Refine AutoAide TUI owner conversation experience",
        createdAt: 100
      },
      store,
      rootTaskId: "task-root",
      now: 120
    });

    expect(result.reply.text).toContain("adjust the default layout");
    expect(result.plan?.tasks).toHaveLength(1);
    expect(store.listTasks()).toHaveLength(2);
    expect(result.toolCalls).toEqual([
      {
        kind: "record_decision",
        summary: "Default TUI should stay owner conversation-first"
      },
      {
        kind: "assign_worker",
        taskTitle: "Compress status bar",
        objective: "Keep only one compact status line",
        reason: "step_ready_for_execution"
      }
    ]);
  });

  it("creates a codex-backed manager runtime by default", () => {
    expect(createDefaultManagerRuntime()).toBeInstanceOf(CodexManagerRuntime);
  });

  it("creates a codex-backed manager runtime when requested", () => {
    expect(createDefaultManagerRuntime({ mode: "codex" })).toBeInstanceOf(CodexManagerRuntime);
  });

  it("creates a deterministic manager runtime only when explicitly requested", () => {
    expect(createDefaultManagerRuntime({ mode: "deterministic" })).toBeInstanceOf(
      DeterministicManagerRuntime
    );
  });
});
