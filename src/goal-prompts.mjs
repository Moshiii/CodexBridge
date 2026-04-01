function renderArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || !artifacts.length) {
    return "[]";
  }
  return JSON.stringify(artifacts, null, 2);
}

function renderHistory(history) {
  if (!Array.isArray(history) || !history.length) {
    return "[]";
  }
  return JSON.stringify(history.slice(-8), null, 2);
}

export function buildWorkerGoalPrompt(goal) {
  const nextInstruction = goal.nextWorkerInstruction
    ? `Next evaluator instruction:\n${goal.nextWorkerInstruction}\n`
    : "There is no prior evaluator instruction yet.\n";

  return [
    "You are the worker for an AutoAide /goal task.",
    "Advance the goal using the workspace when helpful.",
    "You may read and write files if that helps complete the goal.",
    "Do not explain your internal chain of thought.",
    "Return strict JSON only. No markdown fences.",
    "",
    `Goal ID: ${goal.id}`,
    `Objective: ${goal.objective}`,
    `Iteration: ${goal.iteration + 1}`,
    "",
    nextInstruction,
    `Known artifacts: ${renderArtifacts(goal.artifacts)}`,
    `Recent history: ${renderHistory(goal.history)}`,
    "",
    "Return a JSON object with this shape:",
    "{",
    '  "summary": "short factual summary of what you did",',
    '  "status_note": "short current status note for user-facing progress",',
    '  "artifacts": ["relative/path/if/you/wrote/files"],',
    '  "deliverable": "plain-language result or interim result for the user",',
    '  "needs_input": false,',
    '  "input_request": ""',
    "}",
  ].join("\n");
}

export function buildEvaluatorGoalPrompt(goal, workerResult) {
  return [
    "You are the evaluator for an AutoAide /goal task.",
    "Judge the worker output conservatively.",
    "Do not redo the work. Decide whether the goal should continue, complete, block, or fail.",
    "Return strict JSON only. No markdown fences.",
    "",
    `Goal ID: ${goal.id}`,
    `Objective: ${goal.objective}`,
    `Iteration: ${goal.iteration}`,
    `Known artifacts: ${renderArtifacts(goal.artifacts)}`,
    `Worker summary: ${workerResult.summary || ""}`,
    `Worker status note: ${workerResult.status_note || ""}`,
    `Worker deliverable: ${workerResult.deliverable || ""}`,
    `Worker requested input: ${workerResult.input_request || ""}`,
    "",
    "Return a JSON object with this shape:",
    "{",
    '  "verdict": "continue|complete|blocked|failed",',
    '  "summary": "short factual judgment",',
    '  "next_worker_instruction": "one short instruction for the next worker turn",',
    '  "user_message": "what the user should see now"',
    "}",
  ].join("\n");
}
