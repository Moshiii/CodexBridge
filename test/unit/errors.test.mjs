import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

test("toPublicError exposes user errors and hides generic system errors", async () => {
  await withTempHome(async () => {
    const errors = await importFresh("../../src/errors.mjs");

    const userPayload = errors.toPublicError(new errors.UserInputError("Prompt is required.", {
      code: "prompt_required",
    }));
    const genericPayload = errors.toPublicError(new Error("database password leaked"));

    assert.equal(userPayload.statusCode, 400);
    assert.equal(userPayload.payload.error, "Prompt is required.");
    assert.equal(userPayload.payload.kind, "user");
    assert.equal(userPayload.payload.code, "prompt_required");
    assert.equal(genericPayload.statusCode, 500);
    assert.equal(genericPayload.payload.error, "Internal server error");
    assert.equal(JSON.stringify(genericPayload).includes("database password"), false);
  });
});
