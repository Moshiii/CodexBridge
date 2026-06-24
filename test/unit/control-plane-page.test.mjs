import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("control plane page renders the control plane shell and demo prompt data", async () => {
  const { renderHtmlPage } = await importFresh("../../src/control-plane-page.mjs");

  const html = renderHtmlPage();

  assert.match(html, /CodexBridge Control Plane/);
  assert.match(html, /Setup Checklist/);
  assert.match(html, /workspaceDemoPrompts/);
  assert.match(html, /Create a 3-day Beijing weekend plan/);
  assert.match(html, /Reply with one short sentence confirming CodexBridge is ready/);
  assert.match(html, /function renderOperationsAdminResult/);
});
