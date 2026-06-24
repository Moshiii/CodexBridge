import { getWorkspacePath, readCliState, readConfig, writeCliState } from "./config.mjs";
import { buildCommandConfig, startCliTurn } from "./codex-runner.mjs";
import { appendConversationLogEvent } from "./conversation-log.mjs";
import { UserInputError } from "./errors.mjs";
import { buildWorkspacePrompt } from "./workspace-context.mjs";
import { listWorkspaceFiles, summarizeWorkspaceChanges } from "./workspace-files.mjs";

function nowIso() {
  return new Date().toISOString();
}

function getRunKey(botId, sessionLabel) {
  return `${botId}:${sessionLabel}`;
}

function summarizeRun(run) {
  if (!run) {
    return {
      running: false,
      status: "idle",
      prompt: "",
      output: "",
      error: null,
      friendlyMessage: "No test has run yet. Click Run Quick Test to verify this bot.",
      sessionLabel: null,
      startedAt: null,
      finishedAt: null,
    };
  }
  const friendlyMessage = run.status === "running"
    ? "Running now. You can wait here; the output will update automatically."
    : run.status === "completed"
      ? "Quick test completed. This bot can run a CodexBridge turn from the web console."
      : run.status === "stopped"
        ? "The run was stopped before it finished. Start another quick test when ready."
        : run.status === "failed"
          ? "The run failed before CodexBridge returned a usable answer. Check the Runtime Log below, then verify Codex is installed and logged in on this host."
          : "No test has run yet. Click Run Quick Test to verify this bot.";
  return {
    running: run.status === "running",
    status: run.status,
    prompt: run.prompt,
    output: run.output,
    error: run.error,
    workspaceChanges: run.workspaceChanges || [],
    friendlyMessage,
    sessionLabel: run.sessionLabel,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

export function createWebChatService({ resolveBotHome, activeChatRuns = new Map() } = {}) {
  if (typeof resolveBotHome !== "function") {
    throw new TypeError("resolveBotHome is required.");
  }

  async function readChatStatus(botId, sessionLabel = null) {
    const botHome = await resolveBotHome(botId);
    const sessions = await readCliState(botHome);
    const label = sessionLabel || sessions.activeSessionLabel || "main";
    const run = activeChatRuns.get(getRunKey(botId, label));
    return {
      ...summarizeRun(run),
      sessionLabel: label,
      activeSessionLabel: sessions.activeSessionLabel,
    };
  }

  async function startBotChat(botId, { prompt, sessionLabel = null } = {}) {
    const nextPrompt = String(prompt || "").trim();
    if (!nextPrompt) {
      throw new UserInputError("Prompt is required.", { code: "prompt_required" });
    }
    const botHome = await resolveBotHome(botId);
    const config = await readConfig(botHome);
    const cliState = await readCliState(botHome);
    const label = sessionLabel || cliState.activeSessionLabel || "main";
    if (!cliState.sessions[label]) {
      const timestamp = nowIso();
      cliState.sessions[label] = {
        label,
        cliSessionRef: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
    cliState.activeSessionLabel = label;
    await writeCliState(cliState, botHome);

    const key = getRunKey(botId, label);
    const existing = activeChatRuns.get(key);
    if (existing?.status === "running") {
      throw new UserInputError(`Session ${label} is already running.`, {
        code: "session_already_running",
        statusCode: 409,
      });
    }

    const session = cliState.sessions[label];
    const workspaceBefore = await listWorkspaceFiles(botHome).catch(() => []);
    const commandConfig = {
      ...buildCommandConfig(config),
      cwd: getWorkspacePath(botHome),
    };
    const run = {
      botId,
      sessionLabel: label,
      prompt: nextPrompt,
      startedAt: nowIso(),
      finishedAt: null,
      status: "running",
      output: "",
      error: null,
      workspaceChanges: [],
      child: null,
    };
    activeChatRuns.set(key, run);
    await appendConversationLogEvent({
      userId: "local-web",
      channel: "web",
      chatType: "direct",
      chatId: botId,
      conversationId: label,
      direction: "input",
      content: nextPrompt,
      metadata: {
        sessionLabel: label,
      },
    }, botHome).catch(() => {});

    const started = startCliTurn(await buildWorkspacePrompt(nextPrompt, { botHome }), session.cliSessionRef, commandConfig);
    run.child = started.child;
    void started.result.then(async (result) => {
      const latestState = await readCliState(botHome);
      latestState.sessions[label] = {
        ...(latestState.sessions[label] ?? session),
        label,
        cliSessionRef: result.cliSessionRef || latestState.sessions[label]?.cliSessionRef || null,
        createdAt: latestState.sessions[label]?.createdAt || session.createdAt || nowIso(),
        updatedAt: nowIso(),
      };
      latestState.activeSessionLabel = label;
      await writeCliState(latestState, botHome);
      run.finishedAt = nowIso();
      run.child = null;
      const workspaceAfter = await listWorkspaceFiles(botHome).catch(() => []);
      run.workspaceChanges = summarizeWorkspaceChanges(workspaceBefore, workspaceAfter);
      if (result.ok) {
        run.status = "completed";
        run.output = result.output || "";
        await appendConversationLogEvent({
          userId: "local-web",
          channel: "web",
          chatType: "direct",
          chatId: botId,
          conversationId: label,
          direction: "output",
          content: run.output || "Done.",
          metadata: {
            sessionLabel: label,
            ok: true,
          },
        }, botHome).catch(() => {});
        return;
      }
      run.status = result.signal ? "stopped" : "failed";
      run.error = [result.output, result.stderr].filter(Boolean).join("\n\n") || "Chat run failed.";
      await appendConversationLogEvent({
        userId: "local-web",
        channel: "web",
        chatType: "direct",
        chatId: botId,
        conversationId: label,
        direction: "output",
        content: run.error,
        metadata: {
          sessionLabel: label,
          ok: false,
          stopped: Boolean(result.signal),
        },
      }, botHome).catch(() => {});
    }).catch((error) => {
      run.finishedAt = nowIso();
      run.child = null;
      run.status = "failed";
      run.error = error.message;
      void appendConversationLogEvent({
        userId: "local-web",
        channel: "web",
        chatType: "direct",
        chatId: botId,
        conversationId: label,
        direction: "output",
        content: run.error,
        metadata: {
          sessionLabel: label,
          ok: false,
        },
      }, botHome).catch(() => {});
    });

    return await readChatStatus(botId, label);
  }

  async function stopBotChat(botId, sessionLabel = null) {
    const status = await readChatStatus(botId, sessionLabel);
    const run = activeChatRuns.get(getRunKey(botId, status.sessionLabel));
    if (!run || run.status !== "running" || !run.child) {
      return status;
    }
    run.child.kill("SIGINT");
    return await readChatStatus(botId, status.sessionLabel);
  }

  return {
    activeChatRuns,
    readChatStatus,
    startBotChat,
    stopBotChat,
  };
}
