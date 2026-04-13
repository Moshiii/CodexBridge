import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("new users get a default credit account per bot", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    const result = await credits.getUserCredits("user-1");

    assert.equal(result.ok, true);
    assert.equal(result.account.userId, "user-1");
    assert.equal(result.account.balance, credits.DEFAULT_INITIAL_CREDITS);
    assert.equal(result.account.totalConsumed, 0);
  });
});

test("chargeTurnCredits deducts one credit by default", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    const charge = await credits.chargeTurnCredits({ userId: "user-1" });

    assert.equal(charge.ok, true);
    assert.equal(charge.balanceBefore, credits.DEFAULT_INITIAL_CREDITS);
    assert.equal(charge.balanceAfter, credits.DEFAULT_INITIAL_CREDITS - credits.DEFAULT_TURN_COST);
    assert.equal(charge.account.totalConsumed, credits.DEFAULT_TURN_COST);
  });
});

test("chargeTurnCredits blocks turns once balance is exhausted", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    for (let index = 0; index < credits.DEFAULT_INITIAL_CREDITS; index += 1) {
      const charge = await credits.chargeTurnCredits({ userId: "user-1" });
      assert.equal(charge.ok, true);
    }

    const denied = await credits.chargeTurnCredits({ userId: "user-1" });

    assert.equal(denied.ok, false);
    assert.equal(denied.balanceBefore, 0);
    assert.equal(denied.balanceAfter, 0);
    assert.match(
      credits.renderInsufficientCreditsMessage(denied, { userId: "user-1" }),
      /No credits left for user user-1 on this bot/,
    );
  });
});

test("credit accounts are isolated per bot", async () => {
  await withTempHome(async (tempHome) => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await credits.chargeTurnCredits({ userId: "user-1", botHome: `${tempHome}/bots/alpha` });
    const alpha = await credits.getUserCredits("user-1", `${tempHome}/bots/alpha`);
    const beta = await credits.getUserCredits("user-1", `${tempHome}/bots/beta`);

    assert.equal(alpha.account.balance, credits.DEFAULT_INITIAL_CREDITS - credits.DEFAULT_TURN_COST);
    assert.equal(beta.account.balance, credits.DEFAULT_INITIAL_CREDITS);
  });
});

test("getUserCredits returns the current remaining balance after charges", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await credits.chargeTurnCredits({ userId: "user-1" });
    await credits.chargeTurnCredits({ userId: "user-1" });
    const current = await credits.getUserCredits("user-1");

    assert.equal(current.account.balance, credits.DEFAULT_INITIAL_CREDITS - (credits.DEFAULT_TURN_COST * 2));
    assert.equal(current.account.totalConsumed, credits.DEFAULT_TURN_COST * 2);
  });
});
