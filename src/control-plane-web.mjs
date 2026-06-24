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
import {
  decodeRouteParam,
  pickRequestSearchParams,
} from "./control-plane-api-utils.mjs";

export { isWebRequestAuthorized } from "./control-plane-http.mjs";

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
    return json(response, 200, redactControlPlaneDetail(await getBotControlPlaneDetail(decodeRouteParam(botMatch))));
  }

  const botDeleteMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (request.method === "DELETE" && botDeleteMatch) {
    const botId = decodeRouteParam(botDeleteMatch);
    await deleteBot(botId);
    return json(response, 200, { botId, deleted: true });
  }

  const botUseMatch = pathname.match(/^\/api\/bots\/([^/]+)\/use$/);
  if (request.method === "POST" && botUseMatch) {
    const botId = decodeRouteParam(botUseMatch);
    await setActiveBot(botId);
    return json(response, 200, { currentBotId: botId });
  }

  const botToggleMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(enable|disable)$/);
  if (request.method === "POST" && botToggleMatch) {
    const botId = decodeRouteParam(botToggleMatch);
    const enabled = botToggleMatch[2] === "enable";
    return json(response, 200, await setBotEnabled(botId, enabled));
  }

  const botLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/logs$/);
  if (request.method === "GET" && botLogsMatch) {
    return json(response, 200, await readBotLogs(decodeRouteParam(botLogsMatch), 200));
  }

  const botBridgeLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/bridge-logs$/);
  if (request.method === "GET" && botBridgeLogsMatch) {
    return json(response, 200, await readBridgeLogs(decodeRouteParam(botBridgeLogsMatch), 200));
  }

  const botActionMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(start|stop|restart)$/);
  if (request.method === "POST" && botActionMatch) {
    const botId = decodeRouteParam(botActionMatch);
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
    const botId = decodeRouteParam(botConfigMatch);
    const body = await readJsonBody(request);
    const currentConfig = (await inspectBot(botId)).config;
    await updateBotConfig(botId, () => applySafeConfigPatch(currentConfig, body));
    const persistedConfig = (await inspectBot(botId)).config;
    return json(response, 200, redactConfigSecrets(persistedConfig));
  }

  const botSessionsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/sessions$/);
  if (request.method === "GET" && botSessionsMatch) {
    return json(response, 200, await readBotSessions(decodeRouteParam(botSessionsMatch)));
  }
  if (request.method === "POST" && botSessionsMatch) {
    const botId = decodeRouteParam(botSessionsMatch);
    const body = await readJsonBody(request);
    return json(response, 200, await createBotSession(botId, body.label));
  }

  const botSessionUseMatch = pathname.match(/^\/api\/bots\/([^/]+)\/sessions\/([^/]+)\/use$/);
  if (request.method === "POST" && botSessionUseMatch) {
    return json(
      response,
      200,
      await activateBotSession(decodeRouteParam(botSessionUseMatch), decodeRouteParam(botSessionUseMatch, 2)),
    );
  }

  const botChatMatch = pathname.match(/^\/api\/bots\/([^/]+)\/chat$/);
  if (request.method === "GET" && botChatMatch) {
    const botId = decodeRouteParam(botChatMatch);
    const query = pickRequestSearchParams(request, ["sessionLabel"]);
    return json(response, 200, await readChatStatus(botId, query.sessionLabel));
  }
  if (request.method === "POST" && botChatMatch) {
    const botId = decodeRouteParam(botChatMatch);
    const body = await readJsonBody(request);
    return json(response, 200, await startBotChat(botId, body));
  }

  const botChatStopMatch = pathname.match(/^\/api\/bots\/([^/]+)\/chat\/stop$/);
  if (request.method === "POST" && botChatStopMatch) {
    const botId = decodeRouteParam(botChatStopMatch);
    const body = await readJsonBody(request);
    return json(response, 200, await stopBotChat(botId, body.sessionLabel));
  }

  const botQuickTestMatch = pathname.match(/^\/api\/bots\/([^/]+)\/quick-test$/);
  if (request.method === "POST" && botQuickTestMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await startQuickTestForBot(decodeRouteParam(botQuickTestMatch), { mode: body.mode }));
  }

  const botTelegramPairMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/pair$/);
  if (request.method === "POST" && botTelegramPairMatch) {
    const body = await readJsonBody(request);
    const payload = await pairTelegramForBot(decodeRouteParam(botTelegramPairMatch), body.token);
    return json(response, 200, {
      ...payload,
      detail: redactControlPlaneDetail(payload.detail),
    });
  }

  const botTelegramAccessMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/access$/);
  if (request.method === "POST" && botTelegramAccessMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, redactControlPlaneDetail(await allowTelegramAccessForBot(
      decodeRouteParam(botTelegramAccessMatch),
      body,
    )));
  }

  const botTelegramRefreshMatch = pathname.match(/^\/api\/bots\/([^/]+)\/telegram\/refresh$/);
  if (request.method === "POST" && botTelegramRefreshMatch) {
    const botId = decodeRouteParam(botTelegramRefreshMatch);
    const detail = await inspectBot(botId);
    await hydrateTelegramMetadata(detail.bot.homePath);
    return json(response, 200, redactControlPlaneDetail(await getBotControlPlaneDetail(botId)));
  }

  const botGoalsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/goals$/);
  if (request.method === "GET" && botGoalsMatch) {
    return json(response, 200, await listBotGoals(decodeRouteParam(botGoalsMatch)));
  }
  if (request.method === "POST" && botGoalsMatch) {
    const botId = decodeRouteParam(botGoalsMatch);
    const body = await readJsonBody(request);
    return json(response, 200, await startGoalForBot(botId, body));
  }

  const botSchedulesMatch = pathname.match(/^\/api\/bots\/([^/]+)\/schedules$/);
  if (request.method === "GET" && botSchedulesMatch) {
    return json(response, 200, await listBotSchedules(decodeRouteParam(botSchedulesMatch)));
  }
  if (request.method === "POST" && botSchedulesMatch) {
    const botId = decodeRouteParam(botSchedulesMatch);
    const body = await readJsonBody(request);
    return json(response, 200, await createScheduleForBot(botId, body));
  }

  const botScheduleToggleMatch = pathname.match(/^\/api\/bots\/([^/]+)\/schedules\/([^/]+)\/(enable|disable)$/);
  if (request.method === "POST" && botScheduleToggleMatch) {
    return json(
      response,
      200,
      await toggleScheduleForBot(
        decodeRouteParam(botScheduleToggleMatch),
        decodeRouteParam(botScheduleToggleMatch, 2),
        botScheduleToggleMatch[3] === "enable",
      ),
    );
  }

  const botUsersMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users$/);
  if (request.method === "GET" && botUsersMatch) {
    return json(response, 200, await listBotUsers(decodeRouteParam(botUsersMatch)));
  }

  const botUserGrantMatch = pathname.match(/^\/api\/bots\/([^/]+)\/users\/([^/]+)\/grant$/);
  if (request.method === "POST" && botUserGrantMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await grantCreditsForBot(
        decodeRouteParam(botUserGrantMatch),
        decodeRouteParam(botUserGrantMatch, 2),
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
        decodeRouteParam(botUserAdjustMatch),
        decodeRouteParam(botUserAdjustMatch, 2),
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
        decodeRouteParam(botUserStatusMatch),
        decodeRouteParam(botUserStatusMatch, 2),
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
        decodeRouteParam(botUserPrivateMatch),
        decodeRouteParam(botUserPrivateMatch, 2),
        body.privateEnabled === true,
      ),
    );
  }

  const botUsageMatch = pathname.match(/^\/api\/bots\/([^/]+)\/usage$/);
  if (request.method === "GET" && botUsageMatch) {
    return json(response, 200, await listUsageForBot(decodeRouteParam(botUsageMatch), {
      ...pickRequestSearchParams(request, ["userId", "limit"]),
    }));
  }

  const botRunsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/runs$/);
  if (request.method === "GET" && botRunsMatch) {
    return json(response, 200, await listRunsForBot(decodeRouteParam(botRunsMatch), {
      ...pickRequestSearchParams(request, ["userId", "limit"]),
    }));
  }

  const botAdminAuditMatch = pathname.match(/^\/api\/bots\/([^/]+)\/admin-audit$/);
  if (request.method === "GET" && botAdminAuditMatch) {
    return json(response, 200, await listAdminAuditForBot(decodeRouteParam(botAdminAuditMatch), {
      ...pickRequestSearchParams(request, ["userId", "limit"]),
    }));
  }

  const botMetricsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/metrics$/);
  if (request.method === "GET" && botMetricsMatch) {
    return json(response, 200, await getMetricsForBot(decodeRouteParam(botMetricsMatch)));
  }

  const botMigrationsRunMatch = pathname.match(/^\/api\/bots\/([^/]+)\/migrations\/run$/);
  if (request.method === "POST" && botMigrationsRunMatch) {
    return json(response, 200, await runMigrationsForBot(decodeRouteParam(botMigrationsRunMatch)));
  }

  const botConversationLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-logs$/);
  if (request.method === "GET" && botConversationLogsMatch) {
    return json(response, 200, await listConversationLogsForBot(decodeRouteParam(botConversationLogsMatch), {
      ...pickRequestSearchParams(request, [
        "userId",
        "runId",
        "direction",
        "riskLabel",
        "riskOnly",
        "reviewStatus",
        "createdAfter",
        "createdBefore",
        "limit",
      ]),
    }));
  }

  const botConversationLogsCleanupMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-logs\/cleanup$/);
  if (request.method === "POST" && botConversationLogsCleanupMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await cleanupConversationLogsForBot(
      decodeRouteParam(botConversationLogsCleanupMatch),
      body,
    ));
  }

  const botConversationReviewsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-reviews$/);
  if (request.method === "GET" && botConversationReviewsMatch) {
    return json(response, 200, await listConversationReviewsForBot(decodeRouteParam(botConversationReviewsMatch), {
      ...pickRequestSearchParams(request, ["eventId", "status", "limit"]),
    }));
  }

  const botConversationReviewMatch = pathname.match(/^\/api\/bots\/([^/]+)\/conversation-logs\/([^/]+)\/review$/);
  if (request.method === "POST" && botConversationReviewMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await reviewConversationLogForBot(
      decodeRouteParam(botConversationReviewMatch),
      decodeRouteParam(botConversationReviewMatch, 2),
      body,
    ));
  }

  const botWorkspaceMatch = pathname.match(/^\/api\/bots\/([^/]+)\/workspace$/);
  if (request.method === "GET" && botWorkspaceMatch) {
    return json(response, 200, await listWorkspaceFiles(await getBotHome(decodeRouteParam(botWorkspaceMatch))));
  }

  const botWorkspaceFileMatch = pathname.match(/^\/api\/bots\/([^/]+)\/workspace\/file$/);
  if (request.method === "GET" && botWorkspaceFileMatch) {
    return json(
      response,
      200,
      await readWorkspaceFileForBot(
        decodeRouteParam(botWorkspaceFileMatch),
        pickRequestSearchParams(request, ["path"]).path,
      ),
    );
  }
  if (request.method === "POST" && botWorkspaceFileMatch) {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await writeWorkspaceFileForBot(decodeRouteParam(botWorkspaceFileMatch), body.path, body.content),
    );
  }

  const botSkillsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/skills$/);
  if (request.method === "GET" && botSkillsMatch) {
    return json(response, 200, await listBotSkills(decodeRouteParam(botSkillsMatch)));
  }
  if (request.method === "POST" && botSkillsMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await installSkillForBot(decodeRouteParam(botSkillsMatch), body.sourcePath));
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
    return json(response, 200, await rollbackBot(decodeRouteParam(rollbackMatch), body.version || "v1"));
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
