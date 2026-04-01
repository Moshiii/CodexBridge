import { startCliTurn } from "./codex-runner.mjs";
import { buildWorkspacePrompt } from "./workspace-context.mjs";
import { buildWorkerGoalPrompt, buildEvaluatorGoalPrompt } from "./goal-prompts.mjs";
import { appendGoalHistory } from "./goals-state.mjs";

const MAX_GOAL_ITERATIONS = 4;

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

function normalizeArtifacts(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeWorkerResult(parsed) {
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    status_note: typeof parsed.status_note === "string" ? parsed.status_note.trim() : "",
    artifacts: normalizeArtifacts(parsed.artifacts),
    deliverable: typeof parsed.deliverable === "string" ? parsed.deliverable.trim() : "",
    needs_input: Boolean(parsed.needs_input),
    input_request: typeof parsed.input_request === "string" ? parsed.input_request.trim() : "",
  };
}

function normalizeEvaluatorResult(parsed) {
  const verdict = typeof parsed.verdict === "string" ? parsed.verdict.trim().toLowerCase() : "";
  return {
    verdict: ["continue", "complete", "blocked", "failed"].includes(verdict) ? verdict : "failed",
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    next_worker_instruction:
      typeof parsed.next_worker_instruction === "string" ? parsed.next_worker_instruction.trim() : "",
    user_message: typeof parsed.user_message === "string" ? parsed.user_message.trim() : "",
  };
}

function mergeArtifacts(goal, newArtifacts) {
  goal.artifacts = Array.from(new Set([...(goal.artifacts || []), ...normalizeArtifacts(newArtifacts)]));
}

function composeFinalGoalMessage(workerResult, evaluatorResult, goal) {
  const parts = [];

  if (workerResult?.deliverable) {
    parts.push(workerResult.deliverable);
  }

  if (evaluatorResult?.user_message) {
    const normalized = evaluatorResult.user_message.trim();
    if (!parts.length || normalized !== parts[0]) {
      parts.push(`Evaluator: ${normalized}`);
    }
  }

  if (!parts.length) {
    parts.push(`[${goal.id}] Completed.`);
  }

  return parts.join("\n\n");
}

function createStoppedResult(goal) {
  goal.status = "stopped";
  goal.phase = "stopped";
  goal.lastEvaluatorVerdict = "stopped";
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
    goal.phase = "worker";
    appendGoalHistory(goal, {
      role: "system",
      type: "start",
      message: `Goal started: ${goal.objective}`,
    });
    await persistGoal(goal);
    await notify(`Goal started: ${goal.objective}`);

    for (let index = goal.iteration; index < MAX_GOAL_ITERATIONS; index += 1) {
      if (controller.stopRequested) {
        return createStoppedResult(goal);
      }

      goal.phase = "worker";
      goal.iteration = index;
      await persistGoal(goal);

      const workerPrompt = await buildWorkspacePrompt(buildWorkerGoalPrompt(goal));
      const workerStarted = startCliTurn(workerPrompt, goal.workerSessionRef, {
        ...commandConfig,
        onStatus: async (summary) => {
          await notify(`Worker: ${summary}`);
        },
      });
      controller.activeChild = workerStarted.child;
      const workerRaw = await workerStarted.result;
      controller.activeChild = null;

      if (controller.stopRequested) {
        return createStoppedResult(goal);
      }
      if (!workerRaw.ok) {
        goal.status = "failed";
        goal.phase = "worker_failed";
        goal.error = workerRaw.stderr || workerRaw.output || "Worker failed.";
        appendGoalHistory(goal, {
          role: "worker",
          type: "failure",
          message: goal.error,
        });
        await persistGoal(goal);
        return {
          goal,
          status: "failed",
          userMessage: `[${goal.id}] Worker failed.\n\n${goal.error}`,
        };
      }

      goal.workerSessionRef = workerRaw.cliSessionRef || goal.workerSessionRef;
      const workerParsed = normalizeWorkerResult(extractJson(workerRaw.output));
      goal.lastWorkerSummary = workerParsed.summary;
      goal.lastUserMessage = workerParsed.deliverable || workerParsed.status_note || null;
      mergeArtifacts(goal, workerParsed.artifacts);
      appendGoalHistory(goal, {
        role: "worker",
        type: "iteration",
        summary: workerParsed.summary,
        status_note: workerParsed.status_note,
        deliverable: workerParsed.deliverable,
        artifacts: workerParsed.artifacts,
      });
      await persistGoal(goal);
      if (workerParsed.status_note) {
        await notify(`Worker: ${workerParsed.status_note}`);
      }

      goal.phase = "evaluator";
      await persistGoal(goal);
      const evaluatorPrompt = await buildWorkspacePrompt(buildEvaluatorGoalPrompt(goal, workerParsed));
      const evaluatorStarted = startCliTurn(evaluatorPrompt, goal.evaluatorSessionRef, {
        ...commandConfig,
        onStatus: async (summary) => {
          await notify(`Evaluator: ${summary}`);
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
        goal.phase = "evaluator_failed";
        goal.error = evaluatorRaw.stderr || evaluatorRaw.output || "Evaluator failed.";
        appendGoalHistory(goal, {
          role: "evaluator",
          type: "failure",
          message: goal.error,
        });
        await persistGoal(goal);
        return {
          goal,
          status: "failed",
          userMessage: `[${goal.id}] Evaluator failed.\n\n${goal.error}`,
        };
      }

      goal.evaluatorSessionRef = evaluatorRaw.cliSessionRef || goal.evaluatorSessionRef;
      const evaluatorParsed = normalizeEvaluatorResult(extractJson(evaluatorRaw.output));
      goal.lastEvaluatorVerdict = evaluatorParsed.verdict;
      goal.nextWorkerInstruction = evaluatorParsed.next_worker_instruction || null;
      appendGoalHistory(goal, {
        role: "evaluator",
        type: "verdict",
        verdict: evaluatorParsed.verdict,
        summary: evaluatorParsed.summary,
        next_worker_instruction: evaluatorParsed.next_worker_instruction,
        user_message: evaluatorParsed.user_message,
      });
      await persistGoal(goal);

      if (evaluatorParsed.summary) {
        await notify(`Evaluator: ${evaluatorParsed.summary}`);
      }

      if (workerParsed.needs_input || evaluatorParsed.verdict === "blocked") {
        goal.status = "blocked";
        goal.phase = "blocked";
        await persistGoal(goal);
        return {
          goal,
          status: "blocked",
          userMessage:
            evaluatorParsed.user_message ||
            workerParsed.input_request ||
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
          userMessage: composeFinalGoalMessage(workerParsed, evaluatorParsed, goal),
        };
      }

      if (evaluatorParsed.verdict === "failed") {
        goal.status = "failed";
        goal.phase = "failed";
        goal.error = evaluatorParsed.summary || "Evaluator marked goal as failed.";
        await persistGoal(goal);
        return {
          goal,
          status: "failed",
          userMessage: `[${goal.id}] Failed.\n\n${goal.error}`,
        };
      }

      goal.iteration = index + 1;
      await persistGoal(goal);
    }

    goal.status = "blocked";
    goal.phase = "iteration_limit";
    goal.lastEvaluatorVerdict = "blocked";
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
