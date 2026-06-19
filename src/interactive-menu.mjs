import { emitKeypressEvents } from "node:readline";

import { countRenderedRows, formatListCard, renderCard } from "./ui/banner.mjs";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  brightCyan: "\x1b[96m",
  dim: "\x1b[2m",
};

function colorize(text, color) {
  return `${color}${text}${ANSI.reset}`;
}

function normalizeShortcutKey(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim().toLowerCase();
}

function renderShortcutLine(shortcuts) {
  if (!shortcuts.length) {
    return null;
  }
  return shortcuts
    .map((shortcut) => `[${shortcut.key === "space" ? "space" : shortcut.key}] ${shortcut.label}`)
    .join("  ");
}

export function renderSelectionCard(title, items, selectedIndex, options = {}) {
  const lines = [colorize(title, ANSI.bold + ANSI.brightCyan), ""];
  const bodyLines = Array.isArray(options.bodyLines) ? options.bodyLines.filter(Boolean) : [];
  for (const bodyLine of bodyLines) {
    lines.push(bodyLine);
  }
  if (bodyLines.length) {
    lines.push("");
  }
  for (let index = 0; index < items.length; index += 1) {
    const prefix = index === selectedIndex ? colorize("›", ANSI.brightCyan) : " ";
    lines.push(`${prefix} ${items[index].label}`);
  }
  const shortcuts = Array.isArray(options.shortcuts) ? options.shortcuts : [];
  const shortcutLine = renderShortcutLine(shortcuts);
  const hintLines = Array.isArray(options.hintLines) ? options.hintLines.filter(Boolean) : [];
  if (shortcutLine || hintLines.length) {
    lines.push("");
  }
  if (shortcutLine) {
    lines.push(colorize(shortcutLine, ANSI.dim));
  }
  for (const hint of hintLines) {
    lines.push(colorize(hint, ANSI.dim));
  }
  return renderCard(lines).join("\n");
}

export function parseTextMenuResponse(answer, items, options = {}) {
  const shortcuts = Array.isArray(options.shortcuts) ? options.shortcuts : [];
  const defaultIndex = Number.isInteger(options.defaultIndex) ? options.defaultIndex : 0;
  const normalized = String(answer || "").trim().toLowerCase();

  if (!normalized) {
    return {
      action: "select",
      index: defaultIndex,
      value: items[defaultIndex]?.value,
    };
  }

  if (normalized === "q" || normalized === "quit" || normalized === "cancel" || normalized === "esc") {
    return { action: "cancel", index: defaultIndex, value: null };
  }

  const numeric = Number.parseInt(normalized, 10);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= items.length) {
    const index = numeric - 1;
    return {
      action: "select",
      index,
      value: items[index]?.value,
    };
  }

  const matchedShortcut = shortcuts.find((shortcut) => normalizeShortcutKey(shortcut.key) === normalized);
  if (matchedShortcut) {
    return {
      action: "shortcut",
      key: matchedShortcut.key,
      shortcut: matchedShortcut.action,
      index: defaultIndex,
      value: items[defaultIndex]?.value,
    };
  }

  return null;
}

function clearPreviousFrame(output, lineCount) {
  if (!output?.isTTY || lineCount <= 0) {
    return;
  }
  output.write(`\x1b[${lineCount}F`);
  output.write("\x1b[0J");
}

function clearViewport(output) {
  if (!output?.isTTY) {
    return;
  }
  output.write("\x1b[2J\x1b[H");
}

function clearPrimaryPromptLine(output) {
  if (!output?.isTTY) {
    return;
  }
  output.write("\x1b[1F\x1b[0J");
}

function enterAlternateScreen(output) {
  if (!output?.isTTY) {
    return;
  }
  output.write("\x1b[?1049h");
}

function exitAlternateScreen(output) {
  if (!output?.isTTY) {
    return;
  }
  output.write("\x1b[?1049l");
}

function isReadlineAbortError(error) {
  return error?.code === "ABORT_ERR" || error?.name === "AbortError";
}

export async function promptSelect({
  rl,
  input,
  output,
  title,
  items,
  bodyLines = [],
  hintLines = [],
  shortcuts = [],
  defaultIndex = 0,
  clearOnExit = true,
  fullscreen = false,
  fallbackPrompt = "Choose an option: ",
} = {}) {
  if (!Array.isArray(items) || !items.length) {
    return { action: "cancel", index: -1, value: null };
  }

  const safeDefaultIndex = Math.max(0, Math.min(defaultIndex, items.length - 1));

  if (!input?.isTTY || !output?.isTTY || typeof input.setRawMode !== "function") {
    output.write(`${formatListCard(title, items.map((item, index) => `${index + 1}. ${item.label}`))}\n\n`);
    for (const bodyLine of bodyLines) {
      output.write(`${bodyLine}\n`);
    }
    if (bodyLines.length) {
      output.write("\n");
    }
    const shortcutLine = renderShortcutLine(shortcuts);
    if (shortcutLine) {
      output.write(`${shortcutLine}\n`);
    }
    for (const hint of hintLines) {
      output.write(`${hint}\n`);
    }
    if (shortcutLine || hintLines.length) {
      output.write("\n");
    }
    while (true) {
      let answer;
      try {
        answer = await rl.question(fallbackPrompt);
      } catch (error) {
        if (isReadlineAbortError(error)) {
          return { action: "cancel", index: safeDefaultIndex, value: null };
        }
        throw error;
      }
      const parsed = parseTextMenuResponse(answer, items, {
        shortcuts,
        defaultIndex: safeDefaultIndex,
      });
      if (parsed) {
        return parsed;
      }
      output.write("Unknown selection. Try a number, shortcut, or 'q' to cancel.\n");
    }
  }

  rl.pause();
  emitKeypressEvents(input);
  input.resume();

  let selectedIndex = safeDefaultIndex;
  let renderedLineCount = 0;
  const restoreRawMode = Boolean(input.isRaw);
  let usingAlternateScreen = false;

  const render = () => {
    if (fullscreen) {
      clearViewport(output);
    } else {
      clearPreviousFrame(output, renderedLineCount);
    }
    const frame = renderSelectionCard(title, items, selectedIndex, {
      bodyLines,
      hintLines,
      shortcuts,
    });
    output.write(`${frame}\n`);
    renderedLineCount = countRenderedRows(frame.split("\n"), output.columns || 80);
  };

  const cleanup = () => {
    input.removeListener("keypress", onKeypress);
    if (!restoreRawMode) {
      input.setRawMode(false);
    }
    if (usingAlternateScreen) {
      exitAlternateScreen(output);
      usingAlternateScreen = false;
    }
    output.write("\x1b[?25h");
  };

  const finish = (resolve, result) => {
    if (clearOnExit) {
      if (fullscreen) {
        if (!usingAlternateScreen) {
          clearViewport(output);
        }
      } else {
        clearPreviousFrame(output, renderedLineCount);
      }
      renderedLineCount = 0;
    }
    cleanup();
    resolve(result);
  };

  const shortcutMap = new Map(shortcuts.map((shortcut) => [normalizeShortcutKey(shortcut.key), shortcut]));

  const onKeypress = (str, key = {}) => {
    if (key.ctrl && key.name === "c") {
      finish(resolvePromise, { action: "cancel", index: selectedIndex, value: null });
      return;
    }
    if (key.name === "up") {
      selectedIndex = selectedIndex <= 0 ? items.length - 1 : selectedIndex - 1;
      render();
      return;
    }
    if (key.name === "down") {
      selectedIndex = selectedIndex >= items.length - 1 ? 0 : selectedIndex + 1;
      render();
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      finish(resolvePromise, {
        action: "select",
        index: selectedIndex,
        value: items[selectedIndex]?.value,
      });
      return;
    }
    if (key.name === "escape") {
      finish(resolvePromise, { action: "cancel", index: selectedIndex, value: null });
      return;
    }

    const normalizedKey = normalizeShortcutKey(key.name || str);
    if (shortcutMap.has(normalizedKey)) {
      const shortcut = shortcutMap.get(normalizedKey);
      finish(resolvePromise, {
        action: "shortcut",
        key: shortcut.key,
        shortcut: shortcut.action,
        index: selectedIndex,
        value: items[selectedIndex]?.value,
      });
      return;
    }

    const numeric = Number.parseInt(str, 10);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= items.length) {
      selectedIndex = numeric - 1;
      render();
    }
  };

  output.write("\x1b[?25l");
  if (!restoreRawMode) {
    input.setRawMode(true);
  }
  if (fullscreen) {
    clearPrimaryPromptLine(output);
    enterAlternateScreen(output);
    usingAlternateScreen = true;
  }

  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    input.on("keypress", onKeypress);
    render();
  });

  return await promise;
}
