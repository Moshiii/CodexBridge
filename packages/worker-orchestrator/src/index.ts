import {
  type Assignment,
  type AssignmentStatus,
  type ExecutorType,
  type InMemoryTaskStore,
  type Task,
  type WorkerProfile,
  createAssignment
} from "@autoaide/task-system";

export const WORKER_ORCHESTRATOR_SCHEMA_VERSION = 1;

export type WorkerSpawnRequest = {
  workerId: string;
  executorType?: ExecutorType;
  strengths?: string[];
  now?: number;
};

export type WorkerRegistrySnapshot = {
  schemaVersion: number;
  workers: WorkerProfile[];
};

export type AssignTaskInput = {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  taskId: string;
  workerId: string;
  assignmentId: string;
  objective: string;
  now?: number;
  inputs?: Record<string, unknown>;
};

export type WorkerHeartbeatInput = {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  workerId: string;
  assignmentId: string;
  now?: number;
  summary?: string;
};

export type WorkerResultInput = {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  assignmentId: string;
  now?: number;
  outcome: "succeeded" | "failed" | "timed_out" | "cancelled";
  summary?: string;
};

export type StalledAssignment = {
  assignmentId: string;
  workerId: string;
  taskId: string;
  status: AssignmentStatus;
  lastHeartbeatAt: number;
};

function requireWorker(registry: InMemoryWorkerRegistry, workerId: string): WorkerProfile {
  const worker = registry.getWorker(workerId);
  if (!worker) {
    throw new Error(`worker not found: ${workerId}`);
  }
  return worker;
}

function requireTask(store: InMemoryTaskStore, taskId: string): Task {
  const task = store.getTask(taskId);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }
  return task;
}

function requireAssignment(store: InMemoryTaskStore, assignmentId: string): Assignment {
  const assignment = store.getAssignment(assignmentId);
  if (!assignment) {
    throw new Error(`assignment not found: ${assignmentId}`);
  }
  return assignment;
}

function updateAssignmentForHeartbeat(assignment: Assignment, now: number): Assignment {
  const nextStatus =
    assignment.status === "queued" || assignment.status === "starting" ? "running" : assignment.status;

  return {
    ...assignment,
    status: nextStatus,
    startedAt: assignment.startedAt ?? now,
    heartbeatAt: now,
    updatedAt: now
  };
}

function updateAssignmentForResult(
  assignment: Assignment,
  outcome: WorkerResultInput["outcome"],
  now: number,
  summary?: string
): Assignment {
  return {
    ...assignment,
    status: outcome,
    resultSummary: outcome === "succeeded" ? summary : assignment.resultSummary,
    errorSummary: outcome !== "succeeded" ? summary : assignment.errorSummary,
    finishedAt: now,
    updatedAt: now
  };
}

export class InMemoryWorkerRegistry {
  private readonly workers = new Map<string, WorkerProfile>();

  registerWorker(request: WorkerSpawnRequest): WorkerProfile {
    const now = request.now ?? Date.now();
    const worker: WorkerProfile = {
      id: request.workerId,
      executorType: request.executorType ?? "codex",
      status: "idle",
      strengths: request.strengths,
      createdAt: now,
      updatedAt: now
    };
    this.workers.set(worker.id, worker);
    return worker;
  }

  upsertWorker(worker: WorkerProfile): WorkerProfile {
    this.workers.set(worker.id, worker);
    return worker;
  }

  getWorker(workerId: string): WorkerProfile | undefined {
    return this.workers.get(workerId);
  }

  listWorkers(): WorkerProfile[] {
    return [...this.workers.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  listIdleWorkers(): WorkerProfile[] {
    return this.listWorkers().filter((worker) => worker.status === "idle");
  }

  assignCurrentAssignment(workerId: string, assignmentId: string, now: number = Date.now()): WorkerProfile {
    const worker = requireWorker(this, workerId);
    return this.upsertWorker({
      ...worker,
      status: "busy",
      currentAssignmentId: assignmentId,
      updatedAt: now
    });
  }

  clearCurrentAssignment(
    workerId: string,
    now: number = Date.now(),
    status: WorkerProfile["status"] = "idle"
  ): WorkerProfile {
    const worker = requireWorker(this, workerId);
    return this.upsertWorker({
      ...worker,
      status,
      currentAssignmentId: undefined,
      updatedAt: now
    });
  }

  recordHeartbeat(workerId: string, now: number = Date.now()): WorkerProfile {
    const worker = requireWorker(this, workerId);
    return this.upsertWorker({
      ...worker,
      status: "busy",
      updatedAt: now
    });
  }

  detectStalledWorkers(now: number, heartbeatTimeoutMs: number): WorkerProfile[] {
    return this.listWorkers().filter(
      (worker) =>
        worker.status === "busy" &&
        typeof worker.currentAssignmentId === "string" &&
        now - worker.updatedAt > heartbeatTimeoutMs
    );
  }

  toSnapshot(): WorkerRegistrySnapshot {
    return {
      schemaVersion: WORKER_ORCHESTRATOR_SCHEMA_VERSION,
      workers: this.listWorkers().reverse()
    };
  }

  static fromSnapshot(snapshot: WorkerRegistrySnapshot): InMemoryWorkerRegistry {
    if (snapshot.schemaVersion !== WORKER_ORCHESTRATOR_SCHEMA_VERSION) {
      throw new Error(`unsupported worker-orchestrator schema version: ${snapshot.schemaVersion}`);
    }

    const registry = new InMemoryWorkerRegistry();
    for (const worker of snapshot.workers) {
      registry.workers.set(worker.id, worker);
    }
    return registry;
  }
}

export function spawnWorker(
  registry: InMemoryWorkerRegistry,
  request: WorkerSpawnRequest
): WorkerProfile {
  return registry.registerWorker(request);
}

export function assignTaskToWorker(input: AssignTaskInput): Assignment {
  const now = input.now ?? Date.now();
  const task = requireTask(input.store, input.taskId);
  const worker = requireWorker(input.registry, input.workerId);

  if (worker.status !== "idle") {
    throw new Error(`worker is not idle: ${input.workerId}`);
  }

  const assignment = createAssignment({
    id: input.assignmentId,
    taskId: input.taskId,
    workerId: input.workerId,
    objective: input.objective,
    now,
    inputs: input.inputs,
    executorType: worker.executorType
  });

  input.store.upsertAssignment({
    ...assignment,
    status: "starting",
    startedAt: now,
    updatedAt: now
  });
  input.store.upsertTask({
    ...task,
    status: "assigned",
    workerId: input.workerId,
    executorType: worker.executorType,
    updatedAt: now,
    lastProgressAt: now
  });
  input.registry.assignCurrentAssignment(input.workerId, input.assignmentId, now);

  return requireAssignment(input.store, input.assignmentId);
}

export function recordWorkerHeartbeat(input: WorkerHeartbeatInput): Assignment {
  const now = input.now ?? Date.now();
  const assignment = requireAssignment(input.store, input.assignmentId);

  if (assignment.workerId !== input.workerId) {
    throw new Error(`assignment ${input.assignmentId} does not belong to worker ${input.workerId}`);
  }

  const nextAssignment = updateAssignmentForHeartbeat(assignment, now);
  input.store.upsertAssignment(nextAssignment);
  input.registry.recordHeartbeat(input.workerId, now);

  const task = requireTask(input.store, assignment.taskId);
  input.store.upsertTask({
    ...task,
    status: "running",
    lastProgressAt: now,
    updatedAt: now
  });

  return nextAssignment;
}

export function recordWorkerResult(input: WorkerResultInput): Assignment {
  const now = input.now ?? Date.now();
  const assignment = requireAssignment(input.store, input.assignmentId);
  const nextAssignment = updateAssignmentForResult(assignment, input.outcome, now, input.summary);
  input.store.upsertAssignment(nextAssignment);

  const nextWorkerStatus = input.outcome === "succeeded" ? "idle" : "error";
  input.registry.clearCurrentAssignment(assignment.workerId, now, nextWorkerStatus);

  const task = requireTask(input.store, assignment.taskId);
  input.store.upsertTask({
    ...task,
    status: input.outcome === "succeeded" ? "reviewing" : "blocked",
    blockers: input.outcome === "succeeded" ? [] : [input.summary ?? "Worker execution failed"],
    updatedAt: now,
    lastProgressAt: now
  });

  return nextAssignment;
}

export function detectStalledAssignments(
  store: InMemoryTaskStore,
  registry: InMemoryWorkerRegistry,
  now: number,
  heartbeatTimeoutMs: number
): StalledAssignment[] {
  const stalledWorkerIds = new Set(registry.detectStalledWorkers(now, heartbeatTimeoutMs).map((w) => w.id));

  return store
    .listAssignments()
    .filter(
      (assignment) =>
        stalledWorkerIds.has(assignment.workerId) &&
        (assignment.status === "starting" || assignment.status === "running")
    )
    .map((assignment) => ({
      assignmentId: assignment.id,
      workerId: assignment.workerId,
      taskId: assignment.taskId,
      status: assignment.status,
      lastHeartbeatAt: assignment.heartbeatAt ?? assignment.updatedAt
    }));
}
