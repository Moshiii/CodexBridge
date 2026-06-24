import { listRunRecords } from "./runs-state.mjs";

export function buildStorageReadiness(config = {}, migrationStatus = {}) {
  const provider = config.storage?.provider || "json";
  const pending = migrationStatus.pending || [];
  const adapterReady = provider === "json";
  const status = pending.length > 0
    ? "migration_needed"
    : adapterReady
      ? "ready"
      : "provider_not_available";
  return {
    provider,
    adapterReady,
    status,
    ready: status === "ready",
    schemaVersion: migrationStatus.schemaVersion ?? null,
    currentSchemaVersion: migrationStatus.currentSchemaVersion ?? null,
    pending,
    next: status === "migration_needed"
      ? "Run migrations before inviting more users."
      : status === "provider_not_available"
        ? "Switch back to json or finish the SQLite repository adapter before inviting users."
        : "Storage is ready for this version.",
  };
}

export async function buildSetupGuide(detail, health, access) {
  const config = detail.config || {};
  const telegram = config.channels?.telegram || {};
  const feishu = config.channels?.feishu || {};
  const feishuSetup = feishu.setup || {};
  const feishuTestAudience = feishu.testAudience || {};
  const runs = await listRunRecords({ limit: 1, botHome: detail.bot.homePath }).catch(() => []);
  const hasTelegramToken = Boolean(telegram.botToken);
  const hasTelegramIdentity = Boolean(telegram.botUsername || telegram.metadata?.bot?.username);
  const hasTelegramAudience = Boolean(
    access.privateChats.length ||
    access.groupChats.length ||
    access.groupUsers.length,
  );
  const missingFeishuSetupChecks = [
    ["Bot capability", feishuSetup.botCapabilityEnabled],
    ["im.message.receive_v1 event", feishuSetup.messageEventSubscribed],
    ["Tenant install/publish", feishuSetup.tenantInstalled],
    ["User visibility", feishuSetup.visibilityConfirmed],
    ["Test group ready", feishuSetup.testGroupReady],
  ].filter(([, ready]) => !ready).map(([label]) => label);
  const feishuHasCredentials = Boolean(feishu.appId && feishu.appSecret);
  const hasFeishuTestAudience = Boolean((feishuTestAudience.userIds || []).length || (feishuTestAudience.chatIds || []).length);
  const feishuReady = Boolean(feishu.enabled && feishuHasCredentials && missingFeishuSetupChecks.length === 0);
  const channelReady = Boolean((telegram.enabled && hasTelegramToken) || feishuReady);
  const hasAnyAudience = Boolean(hasTelegramAudience || (feishuReady && hasFeishuTestAudience));
  const channelTargetTab = telegram.enabled ? "telegram" : feishu.enabled ? "feishu" : "telegram";
  const channelHint = telegram.enabled
    ? hasTelegramToken
      ? "Telegram token is saved. Confirm the bot username next."
      : "Paste the BotFather token in Telegram Quick Settings."
    : feishu.enabled
      ? feishuHasCredentials
        ? missingFeishuSetupChecks.length > 0
          ? `Feishu credentials are saved. Check: ${missingFeishuSetupChecks.join(", ")}.`
          : "Feishu credentials and setup checklist are complete."
        : "Fill Feishu App ID and App Secret in Feishu Quick Settings."
      : "Choose Telegram or Feishu, then save the channel credentials.";
  const identityHint = telegram.enabled
    ? hasTelegramIdentity
      ? "Telegram bot identity is known."
      : "Set Bot Username in Telegram Quick Settings or use Pair / Re-pair."
    : feishu.enabled
      ? feishuHasCredentials
        ? "Feishu app credentials identify the bot; keep mention names aligned with the app display name."
        : "Finish Feishu App ID and App Secret first."
      : "Connect a channel before confirming identity.";
  const audienceHint = telegram.enabled
    ? hasTelegramAudience
      ? "At least one Telegram private chat, group chat, or group user is allowed."
      : "Use Telegram Known Chats / Known Users to allow a private chat, group, or group user."
    : feishu.enabled
      ? hasFeishuTestAudience
        ? "Feishu test audience is recorded. Send /start in the test group or direct chat."
        : "Paste one Feishu open_id or chat_id in Test Audience before inviting real users."
      : "Connect a channel before adding an audience.";
  const steps = [
    {
      id: "configure_channel",
      label: "Connect an IM channel",
      status: channelReady ? "done" : "todo",
      action: "Add Telegram or Feishu credentials in Quick Settings.",
      hint: channelHint,
      targetTab: channelTargetTab,
    },
    {
      id: "pair_identity",
      label: "Confirm bot identity",
      status: hasTelegramIdentity || feishuReady ? "done" : "todo",
      action: "Confirm the bot name users will mention or message.",
      hint: identityHint,
      targetTab: telegram.enabled ? "telegram" : feishu.enabled ? "feishu" : "telegram",
    },
    {
      id: "allow_audience",
      label: "Allow a test group or user",
      status: hasAnyAudience ? "done" : "todo",
      action: "Allow one test audience before inviting real users.",
      hint: audienceHint,
      targetTab: telegram.enabled ? "telegram" : feishu.enabled ? "feishu" : "telegram",
    },
    {
      id: "start_runtime",
      label: "Start the bridge runtime",
      status: health.healthy ? "done" : "todo",
      action: "Click Start in the top toolbar.",
      hint: "Start the bot runtime after saving channel settings. If it fails, check Runtime Log.",
      targetTab: "overview",
    },
    {
      id: "send_first_message",
      label: "Send one test message",
      status: runs.length > 0 ? "done" : "todo",
      action: "Use Chat or send a message from the connected IM group.",
      hint: "Run Quick Test from Overview first; then invite a real user into the IM channel.",
      targetTab: "chat",
    },
  ];
  const completed = steps.filter((step) => step.status === "done").length;
  return {
    ready: completed === steps.length,
    completed,
    total: steps.length,
    nextStep: steps.find((step) => step.status !== "done") || null,
    steps,
  };
}

export function buildQuickTestPreflight(setupGuide) {
  const missing = (setupGuide?.steps || [])
    .filter((step) => step.status !== "done" && step.id !== "send_first_message");
  if (missing.length === 0) {
    return {
      readyForIm: true,
      message: "Quick test can run now. IM setup also looks ready.",
      missingSteps: [],
    };
  }
  return {
    readyForIm: false,
    message: `Quick test can still verify local Codex. Before inviting users, finish: ${missing.map((step) => `${step.label}: ${step.hint || step.action}`).join("; ")}.`,
    missingSteps: missing.map((step) => ({
      id: step.id,
      label: step.label,
      action: step.action,
      hint: step.hint || "",
      targetTab: step.targetTab,
    })),
  };
}
