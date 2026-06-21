import { resolveBotHome } from "./config.mjs";
import { createRunRecord, getRunRecord, listRunRecords, updateRunRecord } from "./runs-state.mjs";

function trimPreview(value, maxLength = 500) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, Math.max(0, maxLength - 3)) + "...";
}

export async function createQueuedRun(record = {}, botHome = resolveBotHome()) {
  return await createRunRecord({
    ...record,
    status: "queued",
  }, botHome);
}

export async function markRunRunning(runId, patch = {}, botHome = resolveBotHome()) {
  return await updateRunRecord(runId, {
    ...patch,
    status: "running",
  }, botHome);
}

export async function markRunDenied(runId, reason = "denied", patch = {}, botHome = resolveBotHome()) {
  return await updateRunRecord(runId, {
    ...patch,
    status: "denied",
    reason,
  }, botHome);
}

export async function markRunCompleted(runId, patch = {}, botHome = resolveBotHome()) {
  return await updateRunRecord(runId, {
    ...patch,
    status: "completed",
    outputPreview: trimPreview(patch.outputPreview ?? patch.output),
  }, botHome);
}

export async function markRunFailed(runId, error, patch = {}, botHome = resolveBotHome()) {
  return await updateRunRecord(runId, {
    ...patch,
    status: "failed",
    error: String(error?.message || error || patch.error || "Unknown error."),
  }, botHome);
}

export async function markRunStopped(runId, reason = "stopped", patch = {}, botHome = resolveBotHome()) {
  return await updateRunRecord(runId, {
    ...patch,
    status: "stopped",
    reason,
  }, botHome);
}

export { getRunRecord, listRunRecords };
