import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

function detailWithConfig(config = {}, botHome = process.env.CODEXBRIDGE_HOME) {
  return {
    bot: {
      id: "ready",
      homePath: botHome,
    },
    config,
  };
}

test("control plane readiness reports storage migration and adapter status", async () => {
  const { buildStorageReadiness } = await importFresh("../../src/control-plane-readiness-service.mjs");

  const migrationNeeded = buildStorageReadiness(
    { storage: { provider: "json" } },
    { currentSchemaVersion: 1, pending: [{ id: "m1" }] },
  );
  const unsupported = buildStorageReadiness(
    { storage: { provider: "sqlite" } },
    { currentSchemaVersion: 1, pending: [] },
  );

  assert.equal(migrationNeeded.status, "migration_needed");
  assert.equal(migrationNeeded.ready, false);
  assert.match(migrationNeeded.next, /Run migrations/);
  assert.equal(unsupported.status, "provider_not_available");
  assert.equal(unsupported.adapterReady, false);
});

test("control plane readiness builds a Telegram setup guide", async () => {
  await withTempHome(async (botHome) => {
    const service = await importFresh("../../src/control-plane-readiness-service.mjs");
    const runs = await importFresh("../../src/runs-state.mjs");

    await runs.createRunRecord({
      userId: "telegram:123",
      channel: "telegram",
      chatType: "group",
      status: "completed",
    }, botHome);

    const guide = await service.buildSetupGuide(
      detailWithConfig({
        channels: {
          telegram: {
            enabled: true,
            botToken: "123456:ABCDEF",
            botUsername: "ready_bot",
          },
        },
      }, botHome),
      { healthy: true },
      {
        privateChats: [],
        groupChats: ["Group (-100)"],
        groupUsers: [],
      },
    );
    const steps = Object.fromEntries(guide.steps.map((step) => [step.id, step.status]));

    assert.equal(guide.ready, true);
    assert.equal(guide.completed, 5);
    assert.equal(guide.nextStep, null);
    assert.equal(steps.configure_channel, "done");
    assert.equal(steps.pair_identity, "done");
    assert.equal(steps.allow_audience, "done");
    assert.equal(steps.start_runtime, "done");
    assert.equal(steps.send_first_message, "done");
  });
});

test("control plane readiness explains incomplete Feishu setup", async () => {
  await withTempHome(async (botHome) => {
    const { buildSetupGuide } = await importFresh("../../src/control-plane-readiness-service.mjs");

    const guide = await buildSetupGuide(
      detailWithConfig({
        channels: {
          feishu: {
            enabled: true,
            appId: "cli_a",
            appSecret: "secret",
            setup: {
              botCapabilityEnabled: true,
              tenantInstalled: true,
            },
            testAudience: {
              userIds: ["ou_1"],
            },
          },
        },
      }, botHome),
      { healthy: false },
      {
        privateChats: [],
        groupChats: [],
        groupUsers: [],
      },
    );

    assert.equal(guide.ready, false);
    assert.equal(guide.nextStep.id, "configure_channel");
    assert.match(guide.nextStep.hint, /im\.message\.receive_v1 event/);
    assert.match(guide.nextStep.hint, /User visibility/);
  });
});

test("control plane readiness preflight ignores the first-message step", async () => {
  const { buildQuickTestPreflight } = await importFresh("../../src/control-plane-readiness-service.mjs");

  const ready = buildQuickTestPreflight({
    steps: [
      { id: "configure_channel", label: "Connect", status: "done", action: "connect" },
      { id: "send_first_message", label: "Send", status: "todo", action: "send" },
    ],
  });
  const blocked = buildQuickTestPreflight({
    steps: [
      { id: "configure_channel", label: "Connect", status: "todo", action: "connect", hint: "missing" },
      { id: "send_first_message", label: "Send", status: "todo", action: "send" },
    ],
  });

  assert.equal(ready.readyForIm, true);
  assert.equal(ready.missingSteps.length, 0);
  assert.equal(blocked.readyForIm, false);
  assert.deepEqual(blocked.missingSteps.map((step) => step.id), ["configure_channel"]);
  assert.match(blocked.message, /Connect: missing/);
});
