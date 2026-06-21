import { resolveBotHome } from "../config.mjs";
import { createRunRecord, getRunRecord, listRunRecords, updateRunRecord } from "../runs-state.mjs";

export async function createRun(record = {}, { botHome = resolveBotHome() } = {}) {
  return await createRunRecord(record, botHome);
}

export async function updateRun(runId, patch = {}, { botHome = resolveBotHome() } = {}) {
  return await updateRunRecord(runId, patch, botHome);
}

export async function findRun(runId, { botHome = resolveBotHome() } = {}) {
  return await getRunRecord(runId, botHome);
}

export async function listRuns(options = {}, { botHome = resolveBotHome() } = {}) {
  return await listRunRecords({ ...options, botHome });
}
