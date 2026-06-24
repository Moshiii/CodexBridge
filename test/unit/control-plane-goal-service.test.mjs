import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { importFresh, withTempHome } from "../helpers/module.js";

test("control plane goal service creates a web goal and launches with command config", async () => {
  await withTempHome(async (botHome) => {
    const config = await importFresh("../../src/config.mjs");
    const service = await importFresh("../../src/control-plane-goal-service.mjs");
    const runningGoals = new Map();
    let launchArgs = null;

    const cliState = await config.readCliState(botHome);
    cliState.activeSessionLabel = "main";
    cliState.sessions.main.cliSessionRef = "session-main";
    await config.writeCliState(cliState, botHome);

    const goal = await service.startControlPlaneGoal(
      botHome,
      "bot-a",
      { objective: "Ship a demo", sessionLabel: null },
      {
        activeGoalRuns: runningGoals,
        launchGoalFn: async (createdGoal, options) => {
          launchArgs = { createdGoal, options };
          options.onGoalStarted(createdGoal, {
            controller: { stopRequested: false },
            activeChild: null,
          });
        },
      },
    );
    const listed = await service.listControlPlaneGoals(botHome);

    assert.equal(goal.objective, "Ship a demo");
    assert.equal(goal.channel, "web");
    assert.equal(goal.chatId, "bot-a");
    assert.equal(goal.sessionLabel, "main");
    assert.equal(goal.conversationSessionRef, "session-main");
    assert.equal(launchArgs.options.registration.chatId, "bot-a");
    assert.equal(launchArgs.options.registration.sessionLabel, "main");
    assert.equal(launchArgs.options.commandConfig.cwd, path.join(botHome, "workspace"));
    assert.equal(runningGoals.get(goal.id).botId, "bot-a");
    assert.deepEqual(listed.map((item) => item.id), [goal.id]);
  });
});

test("control plane goal service validates objective and persists failed launches", async () => {
  await withTempHome(async (botHome) => {
    const service = await importFresh("../../src/control-plane-goal-service.mjs");

    await assert.rejects(
      () => service.startControlPlaneGoal(botHome, "bot-a", { objective: "" }, {
        launchGoalFn: async () => {},
      }),
      /Goal objective is required/,
    );

    const goal = await service.startControlPlaneGoal(botHome, "bot-a", { objective: "Fail gracefully" }, {
      launchGoalFn: async (createdGoal, options) => {
        await options.onGoalFailed({
          goal: createdGoal,
          error: new Error("runner failed"),
        });
      },
    });
    const [persisted] = await service.listControlPlaneGoals(botHome);

    assert.equal(persisted.id, goal.id);
    assert.equal(persisted.status, "failed");
    assert.equal(persisted.phase, "runner_failed");
    assert.equal(persisted.error, "runner failed");
  });
});
