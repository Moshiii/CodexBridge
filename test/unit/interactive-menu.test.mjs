import test from "node:test";
import assert from "node:assert/strict";

import { importFresh } from "../helpers/module.js";

test("renderSelectionCard highlights the selected item", async () => {
  const { renderSelectionCard } = await importFresh("../../src/interactive-menu.mjs");

  const rendered = renderSelectionCard("Menu", [
    { label: "First", value: "first" },
    { label: "Second", value: "second" },
  ], 1, {
    hintLines: ["Use Enter to choose."],
  });
  const plain = rendered.replace(/\x1b\[[0-9;]*m/g, "");

  assert.match(plain, /First/);
  assert.match(plain, /› Second/);
  assert.match(plain, /Use Enter to choose\./);
});

test("parseTextMenuResponse selects the default item on empty input", async () => {
  const { parseTextMenuResponse } = await importFresh("../../src/interactive-menu.mjs");
  const items = [
    { label: "First", value: "first" },
    { label: "Second", value: "second" },
  ];

  const parsed = parseTextMenuResponse("", items, { defaultIndex: 1 });

  assert.deepEqual(parsed, {
    action: "select",
    index: 1,
    value: "second",
  });
});

test("parseTextMenuResponse accepts numeric and shortcut selections", async () => {
  const { parseTextMenuResponse } = await importFresh("../../src/interactive-menu.mjs");
  const items = [
    { label: "First", value: "first" },
    { label: "Second", value: "second" },
  ];
  const shortcuts = [
    { key: "n", label: "new bot", action: "create" },
  ];

  const numeric = parseTextMenuResponse("2", items, { defaultIndex: 0, shortcuts });
  const shortcut = parseTextMenuResponse("n", items, { defaultIndex: 0, shortcuts });

  assert.deepEqual(numeric, {
    action: "select",
    index: 1,
    value: "second",
  });
  assert.deepEqual(shortcut, {
    action: "shortcut",
    key: "n",
    shortcut: "create",
    index: 0,
    value: "first",
  });
});

test("parseTextMenuResponse recognizes cancel responses", async () => {
  const { parseTextMenuResponse } = await importFresh("../../src/interactive-menu.mjs");
  const items = [
    { label: "First", value: "first" },
  ];

  const parsed = parseTextMenuResponse("q", items, { defaultIndex: 0 });

  assert.deepEqual(parsed, {
    action: "cancel",
    index: 0,
    value: null,
  });
});
