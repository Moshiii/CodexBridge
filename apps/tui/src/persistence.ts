import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  InMemoryMemoryStore,
  type ConversationTurn,
  type MemorySnapshotRepository,
  type MemorySystemSnapshot
} from "@autoaide/memory-system";
import { InMemoryTaskStore, type TaskSnapshotRepository, type TaskSystemSnapshot } from "@autoaide/task-system";
import {
  InMemoryWorkerRegistry,
  type WorkerRegistrySnapshot,
  WORKER_ORCHESTRATOR_SCHEMA_VERSION
} from "@autoaide/worker-orchestrator";

export type AutoAideStatePaths = {
  rootDir: string;
  threadsDir: string;
  snapshotsDir: string;
  conversationFile: string;
  taskSnapshotFile: string;
  memorySnapshotFile: string;
  workerSnapshotFile: string;
};

export type PersistedThreadEvent = {
  schemaVersion: 1;
  kind: "conversation_turn";
  conversationId: string;
  ownerId: string;
  role: ConversationTurn["role"];
  text: string;
  createdAt: number;
};

export function resolveAutoAideStatePaths(conversationId: string): AutoAideStatePaths {
  const rootDir = process.env.AUTOAIDE_STATE_DIR?.trim() || path.join(homedir(), ".autoaide");
  return {
    rootDir,
    threadsDir: path.join(rootDir, "threads"),
    snapshotsDir: path.join(rootDir, "snapshots"),
    conversationFile: path.join(rootDir, "threads", `${conversationId}.jsonl`),
    taskSnapshotFile: path.join(rootDir, "snapshots", "task-system.json"),
    memorySnapshotFile: path.join(rootDir, "snapshots", "memory-system.json"),
    workerSnapshotFile: path.join(rootDir, "snapshots", "worker-registry.json")
  };
}

export function ensureAutoAideStatePaths(paths: AutoAideStatePaths): void {
  mkdirSync(paths.rootDir, { recursive: true });
  mkdirSync(paths.threadsDir, { recursive: true });
  mkdirSync(paths.snapshotsDir, { recursive: true });
}

class JsonFileTaskSnapshotRepository implements TaskSnapshotRepository {
  constructor(private readonly filepath: string) {}

  load(): TaskSystemSnapshot | undefined {
    if (!existsSync(this.filepath)) {
      return undefined;
    }
    return JSON.parse(readFileSync(this.filepath, "utf8")) as TaskSystemSnapshot;
  }

  save(snapshot: TaskSystemSnapshot): void {
    writeFileSync(this.filepath, JSON.stringify(snapshot, null, 2), "utf8");
  }
}

class JsonFileMemorySnapshotRepository implements MemorySnapshotRepository {
  constructor(private readonly filepath: string) {}

  load(): MemorySystemSnapshot | undefined {
    if (!existsSync(this.filepath)) {
      return undefined;
    }
    return JSON.parse(readFileSync(this.filepath, "utf8")) as MemorySystemSnapshot;
  }

  save(snapshot: MemorySystemSnapshot): void {
    writeFileSync(this.filepath, JSON.stringify(snapshot, null, 2), "utf8");
  }
}

export function restorePersistedRuntime(input: {
  now?: number;
  conversationId: string;
}): {
  paths: AutoAideStatePaths;
  store: InMemoryTaskStore;
  memoryStore: InMemoryMemoryStore;
  registry: InMemoryWorkerRegistry;
} {
  const paths = resolveAutoAideStatePaths(input.conversationId);
  ensureAutoAideStatePaths(paths);

  const store = InMemoryTaskStore.restore(new JsonFileTaskSnapshotRepository(paths.taskSnapshotFile));
  const memorySnapshotRepository = new JsonFileMemorySnapshotRepository(paths.memorySnapshotFile);
  const memorySnapshot = memorySnapshotRepository.load();
  const memoryStore = memorySnapshot
    ? InMemoryMemoryStore.fromSnapshot(memorySnapshot)
    : new InMemoryMemoryStore(input.now ?? Date.now());

  let registry = new InMemoryWorkerRegistry();
  if (existsSync(paths.workerSnapshotFile)) {
    const snapshot = JSON.parse(readFileSync(paths.workerSnapshotFile, "utf8")) as WorkerRegistrySnapshot;
    if (snapshot.schemaVersion === WORKER_ORCHESTRATOR_SCHEMA_VERSION) {
      registry = InMemoryWorkerRegistry.fromSnapshot(snapshot);
    }
  }

  return {
    paths,
    store,
    memoryStore,
    registry
  };
}

export function persistRuntimeState(input: {
  paths: AutoAideStatePaths;
  store: InMemoryTaskStore;
  memoryStore: InMemoryMemoryStore;
  registry: InMemoryWorkerRegistry;
}): void {
  ensureAutoAideStatePaths(input.paths);
  input.store.persist(new JsonFileTaskSnapshotRepository(input.paths.taskSnapshotFile));
  writeFileSync(input.paths.workerSnapshotFile, JSON.stringify(input.registry.toSnapshot(), null, 2), "utf8");
  writeFileSync(
    input.paths.memorySnapshotFile,
    JSON.stringify(input.memoryStore.toSnapshot(), null, 2),
    "utf8"
  );
}

export function appendConversationEvent(
  paths: AutoAideStatePaths,
  event: PersistedThreadEvent
): void {
  ensureAutoAideStatePaths(paths);
  appendFileSync(paths.conversationFile, `${JSON.stringify(event)}\n`, "utf8");
}

export function readConversationEvents(paths: AutoAideStatePaths): PersistedThreadEvent[] {
  if (!existsSync(paths.conversationFile)) {
    return [];
  }

  return readFileSync(paths.conversationFile, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PersistedThreadEvent);
}

export function listPersistedThreads(rootDir?: string): string[] {
  const baseDir = rootDir?.trim() || process.env.AUTOAIDE_STATE_DIR?.trim() || path.join(homedir(), ".autoaide");
  const threadsDir = path.join(baseDir, "threads");
  if (!existsSync(threadsDir)) {
    return [];
  }

  return readdirSync(threadsDir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => name.replace(/\.jsonl$/, ""))
    .sort();
}
