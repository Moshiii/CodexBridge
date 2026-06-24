import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("sleep returns a promise that resolves", async () => {
  const { sleep } = await importFresh("../../src/async-utils.mjs");
  const promise = sleep(1);

  assert.equal(typeof promise?.then, "function");

  await promise;
});
