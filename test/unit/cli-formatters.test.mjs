import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, "");
}

test("cli formatters render Telegram entities and sessions", async () => {
  const formatters = await importFresh("../../src/cli-formatters.mjs");

  assert.equal(formatters.formatBotPrompt("alpha"), "codexbridge:alpha> ");
  assert.equal(formatters.formatTelegramEntity("1", { username: "@alice" }), "@alice (1)");
  assert.equal(formatters.formatTelegramEntity("2", { title: "Group" }), "Group (2)");
  assert.equal(formatters.formatTelegramEntityList(["1"], { users: { "1": { label: "Alice" } } }, "user"), "Alice (1)");
  assert.equal(formatters.formatTelegramEntityList([], {}, "chat"), "(all chats)");
  assert.equal(formatters.slugifySessionLabel(" Demo:One! "), "demo:one");
  assert.equal(formatters.slugifySessionLabel("   "), null);

  const rendered = stripAnsi(formatters.formatCliSessions({
    activeSessionLabel: "main",
    sessions: {
      main: { label: "main", cliSessionRef: "session-main" },
      draft: { label: "draft", cliSessionRef: null },
    },
  }, new Map([["draft", { running: true }]])));

  assert.match(rendered, /main \[active, started\]/);
  assert.match(rendered, /draft \[empty, running\]/);
});

test("cli formatters render status cards and CLI results", async () => {
  await withTempHome(async (homePath) => {
    const formatters = await importFresh("../../src/cli-formatters.mjs");

    const config = {
      channel: "telegram",
      ownerUserId: "owner",
      adminUserIds: ["admin"],
      runtime: { model: "gpt-5.4-mini" },
      channels: {
        telegram: {
          enabled: true,
          private: { allowedChatIds: ["10"] },
          groups: { allowedChatIds: ["20"], allowedUserIds: ["30"] },
          metadata: {
            chats: { "10": { label: "Alice" }, "20": { title: "Group" } },
            users: { "30": { username: "bob" } },
          },
        },
        feishu: {
          enabled: false,
          appId: "",
          requireExplicitMention: true,
        },
      },
    };
    const botContext = { botId: "alpha", botHome: `${homePath}/bots/alpha` };
    const cliState = { activeSessionLabel: "main" };
    const bootstrapInfo = { bootstrapPending: false };
    const creditsInfo = { account: { userId: "cli:owner", balance: 7 } };

    const overview = stripAnsi(formatters.formatStatusOverview(botContext, config, { pid: 123 }, cliState, bootstrapInfo, creditsInfo));
    const status = stripAnsi(formatters.formatCliStatus(botContext, config, { pid: 123 }, cliState, bootstrapInfo, creditsInfo));

    assert.match(overview, /Current Bot/);
    assert.match(overview, /runtime:\s+online/);
    assert.match(status, /CodexBridge Status/);
    assert.match(status, /private chats:\s+Alice \(10\)/);
    assert.match(status, /group users:\s+@bob \(30\)/);
    assert.equal(formatters.renderCliResult({ ok: true, output: "" }), "Codex completed without output.");
    assert.match(formatters.renderCliResult({ ok: false, exitCode: 2, output: "out", stderr: "err" }), /exit 2/);
    assert.match(formatters.renderCliResult({ ok: false, signal: "SIGINT", stderr: "stop" }), /interrupted/);
  });
});
