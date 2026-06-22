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
    assert.equal(result.account.paidCredits, credits.DEFAULT_INITIAL_CREDITS);
    assert.equal(result.account.dailyFreeUsed, 0);
    assert.equal(result.account.dailyFreeLimit, credits.DEFAULT_DAILY_FREE_LIMIT);
    assert.equal(result.account.totalConsumed, 0);
  });
});

test("chargeTurnCredits deducts one credit by default", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await credits.grantPaidCredits({ userId: "user-1", amount: 3 });
    const charge = await credits.chargeTurnCredits({ userId: "user-1" });

    assert.equal(charge.ok, true);
    assert.equal(charge.balanceBefore, 3);
    assert.equal(charge.balanceAfter, 3 - credits.DEFAULT_TURN_COST);
    assert.equal(charge.account.totalConsumed, credits.DEFAULT_TURN_COST);
  });
});

test("chargeUsage uses daily free quota first in group chats", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    const charge = await credits.chargeUsage({ userId: "user-1", chatType: "group" });
    const current = await credits.getUserCredits("user-1");

    assert.equal(charge.ok, true);
    assert.equal(charge.costSource, "daily_free");
    assert.equal(charge.dailyFreeCharged, 1);
    assert.equal(charge.paidCreditsCharged, 0);
    assert.equal(current.account.dailyFreeUsed, 1);
    assert.equal(current.account.paidCredits, credits.DEFAULT_INITIAL_CREDITS);
  });
});

test("chargeUsage falls back to paid credits after group daily free quota is exhausted", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await credits.grantPaidCredits({ userId: "user-1", amount: 3 });
    for (let index = 0; index < credits.DEFAULT_DAILY_FREE_LIMIT; index += 1) {
      const charge = await credits.chargeUsage({ userId: "user-1", chatType: "group" });
      assert.equal(charge.costSource, "daily_free");
    }
    const paidCharge = await credits.chargeUsage({ userId: "user-1", chatType: "group" });

    assert.equal(paidCharge.ok, true);
    assert.equal(paidCharge.costSource, "paid_credit");
    assert.equal(paidCharge.balanceBefore, 3);
    assert.equal(paidCharge.balanceAfter, 2);
  });
});

test("chargeUsage denies group usage after daily free quota when no paid credits exist", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    for (let index = 0; index < credits.DEFAULT_DAILY_FREE_LIMIT; index += 1) {
      const charge = await credits.chargeUsage({ userId: "user-1", chatType: "group" });
      assert.equal(charge.ok, true);
      assert.equal(charge.costSource, "daily_free");
    }
    const denied = await credits.chargeUsage({ userId: "user-1", chatType: "group" });

    assert.equal(denied.ok, false);
    assert.equal(denied.costSource, "insufficient");
    assert.equal(denied.account.paidCredits, 0);
  });
});

test("chargeUsage resets daily free quota on a new day", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await credits.chargeUsage({
      userId: "user-1",
      chatType: "group",
      now: new Date("2026-06-21T00:00:00.000Z"),
    });
    const nextDay = await credits.chargeUsage({
      userId: "user-1",
      chatType: "group",
      now: new Date("2026-06-22T00:00:00.000Z"),
    });

    assert.equal(nextDay.ok, true);
    assert.equal(nextDay.costSource, "daily_free");
    assert.equal(nextDay.dailyFreeBefore, 0);
    assert.equal(nextDay.dailyFreeAfter, 1);
  });
});

test("private chat usage only charges paid credits", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await credits.grantPaidCredits({ userId: "user-1", amount: 2 });
    const charge = await credits.chargeUsage({ userId: "user-1", chatType: "direct" });
    const current = await credits.getUserCredits("user-1");

    assert.equal(charge.ok, true);
    assert.equal(charge.costSource, "paid_credit");
    assert.equal(current.account.dailyFreeUsed, 0);
    assert.equal(current.account.paidCredits, 1);
  });
});

test("grantPaidCredits increases paid credit balance", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    const grant = await credits.grantPaidCredits({ userId: "user-1", amount: 10 });

    assert.equal(grant.ok, true);
    assert.equal(grant.granted, 10);
    assert.equal(grant.balanceAfter, 10);
  });
});

test("adjustPaidCredits supports manual credit increases and decreases", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    const increase = await credits.adjustPaidCredits({ userId: "user-1", amount: 5 });
    const decrease = await credits.adjustPaidCredits({ userId: "user-1", amount: -3 });

    assert.equal(increase.ok, true);
    assert.equal(increase.balanceAfter, 5);
    assert.equal(decrease.ok, true);
    assert.equal(decrease.adjusted, -3);
    assert.equal(decrease.balanceAfter, 2);
  });
});

test("adjustPaidCredits rejects negative resulting balances", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await assert.rejects(
      () => credits.adjustPaidCredits({ userId: "user-1", amount: -1 }),
      /negative/,
    );
  });
});

test("chargeTurnCredits blocks turns once balance is exhausted", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    const denied = await credits.chargeTurnCredits({ userId: "user-1" });

    assert.equal(denied.ok, false);
    assert.equal(denied.balanceBefore, 0);
    assert.equal(denied.balanceAfter, 0);
    assert.match(
      credits.renderInsufficientCreditsMessage(denied, { userId: "user-1" }),
      /wait for the next daily free reset in group chat/,
    );
  });
});

test("credit accounts are isolated per bot", async () => {
  await withTempHome(async (tempHome) => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await credits.grantPaidCredits({ userId: "user-1", amount: 2, botHome: `${tempHome}/bots/alpha` });
    await credits.chargeTurnCredits({ userId: "user-1", botHome: `${tempHome}/bots/alpha` });
    const alpha = await credits.getUserCredits("user-1", `${tempHome}/bots/alpha`);
    const beta = await credits.getUserCredits("user-1", `${tempHome}/bots/beta`);

    assert.equal(alpha.account.balance, 1);
    assert.equal(beta.account.balance, credits.DEFAULT_INITIAL_CREDITS);
  });
});

test("getUserCredits returns the current remaining balance after charges", async () => {
  await withTempHome(async () => {
    const credits = await importFresh("../../src/user-credits.mjs");

    await credits.grantPaidCredits({ userId: "user-1", amount: 3 });
    await credits.chargeTurnCredits({ userId: "user-1" });
    await credits.chargeTurnCredits({ userId: "user-1" });
    const current = await credits.getUserCredits("user-1");

    assert.equal(current.account.balance, 3 - (credits.DEFAULT_TURN_COST * 2));
    assert.equal(current.account.totalConsumed, credits.DEFAULT_TURN_COST * 2);
  });
});
