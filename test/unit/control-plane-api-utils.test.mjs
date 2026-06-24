import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("pickRequestSearchParams returns selected query params", async () => {
  const { pickRequestSearchParams } = await importFresh("../../src/control-plane-api-utils.mjs");

  assert.deepEqual(
    pickRequestSearchParams(
      { url: "/api/bots/demo/runs?userId=telegram%3A123&limit=20&ignored=true" },
      ["userId", "limit", "missing"],
    ),
    {
      userId: "telegram:123",
      limit: "20",
      missing: null,
    },
  );
});

test("pickRequestSearchParams handles empty request urls", async () => {
  const { pickRequestSearchParams } = await importFresh("../../src/control-plane-api-utils.mjs");

  assert.deepEqual(pickRequestSearchParams({}, ["sessionLabel"]), {
    sessionLabel: null,
  });
});
