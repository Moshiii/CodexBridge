import { describe, expect, it } from "vitest";
import { InMemoryManagerMemory, InMemoryMemoryStore } from "@autoaide/memory-system";
import { InMemoryTaskStore } from "@autoaide/task-system";
import { createCommitment, createTask } from "@autoaide/task-system";
import {
  CodexManagerRuntime,
  DeterministicManagerRuntime,
  buildManagerGrounding,
  buildCodexManagerInvocation,
  buildCodexManagerPrompt,
  createDefaultManagerRuntime,
  decodeCodexManagerCommandResult,
  interpretOwnerMessage,
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
        text: "整理 AutoAide TUI\n把默认视图改成对话优先",
        createdAt: 100
      })
    ).toEqual({
      ownerId: "owner-1",
      title: "整理 AutoAide TUI",
      goal: "把默认视图改成对话优先",
      sourceMessageId: "message-1",
      needsClarification: false,
      clarificationQuestion: undefined
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
        text: "修一下",
        createdAt: 100
      },
      store,
      rootTaskId: "task-root",
      now: 120
    });

    expect(result.plan).toBeUndefined();
    expect(result.reply.kind).toBe("clarification");
    expect(result.reply.text).toBe("请补充更具体的目标、范围或完成标准。");
    expect(result.toolCalls).toEqual([
      {
        kind: "ask_owner",
        question: "请补充更具体的目标、范围或完成标准。",
        reason: "owner_goal_is_underspecified"
      }
    ]);
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
        text: "整理 AutoAide CLI 的下一步开发计划和验收标准",
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

  it("parses a codex manager response payload", () => {
    expect(
      parseCodexManagerResponse(
        JSON.stringify({
          intent: {
            title: "整理 AutoAide TUI",
            goal: "把默认视图改成对话优先",
            needsClarification: false
          },
          reply: {
            kind: "summary",
            text: "我会先调整默认对话视图，再保留 /status 展示细节。"
          },
          plan: {
            steps: [
              {
                title: "压缩默认状态",
                goal: "把默认 dashboard 压成一行 compact status",
                priority: "high"
              }
            ]
          },
          toolCalls: [
            {
              kind: "assign_worker",
              taskTitle: "压缩默认状态",
              objective: "调整 TUI 默认状态呈现",
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
          taskTitle: "压缩默认状态",
          objective: "调整 TUI 默认状态呈现",
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
            title: "整理 AutoAide TUI",
            goal: "把默认视图改成对话优先",
            needsClarification: false
          },
          reply: {
            kind: "summary",
            text: "已理解需求。"
          },
          toolCalls: [
            {
              kind: "schedule_followup",
              taskTitle: "整理 AutoAide TUI",
              summary: "一天后提醒",
              dueInMinutes: 0,
              reason: "invalid"
            }
          ]
        })
      )
    ).toThrow("invalid schedule_followup tool call");
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
                  title: "整理 AutoAide TUI",
                  goal: "把默认视图改成对话优先",
                  needsClarification: false
                },
                reply: {
                  kind: "summary",
                  text: "已理解需求，会先调整 conversation-first 布局。"
                }
              })
            }
          })
        ].join("\n"),
        stderr: "",
        exitCode: 0
      }
    });

    expect(response.reply.text).toContain("已理解需求");
  });

  it("builds a codex manager invocation with current task summaries", () => {
    const store = new InMemoryTaskStore();
    const now = Date.now();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "整理 AutoAide TUI 的 owner 对话体验",
        goal: "把默认界面改成对话优先",
        now,
        priority: "high"
      })
    );
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "今天确认 owner 对话体验方向",
        dueAt: now - 1_000,
        now
      })
    );
    const memoryStore = new InMemoryMemoryStore(now);
    memoryStore.appendDecisionRecord({
      id: "decision-1",
      ownerId: "owner-1",
      taskId: "task-1",
      summary: "默认 TUI 改成 conversation-first",
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
        text: "整理 AutoAide TUI 的 owner 对话体验",
        createdAt: 100
      },
      store,
      memory,
      conversation: {
        activeRootTaskId: "task-root-1",
        activeTaskTitle: "整理 AutoAide TUI 的 owner 对话体验",
        pendingClarificationQuestion: "请确认完成标准",
        recentMessages: [
          { role: "owner", text: "先整理一下 TUI" },
          { role: "manager", text: "请确认完成标准" }
        ]
      },
      policy: {
        workspaceRoot: process.cwd(),
        maxRuntimeMs: 30_000
      }
    });

    expect(invocation.args).toEqual(["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", "-"]);
    expect(invocation.stdin).toContain("You are the persistent manager agent for AutoAide.");
    expect(invocation.stdin).toContain("今天确认 owner 对话体验方向");
    expect(invocation.stdin).toContain("默认 TUI 改成 conversation-first");
    expect(invocation.stdin).toContain('"kind":"assign_worker"');
    expect(invocation.stdin).toContain('"pendingClarificationQuestion":"请确认完成标准"');
    expect(invocation.stdin).toContain('"activeRootTaskId":"task-root-1"');
  });

  it("builds a manager prompt with recent conversation context", () => {
    const prompt = buildCodexManagerPrompt({
      message: {
        id: "message-1",
        ownerId: "owner-1",
        channel: "web",
        peerId: "peer-1",
        text: "继续推进 AutoAide TUI",
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
        activeTaskTitle: "整理 AutoAide TUI",
        pendingClarificationQuestion: "请确认完成标准",
        recentMessages: [
          { role: "owner", text: "先整理一下 TUI" },
          { role: "manager", text: "请确认完成标准" },
          { role: "owner", text: "要改成 conversation-first" }
        ]
      }
    });

    expect(prompt).toContain("Conversation context JSON:");
    expect(prompt).toContain('"activeTaskTitle":"整理 AutoAide TUI"');
    expect(prompt).toContain('"role":"manager"');
    expect(prompt).toContain("请确认完成标准");
  });

  it("builds manager grounding from memory snapshots", () => {
    const now = Date.now();
    const store = new InMemoryTaskStore();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "整理 AutoAide TUI",
        goal: "把默认视图改成对话优先",
        now,
        priority: "high"
      })
    );
    store.upsertCommitment(
      createCommitment({
        id: "commitment-1",
        ownerId: "owner-1",
        taskId: "task-1",
        summary: "补 manager grounding 设计",
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
      createdAt: now,
      updatedAt: now
    });
    memoryStore.appendDecisionRecord({
      id: "decision-1",
      ownerId: "owner-1",
      taskId: "task-1",
      summary: "manager 默认必须是 Codex runtime",
      createdAt: now
    });
    const grounding = buildManagerGrounding({
      store,
      memory: new InMemoryManagerMemory(store, memoryStore),
      now
    });

    expect(grounding.tasks[0]?.title).toBe("整理 AutoAide TUI");
    expect(grounding.overdueCommitments).toContain("补 manager grounding 设计");
    expect(grounding.workers[0]?.workerId).toBe("worker-1");
    expect(grounding.recentDecisions).toContain("manager 默认必须是 Codex runtime");
  });

  it("uses the codex manager runtime to apply a structured response", async () => {
    const runtime = new CodexManagerRuntime(
      {
        async run() {
          return {
            stdout: JSON.stringify({
              intent: {
                title: "整理 AutoAide TUI",
                goal: "把默认视图改成对话优先",
                needsClarification: false
              },
              reply: {
                kind: "summary",
                text: "我会先调整默认布局，再保留 /status 作为显式查看入口。"
              },
              plan: {
                steps: [
                  {
                    title: "压缩状态栏",
                    goal: "只保留一行 compact status",
                    priority: "high"
                  }
                ]
              },
              toolCalls: [
                {
                  kind: "record_decision",
                  summary: "默认 TUI 保持 owner conversation-first"
                },
                {
                  kind: "assign_worker",
                  taskTitle: "压缩状态栏",
                  objective: "只保留一行 compact status",
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
        text: "整理 AutoAide TUI 的 owner 对话体验",
        createdAt: 100
      },
      store,
      rootTaskId: "task-root",
      now: 120
    });

    expect(result.reply.text).toContain("调整默认布局");
    expect(result.plan?.tasks).toHaveLength(1);
    expect(store.listTasks()).toHaveLength(2);
    expect(result.toolCalls).toEqual([
      {
        kind: "record_decision",
        summary: "默认 TUI 保持 owner conversation-first"
      },
      {
        kind: "assign_worker",
        taskTitle: "压缩状态栏",
        objective: "只保留一行 compact status",
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
