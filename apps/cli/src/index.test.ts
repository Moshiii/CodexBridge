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

  it("runs the codex connectivity check through the cli path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(tuiModule, "runCodexConnectivityCheck").mockResolvedValue({
      dashboard: "manager  tasks 2  workers 2",
      receipts: []
    });

    await expect(runCli(["codex", "check"])).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("workers 2"));
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
