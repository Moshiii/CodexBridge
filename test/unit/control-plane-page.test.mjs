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

test("control plane page escapes dynamic bot rail fields before assigning innerHTML", async () => {
  const { renderHtmlPage } = await importFresh("../../src/control-plane-page.mjs");

  const html = renderHtmlPage();

  assert.match(html, /'<div><strong>' \+ escapeHtml\(bot\.name\) \+ '<\/strong><\/div>'/);
  assert.match(html, /'<div class="subtle">' \+ escapeHtml\(bot\.id\) \+ '<\/div>'/);
  assert.match(html, /escapeHtml\(bot\.status\)/);
  assert.doesNotMatch(html, /'<div><strong>' \+ bot\.name \+ '<\/strong><\/div>'/);
});

test("control plane page injects the compact path home instead of hardcoding a developer path", async () => {
  const { renderHtmlPage } = await importFresh("../../src/control-plane-page.mjs");

  const html = renderHtmlPage({ homePath: "/srv/codexbridge/" });

  assert.match(html, /const home = "\/srv\/codexbridge";/);
  assert.doesNotMatch(html, /const home = "\/Users\/moshiwei";/);
});
