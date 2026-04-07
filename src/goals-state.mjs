import path from "node:path";
import { readdir } from "node:fs/promises";

import { getGoalsPath, readJson, writeJson, ensureBotHome } from "./config.mjs";

function nowIso() {
  return new Date().toISOString();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeGoalRecord(goal = {}) {
  if (!goal || typeof goal !== "object") {
    return goal;
  }

  const conversationSessionRef = goal.conversationSessionRef ?? goal.workerSessionRef ?? null;
  const supervisorSessionRef = goal.supervisorSessionRef ?? goal.evaluatorSessionRef ?? null;
  const lastGoalDelta = goal.lastGoalDelta ?? goal.nextWorkerInstruction ?? null;
  const lastSupervisorVerdict = goal.lastSupervisorVerdict ?? goal.lastEvaluatorVerdict ?? null;
  const conversationEvents = ensureArray(goal.conversationEvents).length
    ? ensureArray(goal.conversationEvents)
    : ensureArray(goal.workerEvents);
  const supervisorEvents = ensureArray(goal.supervisorEvents).length
    ? ensureArray(goal.supervisorEvents)
    : ensureArray(goal.evaluatorEvents);
  const conversationMessageId = goal.conversationMessageId ?? goal.workerMessageId ?? null;
  const supervisorMessageId = goal.supervisorMessageId ?? goal.evaluatorMessageId ?? null;
  const supervisorMessageIds = ensureArray(goal.supervisorMessageIds).length
    ? ensureArray(goal.supervisorMessageIds)
    : ensureArray(goal.evaluatorMessageIds);
  const lastProgressSummary = goal.lastProgressSummary ?? goal.lastWorkerSummary ?? goal.lastAssistantReply ?? null;

  return {
    ...goal,
    conversationSessionRef,
    supervisorSessionRef,
    lastProgressSummary,
    lastSupervisorVerdict,
    lastGoalDelta,
    nextUserMessage: goal.nextUserMessage ?? null,
    lastAssistantReply: goal.lastAssistantReply ?? null,
    conversationMessageId,
    supervisorMessageId,
    supervisorMessageIds,
    conversationEvents,
    supervisorEvents,
    workerSessionRef: conversationSessionRef,
    evaluatorSessionRef: supervisorSessionRef,
    lastWorkerSummary: lastProgressSummary,
    lastEvaluatorVerdict: lastSupervisorVerdict,
    nextWorkerInstruction: lastGoalDelta,
    workerMessageId: conversationMessageId,
    evaluatorMessageId: supervisorMessageId,
    evaluatorMessageIds: supervisorMessageIds,
    workerEvents: conversationEvents,
    evaluatorEvents: supervisorEvents,
  };
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
  return normalizeGoalRecord({
    id: createGoalId(),
    objective,
    status: "pending",
    phase: "created",
    channel,
    chatId: String(chatId),
    sessionLabel,
    conversationSessionRef: null,
    supervisorSessionRef: null,
    iteration: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastProgressSummary: null,
    lastAssistantReply: null,
    lastSupervisorVerdict: null,
    finalOutput: null,
    finalOutputAt: null,
    lastGoalDelta: null,
    nextUserMessage: null,
    lastUserMessage: null,
    error: null,
    artifacts: [],
    conversationMessageId: null,
    supervisorMessageId: null,
    supervisorMessageIds: [],
    finalMessageId: null,
    conversationEvents: [],
    supervisorEvents: [],
    history: [],
  });
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
  return normalizeGoalRecord(await readJson(goalFilePath(goalId), null));
}

export async function writeGoal(goal) {
  await ensureBotHome();
  const normalized = normalizeGoalRecord(goal);
  normalized.updatedAt = nowIso();
  await writeJson(goalFilePath(normalized.id), normalized);
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

  const normalizedGoals = goals.map((goal) => normalizeGoalRecord(goal)).filter(Boolean);
  const filtered = chatId == null
    ? normalizedGoals
    : normalizedGoals.filter((goal) => String(goal.chatId) === String(chatId));
  return filtered
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, limit);
}
