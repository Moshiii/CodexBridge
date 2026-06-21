import { resolveBotHome } from "./config.mjs";
import { listUsers } from "./repositories/users-repository.mjs";
import { listUsageLedgerEvents } from "./repositories/usage-ledger-repository.mjs";
import { listRuns } from "./repositories/runs-repository.mjs";

function createCounter(keys = []) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function increment(counter, key, amount = 1) {
  counter[key] = (counter[key] || 0) + amount;
}

function sumRunDurationMs(runs = []) {
  let total = 0;
  let count = 0;
  for (const run of runs) {
    const started = Date.parse(run.createdAt || "");
    const finished = Date.parse(run.finishedAt || run.updatedAt || "");
    if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
      continue;
    }
    total += finished - started;
    count += 1;
  }
  return { total, count };
}

export async function getBotMetrics({ botHome = resolveBotHome(), limit = 10000 } = {}) {
  const [users, usageEvents, runs] = await Promise.all([
    listUsers({ botHome }),
    listUsageLedgerEvents({ limit }, { botHome }),
    listRuns({ limit }, { botHome }),
  ]);
  const userStatusCounts = createCounter(["free", "paid", "banned", "admin"]);
  const runStatusCounts = createCounter(["queued", "running", "completed", "failed", "stopped", "denied"]);
  const usageEventCounts = createCounter(["grant", "charge", "refund", "adjustment", "deny"]);
  const creditTotals = {
    dailyFreeCharged: 0,
    paidCreditsCharged: 0,
    paidCreditsGranted: 0,
    paidCreditsAdjusted: 0,
    paidCreditsRefunded: 0,
    deniedAmount: 0,
  };
  const groupTrialUsers = new Set();
  const paidActiveUsers = new Set();

  for (const user of users) {
    increment(userStatusCounts, user.status || "free");
    if (user.status === "paid" || user.status === "admin" || user.privateEnabled) {
      paidActiveUsers.add(user.id);
    }
  }

  for (const event of usageEvents) {
    increment(usageEventCounts, event.eventType || "unknown");
    const amount = Number.isFinite(Number(event.amount)) ? Number(event.amount) : 0;
    if (event.eventType === "charge" && event.source === "daily_free") {
      creditTotals.dailyFreeCharged += amount;
      if (event.userId) {
        groupTrialUsers.add(event.userId);
      }
    } else if (event.eventType === "charge" && event.source === "paid_credit") {
      creditTotals.paidCreditsCharged += amount;
    } else if (event.eventType === "grant") {
      creditTotals.paidCreditsGranted += amount;
    } else if (event.eventType === "adjustment") {
      creditTotals.paidCreditsAdjusted += amount;
    } else if (event.eventType === "refund") {
      creditTotals.paidCreditsRefunded += amount;
    } else if (event.eventType === "deny") {
      creditTotals.deniedAmount += amount;
    }
  }

  for (const run of runs) {
    increment(runStatusCounts, run.status || "unknown");
  }

  const finishedRuns = runs.filter((run) => ["completed", "failed", "stopped", "denied"].includes(run.status));
  const duration = sumRunDurationMs(finishedRuns);
  const totalUsers = users.length;
  const paidUserCount = paidActiveUsers.size;
  return {
    ok: true,
    totals: {
      users: totalUsers,
      groupTrialUsers: groupTrialUsers.size,
      paidActiveUsers: paidUserCount,
      paidConversionRate: totalUsers > 0 ? paidUserCount / totalUsers : 0,
      runs: runs.length,
      finishedRuns: finishedRuns.length,
      averageRunLatencyMs: duration.count > 0 ? Math.round(duration.total / duration.count) : 0,
    },
    userStatusCounts,
    runStatusCounts,
    usageEventCounts,
    creditTotals,
  };
}
