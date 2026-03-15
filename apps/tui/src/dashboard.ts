import { buildManagerOverview, runManagerSupervisionCycle } from "@autoaide/manager-runtime";
import { type InMemoryManagerMemory } from "@autoaide/memory-system";
import type { InMemoryTaskStore, Task } from "@autoaide/task-system";
import type { InMemoryWorkerRegistry } from "@autoaide/worker-orchestrator";

export type OperatorTaskView = {
  taskId: string;
  title: string;
  status: Task["status"];
  priority: Task["priority"];
  workerId: string;
  updatedAt: number;
};

export type OperatorWorkerView = {
  workerId: string;
  status: string;
  currentAssignmentId: string;
  updatedAt: number;
};

export type OperatorSnapshot = {
  generatedAt: number;
  overview: {
    totalTasks: number;
    blockedTasks: number;
    overdueCommitments: number;
    schedulableTasks: number;
    workerCount: number;
    busyWorkers: number;
    alertCount: number;
    reminderCount: number;
  };
  tasks: OperatorTaskView[];
  workers: OperatorWorkerView[];
  alerts: string[];
  reminders: string[];
};

export type RenderOperatorDashboardOptions = {
  rich?: boolean;
  width?: number;
};

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m"
} as const;

function paint(value: string, color: string, rich: boolean): string {
  return rich ? `${color}${value}${ANSI.reset}` : value;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function pad(value: string, width: number): string {
  const visible = stripAnsi(value);
  if (visible.length >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - visible.length)}`;
}

function formatRelativeAge(now: number, timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s`;
  }
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  return `${deltaHours}h`;
}

function sortTasks(left: Task, right: Task): number {
  const priorityRank: Record<Task["priority"], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  };
  const leftScore = priorityRank[left.priority];
  const rightScore = priorityRank[right.priority];
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  return right.updatedAt - left.updatedAt;
}

function renderSection(title: string, lines: string[], rich: boolean): string {
  const heading = paint(title, `${ANSI.bold}${ANSI.cyan}`, rich);
  return [heading, ...lines].join("\n");
}

function statusTone(status: string, rich: boolean): string {
  if (status === "blocked" || status === "failed" || status === "timed_out" || status === "error") {
    return paint(status, ANSI.red, rich);
  }
  if (status === "running" || status === "assigned" || status === "busy" || status === "reviewing") {
    return paint(status, ANSI.yellow, rich);
  }
  if (status === "done" || status === "succeeded" || status === "idle") {
    return paint(status, ANSI.green, rich);
  }
  return paint(status, ANSI.blue, rich);
}

export function buildOperatorSnapshot(input: {
  store: InMemoryTaskStore;
  registry: InMemoryWorkerRegistry;
  memory: InMemoryManagerMemory;
  now: number;
}): OperatorSnapshot {
  const overview = buildManagerOverview({
    store: input.store,
    memory: input.memory,
    now: input.now
  });
  const supervision = runManagerSupervisionCycle({
    store: input.store,
    memory: input.memory,
    now: input.now
  });
  const workers = input.registry.listWorkers();

  return {
    generatedAt: input.now,
    overview: {
      ...overview,
      workerCount: workers.length,
      busyWorkers: workers.filter((worker) => worker.status === "busy").length,
      alertCount: supervision.alerts.length,
      reminderCount: supervision.reminders.length
    },
    tasks: input.store
      .listTasks()
      .sort(sortTasks)
      .slice(0, 8)
      .map((task) => ({
        taskId: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        workerId: task.workerId ?? "-",
        updatedAt: task.updatedAt
      })),
    workers: workers.slice(0, 8).map((worker) => ({
      workerId: worker.id,
      status: worker.status,
      currentAssignmentId: worker.currentAssignmentId ?? "-",
      updatedAt: worker.updatedAt
    })),
    alerts: supervision.alerts.map((alert) => alert.summary),
    reminders: supervision.reminders.map((reminder) => reminder.summary)
  };
}

export function renderOperatorDashboard(
  snapshot: OperatorSnapshot,
  options: RenderOperatorDashboardOptions = {}
): string {
  const rich = options.rich ?? Boolean(process.stdout.isTTY);
  const width = Math.max(80, options.width ?? process.stdout.columns ?? 100);
  const summaryLine = [
    `tasks ${snapshot.overview.totalTasks}`,
    `blocked ${snapshot.overview.blockedTasks}`,
    `overdue ${snapshot.overview.overdueCommitments}`,
    `ready ${snapshot.overview.schedulableTasks}`,
    `workers ${snapshot.overview.workerCount}`,
    `busy ${snapshot.overview.busyWorkers}`,
    `alerts ${snapshot.overview.alertCount}`,
    `reminders ${snapshot.overview.reminderCount}`
  ].join("  ");

  const taskLines = [
    `${pad("task", 18)} ${pad("status", 12)} ${pad("prio", 8)} ${pad("worker", 16)} age`,
    ...snapshot.tasks.map((task) =>
      [
        pad(task.title, 18),
        pad(statusTone(task.status, rich), 12),
        pad(task.priority, 8),
        pad(task.workerId, 16),
        formatRelativeAge(snapshot.generatedAt, task.updatedAt)
      ].join(" ")
    )
  ];

  const workerLines = [
    `${pad("worker", 18)} ${pad("status", 12)} ${pad("assignment", 20)} age`,
    ...snapshot.workers.map((worker) =>
      [
        pad(worker.workerId, 18),
        pad(statusTone(worker.status, rich), 12),
        pad(worker.currentAssignmentId, 20),
        formatRelativeAge(snapshot.generatedAt, worker.updatedAt)
      ].join(" ")
    )
  ];

  const alertLines = snapshot.alerts.length > 0 ? snapshot.alerts.map((alert) => `- ${alert}`) : ["- none"];
  const reminderLines =
    snapshot.reminders.length > 0 ? snapshot.reminders.map((reminder) => `- ${reminder}`) : ["- none"];

  return [
    paint("AutoAide Terminal Console", `${ANSI.bold}${ANSI.magenta}`, rich),
    paint("manager-first local operator view", ANSI.dim, rich),
    "=".repeat(width),
    renderSection("Overview", [summaryLine], rich),
    "",
    renderSection("Tasks", taskLines, rich),
    "",
    renderSection("Workers", workerLines, rich),
    "",
    renderSection("Alerts", alertLines, rich),
    "",
    renderSection("Reminders", reminderLines, rich)
  ].join("\n");
}
