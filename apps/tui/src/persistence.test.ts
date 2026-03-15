import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryMemoryStore } from "@autoaide/memory-system";
import { createTask, InMemoryTaskStore } from "@autoaide/task-system";
import { InMemoryWorkerRegistry, spawnWorker } from "@autoaide/worker-orchestrator";
import {
  appendConversationEvent,
  listPersistedThreads,
  persistRuntimeState,
  readConversationEvents,
  resolveAutoAideStatePaths,
  restorePersistedRuntime
} from "./persistence.js";

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

describe("tui persistence", () => {
  it("stores conversation events under ~/.autoaide-style state dir", () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "autoaide-state-"));
    tempStateDirs.push(stateDir);
    process.env.AUTOAIDE_STATE_DIR = stateDir;

    const paths = resolveAutoAideStatePaths("terminal-owner-local");
    appendConversationEvent(paths, {
      schemaVersion: 1,
      kind: "conversation_turn",
      conversationId: "terminal-owner-local",
      ownerId: "owner-local",
      role: "owner",
      text: "Please outline the next development plan",
      createdAt: 123
    });

    const events = readConversationEvents(paths);
    expect(paths.rootDir).toBe(stateDir);
    expect(paths.conversationFile).toBe(path.join(stateDir, "threads", "terminal-owner-local.jsonl"));
    expect(events).toHaveLength(1);
    expect(events[0]?.text).toBe("Please outline the next development plan");
    expect(readFileSync(paths.conversationFile, "utf8")).toContain("\"kind\":\"conversation_turn\"");
  });

  it("persists and restores task, memory, and worker snapshots", () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "autoaide-state-"));
    tempStateDirs.push(stateDir);
    process.env.AUTOAIDE_STATE_DIR = stateDir;

    const now = 456;
    const paths = resolveAutoAideStatePaths("terminal-owner-local");
    const store = new InMemoryTaskStore(now);
    const memoryStore = new InMemoryMemoryStore(now);
    const registry = new InMemoryWorkerRegistry();

    store.upsertTask(
      createTask({
        id: "task-1",
        ownerId: "owner-local",
        title: "Refresh development plan",
        goal: "Produce a new planning draft",
        now
      })
    );
    memoryStore.upsertConversation({
      id: "terminal-owner-local",
      ownerId: "owner-local",
      channel: "tui",
      peerId: "local-terminal",
      rollingSummary: "owner asked for a new plan",
      createdAt: now,
      updatedAt: now
    });
    memoryStore.appendConversationTurn({
      id: "turn-1",
      conversationId: "terminal-owner-local",
      ownerId: "owner-local",
      role: "owner",
      text: "Please refresh the development plan",
      createdAt: now
    });
    spawnWorker(registry, {
      workerId: "worker-1",
      now
    });

    persistRuntimeState({
      paths,
      store,
      memoryStore,
      registry
    });

    const restored = restorePersistedRuntime({
      now,
      conversationId: "terminal-owner-local"
    });

    expect(restored.store.listTasks()).toHaveLength(1);
    expect(restored.memoryStore.listConversations("owner-local")).toHaveLength(1);
    expect(restored.memoryStore.listConversationTurns("terminal-owner-local")).toHaveLength(1);
    expect(restored.registry.listWorkers()).toHaveLength(1);
  });

  it("lists persisted thread ids from the threads directory", () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "autoaide-state-"));
    tempStateDirs.push(stateDir);
    process.env.AUTOAIDE_STATE_DIR = stateDir;

    appendConversationEvent(resolveAutoAideStatePaths("terminal-owner-local"), {
      schemaVersion: 1,
      kind: "conversation_turn",
      conversationId: "terminal-owner-local",
      ownerId: "owner-local",
      role: "owner",
      text: "first thread",
      createdAt: 1
    });
    appendConversationEvent(resolveAutoAideStatePaths("thread-2"), {
      schemaVersion: 1,
      kind: "conversation_turn",
      conversationId: "thread-2",
      ownerId: "owner-local",
      role: "owner",
      text: "second thread",
      createdAt: 2
    });

    expect(listPersistedThreads()).toEqual(["terminal-owner-local", "thread-2"]);
  });
});
