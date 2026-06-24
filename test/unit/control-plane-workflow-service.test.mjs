import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("control plane workflow service creates and activates sessions", async () => {
  await withTempHome(async (botHome) => {
    const service = await importFresh("../../src/control-plane-workflow-service.mjs");

    const created = await service.createSession(botHome, "draft");
    const activated = await service.activateSession(botHome, "main");

    assert.equal(created.activeSessionLabel, "draft");
    assert.deepEqual(created.sessions.map((session) => session.label), ["draft", "main"]);
    assert.equal(activated.activeSessionLabel, "main");
    await assert.rejects(
      () => service.createSession(botHome, ""),
      /Session label is required/,
    );
    await assert.rejects(
      () => service.activateSession(botHome, "missing"),
      /Unknown session/,
    );
  });
});

test("control plane workflow service creates and toggles bot schedules", async () => {
  await withTempHome(async (botHome) => {
    const service = await importFresh("../../src/control-plane-workflow-service.mjs");

    const schedule = await service.createBotSchedule(botHome, "bot-a", {
      objective: "Run daily check",
      cron: "0 9 * * *",
      timezone: "",
    });
    const listed = await service.listBotSchedules(botHome);
    const disabled = await service.toggleBotSchedule(botHome, schedule.id, false);

    assert.equal(schedule.chatId, "bot-a");
    assert.equal(schedule.timezone, "Asia/Shanghai");
    assert.equal(listed.length, 1);
    assert.equal(disabled.enabled, false);
    await assert.rejects(
      () => service.createBotSchedule(botHome, "bot-a", { objective: "", cron: "" }),
      /Schedule objective and cron are required/,
    );
    await assert.rejects(
      () => service.toggleBotSchedule(botHome, "missing", true),
      /Unknown schedule/,
    );
  });
});
