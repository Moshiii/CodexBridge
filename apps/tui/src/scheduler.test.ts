import { afterEach, describe, expect, it, vi } from "vitest";
import { startPeriodicScheduler } from "./scheduler.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduler", () => {
  it("runs periodically until stopped", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const handle = startPeriodicScheduler({
      intervalMs: 1000,
      run() {
        calls += 1;
      }
    });

    await vi.advanceTimersByTimeAsync(3100);
    handle.stop();

    expect(calls).toBe(3);
  });

  it("does not overlap while a previous run is still in flight", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let resolveRun: (() => void) | undefined;
    const handle = startPeriodicScheduler({
      intervalMs: 1000,
      run() {
        calls += 1;
        return new Promise<void>((resolve) => {
          resolveRun = resolve;
        });
      }
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(1);

    resolveRun?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    handle.stop();

    expect(calls).toBe(2);
  });
});
