import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeterministicManagerRuntime } from "@autoaide/manager-runtime";
import { InMemoryMemoryStore } from "@autoaide/memory-system";
import { InMemoryTaskStore, createTask } from "@autoaide/task-system";
import { InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";
import { InMemoryCodexExecutorAdapter, InMemoryCodexRunRegistry } from "@autoaide/executor-codex";
import {
  buildOperatorDashboard,
  buildThreadListMessage,
  completeSlashCommand,
  formatConversationMessage,
  getSlashCommands,
  parseSlashCommand,
  renderInteractiveScreen,
  runCodexConnectivityCheck,
  submitOwnerMessage,
  switchRuntimeThread,
  type OperatorRuntimeState,
  type TuiScreenState
} from "./index.js";
import { appendConversationEvent, resolveAutoAideStatePaths } from "./persistence.js";

const tempStateDirs: string[] = [];

afterEach(() => {
  while (tempStateDirs.length > 0) {
    const dir = tempStateDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  delete process.env.AUTOAIDE_STATE_DIR;
});

function createTestRuntime(now: number, executor?: InMemoryCodexExecutorAdapter): OperatorRuntimeState {
  const stateDir = mkdtempSync(path.join(tmpdir(), "autoaide-tui-"));
  tempStateDirs.push(stateDir);
  process.env.AUTOAIDE_STATE_DIR = stateDir;
  return {
    now,
    paths: resolveAutoAideStatePaths("terminal-owner-local"),
    conversationId: "terminal-owner-local",
    ownerId: "owner-local",
    store: new InMemoryTaskStore(),
    registry: new InMemoryWorkerRegistry(),
    memoryStore: new InMemoryMemoryStore(now),
    runRegistry: new InMemoryCodexRunRegistry(),
    executor:
      executor ??
      new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "succeeded",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: now + 5,
        summary: "AUTOAIDE_TEST_OK"
      })),
    pendingClarification: undefined,
    activeRootTaskId: undefined,
    activeTaskTitle: undefined
  };
}

describe("tui app", () => {
  it("renders the operator dashboard", () => {
    const output = buildOperatorDashboard();
    expect(output).toContain("AutoAide Terminal Console");
    expect(output).toContain("Overview");
    expect(output).toContain("Workers");
  });

  it("runs a codex connectivity check through the tui path", async () => {
    const result = await runCodexConnectivityCheck({
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "succeeded",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: Date.now(),
        summary: request.objective.includes("WORKER_1_OK") ? "WORKER_1_OK" : "WORKER_2_OK"
      }))
    });

    expect(result.receipts).toHaveLength(2);
    expect(result.receipts.map((receipt) => receipt.managerView.summary).sort()).toEqual([
      "WORKER_1_OK",
      "WORKER_2_OK"
    ]);
    expect(result.dashboard).toContain("workers 2");
  });

  it("exposes slash commands and parses slash input", () => {
    expect(getSlashCommands().map((command) => command.name)).toContain("/workers");
    expect(getSlashCommands().map((command) => command.name)).toContain("/threads");
    expect(getSlashCommands().map((command) => command.name)).toContain("/resume");
    expect(getSlashCommands().map((command) => command.name)).toContain("/new");
    expect(getSlashCommands().map((command) => command.name)).toContain("/transcript");
    expect(parseSlashCommand("/workers now")).toEqual({
      name: "/workers",
      args: "now"
    });
  });

  it("completes slash commands for the input editor", () => {
    expect(completeSlashCommand("/wo")).toEqual([["/workers"], "/wo"]);
    expect(completeSlashCommand("/new")).toEqual([["/new"], "/new"]);
    expect(completeSlashCommand("/res")).toEqual([["/resume"], "/res"]);
    expect(completeSlashCommand("/page")).toEqual([["/pageup", "/pagedown"], "/page"]);
    expect(completeSlashCommand("hello")).toEqual([[], "hello"]);
  });

  it("summarizes saved threads and marks the active one", () => {
    const now = Date.now();
    const runtime = createTestRuntime(now);

    appendConversationEvent(resolveAutoAideStatePaths("terminal-owner-local"), {
      schemaVersion: 1,
      kind: "conversation_turn",
      conversationId: "terminal-owner-local",
      ownerId: "owner-local",
      role: "manager",
      text: "active thread reply",
      createdAt: now
    });
    appendConversationEvent(resolveAutoAideStatePaths("thread-2"), {
      schemaVersion: 1,
      kind: "conversation_turn",
      conversationId: "thread-2",
      ownerId: "owner-local",
      role: "owner",
      text: "archived thread request",
      createdAt: now + 1
    });

    const message = buildThreadListMessage(runtime);

    expect(message).toContain("Saved threads:");
    expect(message).toContain("* terminal-owner-local");
    expect(message).toContain("thread-2");
    expect(message).toContain("turns 1");
    expect(message).toContain("updated");
    expect(message).toContain("active thread reply");
    expect(message.indexOf("thread-2")).toBeLessThan(message.indexOf("terminal-owner-local"));
  });

  it("formats structured conversation messages", () => {
    const message = {
      kind: "step" as const,
      threadItemType: "commandExecution" as const,
      stepType: "waited" as const,
      title: "Worker Started",
      text: "worker-multi-1 started assignment-multi-1"
    };

    const lines = formatConversationMessage(message, 48);
    expect(lines[0]).toBe("• Waited for worker execution");
    expect(lines.slice(1).join(" ")).toContain("worker-multi-1");
    expect(lines.slice(1).join(" ")).toContain("task");
    expect(lines.slice(1).join(" ")).toContain("assignment-multi-1");
    expect(message.threadItemType).toBe("commandExecution");
  });

  it("renders file changes as edited steps", () => {
    const lines = formatConversationMessage(
      {
        kind: "step",
        threadItemType: "fileChange",
        stepType: "edited",
        title: "Task Summary Updated",
        text: "updated apps/tui/src/index.ts (+12 -4)"
      },
      72
    );

    expect(lines[0]).toBe("• Edited apps/tui/src/index.ts (+12 -4)");
    expect(lines[1]).toContain("delta +12 -4");
  });

  it("renders web search as searched steps", () => {
    const lines = formatConversationMessage(
      {
        kind: "step",
        threadItemType: "webSearch",
        stepType: "explored",
        title: "Web Search",
        text: "codex cli thread item types"
      },
      72
    );

    expect(lines).toEqual(["• Searched codex cli thread item types"]);
  });

  it("renders reasoning as explored steps", () => {
    const lines = formatConversationMessage(
      {
        kind: "step",
        threadItemType: "reasoning",
        stepType: "explored",
        title: "Intent Interpreted",
        text: "manager interpreted owner intent as \"Refine CLI plan\""
      },
      72
    );

    expect(lines[0]).toBe("• Explored");
    expect(lines[1]).toContain("manager interpreted owner intent");
  });

  it("renders dynamic tool calls as ran call blocks", () => {
    const lines = formatConversationMessage(
      {
        kind: "step",
        threadItemType: "dynamicToolCall",
        stepType: "ran",
        title: "Assign Worker",
        text: "[applied] assigned Refine CLI plan to worker-manager-1"
      },
      72
    );

    expect(lines[0]).toBe("• Called assign_worker");
    expect(lines[1]).toContain("status applied");
    expect(lines.slice(2).join(" ")).toContain("worker-manager-1");
  });

  it("renders plan cells as checklist-like blocks", () => {
    const lines = formatConversationMessage(
      {
        kind: "plan",
        threadItemType: "plan",
        stepType: "explored",
        title: "Plan Created",
        text: "Investigate issue\n- update CLI behavior\n- add tests"
      },
      72
    );

    expect(lines[0]).toBe("• Updated Plan");
    expect(lines[1]).toContain("Investigate issue");
    expect(lines[2]).toContain("□ update CLI behavior");
    expect(lines[3]).toContain("□ add tests");
  });

  it("renders command cells with codex-like vertical continuation lines", () => {
    const lines = formatConversationMessage(
      {
        kind: "command",
        threadItemType: "commandExecution",
        stepType: "ran",
        title: "Worker Completed",
        text: "worker-1 succeeded fix bug: updated files and tests"
      },
      72
    );

    expect(lines[0]).toBe("• Ran worker execution");
    expect(lines[1].startsWith("  │ ") || lines[1].startsWith("  └ ")).toBe(true);
    expect(lines.some((line) => line.includes("result updated files and tests"))).toBe(true);
  });

  it("collapses long command output bodies like a history cell summary", () => {
    const lines = formatConversationMessage(
      {
        kind: "command",
        threadItemType: "commandExecution",
        stepType: "ran",
        title: "Shell Command",
        text: "line one\nline two\nline three\nline four\nline five\nline six"
      },
      72
    );

    expect(lines.some((line) => line.includes("… +"))).toBe(true);
  });

  it("emits streaming orchestration events in a stable order", async () => {
    const events: string[] = [];

    await runCodexConnectivityCheck({
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "succeeded",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: Date.now(),
        summary: request.objective.includes("WORKER_1_OK") ? "WORKER_1_OK" : "WORKER_2_OK"
      })),
      onEvent(event) {
        events.push(event.type);
      }
    });

    expect(events[0]).toBe("check_started");
    expect(events).toContain("worker_started");
    expect(events).toContain("worker_completed");
    expect(events.at(-1)).toBe("check_completed");
  });

  it("switches to another persisted thread", () => {
    const now = Date.now();
    const runtime = createTestRuntime(now);
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system", text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:",
      threadHeader: "thread terminal-owner-local"
    };

    appendConversationEvent(resolveAutoAideStatePaths("thread-2"), {
      schemaVersion: 1,
      kind: "conversation_turn",
      conversationId: "thread-2",
      ownerId: "owner-local",
      role: "owner",
      text: "hello from thread 2",
      createdAt: now
    });

    switchRuntimeThread(state, runtime, "thread-2", now + 1);

    expect(runtime.conversationId).toBe("thread-2");
    expect(state.statusLine).toContain("thread-2");
    expect(state.messages.some((message) => message.kind === "owner" && message.text.includes("thread 2"))).toBe(
      true
    );
  });

  it("renders a fullscreen interactive screen as a transcript-first timeline", () => {
    const screen = renderInteractiveScreen(
      {
        dashboard: buildOperatorDashboard(),
        compactStatus: "manager  tasks 1  workers 0  busy 0  alerts 0  reminders 0",
        messages: [
          { kind: "system", text: "AutoAide interactive TUI ready." },
          { kind: "owner", text: "/help" },
          { kind: "manager", text: "Showing command help." },
          {
            kind: "step",
            threadItemType: "commandExecution",
            stepType: "waited",
            title: "Worker Started",
            text: "worker-multi-1 started assignment-multi-1"
          }
        ],
        statusLine: "Interactive mode active",
        promptLabel: "Input:",
        threadHeader: "thread terminal-owner-local  ·  task idle  ·  workers 0  ·  busy 0  ·  at 12:00:00"
      },
      { width: 120, height: 30 }
    );

    expect(screen).toContain("thread terminal-owner-local");
    expect(screen).toContain("manager  tasks 1  workers 0");
    expect(screen).toContain("Interactive mode active");
    expect(screen).toContain("› /help");
    expect(screen).toContain("• Showing command help.");
    expect(screen).toContain("• Waited for worker execution");
    expect(screen).toContain("  │ worker worker-multi-1");
    expect(screen).toContain("  └ task assignment-multi-1");
    expect(screen).not.toContain("Manager Conversation");
  });

  it("renders shortcut footer mode when requested", () => {
    const screen = renderInteractiveScreen(
      {
        dashboard: buildOperatorDashboard(),
        compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
        messages: [{ kind: "system", text: "AutoAide interactive TUI ready." }],
        statusLine: "Showing shortcuts",
        promptLabel: "Input:",
        threadHeader: "thread terminal-owner-local",
        footerMode: "shortcuts"
      },
      { width: 100, height: 16 }
    );

    expect(screen).toContain("Shortcuts: Enter send");
    expect(screen).toContain("Ctrl+A/E move");
  });

  it("renders older transcript lines when followTail is disabled", () => {
    const screen = renderInteractiveScreen(
      {
        dashboard: buildOperatorDashboard(),
        compactStatus: "manager  tasks 1  workers 0  busy 0  alerts 0  reminders 0",
        messages: [
          { kind: "system", text: "first line" },
          { kind: "manager", text: "second line" },
          { kind: "manager", text: "third line" },
          { kind: "manager", text: "fourth line" },
          { kind: "manager", text: "fifth line" },
          { kind: "manager", text: "sixth line" },
          { kind: "manager", text: "seventh line" },
          { kind: "manager", text: "eighth line" },
          { kind: "manager", text: "ninth line" },
          { kind: "manager", text: "tenth line" },
          { kind: "manager", text: "eleventh line" },
          { kind: "manager", text: "twelfth line" }
        ],
        statusLine: "Interactive mode active",
        promptLabel: "Input:",
        threadHeader: "thread terminal-owner-local",
        followTail: false,
        scrollOffset: 4
      },
      { width: 100, height: 12 }
    );

    expect(screen).toContain("• third line");
    expect(screen).toContain("• fourth line");
    expect(screen).not.toContain("• twelfth line");
  });

  it("renders an active streaming cell at the transcript tail", () => {
    const screen = renderInteractiveScreen(
      {
        dashboard: buildOperatorDashboard(),
        compactStatus: "manager  tasks 1  workers 1  busy 1  alerts 0  reminders 0",
        messages: [{ kind: "manager", text: "Planning the task." }],
        activeCell: {
          kind: "step",
          threadItemType: "commandExecution",
          stepType: "waited",
          title: "Worker Started",
          text: "worker-multi-1 started assignment-multi-1",
          status: "streaming"
        },
        statusLine: "Manager is thinking and preparing a plan...",
        promptLabel: "Goal:",
        threadHeader: "thread terminal-owner-local"
      },
      { width: 100, height: 16 }
    );

    expect(screen).toContain("• Planning the task.");
    expect(screen).toContain("• Waited for worker execution…");
    expect(screen).toContain("Manager is thinking and preparing a plan...");
  });

  it("accepts natural-language owner input and plans a task", async () => {
    const now = Date.now();
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system" as const, text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:",
      threadHeader: "thread terminal-owner-local"
    };
    const runtime = createTestRuntime(now);

    await submitOwnerMessage({
      text: "Outline the next AutoAide CLI development plan and acceptance criteria",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now
    });

    expect(runtime.store.listTasks()).toHaveLength(1);
    expect(runtime.store.listAssignments()).toHaveLength(1);
    expect(runtime.store.listCommitments()).toHaveLength(1);
    expect(runtime.memoryStore.listDecisionRecords()).toHaveLength(1);
    expect(runtime.memoryStore.listConversations("owner-local")).toHaveLength(1);
    expect(runtime.memoryStore.listConversationTurns("terminal-owner-local").length).toBeGreaterThan(0);
    expect(runtime.store.listAssignments()[0]?.status).toBe("succeeded");
    expect(runtime.store.listTasks()[0]?.status).toBe("reviewing");
    expect(state.statusLine).toContain("Planned");
    expect(
      state.messages.some(
        (message) => message.kind === "manager" && message.text.includes("Captured")
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) =>
          "title" in message &&
          message.threadItemType === "dynamicToolCall" &&
          (message.text ?? "").includes("assigned")
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) =>
          "title" in message &&
          message.threadItemType === "reasoning" &&
          message.title === "Intent Interpreted"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) =>
          "title" in message &&
          message.threadItemType === "plan" &&
          message.title === "Plan Created"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) =>
          "title" in message &&
          message.threadItemType === "commandExecution" &&
          message.title === "Worker Completed"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => "title" in message && message.title === "Followup Reviewing Result"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "manager" && message.text.includes("AUTOAIDE_TEST_OK")
      )
    ).toBe(true);
    expect(state.compactStatus).toContain("tasks 1");
    expect(state.dashboard).toContain("tasks 1");
  });

  it("emits streaming manager and worker events while processing a turn", async () => {
    const now = Date.now();
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system", text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:"
    };
    const runtime = createTestRuntime(now);
    const events: string[] = [];

    await submitOwnerMessage({
      text: "Outline the next AutoAide CLI development plan and acceptance criteria",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now,
      onEvent(event) {
        events.push(event.type);
      }
    });

    expect(events[0]).toBe("manager_thinking");
    expect(events).toContain("manager_behavior");
    expect(events).toContain("manager_action");
    expect(events).toContain("manager_reply");
    expect(events).toContain("worker_started");
    expect(events.some((event) => event === "worker_completed" || event === "worker_failed")).toBe(true);
    expect(events.at(-1)).toBe("status");
  });

  it("keeps clarification in the same conversation and plans after owner follow-up", async () => {
    const now = Date.now();
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system", text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:"
    };
    const runtime = createTestRuntime(
      now,
      new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "succeeded",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: now + 6,
        summary: "FOLLOW_UP_OK"
      }))
    );

    await submitOwnerMessage({
      text: "Fix it",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now
    });

    expect(runtime.pendingClarification?.originalText).toBe("Fix it");
    expect(runtime.store.listTasks()).toHaveLength(0);
    expect(state.statusLine).toContain("Waiting for clarification");
    expect(
      state.messages.some(
        (message) => "title" in message && message.title === "Clarification Requested"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => "title" in message && message.title === "Followup Waiting Owner"
      )
    ).toBe(true);
    expect(runtime.memoryStore.listConversations("owner-local")[0]?.pendingClarificationQuestion).toBe(
      "Please provide a more specific goal, scope, or completion criteria."
    );

    await submitOwnerMessage({
      text: "Make the default TUI conversation-first and keep /status for details",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now: now + 1
    });

    const expectedRootTaskId = `task-root-${now + 1}`;

    expect(runtime.pendingClarification).toBeUndefined();
    expect(runtime.activeWorkstreamId).toBe(`workstream-${expectedRootTaskId}`);
    expect(runtime.activeTaskTitle).toBe("Fix it");
    expect(runtime.store.listTasks()).toHaveLength(1);
    expect(runtime.store.listWorkstreams()).toHaveLength(1);
    expect(runtime.store.listWorkstreams()[0]).toMatchObject({
      id: `workstream-${expectedRootTaskId}`,
      rootTaskId: expectedRootTaskId,
      title: "Fix it"
    });
    expect(runtime.store.listAssignments()).toHaveLength(1);
    expect(runtime.store.listAssignments()[0]?.status).toBe("succeeded");
    expect(state.statusLine).toContain("Planned");
    expect(runtime.memoryStore.listConversationTurns("terminal-owner-local").length).toBeGreaterThan(3);
    expect(runtime.memoryStore.listConversations("owner-local")[0]).toMatchObject({
      activeWorkstreamId: `workstream-${expectedRootTaskId}`,
      activeWorkstreamTitle: "Fix it",
      activeTaskId: expectedRootTaskId
    });
    expect(
      state.messages.some(
        (message) => "title" in message && message.title === "Followup Reviewing Result"
      )
    ).toBe(true);
  });

  it("shows blocked-task follow-up events when worker execution fails", async () => {
    const now = Date.now();
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system", text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:"
    };
    const runtime = createTestRuntime(
      now,
      new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "failed",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: now + 7,
        errorCode: "TEST_FAILURE",
        summary: "WORKER_FAILED_FOR_TEST"
      }))
    );

    await submitOwnerMessage({
      text: "Outline the AutoAide CLI exception handling plan",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now
    });

    expect(runtime.store.listAssignments()[0]?.status).toBe("failed");
    expect(runtime.store.listTasks()[0]?.status).toBe("blocked");
    expect(
      state.messages.some(
        (message) => "title" in message && message.title === "Worker Failed"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => "title" in message && message.title === "Followup Blocked Task"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => "title" in message && message.title === "Followup Replan Task"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "manager" && message.text.includes("currently blocked")
      )
    ).toBe(true);
  });

  it("runs an automatic manager review turn after worker completion", async () => {
    const now = Date.now();
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system", text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:"
    };
    const runtime = createTestRuntime(
      now,
      new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "succeeded",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: now + 7,
        summary: "FAILURE_EXPLAINED"
      }))
    );

    let calls = 0;
    const managerRuntime = {
      async respond(input: {
        message: {
          id: string;
          ownerId: string;
          channel: "web";
          peerId: string;
          text: string;
          createdAt: number;
        };
        store: InMemoryTaskStore;
        rootTaskId: string;
        now?: number;
      }) {
        calls += 1;
        if (calls === 1) {
          const task = {
            ...createTask({
              id: input.rootTaskId,
              ownerId: input.message.ownerId,
              title: "Investigate Failing Test",
              goal: "Find the cause of the failure",
              now: input.now,
              priority: "high"
            }),
            status: "planned" as const
          };
          input.store.upsertTask(task);
          return {
            intent: {
              ownerId: input.message.ownerId,
              title: "Investigate Failing Test",
              goal: "Find the cause of the failure",
              sourceMessageId: input.message.id,
              mode: "managed_task" as const,
              needsClarification: false
            },
            plan: {
              rootTask: task,
              tasks: []
            },
            reply: {
              kind: "summary" as const,
              text: "I assigned a worker to investigate the failing test."
            },
            toolCalls: [
              {
                kind: "create_tasks" as const,
                steps: [
                  {
                    title: task.title,
                    goal: task.goal,
                    priority: task.priority
                  }
                ],
                reason: "convert_owner_goal_into_task_graph"
              },
              {
                kind: "assign_worker" as const,
                taskId: task.id,
                objective: "Investigate the failing test",
                deliverable: "Return the failure explanation",
                completionSignal: "A concise failure explanation is returned",
                reason: "step_ready_for_execution"
              }
            ]
          };
        }

        return {
          intent: {
            ownerId: input.message.ownerId,
            title: "Investigate Failing Test",
            goal: "Review the worker result",
            sourceMessageId: input.message.id,
            mode: "managed_task" as const,
            needsClarification: false
          },
          reply: {
            kind: "summary" as const,
            text: "I reviewed the worker result and closed the task."
          },
          toolCalls: [
            {
              kind: "mark_task_done" as const,
              taskId: input.rootTaskId,
              summary: "The worker result fully explains the failure.",
              reason: "review_complete"
            }
          ]
        };
      }
    };

    await submitOwnerMessage({
      text: "Investigate the failing test",
      state,
      runtime,
      managerRuntime,
      now
    });

    expect(calls).toBe(2);
    expect(runtime.store.listTasks()[0]?.status).toBe("done");
    expect(
      state.messages.some(
        (message) => message.kind === "manager" && message.text.includes("closed the task")
      )
    ).toBe(true);
    expect(
      runtime.memoryStore
        .listConversationTurns("terminal-owner-local")
        .some((turn) => turn.text.includes("mark_task_done: [applied] marked Investigate Failing Test done"))
    ).toBe(true);
  });

  it("shows escalate-owner follow-up when blocked task needs owner clarification", async () => {
    const now = Date.now();
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system", text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:"
    };
    const runtime = createTestRuntime(
      now,
      new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "failed",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: now + 7,
        errorCode: "TEST_FAILURE",
        summary: "Need owner clarification on acceptance criteria"
      }))
    );

    await submitOwnerMessage({
      text: "Outline the AutoAide CLI acceptance criteria",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now
    });

    expect(
      state.messages.some(
        (message) => "title" in message && message.title === "Followup Escalate Owner"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "manager" && message.text.includes("needs your decision or confirmation")
      )
    ).toBe(true);
  });

  it.runIf(process.env.AUTOAIDE_REAL_CODEX === "1")(
    "runs two real codex workers concurrently through the tui path",
    async () => {
      const result = await runCodexConnectivityCheck();

      expect(result.receipts).toHaveLength(2);
      expect(result.receipts.map((receipt) => receipt.managerView.status)).toEqual([
        "succeeded",
        "succeeded"
      ]);
      expect(result.receipts.map((receipt) => receipt.managerView.summary).sort()).toEqual([
        "WORKER_1_OK",
        "WORKER_2_OK"
      ]);
    },
    240_000
  );
});
