function renderHistory(history) {
  if (!Array.isArray(history) || !history.length) {
    return "[]";
  }
  return JSON.stringify(history.slice(-10), null, 2);
}

export function buildGoalTurnPrompt(goal) {
  const nextUserMessage = goal.nextUserMessage?.trim()
    ? goal.nextUserMessage.trim()
    : `Work toward this goal and respond with the next best progress update: ${goal.objective}`;

  return [
    "A supervisor goal is active for this conversation.",
    "Stay in the same conversation thread and continue moving the goal forward.",
    "Use the workspace when helpful, and reply normally to the user.",
    "Do not return JSON unless the user explicitly asks for it.",
    "",
    `Goal ID: ${goal.id}`,
    `Objective: ${goal.objective}`,
    `Iteration: ${goal.iteration + 1}`,
    "",
    "Recent goal history:",
    renderHistory(goal.history),
    "",
    "Send the following user message into the ongoing conversation:",
    nextUserMessage,
  ].join("\n");
}

export function buildGoalEvaluatorPrompt(goal, assistantReply) {
  return [
    "You are the supervisor for a CodexBridge goal running inside an existing conversation thread.",
    "Evaluate the assistant's latest normal-chat reply against the goal.",
    "Do not do the work yourself.",
    "If the goal is incomplete, produce exactly one short follow-up user message that should be sent into the same thread next.",
    "Return strict JSON only. No markdown fences.",
    "",
    `Goal ID: ${goal.id}`,
    `Objective: ${goal.objective}`,
    `Iteration: ${goal.iteration + 1}`,
    `Previous follow-up message: ${goal.nextUserMessage || ""}`,
    "",
    "Recent goal history:",
    renderHistory(goal.history),
    "",
    "Latest assistant reply:",
    assistantReply || "",
    "",
    "Return a JSON object with this shape:",
    "{",
    '  "verdict": "continue|complete|blocked|failed",',
    '  "summary": "short factual judgment",',
    '  "goal_delta": "what progress was actually made",',
    '  "next_user_message": "one short user-style follow-up message for the same conversation thread",',
    '  "user_message": "what the human should be shown now"',
    "}",
  ].join("\n");
}
