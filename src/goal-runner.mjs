import { startCliTurn } from "./codex-runner.mjs";
import { buildWorkspacePrompt } from "./workspace-context.mjs";
import { buildGoalTurnPrompt, buildGoalEvaluatorPrompt } from "./goal-prompts.mjs";
import { appendGoalHistory } from "./goals-state.mjs";

const MAX_GOAL_ITERATIONS = 6;

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("Codex returned empty output.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Could not parse JSON result from Codex.");
}

function normalizeEvaluatorResult(parsed) {
  const verdict = typeof parsed.verdict === "string" ? parsed.verdict.trim().toLowerCase() : "";
  return {
    verdict: ["continue", "complete", "blocked", "failed"].includes(verdict) ? verdict : "failed",
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    goalDelta: typeof parsed.goal_delta === "string" ? parsed.goal_delta.trim() : "",
    nextUserMessage:
      typeof parsed.next_user_message === "string" ? parsed.next_user_message.trim() : "",
    userMessage: typeof parsed.user_message === "string" ? parsed.user_message.trim() : "",
  };
}

function createStoppedResult(goal) {
  goal.status = "stopped";
  goal.phase = "stopped";
  goal.lastSupervisorVerdict = "stopped";
  appendGoalHistory(goal, {
    role: "system",
    type: "stop",
    message: "Goal stopped by user.",
  });
  return {
    goal,
    status: "stopped",
    userMessage: `[${goal.id}] Stopped.`,
  };
}

function composeFinalGoalMessage(goal, evaluatorResult) {
  const parts = [];

  if (goal.lastAssistantReply) {
    parts.push(goal.lastAssistantReply);
  }

  if (evaluatorResult?.userMessage) {
    const normalized = evaluatorResult.userMessage.trim();
    if (!parts.length || normalized !== parts[0]) {
      parts.push(`Supervisor: ${normalized}`);
    }
  }

  if (!parts.length) {
    parts.push(`[${goal.id}] Completed.`);
  }

  return parts.join("\n\n");
}

export function startGoalRun(initialGoal, options) {
  const controller = {
    activeChild: null,
    stopRequested: false,
  };

  const result = (async () => {
    let goal = initialGoal;
    const {
      commandConfig,
      persistGoal,
      notify,
      onGoalStarted,
    } = options;

    onGoalStarted?.(goal, controller);

    goal.status = "running";
    goal.phase = "executor";
    appendGoalHistory(goal, {
      role: "system",
      type: "start",
      message: `Goal started in session ${goal.sessionLabel}: ${goal.objective}`,
    });
    await persistGoal(goal);
    await notify(`Goal started in session ${goal.sessionLabel}: ${goal.objective}`);

    for (let index = goal.iteration; index < MAX_GOAL_ITERATIONS; index += 1) {
      if (controller.stopRequested) {
        return createStoppedResult(goal);
      }

      goal.phase = "executor";
      goal.iteration = index;
      await persistGoal(goal);

      const turnPrompt = await buildWorkspacePrompt(buildGoalTurnPrompt(goal));
      const executorStarted = startCliTurn(turnPrompt, goal.conversationSessionRef, {
        ...commandConfig,
        onStatus: async (summary) => {
          await notify(`Executor: ${summary}`);
        },
      });
      controller.activeChild = executorStarted.child;
      const executorRaw = await executorStarted.result;
      controller.activeChild = null;

      if (controller.stopRequested) {
        return createStoppedResult(goal);
      }
      if (!executorRaw.ok) {
        goal.status = "failed";
        goal.phase = "executor_failed";
        goal.error = executorRaw.stderr || executorRaw.output || "Executor failed.";
        appendGoalHistory(goal, {
          role: "executor",
          type: "failure",
          message: goal.error,
        });
        await persistGoal(goal);
        return {
          goal,
          status: "failed",
          userMessage: `[${goal.id}] Executor failed.\n\n${goal.error}`,
        };
      }

      goal.conversationSessionRef = executorRaw.cliSessionRef || goal.conversationSessionRef;
      goal.lastAssistantReply = executorRaw.output?.trim() || "";
      goal.lastProgressSummary = goal.lastAssistantReply;
      appendGoalHistory(goal, {
        role: "executor",
        type: "assistant_reply",
        message: goal.lastAssistantReply,
      });
      await persistGoal(goal);
      if (goal.lastAssistantReply) {
        await notify(`Executor reply: ${goal.lastAssistantReply.slice(0, 240)}`);
      }

      goal.phase = "supervisor";
      await persistGoal(goal);
      const evaluatorPrompt = await buildWorkspacePrompt(buildGoalEvaluatorPrompt(goal, goal.lastAssistantReply));
      const evaluatorStarted = startCliTurn(evaluatorPrompt, goal.supervisorSessionRef, {
        ...commandConfig,
        onStatus: async (summary) => {
          await notify(`Supervisor: ${summary}`);
        },
      });
      controller.activeChild = evaluatorStarted.child;
      const evaluatorRaw = await evaluatorStarted.result;
      controller.activeChild = null;

      if (controller.stopRequested) {
        return createStoppedResult(goal);
      }
      if (!evaluatorRaw.ok) {
        goal.status = "failed";
        goal.phase = "supervisor_failed";
        goal.error = evaluatorRaw.stderr || evaluatorRaw.output || "Supervisor failed.";
        appendGoalHistory(goal, {
          role: "supervisor",
          type: "failure",
          message: goal.error,
        });
        await persistGoal(goal);
        return {
          goal,
          status: "failed",
          userMessage: `[${goal.id}] Supervisor failed.\n\n${goal.error}`,
        };
      }

      goal.supervisorSessionRef = evaluatorRaw.cliSessionRef || goal.supervisorSessionRef;
      const evaluatorParsed = normalizeEvaluatorResult(extractJson(evaluatorRaw.output));
      goal.lastSupervisorVerdict = evaluatorParsed.verdict;
      goal.lastGoalDelta = evaluatorParsed.goalDelta || null;
      goal.nextUserMessage = evaluatorParsed.nextUserMessage || null;
      appendGoalHistory(goal, {
        role: "supervisor",
        type: "verdict",
        verdict: evaluatorParsed.verdict,
        summary: evaluatorParsed.summary,
        goal_delta: evaluatorParsed.goalDelta,
        next_user_message: evaluatorParsed.nextUserMessage,
        user_message: evaluatorParsed.userMessage,
      });
      await persistGoal(goal);

      if (evaluatorParsed.summary) {
        await notify(`Supervisor: ${evaluatorParsed.summary}`);
      }

      if (evaluatorParsed.verdict === "blocked") {
        goal.status = "blocked";
        goal.phase = "blocked";
        await persistGoal(goal);
        return {
          goal,
          status: "blocked",
          userMessage:
            evaluatorParsed.userMessage ||
            `[${goal.id}] Blocked. More input is needed.`,
        };
      }

      if (evaluatorParsed.verdict === "complete") {
        goal.status = "completed";
        goal.phase = "completed";
        await persistGoal(goal);
        return {
          goal,
          status: "completed",
          userMessage: composeFinalGoalMessage(goal, evaluatorParsed),
        };
      }

      if (evaluatorParsed.verdict === "failed") {
        goal.status = "failed";
        goal.phase = "failed";
        goal.error = evaluatorParsed.summary || "Supervisor marked goal as failed.";
        await persistGoal(goal);
        return {
          goal,
          status: "failed",
          userMessage: `[${goal.id}] Failed.\n\n${goal.error}`,
        };
      }

      if (!evaluatorParsed.nextUserMessage) {
        goal.status = "blocked";
        goal.phase = "blocked";
        goal.error = "Supervisor did not provide a next user message.";
        await persistGoal(goal);
        return {
          goal,
          status: "blocked",
          userMessage: `[${goal.id}] Blocked because no follow-up message was produced.`,
        };
      }

      goal.iteration = index + 1;
      await persistGoal(goal);
    }

    goal.status = "blocked";
    goal.phase = "iteration_limit";
    goal.lastSupervisorVerdict = "blocked";
    appendGoalHistory(goal, {
      role: "system",
      type: "limit",
      message: "Iteration limit reached.",
    });
    await persistGoal(goal);
    return {
      goal,
      status: "blocked",
      userMessage: `[${goal.id}] Paused after reaching the iteration limit. Use /goal-resume ${goal.id} to continue.`,
    };
  })();

  return {
    controller,
    result,
  };
}
