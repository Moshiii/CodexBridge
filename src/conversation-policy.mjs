import { detectConversationRiskLabels } from "./conversation-log.mjs";

const DEFAULT_BLOCK_LABELS = new Set(["possible_secret"]);
const DEFAULT_REVIEW_LABELS = new Set([
  "credential_like_text",
  "prompt_injection_signal",
  "possible_email",
  "possible_phone",
]);

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeSet(values, fallback) {
  if (!Array.isArray(values)) {
    return fallback;
  }
  return new Set(values.map((value) => String(value || "").trim()).filter(Boolean));
}

export function evaluateConversationPolicy(content = "", options = {}) {
  const labels = unique([
    ...detectConversationRiskLabels(content),
    ...(Array.isArray(options.riskLabels) ? options.riskLabels : []),
  ]);
  const blockLabels = normalizeSet(options.blockLabels, DEFAULT_BLOCK_LABELS);
  const reviewLabels = normalizeSet(options.reviewLabels, DEFAULT_REVIEW_LABELS);
  const blockingLabels = labels.filter((label) => blockLabels.has(label));
  if (blockingLabels.length > 0) {
    return {
      action: "block",
      riskLabels: labels,
      blockingLabels,
      reviewLabels: labels.filter((label) => reviewLabels.has(label)),
      reason: `Blocked by conversation policy: ${blockingLabels.join(", ")}`,
      userMessage: "This message appears to contain sensitive credential material. Remove secrets or tokens before sending it to CodexBridge.",
    };
  }
  const reviewMatches = labels.filter((label) => reviewLabels.has(label));
  if (reviewMatches.length > 0) {
    return {
      action: "review",
      riskLabels: labels,
      blockingLabels: [],
      reviewLabels: reviewMatches,
      reason: `Review recommended: ${reviewMatches.join(", ")}`,
      userMessage: "",
    };
  }
  return {
    action: "allow",
    riskLabels: labels,
    blockingLabels: [],
    reviewLabels: [],
    reason: "",
    userMessage: "",
  };
}

export function shouldBlockConversation(content = "", options = {}) {
  return evaluateConversationPolicy(content, options).action === "block";
}
