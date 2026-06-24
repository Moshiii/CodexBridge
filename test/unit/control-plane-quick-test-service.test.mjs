import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("control plane quick test service resolves smoke and workspace prompts", async () => {
  const service = await importFresh("../../src/control-plane-quick-test-service.mjs");

  assert.equal(service.normalizeQuickTestMode("unknown"), "smoke");
  assert.equal(service.normalizeQuickTestMode("workspace_file_demo"), "workspace_file_demo");
  assert.equal(service.resolveQuickTestPrompt("smoke"), service.QUICK_TEST_PROMPT);
  assert.match(service.resolveQuickTestPrompt("workspace_file_demo"), /beijing-weekend-plan\.md/);
  assert.equal(service.WORKSPACE_DEMO_PROMPTS.length, 3);
});

test("control plane quick test service starts main-session chat with preflight", async () => {
  const { startQuickTest } = await importFresh("../../src/control-plane-quick-test-service.mjs");
  const calls = [];

  const result = await startQuickTest({
    botId: "alpha",
    mode: "workspace_file_demo",
    getDetail: async (botId) => {
      calls.push(["detail", botId]);
      return {
        setupGuide: {
          steps: [
            {
              id: "configure_channel",
              label: "Connect an IM channel",
              status: "todo",
              action: "Add credentials.",
              hint: "Missing credentials.",
              targetTab: "telegram",
            },
          ],
        },
      };
    },
    startChat: async (botId, payload) => {
      calls.push(["chat", botId, payload]);
      return {
        botId,
        prompt: payload.prompt,
        sessionLabel: payload.sessionLabel,
        running: true,
      };
    },
  });

  assert.deepEqual(calls[0], ["detail", "alpha"]);
  assert.equal(calls[1][0], "chat");
  assert.equal(calls[1][1], "alpha");
  assert.equal(calls[1][2].sessionLabel, "main");
  assert.match(calls[1][2].prompt, /beijing-weekend-plan\.md/);
  assert.equal(result.mode, "workspace_file_demo");
  assert.equal(result.sessionLabel, "main");
  assert.equal(result.preflight.readyForIm, false);
  assert.deepEqual(result.preflight.missingSteps.map((step) => step.id), ["configure_channel"]);
});
