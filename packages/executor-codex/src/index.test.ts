import { describe, expect, it } from "vitest";
import { InMemoryTaskStore, createAssignment, createTask } from "@autoaide/task-system";
import {
  InMemoryWorkerRegistry,
  assignTaskToWorker,
  spawnWorker
} from "@autoaide/worker-orchestrator";
import {
  CommandCodexExecutorAdapter,
  EXECUTOR_CODEX_SCHEMA_VERSION,
  InMemoryCodexExecutorAdapter,
  InMemoryCodexRunRegistry,
  NodeProcessCodexCommandRunner,
  buildCodexCliInvocation,
  buildCodexExecPrompt,
  cancelCodexRun,
  createCodexRunRequest,
  decodeCodexCommandRunnerResult,
  executeCodexAssignment,
  executeCodexAssignmentWithLifecycle,
  parseCodexRunResult,
  redactResultForManager,
  retryCodexRunRequest,
  runCodexWorkerAssignment,
  toWorkerResultPayload,
  validateExecutionPolicy
} from "./index.js";

describe("executor-codex", () => {
  it("builds a codex run request from assignment and task state", () => {
    const assignment = createAssignment({
      id: "assignment-1",
      taskId: "task-1",
      workerId: "worker-1",
      objective: "Implement executor adapter",
      now: 100,
      inputs: { language: "ts" }
    });
    const task = createTask({
      id: "task-1",
      ownerId: "owner-1",
      title: "Implement executor adapter",
      goal: "Create codex run contract",
      now: 90
    });

    const request = createCodexRunRequest({
      runId: "run-1",
      workerId: "worker-1",
      assignment,
      task,
      now: 120,
      policy: {
        workspaceRoot: "/workspace/project",
        allowedTools: ["read", "write", "bash"],
        maxRuntimeMs: 30_000,
        managerVisibility: "summary_only"
      }
    });

    expect(request.schemaVersion).toBe(EXECUTOR_CODEX_SCHEMA_VERSION);
    expect(request.assignmentId).toBe("assignment-1");
    expect(request.allowedTools).toEqual(["read", "write", "bash"]);
  });

  it("validates execution policy boundaries", () => {
    expect(() =>
      validateExecutionPolicy({
        workspaceRoot: " ",
        allowedTools: ["read"],
        maxRuntimeMs: 10_000,
        managerVisibility: "summary_only"
      })
    ).toThrow("policy.workspaceRoot must be a non-empty string");

    expect(() =>
      validateExecutionPolicy({
        workspaceRoot: "/workspace/project",
        allowedTools: [],
        maxRuntimeMs: 10_000,
        managerVisibility: "summary_only"
      })
    ).toThrow("policy.allowedTools must not be empty");
  });

  it("builds a codex cli invocation from a run request", () => {
    const invocation = buildCodexCliInvocation({
      schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
      runId: "run-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      taskId: "task-1",
      objective: "Implement executor adapter",
      inputs: { language: "ts" },
      workspaceRoot: "/workspace/project",
      allowedTools: ["read", "write"],
      maxRuntimeMs: 30_000,
      createdAt: 100,
      managerVisibility: "summary_only"
    });

    expect(invocation.runId).toBe("run-1");
    expect(invocation.command).toBe("codex");
    expect(invocation.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-s",
      "workspace-write",
      "-"
    ]);
    expect(invocation.cwd).toBe("/workspace/project");
    expect(invocation.env.AUTOAIDE_RUN_ID).toBe("run-1");
    expect(invocation.stdin).toContain("Return exactly one JSON object and nothing else.");
  });

  it("builds a codex exec prompt from a run request", () => {
    const prompt = buildCodexExecPrompt({
      schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
      runId: "run-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      taskId: "task-1",
      objective: "Implement executor adapter",
      inputs: { language: "ts" },
      workspaceRoot: "/workspace/project",
      allowedTools: ["read", "write"],
      maxRuntimeMs: 30_000,
      createdAt: 100,
      managerVisibility: "summary_only"
    });

    expect(prompt).toContain("Run ID: run-1");
    expect(prompt).toContain("Inputs JSON: {\"language\":\"ts\"}");
    expect(prompt).toContain("\"status\":\"succeeded\"");
  });

  it("parses structured codex runner output", () => {
    expect(
      parseCodexRunResult(
        JSON.stringify({
          status: "succeeded",
          runId: "run-1",
          assignmentId: "assignment-1",
          finishedAt: 200,
          summary: "Done"
        })
      )
    ).toEqual({
      status: "succeeded",
      runId: "run-1",
      assignmentId: "assignment-1",
      finishedAt: 200,
      summary: "Done"
    });
  });

  it("decodes the last structured result line from noisy stdout", () => {
    expect(
      decodeCodexCommandRunnerResult({
        request: {
          schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
          runId: "run-1",
          workerId: "worker-1",
          assignmentId: "assignment-1",
          taskId: "task-1",
          objective: "Implement executor adapter",
          inputs: {},
          workspaceRoot: "/workspace/project",
          allowedTools: ["read"],
          maxRuntimeMs: 30_000,
          createdAt: 100,
          managerVisibility: "summary_only"
        },
        commandResult: {
          stdout: `starting\nnot-json\n${JSON.stringify({
            status: "succeeded",
            runId: "run-1",
            assignmentId: "assignment-1",
            finishedAt: 200,
            summary: "Done"
          })}`,
          stderr: "",
          exitCode: 0
        }
      })
    ).toEqual({
      status: "succeeded",
      runId: "run-1",
      assignmentId: "assignment-1",
      finishedAt: 200,
      summary: "Done"
    });
  });

  it("decodes codex exec json events into a structured result", () => {
    expect(
      decodeCodexCommandRunnerResult({
        request: {
          schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
          runId: "run-1",
          workerId: "worker-1",
          assignmentId: "assignment-1",
          taskId: "task-1",
          objective: "Implement executor adapter",
          inputs: {},
          workspaceRoot: "/workspace/project",
          allowedTools: ["read"],
          maxRuntimeMs: 30_000,
          createdAt: 100,
          managerVisibility: "summary_only"
        },
        commandResult: {
          stdout: [
            "{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}",
            "{\"type\":\"turn.started\"}",
            JSON.stringify({
              type: "item.completed",
              item: {
                id: "item_0",
                type: "agent_message",
                text: JSON.stringify({
                  status: "succeeded",
                  runId: "run-1",
                  assignmentId: "assignment-1",
                  finishedAt: 200,
                  summary: "Done"
                })
              }
            }),
            "{\"type\":\"turn.completed\"}"
          ].join("\n"),
          stderr: "",
          exitCode: 0
        }
      })
    ).toEqual({
      status: "succeeded",
      runId: "run-1",
      assignmentId: "assignment-1",
      finishedAt: 200,
      summary: "Done"
    });
  });

  it("maps process timeout and process failure into structured results", () => {
    expect(
      decodeCodexCommandRunnerResult({
        request: {
          schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
          runId: "run-1",
          workerId: "worker-1",
          assignmentId: "assignment-1",
          taskId: "task-1",
          objective: "Implement executor adapter",
          inputs: {},
          workspaceRoot: "/workspace/project",
          allowedTools: ["read"],
          maxRuntimeMs: 30_000,
          createdAt: 100,
          managerVisibility: "summary_only"
        },
        commandResult: {
          stdout: "",
          stderr: "too slow",
          exitCode: 124
        },
        now: 250
      })
    ).toEqual({
      status: "timed_out",
      runId: "run-1",
      assignmentId: "assignment-1",
      finishedAt: 250,
      errorCode: "PROCESS_TIMEOUT",
      summary: "too slow"
    });

    expect(
      decodeCodexCommandRunnerResult({
        request: {
          schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
          runId: "run-2",
          workerId: "worker-1",
          assignmentId: "assignment-2",
          taskId: "task-2",
          objective: "Implement executor adapter",
          inputs: {},
          workspaceRoot: "/workspace/project",
          allowedTools: ["read"],
          maxRuntimeMs: 30_000,
          createdAt: 100,
          managerVisibility: "summary_only"
        },
        commandResult: {
          stdout: "",
          stderr: "boom",
          exitCode: 2
        },
        now: 260
      })
    ).toEqual({
      status: "failed",
      runId: "run-2",
      assignmentId: "assignment-2",
      finishedAt: 260,
      errorCode: "PROCESS_EXIT_2",
      summary: "boom"
    });
  });

  it("maps codex results into worker result payloads", () => {
    expect(
      toWorkerResultPayload({
        status: "succeeded",
        runId: "run-1",
        assignmentId: "assignment-1",
        finishedAt: 200,
        summary: "Done"
      })
    ).toEqual({
      outcome: "succeeded",
      summary: "Done"
    });
  });

  it("supports retrying a codex run request with a new run id", () => {
    const retried = retryCodexRunRequest(
      {
        schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
        runId: "run-1",
        workerId: "worker-1",
        assignmentId: "assignment-1",
        taskId: "task-1",
        objective: "Implement executor adapter",
        inputs: {},
        workspaceRoot: "/workspace/project",
        allowedTools: ["read"],
        maxRuntimeMs: 30_000,
        createdAt: 100,
        managerVisibility: "summary_only"
      },
      {
        retryRunId: "run-2",
        now: 200
      }
    );

    expect(retried.runId).toBe("run-2");
    expect(retried.createdAt).toBe(200);
  });

  it("tracks active runs and supports cancellation in the adapter", async () => {
    const adapter = new InMemoryCodexExecutorAdapter(async (request) => ({
      status: "succeeded",
      runId: request.runId,
      assignmentId: request.assignmentId,
      finishedAt: 200,
      summary: "Done"
    }));

    const runPromise = adapter.run({
      schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
      runId: "run-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      taskId: "task-1",
      objective: "Implement executor adapter",
      inputs: {},
      workspaceRoot: "/workspace/project",
      allowedTools: ["read"],
      maxRuntimeMs: 30_000,
      createdAt: 100,
      managerVisibility: "summary_only"
    });

    expect(adapter.isActive("run-1")).toBe(true);
    await runPromise;
    expect(adapter.isActive("run-1")).toBe(false);

    await adapter.cancel("run-1");
    expect(adapter.isActive("run-1")).toBe(false);
  });

  it("runs codex through a command adapter", async () => {
    const adapter = new CommandCodexExecutorAdapter({
      async run(invocation) {
        expect(invocation.command).toBe("codex");
        return {
          stdout: JSON.stringify({
            status: "succeeded",
            runId: "run-1",
            assignmentId: "assignment-1",
            finishedAt: 200,
            summary: "Done"
          }),
          stderr: "",
          exitCode: 0
        };
      }
    });

    await expect(
      adapter.run({
        schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
        runId: "run-1",
        workerId: "worker-1",
        assignmentId: "assignment-1",
        taskId: "task-1",
        objective: "Implement executor adapter",
        inputs: {},
        workspaceRoot: "/workspace/project",
        allowedTools: ["read"],
        maxRuntimeMs: 30_000,
        createdAt: 100,
        managerVisibility: "summary_only"
      })
    ).resolves.toEqual({
      status: "succeeded",
      runId: "run-1",
      assignmentId: "assignment-1",
      finishedAt: 200,
      summary: "Done"
    });
  });

  it("runs a local process through the node command runner", async () => {
    const runner = new NodeProcessCodexCommandRunner();
    const result = await runner.run({
      runId: "run-1",
      command: process.execPath,
      args: [
        "-e",
        "process.stdin.on('data',()=>{});process.stdin.on('end',()=>process.stdout.write(JSON.stringify({status:'succeeded',runId:process.env.AUTOAIDE_RUN_ID,assignmentId:process.env.AUTOAIDE_ASSIGNMENT_ID,finishedAt:200,summary:'Done'})));"
      ],
      cwd: process.cwd(),
      env: {
        AUTOAIDE_RUN_ID: "run-1",
        AUTOAIDE_ASSIGNMENT_ID: "assignment-1"
      },
      timeoutMs: 5_000,
      stdin: "{}"
    });

    expect(result.exitCode).toBe(0);
    expect(parseCodexRunResult(result.stdout)).toEqual({
      status: "succeeded",
      runId: "run-1",
      assignmentId: "assignment-1",
      finishedAt: 200,
      summary: "Done"
    });
  });

  it("cancels a local process through the node command runner", async () => {
    const runner = new NodeProcessCodexCommandRunner();
    const runPromise = runner.run({
      runId: "run-1",
      command: process.execPath,
      args: [
        "-e",
        "setTimeout(()=>process.stdout.write('late'),1000)"
      ],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 5_000,
      stdin: ""
    });

    await runner.cancel("run-1");
    const result = await runPromise;
    expect(result.exitCode).not.toBe(0);
  });

  it("redacts results for manager consumption", () => {
    expect(
      redactResultForManager({
        status: "failed",
        runId: "run-1",
        assignmentId: "assignment-1",
        finishedAt: 200,
        errorCode: "EXEC_TIMEOUT",
        summary: "Execution timed out",
        trace: ["tool:bash", "tool:read"]
      })
    ).toEqual({
      status: "failed",
      summary: "Execution timed out",
      trace: ["tool:bash", "tool:read"]
    });
  });

  it("executes an assigned codex run and writes the result back into orchestrator state", async () => {
    const store = new InMemoryTaskStore();
    const registry = new InMemoryWorkerRegistry();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Implement executor adapter",
        goal: "Wire codex adapter to orchestrator",
        now: 100
      })
    );
    store.updateTaskStatus("task-1", "planned", 110);
    spawnWorker(registry, {
      workerId: "worker-1",
      now: 120
    });
    assignTaskToWorker({
      store,
      registry,
      taskId: "task-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Implement executor integration",
      now: 130
    });

    const output = await executeCodexAssignment({
      store,
      registry,
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "succeeded",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: 200,
        summary: "Execution finished successfully"
      })),
      assignmentId: "assignment-1",
      runId: "run-1",
      policy: {
        workspaceRoot: "/workspace/project",
        allowedTools: ["read", "write", "bash"],
        maxRuntimeMs: 30_000,
        managerVisibility: "summary_only"
      }
    });

    expect(output.workerResult).toEqual({
      outcome: "succeeded",
      summary: "Execution finished successfully"
    });
    expect(store.getAssignment("assignment-1")?.status).toBe("succeeded");
    expect(store.getTask("task-1")?.status).toBe("reviewing");
    expect(registry.getWorker("worker-1")?.status).toBe("idle");
  });

  it("tracks lifecycle records for a codex run", async () => {
    const store = new InMemoryTaskStore();
    const registry = new InMemoryWorkerRegistry();
    const runRegistry = new InMemoryCodexRunRegistry();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Implement lifecycle registry",
        goal: "Track codex runs",
        now: 100
      })
    );
    store.updateTaskStatus("task-1", "planned", 110);
    spawnWorker(registry, { workerId: "worker-1", now: 120 });
    assignTaskToWorker({
      store,
      registry,
      taskId: "task-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Implement lifecycle tracking",
      now: 130
    });

    await executeCodexAssignmentWithLifecycle({
      store,
      registry,
      runRegistry,
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "failed",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: 210,
        errorCode: "EXEC_FAIL",
        summary: "Execution failed"
      })),
      assignmentId: "assignment-1",
      runId: "run-1",
      policy: {
        workspaceRoot: "/workspace/project",
        allowedTools: ["read", "bash"],
        maxRuntimeMs: 30_000,
        managerVisibility: "summary_only"
      }
    });

    expect(runRegistry.getRun("run-1")).toEqual({
      runId: "run-1",
      assignmentId: "assignment-1",
      workerId: "worker-1",
      status: "failed",
      startedAt: expect.any(Number),
      finishedAt: 210,
      retryOfRunId: undefined,
      summary: "Execution failed"
    });
    expect(store.getTask("task-1")?.status).toBe("blocked");
  });

  it("cancels a codex run through the lifecycle controller", async () => {
    const runRegistry = new InMemoryCodexRunRegistry();
    const request = {
      schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
      runId: "run-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      taskId: "task-1",
      objective: "Implement executor adapter",
      inputs: {},
      workspaceRoot: "/workspace/project",
      allowedTools: ["read"],
      maxRuntimeMs: 30_000,
      createdAt: 100,
      managerVisibility: "summary_only" as const
    };
    runRegistry.startRun(request);

    const cancelled = await cancelCodexRun({
      executor: new InMemoryCodexExecutorAdapter(async () => ({
        status: "succeeded",
        runId: "ignored",
        assignmentId: "ignored",
        finishedAt: 0,
        summary: "ignored"
      })),
      runRegistry,
      runId: "run-1",
      now: 200,
      summary: "Stopped by manager"
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.finishedAt).toBe(200);
    expect(cancelled.summary).toBe("Stopped by manager");
  });

  it("runs a codex worker assignment through the unified execution entry", async () => {
    const store = new InMemoryTaskStore();
    const registry = new InMemoryWorkerRegistry();
    const runRegistry = new InMemoryCodexRunRegistry();
    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-1",
        title: "Implement production-like entry",
        goal: "Expose a single codex execution call",
        now: 100
      })
    );
    store.updateTaskStatus("task-1", "planned", 110);
    spawnWorker(registry, { workerId: "worker-1", now: 120 });
    assignTaskToWorker({
      store,
      registry,
      taskId: "task-1",
      workerId: "worker-1",
      assignmentId: "assignment-1",
      objective: "Implement unified codex runner",
      now: 130
    });

    const receipt = await runCodexWorkerAssignment({
      store,
      registry,
      runRegistry,
      executor: new InMemoryCodexExecutorAdapter(async (request) => ({
        status: "succeeded",
        runId: request.runId,
        assignmentId: request.assignmentId,
        finishedAt: 220,
        summary: "Unified execution completed",
        trace: ["tool:read", "tool:write"]
      })),
      assignmentId: "assignment-1",
      runId: "run-1",
      policy: {
        workspaceRoot: "/workspace/project",
        allowedTools: ["read", "write"],
        maxRuntimeMs: 30_000,
        managerVisibility: "summary_and_trace"
      }
    });

    expect(receipt.workerResult.outcome).toBe("succeeded");
    expect(receipt.managerView).toEqual({
      status: "succeeded",
      summary: "Unified execution completed",
      trace: ["tool:read", "tool:write"]
    });
    expect(receipt.lifecycle?.status).toBe("succeeded");
  });

  it.runIf(process.env.AUTOAIDE_REAL_CODEX === "1")(
    "runs a real codex worker assignment through the command adapter",
    async () => {
      const store = new InMemoryTaskStore();
      const registry = new InMemoryWorkerRegistry();
      const runRegistry = new InMemoryCodexRunRegistry();
      store.upsertTask(
        createTask({
          id: "task-real-1",
          ownerId: "owner-1",
          title: "Real codex connectivity test",
          goal: "Verify executor-codex against the real Codex CLI",
          now: Date.now()
        })
      );
      store.updateTaskStatus("task-real-1", "planned", Date.now());
      spawnWorker(registry, { workerId: "worker-real-1", now: Date.now() });
      assignTaskToWorker({
        store,
        registry,
        taskId: "task-real-1",
        workerId: "worker-real-1",
        assignmentId: "assignment-real-1",
        objective: "Return a success result whose summary is exactly CODEX_OK.",
        now: Date.now()
      });

      const receipt = await runCodexWorkerAssignment({
        store,
        registry,
        runRegistry,
        executor: new CommandCodexExecutorAdapter(new NodeProcessCodexCommandRunner()),
        assignmentId: "assignment-real-1",
        runId: "run-real-1",
        policy: {
          workspaceRoot: process.cwd(),
          allowedTools: ["read"],
          maxRuntimeMs: 120_000,
          managerVisibility: "summary_only"
        }
      });

      expect(receipt.managerView.status).toBe("succeeded");
      expect(receipt.managerView.summary).toBe("CODEX_OK");
      expect(receipt.lifecycle?.status).toBe("succeeded");
      expect(store.getAssignment("assignment-real-1")?.status).toBe("succeeded");
      expect(store.getTask("task-real-1")?.status).toBe("reviewing");
      expect(registry.getWorker("worker-real-1")?.status).toBe("idle");
    },
    180_000
  );
});
