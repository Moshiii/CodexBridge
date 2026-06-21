import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("admin audit log stores and filters events", async () => {
  await withTempHome(async () => {
    const audit = await importFresh("../../src/admin-audit-log.mjs");

    await audit.appendAdminAuditEvent({
      action: "grant_credits",
      userId: "telegram:1",
      amount: 10,
    });
    await audit.appendAdminAuditEvent({
      action: "set_user_status",
      userId: "telegram:2",
      status: "banned",
    });
    const events = await audit.listAdminAuditEvents({ userId: "telegram:1" });

    assert.equal(events.length, 1);
    assert.equal(events[0].action, "grant_credits");
    assert.equal(events[0].actor, "local-web");
    assert.ok(events[0].eventId);
  });
});

test("admin audit event requires action", async () => {
  await withTempHome(async () => {
    const audit = await importFresh("../../src/admin-audit-log.mjs");

    await assert.rejects(
      () => audit.appendAdminAuditEvent({ userId: "telegram:1" }),
      /requires action/,
    );
  });
});
