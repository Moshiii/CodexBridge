import type {
  Assignment,
  Commitment,
  InMemoryTaskStore,
  ProgressEvent,
  Project,
  Task,
  Workstream,
  WorkerProfile
} from "@autoaide/task-system";

export const MEMORY_SYSTEM_SCHEMA_VERSION = 3;

export type ManagerWakeReason =
  | "owner_message"
  | "worker_result"
  | "worker_heartbeat"
  | "followup_due"
  | "blocked_task"
  | "stalled_assignment"
  | "status_query";

export type DecisionRecord = {
  id: string;
  ownerId: string;
  taskId?: string;
  projectId?: string;
  summary: string;
  rationale?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
};

export type ConversationTurn = {
  id: string;
  conversationId: string;
  ownerId: string;
  role: "owner" | "manager" | "system" | "event";
  text: string;
  createdAt: number;
};

export type ConversationRecord = {
  id: string;
  ownerId: string;
  channel: string;
  peerId: string;
  activeWorkstreamId?: string;
  activeWorkstreamTitle?: string;
  activeTaskId?: string;
  activeTaskTitle?: string;
  pendingClarificationQuestion?: string;
  rollingSummary?: string;
  createdAt: number;
  updatedAt: number;
};

export type ManagerSessionRecord = {
  id: string;
  ownerId: string;
  activeWorkstreamId?: string;
  lastWakeReason?: ManagerWakeReason;
  lastWakeAt?: number;
  pendingInboxCount: number;
  createdAt: number;
  updatedAt: number;
};

export type ManagerInboxEvent = {
  id: string;
  sessionId: string;
  ownerId: string;
  workstreamId?: string;
  reason: ManagerWakeReason;
  status: "pending" | "processed";
  summary: string;
  createdAt: number;
  processedAt?: number;
  metadata?: Record<string, unknown>;
};

export type MemorySystemSnapshot = {
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  data: {
    projects: Project[];
    workers: WorkerProfile[];
    decisionRecords: DecisionRecord[];
    conversations: ConversationRecord[];
    conversationTurns: ConversationTurn[];
    managerSessions: ManagerSessionRecord[];
    managerInboxEvents: ManagerInboxEvent[];
  };
};

export type LegacyMemorySystemSnapshotV0 = {
  schemaVersion?: 0;
  projects?: Project[];
  workers?: WorkerProfile[];
  decisionRecords?: DecisionRecord[];
  conversations?: ConversationRecord[];
  conversationTurns?: ConversationTurn[];
};

export type LegacyMemorySystemSnapshotV1 = {
  schemaVersion: 1;
  createdAt: number;
  updatedAt: number;
  data: {
    projects?: Project[];
    workers?: WorkerProfile[];
    decisionRecords?: DecisionRecord[];
    conversations?: ConversationRecord[];
    conversationTurns?: ConversationTurn[];
  };
};

export type LegacyMemorySystemSnapshotV2 = {
  schemaVersion: 2;
  createdAt: number;
  updatedAt: number;
  data: {
    projects?: Project[];
    workers?: WorkerProfile[];
    decisionRecords?: DecisionRecord[];
    conversations?: ConversationRecord[];
    conversationTurns?: ConversationTurn[];
  };
};

export type TaskSummary = {
  taskId: string;
  title: string;
  goal: string;
  status: Task["status"];
  priority: Task["priority"];
  workerId?: string;
  projectId?: string;
  blockers: string[];
  lastProgressAt?: number;
  nextFollowupAt?: number;
  eventCount: number;
  summary: string;
};

export type CommitmentSummary = {
  commitmentId: string;
  ownerId: string;
  taskId?: string;
  projectId?: string;
  status: Commitment["status"];
  dueAt?: number;
  summary: string;
};

export type WorkerSummary = {
  workerId: string;
  status: WorkerProfile["status"];
  currentAssignmentId?: string;
  strengths: string[];
  preferredTaskTypes: string[];
  recentTaskTypes: string[];
  lastHeartbeatAt?: number;
  lastOutcome?: WorkerProfile["lastOutcome"];
  lastOutcomeAt?: number;
  recentFailures: string[];
  openAssignments: number;
  reuseHint: string;
  summary: string;
};

export type WorkstreamSummary = {
  workstreamId: string;
  ownerId: string;
  rootTaskId: string;
  title: string;
  goal: string;
  status: Workstream["status"];
  priority: Workstream["priority"];
  activeTaskId?: string;
  activeWorkerId?: string;
  nextFollowupAt?: number;
  lastCheckpointAt?: number;
  lastManagerJudgment?: string;
  summary: string;
};

export type ProjectSummary = {
  projectId: string;
  name: string;
  status: Project["status"];
  taskCount: number;
  openTaskCount: number;
  blockedTaskCount: number;
  summary: string;
};

export type ManagerMemorySnapshot = {
  workstreamSummaries: WorkstreamSummary[];
  taskSummaries: TaskSummary[];
  commitmentSummaries: CommitmentSummary[];
  workerSummaries: WorkerSummary[];
  projectSummaries: ProjectSummary[];
  decisionRecords: DecisionRecord[];
  conversations: ConversationRecord[];
  conversationTurns: ConversationTurn[];
  managerSessions: ManagerSessionRecord[];
  managerInboxEvents: ManagerInboxEvent[];
};

export type MemoryStoreQuery = {
  ownerId?: string;
  taskId?: string;
  projectId?: string;
  status?: Commitment["status"];
  text?: string;
};

export interface MemoryStore {
  upsertProject(project: Project): Project;
  upsertWorker(worker: WorkerProfile): WorkerProfile;
  appendDecisionRecord(record: DecisionRecord): DecisionRecord;
  upsertConversation(conversation: ConversationRecord): ConversationRecord;
  appendConversationTurn(turn: ConversationTurn): ConversationTurn;
  upsertManagerSession(session: ManagerSessionRecord): ManagerSessionRecord;
  appendManagerInboxEvent(event: ManagerInboxEvent): ManagerInboxEvent;
  listProjects(): Project[];
  listWorkers(): WorkerProfile[];
  listDecisionRecords(): DecisionRecord[];
  listConversations(ownerId?: string): ConversationRecord[];
  listConversationTurns(conversationId: string): ConversationTurn[];
  listManagerSessions(ownerId?: string): ManagerSessionRecord[];
  listManagerInboxEvents(sessionId?: string): ManagerInboxEvent[];
  toSnapshot(): MemorySystemSnapshot;
}

export interface MemorySnapshotRepository {
  load(): MemorySystemSnapshot | undefined;
  save(snapshot: MemorySystemSnapshot): void;
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function migrateMemorySnapshot(
  snapshot:
    | MemorySystemSnapshot
    | LegacyMemorySystemSnapshotV0
    | LegacyMemorySystemSnapshotV1
    | LegacyMemorySystemSnapshotV2,
  now: number = Date.now()
): MemorySystemSnapshot {
  if ("data" in snapshot && snapshot.schemaVersion === MEMORY_SYSTEM_SCHEMA_VERSION) {
    return snapshot;
  }

  if ("data" in snapshot && snapshot.schemaVersion === 1) {
    const legacy = snapshot as LegacyMemorySystemSnapshotV1;
    return {
      schemaVersion: MEMORY_SYSTEM_SCHEMA_VERSION,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      data: {
        projects: asArray(legacy.data.projects),
        workers: asArray(legacy.data.workers),
        decisionRecords: asArray(legacy.data.decisionRecords),
        conversations: asArray(legacy.data.conversations),
        conversationTurns: asArray(legacy.data.conversationTurns),
        managerSessions: [],
        managerInboxEvents: []
      }
    };
  }

  if ("data" in snapshot && snapshot.schemaVersion === 2) {
    const legacy = snapshot as LegacyMemorySystemSnapshotV2;
    return {
      schemaVersion: MEMORY_SYSTEM_SCHEMA_VERSION,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      data: {
        projects: asArray(legacy.data.projects),
        workers: asArray(legacy.data.workers),
        decisionRecords: asArray(legacy.data.decisionRecords),
        conversations: asArray(legacy.data.conversations),
        conversationTurns: asArray(legacy.data.conversationTurns),
        managerSessions: [],
        managerInboxEvents: []
      }
    };
  }

  const legacy = snapshot as LegacyMemorySystemSnapshotV0;
  return {
    schemaVersion: MEMORY_SYSTEM_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    data: {
      projects: asArray(legacy.projects),
      workers: asArray(legacy.workers),
      decisionRecords: asArray(legacy.decisionRecords),
      conversations: asArray(legacy.conversations),
      conversationTurns: asArray(legacy.conversationTurns),
      managerSessions: [],
      managerInboxEvents: []
    }
  };
}

export function validateMemorySnapshot(snapshot: MemorySystemSnapshot): string[] {
  const issues: string[] = [];

  if (snapshot.schemaVersion !== MEMORY_SYSTEM_SCHEMA_VERSION) {
    issues.push(`unsupported memory-system schema version: ${snapshot.schemaVersion}`);
  }
  if (!Array.isArray(snapshot.data.projects)) {
    issues.push("snapshot.data.projects must be an array");
  }
  if (!Array.isArray(snapshot.data.workers)) {
    issues.push("snapshot.data.workers must be an array");
  }
  if (!Array.isArray(snapshot.data.decisionRecords)) {
    issues.push("snapshot.data.decisionRecords must be an array");
  }
  if (!Array.isArray(snapshot.data.conversations)) {
    issues.push("snapshot.data.conversations must be an array");
  }
  if (!Array.isArray(snapshot.data.conversationTurns)) {
    issues.push("snapshot.data.conversationTurns must be an array");
  }
  if (!Array.isArray(snapshot.data.managerSessions)) {
    issues.push("snapshot.data.managerSessions must be an array");
  }
  if (!Array.isArray(snapshot.data.managerInboxEvents)) {
    issues.push("snapshot.data.managerInboxEvents must be an array");
  }

  return issues;
}

export function repairMemorySnapshot(
  snapshot:
    | MemorySystemSnapshot
    | LegacyMemorySystemSnapshotV0
    | LegacyMemorySystemSnapshotV1
    | LegacyMemorySystemSnapshotV2,
  now: number = Date.now()
): MemorySystemSnapshot {
  const migrated = migrateMemorySnapshot(snapshot, now);

  return {
    ...migrated,
    data: {
      projects: asArray(migrated.data.projects),
      workers: asArray(migrated.data.workers),
      decisionRecords: asArray(migrated.data.decisionRecords),
      conversations: asArray(migrated.data.conversations),
      conversationTurns: asArray(migrated.data.conversationTurns),
      managerSessions: asArray(migrated.data.managerSessions),
      managerInboxEvents: asArray(migrated.data.managerInboxEvents)
    }
  };
}

function latestProgressAt(task: Task, events: ProgressEvent[]): number | undefined {
  const latestEvent = events.at(-1);
  return latestEvent?.createdAt ?? task.lastProgressAt;
}

function buildTaskSummary(task: Task, events: ProgressEvent[]): TaskSummary {
  const blockers = task.blockers ?? [];
  const lastProgress = latestProgressAt(task, events);
  return {
    taskId: task.id,
    title: task.title,
    goal: task.goal,
    status: task.status,
    priority: task.priority,
    workerId: task.workerId,
    projectId: task.projectId,
    blockers,
    lastProgressAt: lastProgress,
    nextFollowupAt: task.nextFollowupAt,
    eventCount: events.length,
    summary:
      blockers.length > 0
        ? `${task.title} is ${task.status} with blockers: ${blockers.join(", ")}`
        : `${task.title} is ${task.status}`
  };
}

function buildCommitmentSummary(commitment: Commitment): CommitmentSummary {
  return {
    commitmentId: commitment.id,
    ownerId: commitment.ownerId,
    taskId: commitment.taskId,
    projectId: commitment.projectId,
    status: commitment.status,
    dueAt: commitment.dueAt,
    summary: commitment.summary
  };
}

function buildWorkerSummary(worker: WorkerProfile, assignments: Assignment[]): WorkerSummary {
  const openAssignments = assignments.filter(
    (assignment) =>
      assignment.workerId === worker.id &&
      ["queued", "starting", "running"].includes(assignment.status)
  );

  return {
    workerId: worker.id,
    status: worker.status,
    currentAssignmentId: worker.currentAssignmentId,
    strengths: worker.strengths ?? [],
    preferredTaskTypes: worker.preferredTaskTypes ?? [],
    recentTaskTypes: worker.recentTaskTypes ?? [],
    lastHeartbeatAt: worker.lastHeartbeatAt,
    lastOutcome: worker.lastOutcome,
    lastOutcomeAt: worker.lastOutcomeAt,
    recentFailures: worker.recentFailures ?? [],
    openAssignments: openAssignments.length,
    reuseHint:
      worker.status === "idle" && (worker.recentTaskTypes?.length ?? 0) > 0
        ? `Recently handled ${worker.recentTaskTypes?.slice(0, 2).join(", ")}`
        : worker.status === "idle"
          ? "Idle and available for a new assignment"
          : worker.currentAssignmentId
            ? `Currently occupied with ${worker.currentAssignmentId}`
            : `${worker.status} and may need review before reuse`,
    summary: `${worker.id} is ${worker.status} with ${openAssignments.length} open assignments`
  };
}

function buildProjectSummary(project: Project, tasks: Task[]): ProjectSummary {
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  const openTaskCount = projectTasks.filter(
    (task) => !["done", "cancelled"].includes(task.status)
  ).length;
  const blockedTaskCount = projectTasks.filter((task) => task.status === "blocked").length;

  return {
    projectId: project.id,
    name: project.name,
    status: project.status,
    taskCount: projectTasks.length,
    openTaskCount,
    blockedTaskCount,
    summary: `${project.name} has ${openTaskCount} open tasks and ${blockedTaskCount} blocked tasks`
  };
}

function buildWorkstreamSummary(workstream: Workstream): WorkstreamSummary {
  return {
    workstreamId: workstream.id,
    ownerId: workstream.ownerId,
    rootTaskId: workstream.rootTaskId,
    title: workstream.title,
    goal: workstream.goal,
    status: workstream.status,
    priority: workstream.priority,
    activeTaskId: workstream.activeTaskId,
    activeWorkerId: workstream.activeWorkerId,
    nextFollowupAt: workstream.nextFollowupAt,
    lastCheckpointAt: workstream.lastCheckpointAt,
    lastManagerJudgment: workstream.lastManagerJudgment,
    summary: `${workstream.title} is ${workstream.status}`
  };
}

export function buildManagerMemorySnapshot(input: {
  store: InMemoryTaskStore;
  workers?: WorkerProfile[];
  projects?: Project[];
  decisionRecords?: DecisionRecord[];
  conversations?: ConversationRecord[];
  conversationTurns?: ConversationTurn[];
  managerSessions?: ManagerSessionRecord[];
  managerInboxEvents?: ManagerInboxEvent[];
}): ManagerMemorySnapshot {
  const tasks = input.store.listTasks();
  const workstreams = input.store.listWorkstreams();
  const assignments = input.store.listAssignments();
  const commitments = input.store.listCommitments();
  const workstreamSummaries = workstreams.map(buildWorkstreamSummary);
  const taskSummaries = tasks.map((task) =>
    buildTaskSummary(task, input.store.listProgressEvents(task.id))
  );
  const commitmentSummaries = commitments.map(buildCommitmentSummary);
  const workerSummaries = (input.workers ?? []).map((worker) =>
    buildWorkerSummary(worker, assignments)
  );
  const projectSummaries = (input.projects ?? []).map((project) =>
    buildProjectSummary(project, tasks)
  );

  return {
    workstreamSummaries,
    taskSummaries,
    commitmentSummaries,
    workerSummaries,
    projectSummaries,
    decisionRecords: input.decisionRecords ?? [],
    conversations: input.conversations ?? [],
    conversationTurns: input.conversationTurns ?? [],
    managerSessions: input.managerSessions ?? [],
    managerInboxEvents: input.managerInboxEvents ?? []
  };
}

export class InMemoryManagerMemory {
  constructor(
    private readonly store: InMemoryTaskStore,
    private readonly memoryStore: MemoryStore = new InMemoryMemoryStore()
  ) {}

  static fromSnapshots(input: {
    taskStore: InMemoryTaskStore;
    memorySnapshot: MemorySystemSnapshot;
  }): InMemoryManagerMemory {
    return new InMemoryManagerMemory(
      input.taskStore,
      InMemoryMemoryStore.fromSnapshot(input.memorySnapshot)
    );
  }

  static restore(input: {
    taskStore: InMemoryTaskStore;
    repository: MemorySnapshotRepository;
  }): InMemoryManagerMemory {
    const snapshot = input.repository.load();
    if (!snapshot) {
      return new InMemoryManagerMemory(input.taskStore);
    }

    return InMemoryManagerMemory.fromSnapshots({
      taskStore: input.taskStore,
      memorySnapshot: snapshot
    });
  }

  snapshot(): ManagerMemorySnapshot {
    return buildManagerMemorySnapshot({
      store: this.store,
      workers: this.memoryStore.listWorkers(),
      projects: this.memoryStore.listProjects(),
      decisionRecords: this.memoryStore.listDecisionRecords(),
      conversations: this.memoryStore.listConversations(),
      conversationTurns: this.memoryStore.listConversations().flatMap((conversation) =>
        this.memoryStore.listConversationTurns(conversation.id)
      ),
      managerSessions: this.memoryStore.listManagerSessions(),
      managerInboxEvents: this.memoryStore.listManagerInboxEvents()
    });
  }

  getConversation(conversationId: string): ConversationRecord | undefined {
    return this.memoryStore.listConversations().find((conversation) => conversation.id === conversationId);
  }

  listConversationTurns(conversationId: string): ConversationTurn[] {
    return this.memoryStore.listConversationTurns(conversationId);
  }

  searchTasks(query: { text?: string; status?: Task["status"]; workerId?: string }): TaskSummary[] {
    const normalizedText = query.text?.trim().toLowerCase();
    return this.snapshot().taskSummaries.filter((task) => {
      if (query.status && task.status !== query.status) {
        return false;
      }
      if (query.workerId && task.workerId !== query.workerId) {
        return false;
      }
      if (
        normalizedText &&
        !`${task.title} ${task.goal} ${task.summary}`.toLowerCase().includes(normalizedText)
      ) {
        return false;
      }
      return true;
    });
  }

  searchWorkstreams(query: {
    text?: string;
    status?: Workstream["status"];
    activeWorkerId?: string;
  }): WorkstreamSummary[] {
    const normalizedText = query.text?.trim().toLowerCase();
    return this.snapshot().workstreamSummaries.filter((workstream) => {
      if (query.status && workstream.status !== query.status) {
        return false;
      }
      if (query.activeWorkerId && workstream.activeWorkerId !== query.activeWorkerId) {
        return false;
      }
      if (
        normalizedText &&
        !`${workstream.title} ${workstream.goal} ${workstream.summary}`
          .toLowerCase()
          .includes(normalizedText)
      ) {
        return false;
      }
      return true;
    });
  }

  searchCommitments(query: MemoryStoreQuery): CommitmentSummary[] {
    const normalizedText = query.text?.trim().toLowerCase();

    return this.snapshot().commitmentSummaries.filter((commitment) => {
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
      if (normalizedText && !commitment.summary.toLowerCase().includes(normalizedText)) {
        return false;
      }
      return true;
    });
  }

  listOverdueCommitments(now: number): CommitmentSummary[] {
    return this.searchCommitments({}).filter(
      (commitment) =>
        commitment.status !== "fulfilled" &&
        commitment.status !== "cancelled" &&
        typeof commitment.dueAt === "number" &&
        commitment.dueAt < now
    );
  }

  listBlockedTasks(): TaskSummary[] {
    return this.snapshot().taskSummaries.filter((task) => task.status === "blocked");
  }

  listOwnerOpenCommitments(ownerId: string): CommitmentSummary[] {
    return this.searchCommitments({ ownerId }).filter(
      (commitment) => commitment.status === "open" || commitment.status === "overdue"
    );
  }

  exportMemorySnapshot(): MemorySystemSnapshot {
    return this.memoryStore.toSnapshot();
  }

  persist(repository: MemorySnapshotRepository): MemorySystemSnapshot {
    const snapshot = this.exportMemorySnapshot();
    repository.save(snapshot);
    return snapshot;
  }
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly projects = new Map<string, Project>();
  private readonly workers = new Map<string, WorkerProfile>();
  private readonly decisionRecords = new Map<string, DecisionRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly conversationTurns = new Map<string, ConversationTurn[]>();
  private readonly managerSessions = new Map<string, ManagerSessionRecord>();
  private readonly managerInboxEvents = new Map<string, ManagerInboxEvent>();
  private readonly createdAt: number;
  private updatedAt: number;

  constructor(now: number = Date.now()) {
    this.createdAt = now;
    this.updatedAt = now;
  }

  private touch(now: number) {
    this.updatedAt = now;
  }

  upsertProject(project: Project): Project {
    this.projects.set(project.id, project);
    this.touch(project.updatedAt);
    return project;
  }

  upsertWorker(worker: WorkerProfile): WorkerProfile {
    this.workers.set(worker.id, worker);
    this.touch(worker.updatedAt);
    return worker;
  }

  appendDecisionRecord(record: DecisionRecord): DecisionRecord {
    this.decisionRecords.set(record.id, record);
    this.touch(record.createdAt);
    return record;
  }

  upsertConversation(conversation: ConversationRecord): ConversationRecord {
    this.conversations.set(conversation.id, conversation);
    this.touch(conversation.updatedAt);
    return conversation;
  }

  appendConversationTurn(turn: ConversationTurn): ConversationTurn {
    const turns = this.conversationTurns.get(turn.conversationId) ?? [];
    this.conversationTurns.set(turn.conversationId, [...turns, turn]);
    this.touch(turn.createdAt);
    return turn;
  }

  upsertManagerSession(session: ManagerSessionRecord): ManagerSessionRecord {
    this.managerSessions.set(session.id, session);
    this.touch(session.updatedAt);
    return session;
  }

  appendManagerInboxEvent(event: ManagerInboxEvent): ManagerInboxEvent {
    this.managerInboxEvents.set(event.id, event);
    this.touch(event.processedAt ?? event.createdAt);
    return event;
  }

  listProjects(): Project[] {
    return [...this.projects.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  listWorkers(): WorkerProfile[] {
    return [...this.workers.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  listDecisionRecords(): DecisionRecord[] {
    return [...this.decisionRecords.values()].sort((left, right) => left.createdAt - right.createdAt);
  }

  listConversations(ownerId?: string): ConversationRecord[] {
    return [...this.conversations.values()]
      .filter((conversation) => (ownerId ? conversation.ownerId === ownerId : true))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  listConversationTurns(conversationId: string): ConversationTurn[] {
    return [...(this.conversationTurns.get(conversationId) ?? [])].sort(
      (left, right) => left.createdAt - right.createdAt
    );
  }

  listManagerSessions(ownerId?: string): ManagerSessionRecord[] {
    return [...this.managerSessions.values()]
      .filter((session) => (ownerId ? session.ownerId === ownerId : true))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  listManagerInboxEvents(sessionId?: string): ManagerInboxEvent[] {
    return [...this.managerInboxEvents.values()]
      .filter((event) => (sessionId ? event.sessionId === sessionId : true))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  toSnapshot(): MemorySystemSnapshot {
    return {
      schemaVersion: MEMORY_SYSTEM_SCHEMA_VERSION,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      data: {
        projects: this.listProjects().reverse(),
        workers: this.listWorkers().reverse(),
        decisionRecords: this.listDecisionRecords(),
        conversations: this.listConversations().reverse(),
        conversationTurns: this.listConversations()
          .flatMap((conversation) => this.listConversationTurns(conversation.id)),
        managerSessions: this.listManagerSessions().reverse(),
        managerInboxEvents: this.listManagerInboxEvents()
      }
    };
  }

  static fromSnapshot(snapshot: MemorySystemSnapshot): InMemoryMemoryStore {
    const repaired = repairMemorySnapshot(snapshot);
    const issues = validateMemorySnapshot(repaired);

    if (issues.length > 0) {
      throw new Error(issues.join("; "));
    }

    const store = new InMemoryMemoryStore(repaired.createdAt);
    store.updatedAt = repaired.updatedAt;

    for (const project of repaired.data.projects) {
      store.projects.set(project.id, project);
    }
    for (const worker of repaired.data.workers) {
      store.workers.set(worker.id, worker);
    }
    for (const decisionRecord of repaired.data.decisionRecords) {
      store.decisionRecords.set(decisionRecord.id, decisionRecord);
    }
    for (const conversation of repaired.data.conversations) {
      store.conversations.set(conversation.id, conversation);
    }
    for (const turn of repaired.data.conversationTurns) {
      const turns = store.conversationTurns.get(turn.conversationId) ?? [];
      store.conversationTurns.set(turn.conversationId, [...turns, turn]);
    }
    for (const session of repaired.data.managerSessions) {
      store.managerSessions.set(session.id, session);
    }
    for (const event of repaired.data.managerInboxEvents) {
      store.managerInboxEvents.set(event.id, event);
    }

    return store;
  }
}

export class InMemoryMemorySnapshotRepository implements MemorySnapshotRepository {
  private snapshot?: MemorySystemSnapshot;

  load(): MemorySystemSnapshot | undefined {
    return this.snapshot;
  }

  save(snapshot: MemorySystemSnapshot): void {
    this.snapshot = repairMemorySnapshot(snapshot);
  }
}
