import { describe, expect, it } from "vitest";
import { DeterministicManagerRuntime } from "@autoaide/manager-runtime";
import { InMemoryMemoryStore } from "@autoaide/memory-system";
import { InMemoryTaskStore } from "@autoaide/task-system";
import { InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";
import { InMemoryCodexExecutorAdapter, InMemoryCodexRunRegistry } from "@autoaide/executor-codex";
import {
  buildOperatorDashboard,
  completeSlashCommand,
  formatConversationMessage,
  getSlashCommands,
  parseSlashCommand,
  renderInteractiveScreen,
  runCodexConnectivityCheck,
  submitOwnerMessage,
  type OperatorRuntimeState,
  type TuiScreenState
} from "./index.js";

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
    expect(parseSlashCommand("/workers now")).toEqual({
      name: "/workers",
      args: "now"
    });
  });

  it("completes slash commands for the input editor", () => {
    expect(completeSlashCommand("/wo")).toEqual([["/workers"], "/wo"]);
    expect(completeSlashCommand("hello")).toEqual([[], "hello"]);
  });

  it("formats structured conversation messages", () => {
    expect(
      formatConversationMessage(
        { kind: "event", label: "worker_started", text: "worker-multi-1 started assignment-multi-1" },
        48
      )[0]
    ).toContain("[event:worker_started]");
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

  it("renders a fullscreen interactive screen with operator and conversation panels", () => {
    const screen = renderInteractiveScreen(
      {
        dashboard: buildOperatorDashboard(),
        compactStatus: "manager  tasks 1  workers 0  busy 0  alerts 0  reminders 0",
        messages: [
          { kind: "system", text: "AutoAide interactive TUI ready." },
          { kind: "owner", text: "/help" },
          { kind: "manager", text: "Showing command help." },
          { kind: "event", label: "worker_started", text: "worker-multi-1 started assignment-multi-1" }
        ],
        statusLine: "Interactive mode active",
        promptLabel: "Input:"
      },
      { width: 120, height: 30 }
    );

    expect(screen).toContain("Manager Conversation");
    expect(screen).toContain("manager  tasks 1  workers 0");
    expect(screen).toContain("Interactive mode active");
    expect(screen).toContain("[owner] /help");
    expect(screen).toContain("[manager] Showing command help.");
    expect(screen).toContain("[event:worker_started]");
    expect(screen).not.toContain("Operator View");
  });

  it("accepts natural-language owner input and plans a task", async () => {
    const now = Date.now();
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system" as const, text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:"
    };
    const runtime: OperatorRuntimeState = {
      now,
      store: new InMemoryTaskStore(),
      registry: new InMemoryWorkerRegistry(),
      memoryStore: new InMemoryMemoryStore(now),
      runRegistry: new InMemoryCodexRunRegistry(),
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
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

    await submitOwnerMessage({
      text: "请整理 AutoAide CLI 的下一步开发计划和验收标准",
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
        (message) => message.kind === "manager" && message.text.includes("已记录任务")
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.text.includes("assigned")
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "intent_interpreted"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "plan_created"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "worker_completed"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "followup_reviewing_result"
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

  it("keeps clarification in the same conversation and plans after owner follow-up", async () => {
    const now = Date.now();
    const state: TuiScreenState = {
      dashboard: buildOperatorDashboard(),
      compactStatus: "manager  tasks 0  workers 0  busy 0  alerts 0  reminders 0",
      messages: [{ kind: "system", text: "AutoAide interactive TUI ready." }],
      statusLine: "Interactive mode active",
      promptLabel: "Input:"
    };
    const runtime: OperatorRuntimeState = {
      now,
      store: new InMemoryTaskStore(),
      registry: new InMemoryWorkerRegistry(),
      memoryStore: new InMemoryMemoryStore(now),
      runRegistry: new InMemoryCodexRunRegistry(),
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "succeeded",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: now + 6,
        summary: "FOLLOW_UP_OK"
      })),
      pendingClarification: undefined,
      activeRootTaskId: undefined,
      activeTaskTitle: undefined
    };

    await submitOwnerMessage({
      text: "修一下",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now
    });

    expect(runtime.pendingClarification?.originalText).toBe("修一下");
    expect(runtime.store.listTasks()).toHaveLength(0);
    expect(state.statusLine).toContain("Waiting for clarification");
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "clarification_requested"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "followup_waiting_owner"
      )
    ).toBe(true);
    expect(runtime.memoryStore.listConversations("owner-local")[0]?.pendingClarificationQuestion).toBe(
      "请补充更具体的目标、范围或完成标准。"
    );

    await submitOwnerMessage({
      text: "把 TUI 默认界面改成 conversation-first，并保留 /status 查看详情",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now: now + 1
    });

    expect(runtime.pendingClarification).toBeUndefined();
    expect(runtime.activeTaskTitle).toBe("修一下");
    expect(runtime.store.listTasks()).toHaveLength(1);
    expect(runtime.store.listAssignments()).toHaveLength(1);
    expect(runtime.store.listAssignments()[0]?.status).toBe("succeeded");
    expect(state.statusLine).toContain("Planned");
    expect(runtime.memoryStore.listConversationTurns("terminal-owner-local").length).toBeGreaterThan(3);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "followup_reviewing_result"
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
    const runtime: OperatorRuntimeState = {
      now,
      store: new InMemoryTaskStore(),
      registry: new InMemoryWorkerRegistry(),
      memoryStore: new InMemoryMemoryStore(now),
      runRegistry: new InMemoryCodexRunRegistry(),
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "failed",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: now + 7,
        errorCode: "TEST_FAILURE",
        summary: "WORKER_FAILED_FOR_TEST"
      })),
      pendingClarification: undefined,
      activeRootTaskId: undefined,
      activeTaskTitle: undefined
    };

    await submitOwnerMessage({
      text: "请整理 AutoAide CLI 的异常处理方案",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now
    });

    expect(runtime.store.listAssignments()[0]?.status).toBe("failed");
    expect(runtime.store.listTasks()[0]?.status).toBe("blocked");
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "worker_failed"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "followup_blocked_task"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "followup_replan_task"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "manager" && message.text.includes("当前被阻塞")
      )
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
    const runtime: OperatorRuntimeState = {
      now,
      store: new InMemoryTaskStore(),
      registry: new InMemoryWorkerRegistry(),
      memoryStore: new InMemoryMemoryStore(now),
      runRegistry: new InMemoryCodexRunRegistry(),
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "failed",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: now + 7,
        errorCode: "TEST_FAILURE",
        summary: "Need owner clarification on acceptance criteria"
      })),
      pendingClarification: undefined,
      activeRootTaskId: undefined,
      activeTaskTitle: undefined
    };

    await submitOwnerMessage({
      text: "请整理 AutoAide CLI 的验收标准",
      state,
      runtime,
      managerRuntime: new DeterministicManagerRuntime(),
      now
    });

    expect(
      state.messages.some(
        (message) => message.kind === "event" && message.label === "followup_escalate_owner"
      )
    ).toBe(true);
    expect(
      state.messages.some(
        (message) => message.kind === "manager" && message.text.includes("需要你补充决策或确认")
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
