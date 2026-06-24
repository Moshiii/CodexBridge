import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("decodeRouteParam decodes route capture groups", async () => {
  const { decodeRouteParam } = await importFresh("../../src/control-plane-api-utils.mjs");
  const match = ["/api/bots/demo%20bot/sessions/main%2Fwork/use", "demo%20bot", "main%2Fwork"];

  assert.equal(decodeRouteParam(match), "demo bot");
  assert.equal(decodeRouteParam(match, 2), "main/work");
});

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

test("parseRequestUrl parses request URLs with a stable fallback base", async () => {
  const { parseRequestUrl } = await importFresh("../../src/control-plane-api-utils.mjs");

  assert.equal(parseRequestUrl({ url: "/api/bots?limit=10" }).pathname, "/api/bots");
  assert.equal(parseRequestUrl({}, "http://127.0.0.1:8787").origin, "http://127.0.0.1:8787");
});

test("pickRequestSearchParams handles empty request urls", async () => {
  const { pickRequestSearchParams } = await importFresh("../../src/control-plane-api-utils.mjs");

  assert.deepEqual(pickRequestSearchParams({}, ["sessionLabel"]), {
    sessionLabel: null,
  });
});
