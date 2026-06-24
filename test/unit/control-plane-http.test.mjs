import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { importFresh } from "../helpers/module.js";

function requestFromString(body) {
  return Readable.from(body ? [Buffer.from(body, "utf8")] : []);
}

function createResponseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

test("control plane http helpers parse JSON bodies and classify invalid JSON", async () => {
  const { readJsonBody } = await importFresh("../../src/control-plane-http.mjs");

  assert.deepEqual(await readJsonBody(requestFromString("")), {});
  assert.deepEqual(await readJsonBody(requestFromString('{"ok":true}')), { ok: true });

  await assert.rejects(
    () => readJsonBody(requestFromString("{bad-json")),
    (error) => {
      assert.equal(error.code, "invalid_json");
      assert.equal(error.message, "Request body must be valid JSON.");
      return true;
    },
  );
});

test("control plane http helpers authorize token, bearer, and basic requests", async () => {
  const {
    isWebRequestAuthorized,
    parseBasicAuthPassword,
    timingSafeEqualString,
  } = await importFresh("../../src/control-plane-http.mjs");

  assert.equal(isWebRequestAuthorized({ headers: {} }, ""), true);
  assert.equal(isWebRequestAuthorized({ headers: { "x-codexbridge-token": "secret" } }, "secret"), true);
  assert.equal(isWebRequestAuthorized({ headers: { authorization: "Bearer secret" } }, "secret"), true);

  const encodedBasic = Buffer.from("operator:secret", "utf8").toString("base64");
  assert.equal(parseBasicAuthPassword(`Basic ${encodedBasic}`), "secret");
  assert.equal(isWebRequestAuthorized({ headers: { authorization: `Basic ${encodedBasic}` } }, "secret"), true);

  assert.equal(isWebRequestAuthorized({ headers: { authorization: "Bearer wrong" } }, "secret"), false);
  assert.equal(timingSafeEqualString("secret", "secret"), true);
  assert.equal(timingSafeEqualString("secret", "secret-longer"), false);
});

test("control plane http helpers write standard response envelopes", async () => {
  const { html, json, text, unauthorized } = await importFresh("../../src/control-plane-http.mjs");

  const jsonResponse = createResponseRecorder();
  json(jsonResponse, 201, { ok: true });
  assert.equal(jsonResponse.statusCode, 201);
  assert.equal(jsonResponse.headers["content-type"], "application/json; charset=utf-8");
  assert.match(jsonResponse.body, /"ok": true/);

  const htmlResponse = createResponseRecorder();
  html(htmlResponse, 200, "<main></main>");
  assert.equal(htmlResponse.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(htmlResponse.body, "<main></main>");

  const textResponse = createResponseRecorder();
  text(textResponse, 200, "plain");
  assert.equal(textResponse.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(textResponse.body, "plain");

  const unauthorizedResponse = createResponseRecorder();
  unauthorized(unauthorizedResponse);
  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.match(unauthorizedResponse.headers["www-authenticate"], /CodexBridge Control Plane/);
});
