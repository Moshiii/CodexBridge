import { readCliState, writeCliState } from "./config.mjs";
import { NotFoundError, UserInputError } from "./errors.mjs";
import { createScheduleRecord, getScheduleById, listSchedules, upsertSchedule } from "./schedules-state.mjs";

function nowIso() {
  return new Date().toISOString();
}

async function withBotHome(botHome, work) {
  const previousBotHome = process.env.BOT_HOME;
  process.env.BOT_HOME = botHome;
  try {
    return await work();
  } finally {
    if (previousBotHome == null) {
      delete process.env.BOT_HOME;
    } else {
      process.env.BOT_HOME = previousBotHome;
    }
  }
}

function normalizeSessionLabel(label) {
  const nextLabel = String(label || "").trim();
  if (!nextLabel) {
    throw new UserInputError("Session label is required.", { code: "session_label_required" });
  }
  return nextLabel;
}

export async function readSessions(botHome) {
  const cliState = await readCliState(botHome);
  const sessions = Object.values(cliState.sessions ?? {}).sort((a, b) => a.label.localeCompare(b.label));
  return {
    activeSessionLabel: cliState.activeSessionLabel,
    sessions,
  };
}

export async function createSession(botHome, label) {
  const nextLabel = normalizeSessionLabel(label);
  const cliState = await readCliState(botHome);
  if (!cliState.sessions[nextLabel]) {
    const timestamp = nowIso();
    cliState.sessions[nextLabel] = {
      label: nextLabel,
      cliSessionRef: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  cliState.activeSessionLabel = nextLabel;
  cliState.sessions[nextLabel].updatedAt = nowIso();
  await writeCliState(cliState, botHome);
  return await readSessions(botHome);
}

export async function activateSession(botHome, label) {
  const nextLabel = normalizeSessionLabel(label);
  const cliState = await readCliState(botHome);
  if (!cliState.sessions[nextLabel]) {
    throw new NotFoundError(`Unknown session: ${nextLabel}`, { code: "session_not_found" });
  }
  cliState.activeSessionLabel = nextLabel;
  cliState.sessions[nextLabel].updatedAt = nowIso();
  await writeCliState(cliState, botHome);
  return await readSessions(botHome);
}

export async function listBotSchedules(botHome) {
  return await withBotHome(botHome, async () => await listSchedules());
}

export async function createBotSchedule(botHome, botId, { objective, cron, timezone } = {}) {
  const nextObjective = String(objective || "").trim();
  const nextCron = String(cron || "").trim();
  const nextTimezone = String(timezone || "").trim() || "Asia/Shanghai";
  if (!nextObjective || !nextCron) {
    throw new UserInputError("Schedule objective and cron are required.", {
      code: "schedule_objective_and_cron_required",
    });
  }
  return await withBotHome(botHome, async () => {
    const schedule = createScheduleRecord({
      chatId: botId,
      objective: nextObjective,
      cron: nextCron,
      timezone: nextTimezone,
    });
    return await upsertSchedule(schedule);
  });
}

export async function toggleBotSchedule(botHome, scheduleId, enabled) {
  return await withBotHome(botHome, async () => {
    const schedule = await getScheduleById(scheduleId);
    if (!schedule) {
      throw new NotFoundError(`Unknown schedule: ${scheduleId}`, { code: "schedule_not_found" });
    }
    schedule.enabled = enabled;
    schedule.updatedAt = nowIso();
    return await upsertSchedule(schedule);
  });
}
