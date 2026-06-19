import { spawn } from "node:child_process";

import { WORKSPACE_PATH } from "./config.mjs";

const DEFAULT_START_COMMAND = "codex exec --skip-git-repo-check --json -";
const DEFAULT_RESUME_TEMPLATE = "codex exec resume --skip-git-repo-check --json __SESSION_ID__ -";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function commandHasModel(command) {
  return /(^|\s)(-m|--model)\s/.test(command) || /(^|\s)(-c|--config)\s+model=/.test(command);
}

function applyModelToCommand(command, model) {
  if (!model || commandHasModel(command)) {
    return command;
  }
  return `${command} --model ${shellQuote(model)}`;
}

function useLoginShell() {
  const raw = process.env.CODEXBRIDGE_LOGIN_SHELL?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function getShellSpec() {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c"],
    };
  }
  return {
    command: process.env.SHELL || "zsh",
    args: [useLoginShell() ? "-lc" : "-c"],
  };
}

export function buildCommandConfig(config) {
  const model = config.runtime?.model || "gpt-5.4";
  return {
    cwd: process.env.CODEX_CWD?.trim() || WORKSPACE_PATH,
    startCommand: applyModelToCommand(process.env.CODEX_START_COMMAND?.trim() || DEFAULT_START_COMMAND, model),
    resumeTemplate: applyModelToCommand(
      process.env.CODEX_RESUME_COMMAND_TEMPLATE?.trim() || DEFAULT_RESUME_TEMPLATE,
      model,
    ),
    model,
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

function extractToolLabel(item) {
  return (
    item?.name ||
    item?.tool_name ||
    item?.toolName ||
    item?.raw_item?.name ||
    item?.call_name ||
    item?.action?.name ||
    "tool"
  );
}

function compactCommand(command) {
  if (typeof command !== "string") {
    return "command";
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return "command";
  }

  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

function summarizeEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  if (event.type === "thread.started") {
    return "Session started";
  }

  if (event.type === "item.started" && event.item?.type === "tool_call") {
    return `Using ${extractToolLabel(event.item)}...`;
  }

  if (event.type === "item.completed" && event.item?.type === "tool_call") {
    return `Finished ${extractToolLabel(event.item)}.`;
  }

  if (event.type === "item.started" && event.item?.type === "command_execution") {
    return `Running ${compactCommand(event.item.command)}...`;
  }

  if (event.type === "item.completed" && event.item?.type === "command_execution") {
    return `Finished ${compactCommand(event.item.command)}.`;
  }

  if (event.type === "item.started" && event.item?.type === "reasoning") {
    return "Thinking...";
  }

  return null;
}

function startShellCommand(prompt, command, cwd, options = {}) {
  const shellSpec = getShellSpec();
  const child = spawn(shellSpec.command, [...shellSpec.args, command], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let stdoutBuffer = "";
  let settled = false;
  const seenStatuses = new Set();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      try {
        const event = JSON.parse(line);
        const summary = summarizeEvent(event);
        if (summary && !seenStatuses.has(summary)) {
          seenStatuses.add(summary);
          options.onStatus?.(summary, event);
        }
      } catch {
        // ignore non-JSON lines in streaming status mode
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const result = new Promise((resolve) => {
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: `Failed to start command: ${error.message}`,
      });
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: code === 0,
        exitCode: code,
        signal: signal ?? null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });

  child.stdin.end(prompt);
  return { child, result };
}

function finalizeCliTurnResult(result, sessionRef) {
  const parsed = parseCodexJson(result.stdout);
  return {
    ...result,
    cliSessionRef: sessionRef || parsed.threadId,
    output: parsed.finalText || result.stdout,
  };
}

export async function runCliTurn(prompt, sessionRef, commandConfig) {
  const started = startCliTurn(prompt, sessionRef, commandConfig);
  const result = await started.result;
  return finalizeCliTurnResult(result, sessionRef);
}

export function startCliTurn(prompt, sessionRef, commandConfig) {
  const command = sessionRef
    ? commandConfig.resumeTemplate.replaceAll("__SESSION_ID__", sessionRef)
    : commandConfig.startCommand;
  const started = startShellCommand(prompt, command, commandConfig.cwd, {
    onStatus: commandConfig.onStatus,
  });
  return {
    child: started.child,
    result: started.result.then((result) => finalizeCliTurnResult(result, sessionRef)),
  };
}
