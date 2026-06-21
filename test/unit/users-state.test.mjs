import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("upsertUser creates a free user with channel-scoped id", async () => {
  await withTempHome(async () => {
    const users = await importFresh("../../src/users-state.mjs");

    const user = await users.upsertUser({
      channel: "telegram",
      externalUserId: "123",
      displayName: "@demo",
    });

    assert.equal(user.id, "telegram:123");
    assert.equal(user.channel, "telegram");
    assert.equal(user.externalUserId, "123");
    assert.equal(user.displayName, "@demo");
    assert.equal(user.status, "free");
    assert.equal(user.privateEnabled, false);
    assert.equal(users.canUseGroupChat(user), true);
    assert.equal(users.canUsePrivateChat(user), false);
  });
});

test("paid and admin users can use private chat", async () => {
  await withTempHome(async () => {
    const users = await importFresh("../../src/users-state.mjs");

    const paid = await users.upsertUser({
      channel: "telegram",
      externalUserId: "paid",
      status: "paid",
    });
    const admin = await users.upsertUser({
      channel: "telegram",
      externalUserId: "admin",
      status: "admin",
    });

    assert.equal(users.canUsePrivateChat(paid), true);
    assert.equal(users.canUsePrivateChat(admin), true);
  });
});

test("banned users are denied everywhere", async () => {
  await withTempHome(async () => {
    const users = await importFresh("../../src/users-state.mjs");

    const user = await users.upsertUser({
      channel: "feishu",
      externalUserId: "ou_1",
      status: "banned",
      privateEnabled: true,
    });

    assert.equal(users.canUseGroupChat(user), false);
    assert.equal(users.canUsePrivateChat(user), false);
  });
});

test("setPrivateEnabled unlocks private chat without changing status", async () => {
  await withTempHome(async () => {
    const users = await importFresh("../../src/users-state.mjs");

    const user = await users.upsertUser({
      channel: "telegram",
      externalUserId: "123",
    });
    assert.equal(users.canUsePrivateChat(user), false);

    const unlocked = await users.setPrivateEnabled(user.id, true);

    assert.equal(unlocked.status, "free");
    assert.equal(unlocked.privateEnabled, true);
    assert.equal(users.canUsePrivateChat(unlocked), true);
  });
});
