import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("conversation review ledger stores and filters review annotations", async () => {
  await withTempHome(async () => {
    const reviews = await importFresh("../../src/conversation-review.mjs");

    const first = await reviews.appendConversationReviewEvent({
      eventId: "event_1",
      status: "confirmed_risk",
      reviewer: "operator",
      note: "credential included",
    });
    await reviews.appendConversationReviewEvent({
      eventId: "event_1",
      status: "handled",
      reviewer: "operator",
      note: "user warned",
    });
    await reviews.appendConversationReviewEvent({
      eventId: "event_2",
      status: "false_positive",
      reviewer: "operator",
    });

    const byEvent = await reviews.listConversationReviewEvents({ eventId: "event_1" });
    const falsePositives = await reviews.listConversationReviewEvents({ status: "false_positive" });
    const latest = await reviews.getLatestConversationReviews();

    assert.equal(first.eventId, "event_1");
    assert.equal(first.status, "confirmed_risk");
    assert.equal(byEvent.length, 2);
    assert.equal(falsePositives.length, 1);
    assert.equal(falsePositives[0].eventId, "event_2");
    assert.equal(latest.get("event_1").status, "handled");
    assert.equal(latest.get("event_2").status, "false_positive");
  });
});

test("conversation review rejects missing event id and invalid status", async () => {
  await withTempHome(async () => {
    const reviews = await importFresh("../../src/conversation-review.mjs");

    await assert.rejects(
      reviews.appendConversationReviewEvent({ status: "handled" }),
      /eventId/,
    );
    await assert.rejects(
      reviews.appendConversationReviewEvent({ eventId: "event_1", status: "maybe" }),
      /valid status/,
    );
  });
});
