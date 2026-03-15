import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tuiModule from "@autoaide/tui";
import { runCli, setSpawnProcessForTest } from "./index.js";

describe("autoaide cli", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setSpawnProcessForTest((() => {
      throw new Error("spawnProcess test double was not configured");
    }) as never);
  });

  it("renders top-level help", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runCli([])).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("AutoAide CLI"));
    log.mockRestore();
  });

  it("renders the status dashboard", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runCli(["status"])).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("AutoAide Terminal Console"));
    log.mockRestore();
  });

  it("runs the doctor command through the cli path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(tuiModule, "runCodexConnectivityCheck").mockResolvedValue({
      dashboard: "manager  tasks 2  workers 2",
      receipts: []
    });

    await expect(runCli(["doctor"])).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("workers 2"));
    log.mockRestore();
  });

  it("streams exec events through the exec command", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(tuiModule, "runManagerExec").mockImplementation(async ({ onEvent }) => {
      await onEvent?.({ type: "thread.started", threadId: "thread-1" });
      await onEvent?.({ type: "turn.started", text: "Explain this codebase" });
      await onEvent?.({
        type: "item.started",
        item: { id: "reasoning-1", type: "reasoning", text: "Working...", status: "in_progress" }
      });
      await onEvent?.({
        type: "item.completed",
        item: { id: "assistant-1", type: "assistant_message", text: "Done.", status: "completed" }
      });
      await onEvent?.({ type: "turn.completed", threadId: "thread-1", text: "Done." });
      return { threadId: "thread-1", finalText: "Done." };
    });

    await expect(runCli(["exec", "Explain this codebase"])).resolves.toBe(0);

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Working..."));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Done."));
    writeSpy.mockRestore();
  });

  it("prints mounted kernels for models", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runCli(["models"])).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("codex"));
    log.mockRestore();
  });

  it("launches the Rust TUI for the tui command", async () => {
    const spawnMock = vi.fn().mockReturnValue({
      on(event: string, listener: (...args: unknown[]) => void) {
        if (event === "exit") {
          queueMicrotask(() => listener(0, null));
        }
        return this as never;
      }
    });
    setSpawnProcessForTest(spawnMock as never);

    await expect(runCli(["tui"])).resolves.toBe(0);

    expect(spawnMock).toHaveBeenCalledWith(
      "cargo",
      expect.arrayContaining(["run", "--quiet"]),
      expect.objectContaining({ stdio: "inherit" })
    );
  });
});
