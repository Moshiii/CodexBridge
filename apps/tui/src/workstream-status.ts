import type { InMemoryManagerMemory } from "@autoaide/memory-system";
import type { InMemoryTaskStore } from "@autoaide/task-system";

function normalizeQuery(text: string): string {
  return text
    .trim()
    .replace(/^\/status\s+/i, "")
    .replace(/^(status|what(?:'s| is)? the status of|how is|how's|what about)\s+/i, "")
    .replace(/( status)?\?*$/i, "")
    .replace(/(任务|项目|工作流|workstream|task)/g, " ")
    .replace(/(怎么样了|怎么样|进展如何|进展咋样|进展|状态如何|状态|如何了|咋样了|\?+|？+)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeStatusQuery(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith("/status") ||
    normalized.startsWith("status") ||
    normalized.startsWith("how is") ||
    normalized.startsWith("how's") ||
    normalized.startsWith("what about") ||
    normalized.startsWith("what is the status of") ||
    /怎么样|进展|状态|如何了|咋样/.test(text)
  );
}

function formatWorkstreamStatus(input: {
  title: string;
  status: string;
  goal: string;
  activeWorkerId?: string;
  lastManagerJudgment?: string;
  nextFollowupAt?: number;
}): string {
  const parts = [
    `${input.title} is ${input.status}.`,
    `Goal: ${input.goal}.`
  ];

  if (input.activeWorkerId) {
    parts.push(`Current worker: ${input.activeWorkerId}.`);
  }
  if (typeof input.nextFollowupAt === "number") {
    parts.push(`Next follow-up: ${new Date(input.nextFollowupAt).toLocaleString("en-US", { hour12: false })}.`);
  }
  if (input.lastManagerJudgment) {
    parts.push(`Last manager judgment: ${input.lastManagerJudgment}.`);
  }

  return parts.join(" ");
}

export function resolveWorkstreamStatusQuery(input: {
  text: string;
  memory: InMemoryManagerMemory;
  store: InMemoryTaskStore;
  activeWorkstreamId?: string;
}): { queryText: string; replyText: string } | undefined {
  if (!looksLikeStatusQuery(input.text)) {
    return undefined;
  }

  const queryText = normalizeQuery(input.text);
  const workstreams =
    queryText.length > 0
      ? input.memory.searchWorkstreams({ text: queryText })
      : [];

  const exact =
    queryText.length > 0
      ? workstreams.find((workstream) => workstream.title.toLowerCase() === queryText.toLowerCase())
      : undefined;
  const matched =
    exact ??
    workstreams[0] ??
    (input.activeWorkstreamId ? input.store.getWorkstream(input.activeWorkstreamId) : undefined);

  if (!matched) {
    return {
      queryText,
      replyText:
        queryText.length > 0
          ? `I could not find a matching workstream for "${queryText}".`
          : "There is no active workstream to report right now."
    };
  }

  const candidates = exact ? [exact] : workstreams.slice(0, 3);
  if (!exact && workstreams.length > 1 && queryText.length > 0) {
    return {
      queryText,
      replyText: [
        `I found multiple matching workstreams for "${queryText}":`,
        ...candidates.map((workstream) => `- ${workstream.title} (${workstream.status})`)
      ].join("\n")
    };
  }

  return {
    queryText,
    replyText: formatWorkstreamStatus({
      title: matched.title,
      status: matched.status,
      goal: matched.goal,
      activeWorkerId: matched.activeWorkerId,
      lastManagerJudgment: "lastManagerJudgment" in matched ? matched.lastManagerJudgment : undefined,
      nextFollowupAt: matched.nextFollowupAt
    })
  };
}
