const SUPPORTED_CHANNELS = new Set(["telegram", "feishu"]);
const REDACTED_SECRET = "[redacted]";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function validateTelegramConfig(telegram, errors) {
  if (!isPlainObject(telegram)) {
    addError(errors, "channels.telegram", "Telegram config must be an object.");
    return;
  }
  if (telegram.botToken === REDACTED_SECRET) {
    addError(errors, "channels.telegram.botToken", "Redacted Telegram token cannot be persisted.");
  }
  if (!isPlainObject(telegram.private)) {
    addError(errors, "channels.telegram.private", "Telegram private config must be an object.");
  } else if (!isStringArray(telegram.private.allowedChatIds)) {
    addError(errors, "channels.telegram.private.allowedChatIds", "Telegram private allowedChatIds must be a string array.");
  }
  if (!isPlainObject(telegram.groups)) {
    addError(errors, "channels.telegram.groups", "Telegram groups config must be an object.");
  } else {
    if (!isStringArray(telegram.groups.allowedChatIds)) {
      addError(errors, "channels.telegram.groups.allowedChatIds", "Telegram group allowedChatIds must be a string array.");
    }
    if (!isStringArray(telegram.groups.allowedUserIds)) {
      addError(errors, "channels.telegram.groups.allowedUserIds", "Telegram group allowedUserIds must be a string array.");
    }
  }
}

function validateFeishuConfig(feishu, errors) {
  if (!isPlainObject(feishu)) {
    addError(errors, "channels.feishu", "Feishu config must be an object.");
    return;
  }
  if (feishu.appSecret === REDACTED_SECRET) {
    addError(errors, "channels.feishu.appSecret", "Redacted Feishu appSecret cannot be persisted.");
  }
  if (!isStringArray(feishu.botMentionNames)) {
    addError(errors, "channels.feishu.botMentionNames", "Feishu botMentionNames must be a string array.");
  }
}

export function validateBotConfig(config = {}) {
  const errors = [];
  if (!isPlainObject(config)) {
    addError(errors, "", "Bot config must be an object.");
    return errors;
  }
  if (typeof config.id !== "string" || !config.id.trim()) {
    addError(errors, "id", "Bot config id is required.");
  }
  if (!SUPPORTED_CHANNELS.has(String(config.channel || "").trim())) {
    addError(errors, "channel", "Bot config channel must be telegram or feishu.");
  }
  if (typeof config.enabled !== "boolean") {
    addError(errors, "enabled", "Bot config enabled must be a boolean.");
  }
  if (!isPlainObject(config.runtime)) {
    addError(errors, "runtime", "Runtime config must be an object.");
  } else if (typeof config.runtime.model !== "string") {
    addError(errors, "runtime.model", "Runtime model must be a string.");
  }
  if (!isPlainObject(config.channels)) {
    addError(errors, "channels", "Channels config must be an object.");
  } else {
    validateTelegramConfig(config.channels.telegram, errors);
    validateFeishuConfig(config.channels.feishu, errors);
  }
  return errors;
}

export function assertValidBotConfig(config = {}) {
  const errors = validateBotConfig(config);
  if (errors.length) {
    const details = errors.map((error) => `${error.path || "(root)"}: ${error.message}`).join("; ");
    throw new Error(`Invalid bot config. ${details}`);
  }
  return config;
}
