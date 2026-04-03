import { ensureBotHome, getSchedulesStatePath, readJson, writeJson } from "./config.mjs";

function nowIso() {
  return new Date().toISOString();
}

function createState() {
  return {
    version: 1,
    schedules: [],
  };
}

function createScheduleId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 6);
  return `sched_${stamp}_${nonce}`;
}

export async function readSchedulesState() {
  await ensureBotHome();
  const state = await readJson(getSchedulesStatePath(), createState());
  if (!Array.isArray(state.schedules)) {
    state.schedules = [];
  }
  return state;
}

export async function writeSchedulesState(state) {
  await ensureBotHome();
  await writeJson(getSchedulesStatePath(), state);
}

export function createScheduleRecord({ chatId, objective, cron, timezone }) {
  const timestamp = nowIso();
  return {
    id: createScheduleId(),
    chatId: String(chatId),
    objective,
    cron,
    timezone,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastTriggeredAt: null,
    lastTriggeredKey: null,
    lastGoalId: null,
    lastError: null,
  };
}

export async function listSchedules({ chatId = null } = {}) {
  const state = await readSchedulesState();
  return state.schedules.filter((schedule) => chatId == null || String(schedule.chatId) === String(chatId));
}

export async function getScheduleById(scheduleId) {
  const state = await readSchedulesState();
  return state.schedules.find((schedule) => schedule.id === scheduleId) || null;
}

export async function upsertSchedule(nextSchedule) {
  const state = await readSchedulesState();
  const index = state.schedules.findIndex((schedule) => schedule.id === nextSchedule.id);
  nextSchedule.updatedAt = nowIso();
  if (index === -1) {
    state.schedules.push(nextSchedule);
  } else {
    state.schedules[index] = nextSchedule;
  }
  await writeSchedulesState(state);
  return nextSchedule;
}
