import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Assignment, InMemoryTaskStore, Task } from "@autoaide/task-system";
import {
  type InMemoryWorkerRegistry,
  recordWorkerResult
} from "@autoaide/worker-orchestrator";

export const EXECUTOR_CODEX_SCHEMA_VERSION = 1;

export type ManagerVisibility = "summary_only" | "summary_and_trace";

export type CodexExecutionPolicy = {
  workspaceRoot: string;
  allowedTools: string[];
  maxRuntimeMs: number;
  managerVisibility: ManagerVisibility;
  credentialProfile?: string;
};

export type CodexRunRequest = {
  schemaVersion: number;
  runId: string;
  workerId: string;
  assignmentId: string;
  taskId: string;
  objective: string;
  inputs: Record<string, unknown>;
  workspaceRoot: string;
  allowedTools: string[];
  maxRuntimeMs: number;
  createdAt: number;
  managerVisibility: ManagerVisibility;
  credentialProfile?: string;
};

export type CodexRunSuccess = {
  status: "succeeded";
  runId: string;
  assignmentId: string;
  finishedAt: number;
  summary: string;
  trace?: string[];
};

export type CodexRunFailure = {
  status: "failed" | "timed_out" | "cancelled";
  runId: string;
  assignmentId: string;
  finishedAt: number;
  errorCode: string;
  summary: string;
  trace?: string[];
};

export type CodexRunResult = CodexRunSuccess | CodexRunFailure;

export type WorkerResultPayload = {
  outcome: "succeeded" | "failed" | "timed_out" | "cancelled";
  summary: string;
};

export type CodexRunRecord = {
  runId: string;
  assignmentId: string;
  workerId: string;
  status: "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  retryOfRunId?: string;
  summary?: string;
};

export type CodexCliInvocation = {
  runId: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  stdin: string;
};

export type CodexCommandRunnerResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type CodexJsonEvent = {
  type?: string;
  item?: {
    type?: string;
    text?: string;
  };
};

export type CodexExecutionOutput = {
  request: CodexRunRequest;
  result: CodexRunResult;
  workerResult: WorkerResultPayload;
};

export type CodexExecutionReceipt = CodexExecutionOutput & {
  managerView: {
    status: CodexRunResult["status"];
    summary: string;
    trace?: string[];
  };
  lifecycle?: CodexRunRecord;
};

export interface CodexExecutor {
  run(request: CodexRunRequest): Promise<CodexRunResult>;
  cancel(runId: string): Promise<void>;
}

export interface CodexCommandRunner {
  run(invocation: CodexCliInvocation): Promise<CodexCommandRunnerResult>;
  cancel?(runId: string): Promise<void>;
}

export type CodexRunHandler = (request: CodexRunRequest) => Promise<CodexRunResult>;

function ensureNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return normalized;
}

export function validateExecutionPolicy(policy: CodexExecutionPolicy): CodexExecutionPolicy {
  if (!policy.allowedTools.length) {
    throw new Error("policy.allowedTools must not be empty");
  }
  if (!Number.isFinite(policy.maxRuntimeMs) || policy.maxRuntimeMs <= 0) {
    throw new Error("policy.maxRuntimeMs must be a positive number");
  }

  return {
    ...policy,
    workspaceRoot: ensureNonEmptyString(policy.workspaceRoot, "policy.workspaceRoot"),
    allowedTools: policy.allowedTools.map((tool) => ensureNonEmptyString(tool, "policy.allowedTools"))
  };
}

export function createCodexRunRequest(input: {
  runId: string;
  workerId: string;
  assignment: Assignment;
  task: Task;
  policy: CodexExecutionPolicy;
  now?: number;
}): CodexRunRequest {
  const policy = validateExecutionPolicy(input.policy);
  const now = input.now ?? Date.now();

  return {
    schemaVersion: EXECUTOR_CODEX_SCHEMA_VERSION,
    runId: ensureNonEmptyString(input.runId, "runId"),
    workerId: ensureNonEmptyString(input.workerId, "workerId"),
    assignmentId: input.assignment.id,
    taskId: input.task.id,
    objective: input.assignment.objective,
    inputs: input.assignment.inputs,
    workspaceRoot: policy.workspaceRoot,
    allowedTools: policy.allowedTools,
    maxRuntimeMs: policy.maxRuntimeMs,
    createdAt: now,
    managerVisibility: policy.managerVisibility,
    credentialProfile: policy.credentialProfile
  };
}

export function toWorkerResultPayload(result: CodexRunResult): WorkerResultPayload {
  return {
    outcome: result.status,
    summary: result.summary
  };
}

export function redactResultForManager(result: CodexRunResult): {
  status: CodexRunResult["status"];
  summary: string;
  trace?: string[];
} {
  if (!result.trace) {
    return {
      status: result.status,
      summary: result.summary
    };
  }

  return {
    status: result.status,
    summary: result.summary,
    trace: result.trace
  };
}

export function retryCodexRunRequest(
  request: CodexRunRequest,
  input: { retryRunId: string; now?: number }
): CodexRunRequest {
  return {
    ...request,
    runId: ensureNonEmptyString(input.retryRunId, "retryRunId"),
    createdAt: input.now ?? Date.now()
  };
}

export function buildCodexCliInvocation(
  request: CodexRunRequest,
  command = "codex"
): CodexCliInvocation {
  return {
    runId: request.runId,
    command,
    args: ["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", "-"],
    cwd: request.workspaceRoot,
    env: {
      AUTOAIDE_RUN_ID: request.runId,
      AUTOAIDE_WORKER_ID: request.workerId,
      AUTOAIDE_ASSIGNMENT_ID: request.assignmentId,
      AUTOAIDE_TASK_ID: request.taskId,
      AUTOAIDE_ALLOWED_TOOLS: request.allowedTools.join(","),
      AUTOAIDE_MANAGER_VISIBILITY: request.managerVisibility,
      ...(request.credentialProfile
        ? { AUTOAIDE_CREDENTIAL_PROFILE: request.credentialProfile }
        : {})
    },
    timeoutMs: request.maxRuntimeMs,
    stdin: buildCodexExecPrompt(request)
  };
}

export function buildCodexExecPrompt(request: CodexRunRequest): string {
  return [
    "You are a Codex worker executing an AutoAide assignment.",
    `Run ID: ${request.runId}`,
    `Assignment ID: ${request.assignmentId}`,
    `Task ID: ${request.taskId}`,
    `Objective: ${request.objective}`,
    `Workspace root: ${request.workspaceRoot}`,
    `Allowed tools: ${request.allowedTools.join(", ")}`,
    `Inputs JSON: ${JSON.stringify(request.inputs)}`,
    "Complete the assignment using the available tools if needed.",
    "Return exactly one JSON object and nothing else.",
    `For success, use: {"status":"succeeded","runId":"${request.runId}","assignmentId":"${request.assignmentId}","finishedAt":<unix_ms>,"summary":"<short summary>","trace":["<optional short step>"]}`,
    `For failure, use: {"status":"failed","runId":"${request.runId}","assignmentId":"${request.assignmentId}","finishedAt":<unix_ms>,"errorCode":"<short_code>","summary":"<short summary>","trace":["<optional short step>"]}`,
    "Do not wrap the JSON in markdown fences."
  ].join("\n");
}

export function parseCodexRunResult(raw: string): CodexRunResult {
  const parsed = JSON.parse(raw) as Partial<CodexRunResult>;

  if (
    parsed.status !== "succeeded" &&
    parsed.status !== "failed" &&
    parsed.status !== "timed_out" &&
    parsed.status !== "cancelled"
  ) {
    throw new Error("invalid codex result status");
  }
  if (typeof parsed.runId !== "string" || typeof parsed.assignmentId !== "string") {
    throw new Error("invalid codex result identity");
  }
  if (typeof parsed.finishedAt !== "number" || typeof parsed.summary !== "string") {
    throw new Error("invalid codex result payload");
  }
  if (
    parsed.status !== "succeeded" &&
    typeof (parsed as Partial<CodexRunFailure>).errorCode !== "string"
  ) {
    throw new Error("invalid codex failure payload");
  }

  return parsed as CodexRunResult;
}

export function decodeCodexCommandRunnerResult(input: {
  request: CodexRunRequest;
  commandResult: CodexCommandRunnerResult;
  now?: number;
}): CodexRunResult {
  const trimmedStdout = input.commandResult.stdout.trim();
  const now = input.now ?? Date.now();

  if (trimmedStdout) {
    const lines = trimmedStdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return parseCodexRunResult(lines[index]!);
      } catch {
        try {
          const event = JSON.parse(lines[index]!) as CodexJsonEvent;
          if (event.type === "item.completed" && event.item?.type === "agent_message") {
            return parseCodexRunResult(event.item.text ?? "");
          }
        } catch {
          continue;
        }
      }
    }
  }

  if (input.commandResult.exitCode === 124) {
    return {
      status: "timed_out",
      runId: input.request.runId,
      assignmentId: input.request.assignmentId,
      finishedAt: now,
      errorCode: "PROCESS_TIMEOUT",
      summary: input.commandResult.stderr.trim() || "Codex process timed out"
    };
  }

  return {
    status: "failed",
    runId: input.request.runId,
    assignmentId: input.request.assignmentId,
    finishedAt: now,
    errorCode: `PROCESS_EXIT_${input.commandResult.exitCode}`,
    summary: input.commandResult.stderr.trim() || "Codex process failed"
  };
}

export class InMemoryCodexRunRegistry {
  private readonly runs = new Map<string, CodexRunRecord>();

  startRun(request: CodexRunRequest, retryOfRunId?: string): CodexRunRecord {
    const record: CodexRunRecord = {
      runId: request.runId,
      assignmentId: request.assignmentId,
      workerId: request.workerId,
      status: "running",
      startedAt: request.createdAt,
      retryOfRunId
    };
    this.runs.set(record.runId, record);
    return record;
  }

  finishRun(result: CodexRunResult): CodexRunRecord {
    const existing = this.runs.get(result.runId);
    if (!existing) {
      throw new Error(`run not found: ${result.runId}`);
    }

    const record: CodexRunRecord = {
      ...existing,
      status: result.status,
      finishedAt: result.finishedAt,
      summary: result.summary
    };
    this.runs.set(record.runId, record);
    return record;
  }

  cancelRun(runId: string, now: number = Date.now(), summary = "Run cancelled"): CodexRunRecord {
    const existing = this.runs.get(runId);
    if (!existing) {
      throw new Error(`run not found: ${runId}`);
    }

    const record: CodexRunRecord = {
      ...existing,
      status: "cancelled",
      finishedAt: now,
      summary
    };
    this.runs.set(runId, record);
    return record;
  }

  getRun(runId: string): CodexRunRecord | undefined {
    return this.runs.get(runId);
  }

  listRuns(): CodexRunRecord[] {
    return [...this.runs.values()].sort((left, right) => right.startedAt - left.startedAt);
  }
}

export async function executeCodexAssignment(input: {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  executor: CodexExecutor;
  assignmentId: string;
  runId: string;
  policy: CodexExecutionPolicy;
  now?: number;
}): Promise<CodexExecutionOutput> {
  const assignment = input.store.getAssignment(input.assignmentId);
  if (!assignment) {
    throw new Error(`assignment not found: ${input.assignmentId}`);
  }

  const task = input.store.getTask(assignment.taskId);
  if (!task) {
    throw new Error(`task not found: ${assignment.taskId}`);
  }

  const request = createCodexRunRequest({
    runId: input.runId,
    workerId: assignment.workerId,
    assignment,
    task,
    policy: input.policy,
    now: input.now
  });
  const result = await input.executor.run(request);
  const workerResult = toWorkerResultPayload(result);

  recordWorkerResult({
    store: input.store,
    registry: input.registry,
    assignmentId: assignment.id,
    now: result.finishedAt,
    outcome: workerResult.outcome,
    summary: workerResult.summary
  });

  return {
    request,
    result,
    workerResult
  };
}

export async function executeCodexAssignmentWithLifecycle(input: {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  runRegistry: InMemoryCodexRunRegistry;
  executor: CodexExecutor;
  assignmentId: string;
  runId: string;
  policy: CodexExecutionPolicy;
  now?: number;
  retryOfRunId?: string;
}): Promise<CodexExecutionOutput> {
  const assignment = input.store.getAssignment(input.assignmentId);
  if (!assignment) {
    throw new Error(`assignment not found: ${input.assignmentId}`);
  }
  const task = input.store.getTask(assignment.taskId);
  if (!task) {
    throw new Error(`task not found: ${assignment.taskId}`);
  }

  const request = createCodexRunRequest({
    runId: input.runId,
    workerId: assignment.workerId,
    assignment,
    task,
    policy: input.policy,
    now: input.now
  });
  input.runRegistry.startRun(request, input.retryOfRunId);

  const result = await input.executor.run(request);
  input.runRegistry.finishRun(result);
  const workerResult = toWorkerResultPayload(result);

  recordWorkerResult({
    store: input.store,
    registry: input.registry,
    assignmentId: assignment.id,
    now: result.finishedAt,
    outcome: workerResult.outcome,
    summary: workerResult.summary
  });

  return {
    request,
    result,
    workerResult
  };
}

export async function cancelCodexRun(input: {
  executor: CodexExecutor;
  runRegistry: InMemoryCodexRunRegistry;
  runId: string;
  now?: number;
  summary?: string;
}): Promise<CodexRunRecord> {
  await input.executor.cancel(input.runId);
  return input.runRegistry.cancelRun(input.runId, input.now, input.summary);
}

export async function runCodexWorkerAssignment(input: {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  executor: CodexExecutor;
  assignmentId: string;
  runId: string;
  policy: CodexExecutionPolicy;
  runRegistry?: InMemoryCodexRunRegistry;
  now?: number;
  retryOfRunId?: string;
}): Promise<CodexExecutionReceipt> {
  const execution = input.runRegistry
    ? await executeCodexAssignmentWithLifecycle({
        store: input.store,
        registry: input.registry,
        runRegistry: input.runRegistry,
        executor: input.executor,
        assignmentId: input.assignmentId,
        runId: input.runId,
        policy: input.policy,
        now: input.now,
        retryOfRunId: input.retryOfRunId
      })
    : await executeCodexAssignment({
        store: input.store,
        registry: input.registry,
        executor: input.executor,
        assignmentId: input.assignmentId,
        runId: input.runId,
        policy: input.policy,
        now: input.now
      });

  return {
    ...execution,
    managerView: redactResultForManager(execution.result),
    lifecycle: input.runRegistry?.getRun(execution.request.runId)
  };
}

export class InMemoryCodexExecutorAdapter implements CodexExecutor {
  private readonly activeRuns = new Set<string>();

  constructor(private readonly handler: CodexRunHandler) {}

  async run(request: CodexRunRequest): Promise<CodexRunResult> {
    this.activeRuns.add(request.runId);
    try {
      return await this.handler(request);
    } finally {
      this.activeRuns.delete(request.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.activeRuns.delete(runId);
  }

  isActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }
}

export class CommandCodexExecutorAdapter implements CodexExecutor {
  constructor(
    private readonly runner: CodexCommandRunner,
    private readonly command = "codex"
  ) {}

  async run(request: CodexRunRequest): Promise<CodexRunResult> {
    const invocation = buildCodexCliInvocation(request, this.command);
    const result = await this.runner.run(invocation);
    return decodeCodexCommandRunnerResult({
      request,
      commandResult: result
    });
  }

  async cancel(runId: string): Promise<void> {
    if (this.runner.cancel) {
      await this.runner.cancel(runId);
    }
  }
}

export class NodeProcessCodexCommandRunner implements CodexCommandRunner {
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();

  async run(invocation: CodexCliInvocation): Promise<CodexCommandRunnerResult> {
    return await new Promise<CodexCommandRunnerResult>((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        env: {
          ...process.env,
          ...invocation.env
        },
        stdio: "pipe"
      });

      this.processes.set(invocation.runId, child);

      let stdout = "";
      let stderr = "";
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        this.processes.delete(invocation.runId);
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        settle(() => {
          resolve({
            stdout,
            stderr,
            exitCode: 124
          });
        });
      }, invocation.timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        settle(() => {
          reject(error);
        });
      });
      child.on("close", (code) => {
        settle(() => {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 1
          });
        });
      });

      child.stdin.write(invocation.stdin);
      child.stdin.end();
    });
  }

  async cancel(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    if (!child) {
      return;
    }
    child.kill("SIGTERM");
    this.processes.delete(runId);
  }
}
