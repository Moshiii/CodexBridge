import { resolveBotHome } from "./config.mjs";
import { listUsers } from "./repositories/users-repository.mjs";
import { listUsageLedgerEvents } from "./repositories/usage-ledger-repository.mjs";
import { listRuns } from "./repositories/runs-repository.mjs";
import { listConversationLogEvents } from "./conversation-log.mjs";
import { listConversationReviewEvents } from "./conversation-review.mjs";

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

function buildGrowthSnapshot({ totalUsers, groupTrialUsers, paidUserCount, runStatusCounts, conversationTotals }) {
  const failedRuns = runStatusCounts.failed || 0;
  const riskyEvents = conversationTotals.riskyEvents || 0;
  if (totalUsers === 0) {
    return {
      status: "waiting_for_users",
      summary: "No users yet. Invite one test user or group after setup is ready.",
      nextStep: "Run Quick Test, invite one test user, then watch users, usage, and risk logs here.",
    };
  }
  if (groupTrialUsers === 0) {
    return {
      status: "waiting_for_group_trial",
      summary: `${totalUsers} user${totalUsers === 1 ? "" : "s"} seen, but no daily free group trial usage yet.`,
      nextStep: "Ask a user to try one public group question before selling private access.",
    };
  }
  if (failedRuns > 0) {
    return {
      status: "needs_runtime_attention",
      summary: `${groupTrialUsers} group trial user${groupTrialUsers === 1 ? "" : "s"} seen, with ${failedRuns} failed run${failedRuns === 1 ? "" : "s"}.`,
      nextStep: "Check Runtime Log before inviting more users.",
    };
  }
  if (riskyEvents > 0) {
    return {
      status: "needs_review",
      summary: `${groupTrialUsers} group trial user${groupTrialUsers === 1 ? "" : "s"} seen, with ${riskyEvents} risky conversation event${riskyEvents === 1 ? "" : "s"}.`,
      nextStep: "Review risky conversation logs before expanding the group.",
    };
  }
  return {
    status: paidUserCount > 0 ? "trial_converting" : "trial_running",
    summary: `${groupTrialUsers} group trial user${groupTrialUsers === 1 ? "" : "s"} seen; ${paidUserCount} paid/private user${paidUserCount === 1 ? "" : "s"}.`,
    nextStep: paidUserCount > 0
      ? "Keep monitoring paid credits, refunds, and risk logs while expanding slowly."
      : "If users are satisfied, grant paid credits or unlock private chat for the first buyer.",
  };
}

function buildConversionFunnel({ totalUsers, groupTrialUsers, paidUserCount, completedRuns, failedRuns }) {
  const rate = (value, denominator) => denominator > 0 ? value / denominator : 0;
  return [
    {
      id: "seen_users",
      label: "Users seen",
      value: totalUsers,
      rate: totalUsers > 0 ? 1 : 0,
      next: totalUsers > 0 ? "Users have reached CodexBridge." : "Invite one test user after setup is ready.",
    },
    {
      id: "group_trial",
      label: "Group trial users",
      value: groupTrialUsers,
      rate: rate(groupTrialUsers, totalUsers),
      next: groupTrialUsers > 0 ? "Group trial is active." : "Ask one user to try a public group question.",
    },
    {
      id: "paid_or_private",
      label: "Paid/private users",
      value: paidUserCount,
      rate: rate(paidUserCount, Math.max(groupTrialUsers, totalUsers)),
      next: paidUserCount > 0 ? "Paid/private conversion has started." : "Grant paid credits or unlock private chat for the first satisfied user.",
    },
    {
      id: "successful_runs",
      label: "Successful runs",
      value: completedRuns,
      rate: rate(completedRuns, completedRuns + failedRuns),
      next: completedRuns > 0 ? "Users have seen successful answers." : "Run Quick Test and resolve runtime issues before inviting more users.",
    },
  ];
}

export async function getBotMetrics({ botHome = resolveBotHome(), limit = 10000 } = {}) {
  const [users, usageEvents, runs, conversationEvents, reviewEvents] = await Promise.all([
    listUsers({ botHome }),
    listUsageLedgerEvents({ limit }, { botHome }),
    listRuns({ limit }, { botHome }),
    listConversationLogEvents({ limit, botHome }),
    listConversationReviewEvents({ limit, botHome }),
  ]);
  const userStatusCounts = createCounter(["free", "paid", "banned", "admin"]);
  const runStatusCounts = createCounter(["queued", "running", "completed", "failed", "stopped", "denied"]);
  const usageEventCounts = createCounter(["grant", "charge", "refund", "adjustment", "deny"]);
  const conversationDirectionCounts = createCounter(["input", "output", "system", "error"]);
  const policyActionCounts = createCounter(["allow", "review", "block", "unknown"]);
  const reviewStatusCounts = createCounter(["unreviewed", "confirmed_risk", "false_positive", "handled"]);
  const riskLabelCounts = {};
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
  const loggedUsers = new Set();
  const riskyUsers = new Map();
  let riskyEvents = 0;

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

  for (const event of conversationEvents) {
    increment(conversationDirectionCounts, event.direction || "unknown");
    const action = event.metadata?.policy?.action || "unknown";
    increment(policyActionCounts, action);
    if (event.userId) {
      loggedUsers.add(event.userId);
    }
    const labels = Array.isArray(event.riskLabels) ? event.riskLabels : [];
    if (labels.length > 0) {
      riskyEvents += 1;
      if (event.userId) {
        riskyUsers.set(event.userId, (riskyUsers.get(event.userId) || 0) + 1);
      }
    }
    for (const label of labels) {
      increment(riskLabelCounts, label);
    }
  }

  for (const event of reviewEvents) {
    increment(reviewStatusCounts, event.status || "unknown");
  }

  const finishedRuns = runs.filter((run) => ["completed", "failed", "stopped", "denied"].includes(run.status));
  const duration = sumRunDurationMs(finishedRuns);
  const totalUsers = users.length;
  const paidUserCount = paidActiveUsers.size;
  const completedRuns = runStatusCounts.completed || 0;
  const failedRuns = runStatusCounts.failed || 0;
  const conversationTotals = {
    events: conversationEvents.length,
    inputs: conversationDirectionCounts.input || 0,
    outputs: conversationDirectionCounts.output || 0,
    system: conversationDirectionCounts.system || 0,
    errors: conversationDirectionCounts.error || 0,
    riskyEvents,
    blockedEvents: policyActionCounts.block || 0,
    reviewedEvents: reviewEvents.length,
    uniqueLoggedUsers: loggedUsers.size,
  };
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
    growthSnapshot: buildGrowthSnapshot({
      totalUsers,
      groupTrialUsers: groupTrialUsers.size,
      paidUserCount,
      runStatusCounts,
      conversationTotals,
    }),
    conversionFunnel: buildConversionFunnel({
      totalUsers,
      groupTrialUsers: groupTrialUsers.size,
      paidUserCount,
      completedRuns,
      failedRuns,
    }),
    conversationTotals,
    userStatusCounts,
    runStatusCounts,
    usageEventCounts,
    conversationDirectionCounts,
    policyActionCounts,
    reviewStatusCounts,
    riskLabelCounts,
    topRiskUsers: Array.from(riskyUsers.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([userId, events]) => ({ userId, events })),
    creditTotals,
  };
}
