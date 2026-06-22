import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { importFresh, withTempHome } from "../helpers/module.js";

test("renderRunningMessage stays compact", async () => {
  await withTempHome(async () => {
    const { renderRunningMessage } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    const text = renderRunningMessage("hello", "main", "Codex");

    assert.equal(text, "Running Codex on [main]...");
  });
});

test("renderCodexResult keeps empty-output fallback", async () => {
  await withTempHome(async () => {
    const { renderCodexResult } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.equal(
      renderCodexResult({ ok: true, output: "", stderr: "" }),
      "Codex completed, but returned no output.",
    );
  });
});

test("isTelegramReplyReferenceError recognizes Telegram 400 reply failures", async () => {
  await withTempHome(async () => {
    const { isTelegramReplyReferenceError } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.equal(
      isTelegramReplyReferenceError(new Error("Telegram API sendMessage failed with HTTP 400: Bad Request: reply message not found")),
      true,
    );
    assert.equal(isTelegramReplyReferenceError(new Error("Telegram API sendMessage failed with HTTP 500")), false);
  });
});

test("parseCommand strips command targeting suffix", async () => {
  await withTempHome(async () => {
    const { parseCommand } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.deepEqual(parseCommand("/skills@CodexBridgeBot install /tmp/demo.zip"), {
      command: "skills",
      argsText: "install /tmp/demo.zip",
    });
  });
});

test("extractBotMention finds explicit group mentions", async () => {
  await withTempHome(async () => {
    const { extractBotMention } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    const text = "@CodexBridgeBot hi there";
    const mention = extractBotMention(
      text,
      [{ type: "mention", offset: 0, length: 15 }],
      "CodexBridgeBot",
    );

    assert.deepEqual(mention, {
      offset: 0,
      length: 15,
      text: "@CodexBridgeBot",
    });
  });
});

test("isTelegramBotAddedToChat detects the configured bot join event", async () => {
  await withTempHome(async () => {
    const { isTelegramBotAddedToChat } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.equal(
      isTelegramBotAddedToChat({
        new_chat_members: [
          { is_bot: false, username: "alice" },
          { is_bot: true, username: "CodexBridgeBot" },
        ],
      }, "@CodexBridgeBot"),
      true,
    );
    assert.equal(
      isTelegramBotAddedToChat({
        new_chat_members: [
          { is_bot: true, username: "OtherBot" },
        ],
      }, "CodexBridgeBot"),
      false,
    );
  });
});

test("stripExplicitBotMention removes the mention and preserves the request", async () => {
  await withTempHome(async () => {
    const { stripExplicitBotMention } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.equal(
      stripExplicitBotMention("@CodexBridgeBot summarize this", { offset: 0, length: 15 }),
      "summarize this",
    );
  });
});

test("resolveBotRuntimeContext reads bot-scoped config from BOT_HOME", async () => {
  await withTempHome(async (tempHome) => {
    const botHome = `${tempHome}/bots/alpha`;
    process.env.BOT_HOME = botHome;
    process.env.CODEXBRIDGE_BOT_ID = "alpha";
    try {
      const configModule = await importFresh("../../src/config.mjs");
      await configModule.writeConfig(
        {
          id: "alpha",
          name: "Alpha",
          runtime: {
            model: "gpt-5.4-mini",
            backend: "codex",
          },
          channels: {
            telegram: {
              enabled: true,
              botToken: "token-alpha",
              botUsername: "alpha_bot",
              private: {
                allowedChatIds: ["1"],
              },
              groups: {
                allowedChatIds: ["2"],
                allowedUserIds: ["3"],
                requireExplicitMention: true,
              },
            },
          },
        },
        botHome,
      );

      const { resolveBotRuntimeContext } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");
      const runtime = await resolveBotRuntimeContext();

      assert.equal(runtime.botHome, botHome);
      assert.equal(runtime.token, "token-alpha");
      assert.equal(runtime.botUsername, "alpha_bot");
      assert.deepEqual(Array.from(runtime.allowedChatIds), ["1"]);
      assert.deepEqual(Array.from(runtime.allowedGroupChatIds), ["2"]);
      assert.deepEqual(Array.from(runtime.allowedGroupUserIds), ["3"]);
      assert.match(runtime.codexCwd, /bots\/alpha\/workspace$/);
    } finally {
      delete process.env.BOT_HOME;
      delete process.env.CODEXBRIDGE_BOT_ID;
    }
  });
});

test("scheduleBotRuntimeRestart targets the current bot runtime command", async () => {
  await withTempHome(async (tempHome) => {
    const { buildBotRuntimeRestartCommand } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");
    const command = buildBotRuntimeRestartCommand("alpha", path.join(tempHome, "bots", "alpha"));

    assert.match(command, /bot restart "alpha"/);
    assert.match(command, /bots\/alpha\/logs\/runtime\.log/);
  });
});

test("canTelegramUserAccessChat gates private chat behind paid access", async () => {
  await withTempHome(async () => {
    const { canTelegramUserAccessChat } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    const freeUser = {
      id: "telegram:1",
      status: "free",
      privateEnabled: false,
    };
    const paidUser = {
      id: "telegram:2",
      status: "paid",
      privateEnabled: true,
    };

    assert.equal(canTelegramUserAccessChat(freeUser, { chatType: "group", isGroup: true }), true);
    assert.equal(canTelegramUserAccessChat(freeUser, { chatType: "direct", isDirect: true }), false);
    assert.equal(canTelegramUserAccessChat(paidUser, { chatType: "direct", isDirect: true }), true);
    assert.equal(canTelegramUserAccessChat({ ...paidUser, status: "banned" }, { chatType: "group", isGroup: true }), false);
  });
});

test("renderCreditsStatus includes daily free and paid credit fields", async () => {
  await withTempHome(async () => {
    const { renderCreditsStatus } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    const text = renderCreditsStatus(
      {
        account: {
          userId: "telegram:1",
          dailyFreeUsed: 2,
          dailyFreeLimit: 5,
          paidCredits: 10,
          totalConsumed: 7,
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

    assert.match(text, /CodexBridge credits/);
    assert.match(text, /User: telegram:1/);
    assert.match(text, /Plan: paid/);
    assert.match(text, /Private chat: unlocked/);
    assert.match(text, /Daily free used: 2\/5/);
    assert.match(text, /Paid credits: 10/);
    assert.match(text, /You can use both group chat and private chat/);
  });
});

test("telegram welcome and help explain free group use and private unlock", async () => {
  await withTempHome(async () => {
    const { renderHelpMessage, renderWelcomeMessage } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    const welcome = renderWelcomeMessage();
    const help = renderHelpMessage();

    assert.match(welcome, /daily free quota/);
    assert.match(welcome, /Everyone in the group can see/);
    assert.match(welcome, /Use \/credits/);
    assert.match(welcome, /Private chat unlocks/);
    assert.match(help, /\/start - show the quick start/);
    assert.match(help, /Operators manage credits/);
  });
});

test("telegram common error prompts stay actionable", async () => {
  await withTempHome(async () => {
    const {
      renderBusyMessage,
      renderRequestFailedMessage,
      renderUnsupportedCommandMessage,
      renderUnsupportedPayloadMessage,
    } = await importFresh("../../plugins/telegram-codex/telegram-codex-bridge.mjs");

    assert.match(renderUnsupportedPayloadMessage(), /text messages and document uploads/);
    assert.match(renderUnsupportedPayloadMessage(), /upload a file with a caption/);
    assert.match(renderUnsupportedCommandMessage("foo"), /Use \/help/);
    assert.match(renderBusyMessage("main"), /use \/stop/);
    assert.match(renderRequestFailedMessage("codex missing"), /refunded automatically/);
    assert.match(renderRequestFailedMessage("codex missing"), /runtime log/);
  });
});
