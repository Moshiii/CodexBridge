import { spawn } from "node:child_process";

import { WORKSPACE_PATH } from "./config.mjs";

const DEFAULT_START_COMMAND = "codex exec --skip-git-repo-check --json -";
const DEFAULT_RESUME_TEMPLATE = "codex exec resume --skip-git-repo-check --json __SESSION_ID__ -";

export function buildCommandConfig(config) {
  return {
    cwd: process.env.CODEX_CWD?.trim() || WORKSPACE_PATH,
    startCommand: process.env.CODEX_START_COMMAND?.trim() || DEFAULT_START_COMMAND,
    resumeTemplate:
      process.env.CODEX_RESUME_COMMAND_TEMPLATE?.trim() || DEFAULT_RESUME_TEMPLATE,
    model: config.model || "gpt-5.4",
  };
}

function parseCodexJson(stdout) {
  const events = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  let threadId = null;
  let finalText = "";

  for (const event of events) {
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      threadId = event.thread_id;
    }
    if (
      event.type === "item.completed" &&
      event.item &&
      event.item.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      finalText = event.item.text;
    }
  }

  return { threadId, finalText };
}

async function runShellCommand(prompt, command, cwd) {
  return await new Promise((resolve) => {
    const child = spawn(process.env.SHELL || "zsh", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: `Failed to start command: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    child.stdin.end(prompt);
  });
}

export async function runCliTurn(prompt, sessionRef, commandConfig) {
  const command = sessionRef
    ? commandConfig.resumeTemplate.replaceAll("__SESSION_ID__", sessionRef)
    : commandConfig.startCommand;
  const result = await runShellCommand(prompt, command, commandConfig.cwd);
  const parsed = parseCodexJson(result.stdout);
  return {
    ...result,
    cliSessionRef: sessionRef || parsed.threadId,
    output: parsed.finalText || result.stdout,
  };
}
