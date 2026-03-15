import type { ManagerConversationContext, ManagerIntent, ManagerOwnerMessage } from "../contracts.js";

export function normalizeConversation(
  conversation: ManagerConversationContext | undefined
): ManagerConversationContext | undefined {
  if (!conversation) {
    return undefined;
  }

  return {
    activeRootTaskId: conversation.activeRootTaskId,
    activeTaskTitle: conversation.activeTaskTitle,
    pendingClarificationQuestion: conversation.pendingClarificationQuestion,
    recentMessages: conversation.recentMessages.slice(-8)
  };
}

function classifyOwnerRequestMode(text: string): "conversation_only" | "managed_task" {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return "conversation_only";
  }

  const conversationalPrefixes = [
    "what can you do",
    "why",
    "how",
    "explain",
    "summarize",
    "status"
  ];
  if (conversationalPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return "conversation_only";
  }

  if (normalized.includes("?") || normalized.includes("？")) {
    const actionSignals = [
      "please",
      "fix",
      "implement",
      "plan",
      "delegate",
      "assign"
    ];
    if (!actionSignals.some((signal) => normalized.includes(signal))) {
      return "conversation_only";
    }
  }

  return "managed_task";
}

export function interpretOwnerMessage(message: ManagerOwnerMessage): ManagerIntent {
  const text = message.text.trim();
  const segments = text
    .split("\n")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const title = segments[0] ?? text;
  const goal = segments.slice(1).join(" ") || text;
  const mode = classifyOwnerRequestMode(text);
  const needsClarification = mode === "managed_task" && text.length < 12;

  return {
    ownerId: message.ownerId,
    title,
    goal,
    sourceMessageId: message.id,
    mode,
    needsClarification,
    clarificationQuestion: needsClarification
      ? "Please provide a more specific goal, scope, or completion criteria."
      : undefined
  };
}

export function classifyOwnerMessageMode(text: string): "conversation_only" | "managed_task" {
  return classifyOwnerRequestMode(text);
}
