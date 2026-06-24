import http from "node:http";
import { URL } from "node:url";

import {
  canaryRollout,
  createBot,
  deleteBot,
  inspectBot,
  readBotLogs,
  restartBot,
  rollbackBot,
  rollingRestartBots,
  setActiveBot,
  setBotEnabled,
  startBot,
  stopBot,
  updateBotConfig,
} from "./bots.mjs";
import { readActiveBotId } from "./config.mjs";
import { hydrateTelegramMetadata } from "./telegram-metadata.mjs";
import { toPublicError } from "./errors.mjs";
import {
  adjustCredits,
  cleanupConversationLogs,
  getMetrics,
  grantCredits,
  listAdminAudit,
  listConversationLogs,
  listConversationReviews,
  listOperationsUsers,
  listRuns,
  listUsage,
  reviewConversationLog,
  runMigrations,
  updatePrivateEnabled,
  updateUserStatus,
} from "./control-plane-operations-service.mjs";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "./workspace-files.mjs";
import { createWebChatService } from "./web-chat-service.mjs";
import {
  applySafeConfigPatch,
  redactConfigSecrets,
  redactControlPlaneDetail,
} from "./control-plane-config-service.mjs";
import {
  startQuickTest,
} from "./control-plane-quick-test-service.mjs";
import {
  activateSession,
  createBotSchedule,
  createSession,
  listBotSchedules as listSchedulesForBotHome,
  readSessions,
  toggleBotSchedule,
} from "./control-plane-workflow-service.mjs";
import {
  listControlPlaneGoals,
  startControlPlaneGoal,
} from "./control-plane-goal-service.mjs";
import {
  allowTelegramAccessForControlPlane,
  pairTelegramForControlPlane,
} from "./control-plane-telegram-service.mjs";
import {
  installControlPlaneSkill,
  listControlPlaneSkills,
} from "./control-plane-skills-service.mjs";
import {
  getBotControlPlaneDetail as getBotControlPlaneDetailFromService,
  getControlPlaneSnapshot as getControlPlaneSnapshotFromService,
  readBridgeLogs,
} from "./control-plane-detail-service.mjs";
import { renderHtmlPage } from "./control-plane-page.mjs";
import {
  html,
  isWebRequestAuthorized,
  json,
  readJsonBody,
  unauthorized,
} from "./control-plane-http.mjs";

const activeGoalRuns = new Map();
const webChatService = createWebChatService({ resolveBotHome: getBotHome });

async function getBotHome(botId) {
  const detail = await inspectBot(botId);
  return detail.bot.homePath;
}

async function readBotSessions(botId) {
  const botHome = await getBotHome(botId);
  return await readSessions(botHome);
}

async function createBotSession(botId, label) {
  const botHome = await getBotHome(botId);
  return await createSession(botHome, label);
}

async function activateBotSession(botId, label) {
  const botHome = await getBotHome(botId);
  return await activateSession(botHome, label);
}

async function readChatStatus(botId, sessionLabel = null) {
  return await webChatService.readChatStatus(botId, sessionLabel);
}

async function startBotChat(botId, { prompt, sessionLabel = null } = {}) {
  return await webChatService.startBotChat(botId, { prompt, sessionLabel });
}

async function startQuickTestForBot(botId, options = {}) {
  return await startQuickTest({
    botId,
    mode: options.mode,
    getDetail: getBotControlPlaneDetail,
    startChat: startBotChat,
  });
}

async function stopBotChat(botId, sessionLabel = null) {
  const status = await readChatStatus(botId, sessionLabel);
  for (const active of activeGoalRuns.values()) {
    if (active?.botId === botId && active?.sessionLabel === status.sessionLabel) {
      active.controller.stopRequested = true;
      active.controller.activeChild?.kill("SIGINT");
      return await readChatStatus(botId, status.sessionLabel);
    }
  }
  return await webChatService.stopBotChat(botId, status.sessionLabel);
}

async function readWorkspaceFileForBot(botId, relativePath) {
  const botHome = await getBotHome(botId);
  return await readWorkspaceFile(botHome, relativePath);
}

async function writeWorkspaceFileForBot(botId, relativePath, content) {
  const botHome = await getBotHome(botId);
  return await writeWorkspaceFile(botHome, relativePath, content);
}

async function listBotSkills(botId) {
  const botHome = await getBotHome(botId);
  return await listControlPlaneSkills(botHome);
}

async function installSkillForBot(botId, sourcePath) {
  const botHome = await getBotHome(botId);
  return await installControlPlaneSkill(botHome, sourcePath);
}

async function pairTelegramForBot(botId, token) {
  return await pairTelegramForControlPlane(botId, token, {
    updateBotConfigFn: updateBotConfig,
    getDetailFn: getBotControlPlaneDetail,
  });
}

async function allowTelegramAccessForBot(botId, { accessType, id } = {}) {
  return await allowTelegramAccessForControlPlane(botId, { accessType, id }, {
    updateBotConfigFn: updateBotConfig,
    getDetailFn: getBotControlPlaneDetail,
  });
}

async function listBotGoals(botId) {
  const botHome = await getBotHome(botId);
  return await listControlPlaneGoals(botHome);
}

async function startGoalForBot(botId, { objective, sessionLabel = null } = {}) {
  const botHome = await getBotHome(botId);
  return await startControlPlaneGoal(botHome, botId, { objective, sessionLabel }, { activeGoalRuns });
}

async function listBotSchedules(botId) {
  const botHome = await getBotHome(botId);
  return await listSchedulesForBotHome(botHome);
}

async function createScheduleForBot(botId, { objective, cron, timezone } = {}) {
  const botHome = await getBotHome(botId);
  return await createBotSchedule(botHome, botId, { objective, cron, timezone });
}

async function toggleScheduleForBot(botId, scheduleId, enabled) {
  const botHome = await getBotHome(botId);
  return await toggleBotSchedule(botHome, scheduleId, enabled);
}

async function listBotUsers(botId) {
  const botHome = await getBotHome(botId);
  return await listOperationsUsers(botHome);
}

async function grantCreditsForBot(botId, userId, amount) {
  const botHome = await getBotHome(botId);
  return await grantCredits(botHome, userId, amount);
}

async function adjustCreditsForBot(botId, userId, amount, reason) {
  const botHome = await getBotHome(botId);
  return await adjustCredits(botHome, userId, amount, reason);
}

async function updateUserStatusForBot(botId, userId, status) {
  const botHome = await getBotHome(botId);
  return await updateUserStatus(botHome, userId, status);
}

async function updatePrivateEnabledForBot(botId, userId, privateEnabled) {
  const botHome = await getBotHome(botId);
  return await updatePrivateEnabled(botHome, userId, privateEnabled);
}

async function listUsageForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listUsage(botHome, options);
}

async function listRunsForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listRuns(botHome, options);
}

async function listAdminAuditForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listAdminAudit(botHome, options);
}

async function getMetricsForBot(botId) {
  const botHome = await getBotHome(botId);
  return await getMetrics(botHome);
}

async function runMigrationsForBot(botId) {
  const botHome = await getBotHome(botId);
  return await runMigrations(botHome);
}

async function listConversationLogsForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listConversationLogs(botHome, options);
}

async function listConversationReviewsForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await listConversationReviews(botHome, options);
}

async function cleanupConversationLogsForBot(botId, options = {}) {
  const botHome = await getBotHome(botId);
  return await cleanupConversationLogs(botHome, options);
}

async function reviewConversationLogForBot(botId, eventId, body = {}) {
  const botHome = await getBotHome(botId);
  return await reviewConversationLog(botHome, eventId, body);
}

export async function getControlPlaneSnapshot() {
  return await getControlPlaneSnapshotFromService();
}

export async function getBotControlPlaneDetail(botId) {
  return await getBotControlPlaneDetailFromService(botId);
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/current-bot") {
    return json(response, 200, { currentBotId: await readActiveBotId() });
  }

  if (request.method === "GET" && pathname === "/api/bots") {
    return json(response, 200, await getControlPlaneSnapshot());
  }

  if (request.method === "POST" && pathname === "/api/bots") {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await createBot({
        id: body.id,
        name: body.name,
        enabled: body.enabled === true,
      }),
    );
  }

  const botMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (request.method === "GET" && botMatch) {
    return json(response, 200, redactControlPlaneDetail(await getBotControlPlaneDetail(decodeURIComponent(botMatch[1]))));
  }

  const botDeleteMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (request.method === "DELETE" && botDeleteMatch) {
    const botId = decodeURIComponent(botDeleteMatch[1]);
    await deleteBot(botId);
    return json(response, 200, { botId, deleted: true });
  }

  const botUseMatch = pathname.match(/^\/api\/bots\/([^/]+)\/use$/);
  if (request.method === "POST" && botUseMatch) {
    const botId = decodeURIComponent(botUseMatch[1]);
    await setActiveBot(botId);
    return json(response, 200, { currentBotId: botId });
  }

  const botToggleMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(enable|disable)$/);
  if (request.method === "POST" && botToggleMatch) {
    const botId = decodeURIComponent(botToggleMatch[1]);
    const enabled = botToggleMatch[2] === "enable";
    return json(response, 200, await setBotEnabled(botId, enabled));
  }

  const botLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/logs$/);
  if (request.method === "GET" && botLogsMatch) {
    return json(response, 200, await readBotLogs(decodeURIComponent(botLogsMatch[1]), 200));
  }

  const botBridgeLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/bridge-logs$/);
  if (request.method === "GET" && botBridgeLogsMatch) {
    return json(response, 200, await readBridgeLogs(decodeURIComponent(botBridgeLogsMatch[1]), 200));
  }

  const botActionMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(start|stop|restart)$/);
  if (request.method === "POST" && botActionMatch) {
    const botId = decodeURIComponent(botActionMatch[1]);
    const action = botActionMatch[2];
    if (action === "start") {
      return json(response, 200, { botId, pid: await startBot(botId) });
    }
    if (action === "stop") {
      return json(response, 200, { botId, stopped: await stopBot(botId) });
    }
    return json(response, 200, { botId, pid: await restartBot(botId) });
  }

  const botConfigMatch = pathname.match(/^\/api\/bots\/([^/]+)\/config$/);
  if (request.method === "POST" && botConfigMatch) {
    const botId = decodeURIComponent(botConfigMatch[1]);
    const body = await readJsonBody(request);
    const currentConfig = (await inspectBot(botId)).config;
    await updateBotConfig(botId, () => applySafeConfigPatch(currentConfig, body));
    const persistedConfig = (await inspectBot(botId)).config;
    return json(response, 200, redactConfigSecrets(persistedConfig));
  }

  const botSessionsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/sessions$/);
  if (request.method === "GET" && botSessionsMatch) {
    return json(response, 200, await readBotSessions(decodeURIComponent(botSessionsMatch[1])));
  }
  if (request.method === "POST" && botSessionsMatch) {
    const botId = decodeURIComponent(botSessionsMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await createBotSession(botId, body.label));
  }

  const botSessionUseMatch = pathname.match(/^\/api\/bots\/([^/]+)\/sessions\/([^/]+)\/use$/);
  if (request.method === "POST" && botSessionUseMatch) {
    return json(
      response,
      200,
      await activateBotSession(decodeURIComponent(botSessionUseMatch[1]), decodeURIComponent(botSessionUseMatch[2])),
    );
  }

  const botChatMatch = pathname.match(/^\/api\/bots\/([^/]+)\/chat$/);
  if (request.method === "GET" && botChatMatch) {
    const botId = decodeURIComponent(botChatMatch[1]);
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await readChatStatus(botId, url.searchParams.get("sessionLabel")));
  }
  if (request.method === "POST" && botChatMatch) {
    const botId = decodeURIComponent(botChatMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await startBotChat(botId, body));
  }

  const botChatStopMatch = pathname.match(/^\/api\/bots\/([^/]+)\/chat\/stop$/);
  if (request.method === "POST" && botChatStopMatch) {
    const botId = decodeURIComponent(botChatStopMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await stopBotChat(botId, body.sessionLabel));
  }

  const botQuickTestMatch = pathname.match(/^\/api\/bots\/([^/]+)\/quick-test$/);
  if (request.method === "POST" && botQuickTestMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await startQuickTestForBot(decodeURIComponent(botQuickTestMatch[1]), { mode: body.mode }));
  }

  const botTelegramPairMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/pair$/);
  if (request.method === "POST" && botTelegramPairMatch) {
    const body = await readJsonBody(request);
    const payload = await pairTelegramForBot(decodeURIComponent(botTelegramPairMatch[1]), body.token);
    return json(response, 200, {
      ...payload,
      detail: redactControlPlaneDetail(payload.detail),
    });
  }

  const botTelegramAccessMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/access$/);
  if (request.method === "POST" && botTelegramAccessMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, redactControlPlaneDetail(await allowTelegramAccessForBot(
      decodeURIComponent(botTelegramAccessMatch[1]),
      body,
    )));
  }

  const botTelegramRefreshMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/refresh$/);
  if (request.method === "POST" && botTelegramRefreshMatch) {
    const botId = decodeURIComponent(botTelegramRefreshMatch[1]);
    const detail = await inspectBot(botId);
    await hydrateTelegramMetadata(detail.bot.homePath);
    return json(response, 200, redactControlPlaneDetail(await getBotControlPlaneDetail(botId)));
  }

  const botGoalsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/goals$/);
  if (request.method === "GET" && botGoalsMatch) {
    return json(response, 200, await listBotGoals(decodeURIComponent(botGoalsMatch[1])));
  }
  if (request.method === "POST" && botGoalsMatch) {
    const botId = decodeURIComponent(botGoalsMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await startGoalForBot(botId, body));
  }

  const botSchedulesMatch = pathname.match(/^\/api\/bots\/([^/]+)\/schedules$/);
  if (request.method === "GET" && botSchedulesMatch) {
    return json(response, 200, await listBotSchedules(decodeURIComponent(botSchedulesMatch[1])));
  }
  if (request.method === "POST" && botSchedulesMatch) {
    const botId = decodeURIComponent(botSchedulesMatch[1]);
    const body = await readJsonBody(request);
    return json(response, 200, await createScheduleForBot(botId, body));
  }

  const botScheduleToggleMatch = pathname.match(/^\/api\/bots\/([^/]+)\/schedules\/([^/]+)\/(enable|disable)$/);
  if (request.method === "POST" && botScheduleToggleMatch) {
    return json(
      response,
      200,
      await toggleScheduleForBot(
        decodeURIComponent(botScheduleToggleMatch[1]),
        decodeURIComponent(botScheduleToggleMatch[2]),
        botScheduleToggleMatch[3] === "enable",
      ),
    );
  }

  const botUsersMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users$/);
  if (request.method === "GET" && botUsersMatch) {
    return json(response, 200, await listBotUsers(decodeURIComponent(botUsersMatch[1])));
  }

  const botUserGrantMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/grant$/);
  if (request.method === "POST" && botUserGrantMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await grantCreditsForBot(
        decodeURIComponent(botUserGrantMatch[1]),
        decodeURIComponent(botUserGrantMatch[2]),
        body.amount,
      ),
    );
  }

  const botUserAdjustMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/adjust$/);
  if (request.method === "POST" && botUserAdjustMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await adjustCreditsForBot(
        decodeURIComponent(botUserAdjustMatch[1]),
        decodeURIComponent(botUserAdjustMatch[2]),
        body.amount,
        body.reason || "manual_adjustment",
      ),
    );
  }

  const botUserStatusMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/status$/);
  if (request.method === "POST" && botUserStatusMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await updateUserStatusForBot(
        decodeURIComponent(botUserStatusMatch[1]),
        decodeURIComponent(botUserStatusMatch[2]),
        body.status,
      ),
    );
  }

  const botUserPrivateMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/private$/);
  if (request.method === "POST" && botUserPrivateMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await updatePrivateEnabledForBot(
        decodeURIComponent(botUserPrivateMatch[1]),
        decodeURIComponent(botUserPrivateMatch[2]),
        body.privateEnabled === true,
      ),
    );
  }

  const botUsageMatch = pathname.match(/^\/api\/bots\/([^/]+)\/usage$/);
  if (request.method === "GET" && botUsageMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listUsageForBot(decodeURIComponent(botUsageMatch[1]), {
      userId: url.searchParams.get("userId"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botRunsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/runs$/);
  if (request.method === "GET" && botRunsMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listRunsForBot(decodeURIComponent(botRunsMatch[1]), {
      userId: url.searchParams.get("userId"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botAdminAuditMatch = pathname.match(/^\/api\/bots\/([^/]+)\/admin-audit$/);
  if (request.method === "GET" && botAdminAuditMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listAdminAuditForBot(decodeURIComponent(botAdminAuditMatch[1]), {
      userId: url.searchParams.get("userId"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botMetricsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/metrics$/);
  if (request.method === "GET" && botMetricsMatch) {
    return json(response, 200, await getMetricsForBot(decodeURIComponent(botMetricsMatch[1])));
  }

  const botMigrationsRunMatch = pathname.match(/^\/api\/bots\/([^/]+)\/migrations\/run$/);
  if (request.method === "POST" && botMigrationsRunMatch) {
    return json(response, 200, await runMigrationsForBot(decodeURIComponent(botMigrationsRunMatch[1])));
  }

  const botConversationLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-logs$/);
  if (request.method === "GET" && botConversationLogsMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listConversationLogsForBot(decodeURIComponent(botConversationLogsMatch[1]), {
      userId: url.searchParams.get("userId"),
      runId: url.searchParams.get("runId"),
      direction: url.searchParams.get("direction"),
      riskLabel: url.searchParams.get("riskLabel"),
      riskOnly: url.searchParams.get("riskOnly"),
      reviewStatus: url.searchParams.get("reviewStatus"),
      createdAfter: url.searchParams.get("createdAfter"),
      createdBefore: url.searchParams.get("createdBefore"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botConversationLogsCleanupMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-logs\/cleanup$/);
  if (request.method === "POST" && botConversationLogsCleanupMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await cleanupConversationLogsForBot(
      decodeURIComponent(botConversationLogsCleanupMatch[1]),
      body,
    ));
  }

  const botConversationReviewsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-reviews$/);
  if (request.method === "GET" && botConversationReviewsMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(response, 200, await listConversationReviewsForBot(decodeURIComponent(botConversationReviewsMatch[1]), {
      eventId: url.searchParams.get("eventId"),
      status: url.searchParams.get("status"),
      limit: url.searchParams.get("limit"),
    }));
  }

  const botConversationReviewMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-logs\/([^/]+)\/review$/);
  if (request.method === "POST" && botConversationReviewMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await reviewConversationLogForBot(
      decodeURIComponent(botConversationReviewMatch[1]),
      decodeURIComponent(botConversationReviewMatch[2]),
      body,
    ));
  }

  const botWorkspaceMatch = pathname.match(/^\/api\/bots\/([^/]+)\/workspace$/);
  if (request.method === "GET" && botWorkspaceMatch) {
    return json(response, 200, await listWorkspaceFiles(await getBotHome(decodeURIComponent(botWorkspaceMatch[1]))));
  }

  const botWorkspaceFileMatch = pathname.match(/^\/api\/bots\/([^/]+)\/workspace\/file$/);
  if (request.method === "GET" && botWorkspaceFileMatch) {
    const url = new URL(request.url || "/", "http://localhost");
    return json(
      response,
      200,
      await readWorkspaceFileForBot(decodeURIComponent(botWorkspaceFileMatch[1]), url.searchParams.get("path")),
    );
  }
  if (request.method === "POST" && botWorkspaceFileMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await writeWorkspaceFileForBot(decodeURIComponent(botWorkspaceFileMatch[1]), body.path, body.content),
    );
  }

  const botSkillsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/skills$/);
  if (request.method === "GET" && botSkillsMatch) {
    return json(response, 200, await listBotSkills(decodeURIComponent(botSkillsMatch[1])));
  }
  if (request.method === "POST" && botSkillsMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await installSkillForBot(decodeURIComponent(botSkillsMatch[1]), body.sourcePath));
  }

  if (request.method === "POST" && pathname === "/api/rollout/restart-all") {
    return json(response, 200, await rollingRestartBots());
  }

  if (request.method === "POST" && pathname === "/api/rollout/canary") {
    const body = await readJsonBody(request);
    return json(response, 200, await canaryRollout(body.botIds || [], body.desiredVersion || "v1"));
  }

  const rollbackMatch = pathname.match(/^\/api\/rollout\/rollback\/([^/]+)$/);
  if (request.method === "POST" && rollbackMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await rollbackBot(decodeURIComponent(rollbackMatch[1]), body.version || "v1"));
  }

  return false;
}

export async function startControlPlaneWebServer({ port = 8787, host = "127.0.0.1" } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      if (!isWebRequestAuthorized(request)) {
        unauthorized(response);
        return;
      }
      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      if (url.pathname === "/") {
        html(response, 200, renderHtmlPage());
        return;
      }
      const handled = await handleApi(request, response, url.pathname);
      if (handled === false) {
        json(response, 404, { error: "Not found" });
      }
    } catch (error) {
      const publicError = toPublicError(error);
      json(response, publicError.statusCode, publicError.payload);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    port: resolvedPort,
    host,
    close: async () => await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
