export type OwnerChannelKind = "discord" | "telegram" | "slack" | "web";
export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type TaskStatus =
  | "new"
  | "planned"
  | "assigned"
  | "running"
  | "blocked"
  | "reviewing"
  | "done"
  | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type ExecutorType = "codex";
export type AssignmentStatus =
  | "queued"
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";
export type CommitmentStatus = "open" | "fulfilled" | "cancelled" | "overdue";
export type WorkerStatus = "idle" | "busy" | "offline" | "error";
export type ProgressEventSource = "owner" | "manager" | "worker" | "system";
export type ProgressEventKind =
  | "task_created"
  | "task_split"
  | "task_assigned"
  | "work_started"
  | "heartbeat"
  | "blocked"
  | "needs_clarification"
  | "completed"
  | "failed"
  | "reassigned"
  | "cancelled";

export type Owner = {
  id: string;
  displayName: string;
  channels: Array<{
    kind: OwnerChannelKind;
    accountId: string;
    peerId: string;
  }>;
  createdAt: number;
  updatedAt: number;
};

export type Project = {
  id: string;
  name: string;
  goal: string;
  ownerId: string;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
};

export type Task = {
  id: string;
  projectId?: string;
  ownerId: string;
  parentTaskId?: string;
  title: string;
  goal: string;
  status: TaskStatus;
  priority: TaskPriority;
  executorType?: ExecutorType;
  workerId?: string;
  completionCriteria?: string[];
  blockers?: string[];
  dueAt?: number;
  createdAt: number;
  updatedAt: number;
  lastProgressAt?: number;
  nextFollowupAt?: number;
  tags?: string[];
};

export type Assignment = {
  id: string;
  taskId: string;
  workerId: string;
  executorType: ExecutorType;
  status: AssignmentStatus;
  objective: string;
  inputs: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  heartbeatAt?: number;
  resultSummary?: string;
  errorSummary?: string;
};

export type ProgressEvent = {
  id: string;
  taskId: string;
  assignmentId?: string;
  source: ProgressEventSource;
  kind: ProgressEventKind;
  summary: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
};

export type Commitment = {
  id: string;
  ownerId: string;
  taskId?: string;
  projectId?: string;
  summary: string;
  status: CommitmentStatus;
  dueAt?: number;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt?: number;
};

export type WorkerProfile = {
  id: string;
  executorType: ExecutorType;
  status: WorkerStatus;
  currentAssignmentId?: string;
  strengths?: string[];
  recentFailures?: string[];
  createdAt: number;
  updatedAt: number;
};

export type TaskQuery = {
  ownerId?: string;
  projectId?: string;
  workerId?: string;
  status?: TaskStatus;
};

export type AssignmentQuery = {
  taskId?: string;
  workerId?: string;
  status?: AssignmentStatus;
};

export type CommitmentQuery = {
  ownerId?: string;
  taskId?: string;
  projectId?: string;
  status?: CommitmentStatus;
};

export const TASK_SYSTEM_SCHEMA_VERSION = 1;

export type TaskSystemSnapshot = {
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  data: {
    tasks: Task[];
    assignments: Assignment[];
    commitments: Commitment[];
    progressEvents: ProgressEvent[];
  };
};

export type LegacyTaskSystemSnapshotV0 = {
  schemaVersion?: 0;
  tasks?: Task[];
  assignments?: Assignment[];
  commitments?: Commitment[];
  progressEvents?: ProgressEvent[];
};

function isNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return normalized;
}

function normalizeDueAt(dueAt: number | undefined, field: string): number | undefined {
  if (dueAt === undefined) {
    return undefined;
  }
  if (!Number.isFinite(dueAt) || dueAt <= 0) {
    throw new Error(`${field} must be a positive timestamp`);
  }
  return dueAt;
}

export function createTask(input: {
  id: string;
  ownerId: string;
  title: string;
  goal: string;
  now?: number;
  priority?: TaskPriority;
  projectId?: string;
  parentTaskId?: string;
  dueAt?: number;
  tags?: string[];
}): Task {
  const now = input.now ?? Date.now();
  return {
    id: isNonEmptyString(input.id, "task.id"),
    ownerId: isNonEmptyString(input.ownerId, "task.ownerId"),
    projectId: input.projectId,
    parentTaskId: input.parentTaskId,
    title: isNonEmptyString(input.title, "task.title"),
    goal: isNonEmptyString(input.goal, "task.goal"),
    status: "new",
    priority: input.priority ?? "medium",
    dueAt: normalizeDueAt(input.dueAt, "task.dueAt"),
    createdAt: now,
    updatedAt: now,
    tags: input.tags
  };
}

export function createAssignment(input: {
  id: string;
  taskId: string;
  workerId: string;
  objective: string;
  now?: number;
  inputs?: Record<string, unknown>;
  executorType?: ExecutorType;
}): Assignment {
  const now = input.now ?? Date.now();
  return {
    id: isNonEmptyString(input.id, "assignment.id"),
    taskId: isNonEmptyString(input.taskId, "assignment.taskId"),
    workerId: isNonEmptyString(input.workerId, "assignment.workerId"),
    executorType: input.executorType ?? "codex",
    status: "queued",
    objective: isNonEmptyString(input.objective, "assignment.objective"),
    inputs: input.inputs ?? {},
    createdAt: now,
    updatedAt: now
  };
}

export function createCommitment(input: {
  id: string;
  ownerId: string;
  summary: string;
  now?: number;
  dueAt?: number;
  taskId?: string;
  projectId?: string;
}): Commitment {
  const now = input.now ?? Date.now();
  return {
    id: isNonEmptyString(input.id, "commitment.id"),
    ownerId: isNonEmptyString(input.ownerId, "commitment.ownerId"),
    summary: isNonEmptyString(input.summary, "commitment.summary"),
    dueAt: normalizeDueAt(input.dueAt, "commitment.dueAt"),
    taskId: input.taskId,
    projectId: input.projectId,
    status: "open",
    createdAt: now,
    updatedAt: now
  };
}

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  new: ["planned", "cancelled"],
  planned: ["assigned", "cancelled"],
  assigned: ["running", "blocked", "cancelled", "planned"],
  running: ["reviewing", "blocked", "cancelled", "planned"],
  blocked: ["planned", "assigned", "cancelled"],
  reviewing: ["done", "planned", "cancelled"],
  done: [],
  cancelled: []
};

const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  queued: ["starting", "cancelled"],
  starting: ["running", "failed", "timed_out", "cancelled"],
  running: ["succeeded", "failed", "timed_out", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: []
};

const COMMITMENT_TRANSITIONS: Record<CommitmentStatus, CommitmentStatus[]> = {
  open: ["fulfilled", "cancelled", "overdue"],
  fulfilled: [],
  cancelled: [],
  overdue: ["fulfilled", "cancelled"]
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function transitionTask(task: Task, to: TaskStatus, now: number = Date.now()): Task {
  if (!canTransitionTask(task.status, to)) {
    throw new Error(`invalid task transition: ${task.status} -> ${to}`);
  }
  return {
    ...task,
    status: to,
    updatedAt: now
  };
}

export function canTransitionAssignment(from: AssignmentStatus, to: AssignmentStatus): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

export function transitionAssignment(
  assignment: Assignment,
  to: AssignmentStatus,
  now: number = Date.now()
): Assignment {
  if (!canTransitionAssignment(assignment.status, to)) {
    throw new Error(`invalid assignment transition: ${assignment.status} -> ${to}`);
  }

  return {
    ...assignment,
    status: to,
    updatedAt: now,
    startedAt: to === "running" && !assignment.startedAt ? now : assignment.startedAt,
    finishedAt:
      to === "succeeded" || to === "failed" || to === "cancelled" || to === "timed_out"
        ? now
        : assignment.finishedAt
  };
}

export function canTransitionCommitment(from: CommitmentStatus, to: CommitmentStatus): boolean {
  return COMMITMENT_TRANSITIONS[from].includes(to);
}

export function transitionCommitment(
  commitment: Commitment,
  to: CommitmentStatus,
  now: number = Date.now()
): Commitment {
  if (!canTransitionCommitment(commitment.status, to)) {
    throw new Error(`invalid commitment transition: ${commitment.status} -> ${to}`);
  }

  return {
    ...commitment,
    status: to,
    updatedAt: now,
    lastCheckedAt: now
  };
}

function byUpdatedAtDesc<T extends { updatedAt: number }>(left: T, right: T) {
  return right.updatedAt - left.updatedAt;
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function migrateSnapshot(
  snapshot: TaskSystemSnapshot | LegacyTaskSystemSnapshotV0,
  now: number = Date.now()
): TaskSystemSnapshot {
  if ("data" in snapshot && snapshot.schemaVersion === TASK_SYSTEM_SCHEMA_VERSION) {
    return snapshot;
  }

  const legacy = snapshot as LegacyTaskSystemSnapshotV0;
  return {
    schemaVersion: TASK_SYSTEM_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    data: {
      tasks: asArray(legacy.tasks),
      assignments: asArray(legacy.assignments),
      commitments: asArray(legacy.commitments),
      progressEvents: asArray(legacy.progressEvents)
    }
  };
}

export function validateSnapshot(snapshot: TaskSystemSnapshot): string[] {
  const issues: string[] = [];

  if (snapshot.schemaVersion !== TASK_SYSTEM_SCHEMA_VERSION) {
    issues.push(`unsupported task-system schema version: ${snapshot.schemaVersion}`);
  }
  if (!Array.isArray(snapshot.data.tasks)) {
    issues.push("snapshot.data.tasks must be an array");
  }
  if (!Array.isArray(snapshot.data.assignments)) {
    issues.push("snapshot.data.assignments must be an array");
  }
  if (!Array.isArray(snapshot.data.commitments)) {
    issues.push("snapshot.data.commitments must be an array");
  }
  if (!Array.isArray(snapshot.data.progressEvents)) {
    issues.push("snapshot.data.progressEvents must be an array");
  }

  return issues;
}

export function repairSnapshot(
  snapshot: TaskSystemSnapshot | LegacyTaskSystemSnapshotV0,
  now: number = Date.now()
): TaskSystemSnapshot {
  const migrated = migrateSnapshot(snapshot, now);

  return {
    ...migrated,
    data: {
      tasks: asArray(migrated.data.tasks),
      assignments: asArray(migrated.data.assignments),
      commitments: asArray(migrated.data.commitments),
      progressEvents: asArray(migrated.data.progressEvents)
    }
  };
}

export interface TaskSnapshotRepository {
  load(): TaskSystemSnapshot | undefined;
  save(snapshot: TaskSystemSnapshot): void;
}

export class InMemoryTaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly assignments = new Map<string, Assignment>();
  private readonly commitments = new Map<string, Commitment>();
  private readonly progressEvents = new Map<string, ProgressEvent>();
  private readonly createdAt: number;
  private updatedAt: number;

  constructor(now: number = Date.now()) {
    this.createdAt = now;
    this.updatedAt = now;
  }

  private touch(now: number) {
    this.updatedAt = now;
  }

  upsertTask(task: Task): Task {
    this.tasks.set(task.id, task);
    this.touch(task.updatedAt);
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listTasks(query: TaskQuery = {}): Task[] {
    return [...this.tasks.values()]
      .filter((task) => {
        if (query.ownerId && task.ownerId !== query.ownerId) {
          return false;
        }
        if (query.projectId && task.projectId !== query.projectId) {
          return false;
        }
        if (query.workerId && task.workerId !== query.workerId) {
          return false;
        }
        if (query.status && task.status !== query.status) {
          return false;
        }
        return true;
      })
      .sort(byUpdatedAtDesc);
  }

  updateTaskStatus(id: string, status: TaskStatus, now: number = Date.now()): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`task not found: ${id}`);
    }
    const next = transitionTask(task, status, now);
    this.tasks.set(id, next);
    this.touch(now);
    return next;
  }

  upsertAssignment(assignment: Assignment): Assignment {
    this.assignments.set(assignment.id, assignment);
    this.touch(assignment.updatedAt);
    return assignment;
  }

  getAssignment(id: string): Assignment | undefined {
    return this.assignments.get(id);
  }

  listAssignments(query: AssignmentQuery = {}): Assignment[] {
    return [...this.assignments.values()]
      .filter((assignment) => {
        if (query.taskId && assignment.taskId !== query.taskId) {
          return false;
        }
        if (query.workerId && assignment.workerId !== query.workerId) {
          return false;
        }
        if (query.status && assignment.status !== query.status) {
          return false;
        }
        return true;
      })
      .sort(byUpdatedAtDesc);
  }

  updateAssignmentStatus(id: string, status: AssignmentStatus, now: number = Date.now()): Assignment {
    const assignment = this.assignments.get(id);
    if (!assignment) {
      throw new Error(`assignment not found: ${id}`);
    }
    const next = transitionAssignment(assignment, status, now);
    this.assignments.set(id, next);
    this.touch(now);
    return next;
  }

  upsertCommitment(commitment: Commitment): Commitment {
    this.commitments.set(commitment.id, commitment);
    this.touch(commitment.updatedAt);
    return commitment;
  }

  getCommitment(id: string): Commitment | undefined {
    return this.commitments.get(id);
  }

  listCommitments(query: CommitmentQuery = {}): Commitment[] {
    return [...this.commitments.values()]
      .filter((commitment) => {
        if (query.ownerId && commitment.ownerId !== query.ownerId) {
          return false;
        }
        if (query.taskId && commitment.taskId !== query.taskId) {
          return false;
        }
        if (query.projectId && commitment.projectId !== query.projectId) {
          return false;
        }
        if (query.status && commitment.status !== query.status) {
          return false;
        }
        return true;
      })
      .sort(byUpdatedAtDesc);
  }

  updateCommitmentStatus(
    id: string,
    status: CommitmentStatus,
    now: number = Date.now()
  ): Commitment {
    const commitment = this.commitments.get(id);
    if (!commitment) {
      throw new Error(`commitment not found: ${id}`);
    }
    const next = transitionCommitment(commitment, status, now);
    this.commitments.set(id, next);
    this.touch(now);
    return next;
  }

  appendProgressEvent(event: ProgressEvent): ProgressEvent {
    this.progressEvents.set(event.id, event);
    this.touch(event.createdAt);
    return event;
  }

  listProgressEvents(taskId?: string): ProgressEvent[] {
    return [...this.progressEvents.values()]
      .filter((event) => (taskId ? event.taskId === taskId : true))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  toSnapshot(): TaskSystemSnapshot {
    return {
      schemaVersion: TASK_SYSTEM_SCHEMA_VERSION,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      data: {
        tasks: this.listTasks().reverse(),
        assignments: this.listAssignments().reverse(),
        commitments: this.listCommitments().reverse(),
        progressEvents: this.listProgressEvents()
      }
    };
  }

  persist(repository: TaskSnapshotRepository): TaskSystemSnapshot {
    const snapshot = this.toSnapshot();
    repository.save(snapshot);
    return snapshot;
  }

  static restore(repository: TaskSnapshotRepository): InMemoryTaskStore {
    const snapshot = repository.load();
    if (!snapshot) {
      return new InMemoryTaskStore();
    }

    return InMemoryTaskStore.fromSnapshot(snapshot);
  }

  static fromSnapshot(snapshot: TaskSystemSnapshot): InMemoryTaskStore {
    const repaired = repairSnapshot(snapshot);
    const issues = validateSnapshot(repaired);
    if (issues.length > 0) {
      throw new Error(issues.join("; "));
    }

    const store = new InMemoryTaskStore(repaired.createdAt);
    store.updatedAt = repaired.updatedAt;

    for (const task of repaired.data.tasks) {
      store.tasks.set(task.id, task);
    }
    for (const assignment of repaired.data.assignments) {
      store.assignments.set(assignment.id, assignment);
    }
    for (const commitment of repaired.data.commitments) {
      store.commitments.set(commitment.id, commitment);
    }
    for (const event of repaired.data.progressEvents) {
      store.progressEvents.set(event.id, event);
    }

    return store;
  }
}

export class InMemoryTaskSnapshotRepository implements TaskSnapshotRepository {
  private snapshot?: TaskSystemSnapshot;

  load(): TaskSystemSnapshot | undefined {
    return this.snapshot;
  }

  save(snapshot: TaskSystemSnapshot): void {
    this.snapshot = repairSnapshot(snapshot);
  }
}
