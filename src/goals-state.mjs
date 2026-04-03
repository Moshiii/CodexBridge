import path from "node:path";
import { readdir } from "node:fs/promises";

import { getGoalsPath, readJson, writeJson, ensureBotHome } from "./config.mjs";

function nowIso() {
  return new Date().toISOString();
}

export function goalFilePath(goalId) {
  return path.join(getGoalsPath(), `${goalId}.json`);
}

export function createGoalId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 6);
  return `goal_${stamp}_${nonce}`;
}

export function createGoalRecord({ objective, chatId, sessionLabel, channel = "telegram" }) {
  const timestamp = nowIso();
  return {
    id: createGoalId(),
    objective,
    status: "pending",
    phase: "created",
    channel,
    chatId: String(chatId),
    sessionLabel,
    workerSessionRef: null,
    evaluatorSessionRef: null,
    iteration: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastWorkerSummary: null,
    lastEvaluatorVerdict: null,
    finalOutput: null,
    finalOutputAt: null,
    nextWorkerInstruction: null,
    lastUserMessage: null,
    error: null,
    artifacts: [],
    workerMessageId: null,
    evaluatorMessageId: null,
    evaluatorMessageIds: [],
    finalMessageId: null,
    workerEvents: [],
    evaluatorEvents: [],
    history: [],
  };
}

export function appendGoalHistory(goal, entry) {
  const nextEntry = {
    at: nowIso(),
    ...entry,
  };
  goal.history = [...(goal.history || []), nextEntry].slice(-40);
  goal.updatedAt = nextEntry.at;
  return goal;
}

export async function readGoal(goalId) {
  await ensureBotHome();
  return await readJson(goalFilePath(goalId), null);
}

export async function writeGoal(goal) {
  await ensureBotHome();
  goal.updatedAt = nowIso();
  await writeJson(goalFilePath(goal.id), goal);
}

export async function listGoals({ chatId = null, limit = 20 } = {}) {
  await ensureBotHome();
  const goalsPath = getGoalsPath();
  let names = [];
  try {
    names = await readdir(goalsPath);
  } catch {
    return [];
  }

  const goals = (
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => await readJson(path.join(goalsPath, name), null)),
    )
  ).filter(Boolean);

  const filtered = chatId == null ? goals : goals.filter((goal) => String(goal.chatId) === String(chatId));
  return filtered
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, limit);
}
