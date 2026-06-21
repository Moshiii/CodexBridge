import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("feishu bridge helpers can be imported without starting the bridge", async () => {
  await withTempHome(async () => {
    const bridge = await importFresh("../../plugins/feishu-codex/feishu-codex-bridge.mjs");

    assert.equal(typeof bridge.canFeishuUserAccessChat, "function");
    assert.equal(typeof bridge.renderCreditsStatus, "function");
  });
});

test("canFeishuUserAccessChat gates private chat behind paid access", async () => {
  await withTempHome(async () => {
    const { canFeishuUserAccessChat } = await importFresh("../../plugins/feishu-codex/feishu-codex-bridge.mjs");
    const freeUser = {
      status: "free",
      privateEnabled: false,
    };
    const unlockedUser = {
      status: "free",
      privateEnabled: true,
    };

    assert.equal(canFeishuUserAccessChat(freeUser, { chatType: "group" }), true);
    assert.equal(canFeishuUserAccessChat(freeUser, { chatType: "direct" }), false);
    assert.equal(canFeishuUserAccessChat(unlockedUser, { chatType: "direct" }), true);
    assert.equal(canFeishuUserAccessChat({ status: "banned" }, { chatType: "group" }), false);
  });
});

test("renderCreditsStatus includes daily free and paid credit fields", async () => {
  await withTempHome(async () => {
    const { renderCreditsStatus } = await importFresh("../../plugins/feishu-codex/feishu-codex-bridge.mjs");

    const text = renderCreditsStatus(
      {
        account: {
          userId: "feishu:ou_1",
          paidCredits: 7,
          dailyFreeUsed: 2,
          dailyFreeLimit: 5,
          totalConsumed: 9,
        },
        defaults: {
          turnCost: 1,
        },
      },
      {
        status: "paid",
        privateEnabled: true,
      },
    );

    assert.match(text, /Status: paid/);
    assert.match(text, /Private chat: unlocked/);
    assert.match(text, /Daily free: 2\/5/);
    assert.match(text, /Paid credits: 7/);
  });
});
