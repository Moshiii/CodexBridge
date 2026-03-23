export type PeriodicSchedulerHandle = {
  stop(): void;
};

export function startPeriodicScheduler(input: {
  intervalMs: number;
  run: () => Promise<void> | void;
}): PeriodicSchedulerHandle {
  let disposed = false;
  let inFlight = false;

  const timer = setInterval(() => {
    if (disposed || inFlight) {
      return;
    }
    inFlight = true;
    Promise.resolve(input.run()).finally(() => {
      inFlight = false;
    });
  }, input.intervalMs);

  return {
    stop() {
      disposed = true;
      clearInterval(timer);
    }
  };
}
