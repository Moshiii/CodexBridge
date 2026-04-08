import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("goal and schedule are allowed in direct chats", async () => {
  const { canUseGoal, canUseSchedule } = await importFresh("../../src/capability-policy.mjs");
  const directEnvelope = {
    chatType: "direct",
    isDirect: true,
    userId: "u1",
  };

  assert.equal(canUseGoal(directEnvelope, {}), true);
  assert.equal(canUseSchedule(directEnvelope, {}), true);
});

test("goal and schedule are denied in group chats for non-owner users", async () => {
  const { canUseGoal, canUseSchedule } = await importFresh("../../src/capability-policy.mjs");
  const groupEnvelope = {
    chatType: "group",
    isGroup: true,
    userId: "u2",
  };
  const config = {
    ownerUserId: "owner-1",
    adminUserIds: ["admin-1"],
  };

  assert.equal(canUseGoal(groupEnvelope, config), false);
  assert.equal(canUseSchedule(groupEnvelope, config), false);
});

test("goal and schedule are allowed in group chats for owner and admins", async () => {
  const { canUseGoal, canUseSchedule, canStopTask } = await importFresh("../../src/capability-policy.mjs");
  const ownerEnvelope = {
    chatType: "group",
    isGroup: true,
    userId: "owner-1",
  };
  const adminEnvelope = {
    chatType: "group",
    isGroup: true,
    userId: "admin-1",
  };
  const config = {
    ownerUserId: "owner-1",
    adminUserIds: ["admin-1"],
  };

  assert.equal(canUseGoal(ownerEnvelope, config), true);
  assert.equal(canUseSchedule(ownerEnvelope, config), true);
  assert.equal(canUseGoal(adminEnvelope, config), true);
  assert.equal(canUseSchedule(adminEnvelope, config), true);
  assert.equal(canStopTask(ownerEnvelope, { ownerUserId: "someone-else" }, config), true);
  assert.equal(canStopTask(adminEnvelope, { ownerUserId: "someone-else" }, config), true);
});
