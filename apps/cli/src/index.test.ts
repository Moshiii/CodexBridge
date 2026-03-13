import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tuiModule from "@autoaide/tui";
import { runCli } from "./index.js";

describe("autoaide cli", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
