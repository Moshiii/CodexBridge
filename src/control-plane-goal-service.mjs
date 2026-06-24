import { withBotHomeEnv } from "./bot-home-env.mjs";
import { buildCommandConfig } from "./codex-runner.mjs";
import { readCliState, readConfig, getWorkspacePath } from "./config.mjs";
import { UserInputError } from "./errors.mjs";
import { launchGoal } from "./goal-controller.mjs";
import { createGoalRecord, listGoals, writeGoal } from "./goals-state.mjs";

export async function listControlPlaneGoals(botHome, options = {}) {
  return await withBotHomeEnv(botHome, async () => await listGoals({ limit: options.limit || 40 }));
}

export async function startControlPlaneGoal(
  botHome,
  botId,
  { objective, sessionLabel = null } = {},
  { activeGoalRuns = new Map(), launchGoalFn = launchGoal } = {},
) {
  const nextObjective = String(objective || "").trim();
  if (!nextObjective) {
    throw new UserInputError("Goal objective is required.", { code: "goal_objective_required" });
  }
  const sessions = await readCliState(botHome);
  const label = sessionLabel || sessions.activeSessionLabel || "main";
  const goal = createGoalRecord({
    objective: nextObjective,
    chatId: botId,
    sessionLabel: label,
    channel: "web",
  });
  goal.conversationSessionRef = sessions.sessions?.[label]?.cliSessionRef || null;
  await withBotHomeEnv(botHome, async () => await writeGoal(goal));

  const config = await readConfig(botHome);
  const commandConfig = {
    ...buildCommandConfig(config),
    cwd: getWorkspacePath(botHome),
  };
  await launchGoalFn(goal, {
    runningGoals: activeGoalRuns,
    commandConfig,
    registration: {
      chatId: botId,
      sessionLabel: goal.sessionLabel,
    },
    persistGoal: async (nextGoal) => await withBotHomeEnv(botHome, async () => await writeGoal(nextGoal)),
    notify: async () => {},
    onGoalStarted: (_startedGoal, entry) => {
      activeGoalRuns.set(goal.id, { ...entry, botId, sessionLabel: goal.sessionLabel });
    },
    onGoalFinished: async ({ goal: finalGoal }) => {
      await withBotHomeEnv(botHome, async () => await writeGoal(finalGoal));
    },
    onGoalFailed: async ({ goal: failedGoal, error }) => {
      await withBotHomeEnv(botHome, async () => {
        const nextGoal = {
          ...failedGoal,
          status: "failed",
          phase: "runner_failed",
          error: error.message,
        };
        await writeGoal(nextGoal);
      });
    },
  });
  return goal;
}
