import { startGoalRun } from "./goal-runner.mjs";
import { writeGoal } from "./goals-state.mjs";

function ensureGoalCollections(map) {
  return map instanceof Map ? map : new Map();
}

export function findRunningGoal(runningGoals, goalId) {
  return ensureGoalCollections(runningGoals).get(goalId) || null;
}

export function findRunningGoalForChat(runningGoals, chatId) {
  for (const runningGoal of ensureGoalCollections(runningGoals).values()) {
    if (String(runningGoal.chatId) === String(chatId)) {
      return runningGoal;
    }
  }
  return null;
}

export function requestGoalStop(runningGoal) {
  if (!runningGoal) {
    return false;
  }

  runningGoal.controller.stopRequested = true;
  const child = runningGoal.controller.activeChild;
  if (!child || child.exitCode != null || child.killed) {
    return true;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    return false;
  }

  setTimeout(() => {
    if (child.exitCode == null && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore hard-kill failures
      }
    }
  }, 3000).unref?.();

  return true;
}

export async function launchGoal(goal, options) {
  const {
    runningGoals,
    commandConfig,
    persistGoal = async (nextGoal) => await writeGoal(nextGoal),
    notify = async () => {},
    onGoalStarted,
    onGoalFinished,
    onGoalFailed,
    registration,
  } = options;

  const goalRuns = ensureGoalCollections(runningGoals);
  const started = startGoalRun(goal, {
    commandConfig,
    persistGoal,
    notify,
    onGoalStarted: (startedGoal, controller) => {
      const entry = {
        goalId: startedGoal.id,
        chatId: registration?.chatId ?? startedGoal.chatId,
        sessionLabel: registration?.sessionLabel ?? startedGoal.sessionLabel,
        controller,
      };
      goalRuns.set(startedGoal.id, entry);
      onGoalStarted?.(startedGoal, entry);
    },
  });

  void started.result
    .then(async ({ goal: finalGoal, userMessage, status }) => {
      goalRuns.delete(goal.id);
      await onGoalFinished?.({ goal: finalGoal, userMessage, status });
    })
    .catch(async (error) => {
      goalRuns.delete(goal.id);
      await onGoalFailed?.({ goal, error });
    });

  return started;
}
