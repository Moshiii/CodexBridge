import os from "node:os";
import path from "node:path";
import { stdout } from "node:process";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  gray: "\x1b[90m",
};

const SOLID_FRAME = [
  " ░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░▒▓██████▓▒░ ░▒▓██████▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░ ",
  "░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        ",
  "░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        ",
  "░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓██████▓▒░   ",
  "░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        ",
  "░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░  ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        ",
  "░▒▓█▓▒░░▒▓█▓▒░░▒▓██████▓▒░   ░▒▓█▓▒░   ░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░ ",
];

function remapFrame(frame, replacer) {
  return frame.map((line) =>
    line
      .split("")
      .map((char) => replacer(char))
      .join(""),
  );
}

const LOGO_FRAMES = [
  remapFrame(SOLID_FRAME, (char) => {
    if (char === "█" || char === "▓") return "▒";
    if (char === "▒") return "░";
    return char;
  }),
  remapFrame(SOLID_FRAME, (char) => {
    if (char === "█") return "▓";
    if (char === "▓") return "▒";
    return char;
  }),
  remapFrame(SOLID_FRAME, (char) => {
    if (char === "█") return "▓";
    return char;
  }),
  SOLID_FRAME,
];

const FRAME_DELAYS_MS = [180, 220, 260, 0];
const SUBTITLE = "booting local operator layer";

function colorize(text, color) {
  return `${color}${text}${ANSI.reset}`;
}

function supportsAnimation() {
  if (process.env.AUTOAIDE_NO_ANIMATION === "1") {
    return false;
  }
  if (process.env.AUTOAIDE_FORCE_ANIMATION === "1") {
    return true;
  }
  return Boolean(stdout.isTTY && stdout.columns >= 60 && stdout.rows >= 16 && !process.env.CI);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPath(filePath) {
  const home = os.homedir();
  if (filePath.startsWith(home)) {
    return `~${filePath.slice(home.length)}`;
  }
  return filePath;
}

function buildCardLines({ model, workspacePath }) {
  return [
    colorize("AutoAide", ANSI.bold + ANSI.brightCyan),
    colorize("personal AI shell", ANSI.dim),
    "",
    `model:     ${model}`,
    `${ANSI.dim}workspace:${ANSI.reset} ${colorize(formatPath(workspacePath), ANSI.gray)}`,
  ];
}

export function renderCard(lines) {
  const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  const innerWidth = Math.max(...plainLines.map((line) => line.length));
  const top = `╭${"─".repeat(innerWidth + 2)}╮`;
  const bottom = `╰${"─".repeat(innerWidth + 2)}╯`;
  const body = lines.map((line, index) => {
    const pad = " ".repeat(innerWidth - plainLines[index].length);
    return `│ ${line}${pad} │`;
  });
  return [top, ...body, bottom];
}

export function formatKeyValueCard(title, rows) {
  const lines = [colorize(title, ANSI.bold + ANSI.brightCyan), ""];
  for (const [label, value] of rows) {
    lines.push(`${colorize(`${label}:`, ANSI.dim)} ${value}`);
  }
  return renderCard(lines).join("\n");
}

export function formatListCard(title, items) {
  const lines = [colorize(title, ANSI.bold + ANSI.brightCyan), "", ...items];
  return renderCard(lines).join("\n");
}

export function formatMessageCard(title, bodyLines) {
  return renderCard([colorize(title, ANSI.bold + ANSI.brightCyan), "", ...bodyLines]).join("\n");
}

function glitchSubtitle(text) {
  const chars = text.split("");
  const replacements = new Map([
    [8, "l"],
    [9, "0"],
    [16, "p"],
    [17, "-"],
    [18, "r"],
  ]);
  return chars
    .map((char, index) => {
      if (!replacements.has(index)) {
        return char;
      }
      return colorize(replacements.get(index), ANSI.brightCyan);
    })
    .join("");
}

function composeBanner(frame, config) {
  const logo = frame.map((line) => colorize(line, ANSI.brightCyan));
  const card = renderCard(buildCardLines({ model: config.model || "gpt-5.4", workspacePath: config.workspacePath }));
  const subtitle = colorize(SUBTITLE, ANSI.dim);
  return [...logo, "", ...card, "", subtitle];
}

function makeHarderSolidFrame(frame) {
  return frame.map((line) =>
    line
      .replaceAll("░", " ")
      .replace(/▒(?=█)/g, "▓")
      .replace(/(?<=█)▒/g, "▓"),
  );
}

function composeBannerWithGlitch(frame, config) {
  const lines = composeBanner(frame, config);
  lines[lines.length - 1] = glitchSubtitle(SUBTITLE);
  return lines;
}

function clearFrame(lineCount) {
  if (!stdout.isTTY || lineCount <= 0) {
    return;
  }
  stdout.write(`\x1b[${lineCount}F`);
  stdout.write("\x1b[0J");
}

function printLines(lines) {
  stdout.write(`${lines.join("\n")}\n`);
}

export async function showStartupBanner(config) {
  const bannerConfig = {
    model: config.model || "gpt-5.4",
    workspacePath: config.workspacePath || path.join(os.homedir(), ".autoaide", "workspace"),
  };

  if (!supportsAnimation()) {
    printLines(composeBanner(makeHarderSolidFrame(LOGO_FRAMES.at(-1)), bannerConfig));
    stdout.write("\n");
    return;
  }

  let printedLines = 0;
  for (let index = 0; index < LOGO_FRAMES.length; index += 1) {
    const lines = composeBanner(LOGO_FRAMES[index], bannerConfig);
    if (printedLines > 0) {
      clearFrame(printedLines);
    }
    printLines(lines);
    printedLines = lines.length;
    const delay = FRAME_DELAYS_MS[index];
    if (delay > 0) {
      await sleep(delay);
    }
  }

  await sleep(220);
  clearFrame(printedLines);
  const finalFrame = makeHarderSolidFrame(LOGO_FRAMES.at(-1));
  const glitched = composeBannerWithGlitch(finalFrame, bannerConfig);
  printLines(glitched);
  printedLines = glitched.length;
  await sleep(180);
  clearFrame(printedLines);
  printLines(composeBanner(finalFrame, bannerConfig));
  stdout.write("\n");
}
