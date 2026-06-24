import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("requestGoalStop marks a running goal stopped without an active child", async () => {
  const { requestGoalStop } = await importFresh("../../src/goal-controller.mjs");
  const runningGoal = {
    controller: {
      stopRequested: false,
      activeChild: null,
    },
  };

  assert.equal(requestGoalStop(runningGoal), true);
  assert.equal(runningGoal.controller.stopRequested, true);
});

test("requestGoalStop sends SIGTERM to an active child", async () => {
  const { requestGoalStop } = await importFresh("../../src/goal-controller.mjs");
  const signals = [];
  const runningGoal = {
    controller: {
      stopRequested: false,
      activeChild: {
        exitCode: null,
        killed: false,
        kill(signal) {
          signals.push(signal);
          return true;
        },
      },
    },
  };

  assert.equal(requestGoalStop(runningGoal), true);
  assert.equal(runningGoal.controller.stopRequested, true);
  assert.deepEqual(signals, ["SIGTERM"]);
});
