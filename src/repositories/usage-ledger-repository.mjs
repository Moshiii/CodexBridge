import { resolveBotHome } from "../config.mjs";
import { appendUsageEvent, listUsageEvents } from "../usage-ledger.mjs";

export async function appendUsageLedgerEvent(event, { botHome = resolveBotHome() } = {}) {
  return await appendUsageEvent(event, botHome);
}

export async function listUsageLedgerEvents(options = {}, { botHome = resolveBotHome() } = {}) {
  return await listUsageEvents({ ...options, botHome });
}
