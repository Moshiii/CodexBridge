function normalizeLevel(level) {
  const normalized = String(level || "").trim().toLowerCase();
  return ["debug", "info", "warn", "error"].includes(normalized) ? normalized : "info";
}

function normalizeEvent(event) {
  return String(event || "").trim() || "event";
}

function normalizeDetails(details) {
  if (details == null) {
    return {};
  }
  if (details instanceof Error) {
    return {
      errorName: details.name,
      errorMessage: details.message,
      stack: details.stack || "",
    };
  }
  if (typeof details === "object" && !Array.isArray(details)) {
    return { ...details };
  }
  return { value: details };
}

export function createLogEvent({ level = "info", event, details = null, timestamp = new Date().toISOString() } = {}) {
  return {
    timestamp,
    level: normalizeLevel(level),
    event: normalizeEvent(event),
    ...normalizeDetails(details),
  };
}

export function formatLogEvent(input = {}) {
  return JSON.stringify(createLogEvent(input));
}

export function writeLogEvent(writer = console.log, input = {}) {
  writer(formatLogEvent(input));
}
