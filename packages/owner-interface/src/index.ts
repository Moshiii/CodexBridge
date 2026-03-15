import { type EscalationAction } from "@autoaide/manager-core";
import type { Reminder, SupervisionResult } from "@autoaide/supervision-core";
import { InMemoryTaskStore, type OwnerChannelKind } from "@autoaide/task-system";

export type OwnerMessage = {
  id: string;
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  text: string;
  createdAt: number;
};

export type ManagerReply = {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  kind: "summary" | "clarification" | "alert";
  text: string;
  createdAt: number;
};

export type OwnerChannelTarget = {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
};

export type ReplyDispatchFailure = {
  reply: ManagerReply;
  error: string;
};

export type ReplyDispatchReport = {
  sent: ManagerReply[];
  failed: ReplyDispatchFailure[];
};

export interface ChannelAdapter {
  send(reply: ManagerReply): Promise<void>;
}

export interface ChannelBridge {
  register(channel: OwnerChannelKind, adapter: ChannelAdapter): void;
  send(reply: ManagerReply): Promise<void>;
}

export class InMemoryChannelBridge implements ChannelBridge {
  private readonly adapters = new Map<OwnerChannelKind, ChannelAdapter>();
  private readonly sentReplies: ManagerReply[] = [];

  register(channel: OwnerChannelKind, adapter: ChannelAdapter): void {
    this.adapters.set(channel, adapter);
  }

  async send(reply: ManagerReply): Promise<void> {
    const adapter = this.adapters.get(reply.channel);
    if (!adapter) {
      throw new Error(`channel adapter not found: ${reply.channel}`);
    }
    this.sentReplies.push(reply);
    await adapter.send(reply);
  }

  listSentReplies(): ManagerReply[] {
    return [...this.sentReplies];
  }
}

export function createClarificationReply(input: {
  message: OwnerMessage;
  question: string;
  now?: number;
}): ManagerReply {
  return {
    ownerId: input.message.ownerId,
    channel: input.message.channel,
    peerId: input.message.peerId,
    kind: "clarification",
    text: input.question,
    createdAt: input.now ?? Date.now()
  };
}

export function createSummaryReply(input: {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  title: string;
  tasksCreated: number;
  nextStep?: string;
  now?: number;
}): ManagerReply {
  const nextStepLine = input.nextStep ? ` Next: ${input.nextStep}` : "";
  return {
    ownerId: input.ownerId,
    channel: input.channel,
    peerId: input.peerId,
    kind: "summary",
    text: `Captured "${input.title}" and created ${input.tasksCreated} tasks.${nextStepLine}`.trim(),
    createdAt: input.now ?? Date.now()
  };
}

export function createEscalationReply(input: {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  action: EscalationAction;
  now?: number;
}): ManagerReply {
  const text =
    input.action.kind === "follow_up_owner"
      ? `Need your clarification or confirmation: ${input.action.reason}`
      : input.action.kind === "replan_task"
        ? `The task needs replanning: ${input.action.reason}`
        : `Checking executor state: ${input.action.reason}`;

  return {
    ownerId: input.ownerId,
    channel: input.channel,
    peerId: input.peerId,
    kind: "alert",
    text,
    createdAt: input.now ?? Date.now()
  };
}

export function createReminderReply(input: {
  ownerId: string;
  channel: OwnerChannelKind;
  peerId: string;
  reminder: Reminder;
  now?: number;
}): ManagerReply {
  const text =
    input.reminder.kind === "commitment_reminder"
      ? `Reminder: your commitment is due, ${input.reminder.summary}`
      : `Reminder: ${input.reminder.summary}`;

  return {
    ownerId: input.ownerId,
    channel: input.channel,
    peerId: input.peerId,
    kind: "alert",
    text,
    createdAt: input.now ?? Date.now()
  };
}

function findTarget(
  targets: OwnerChannelTarget[],
  ownerId: string
): OwnerChannelTarget | undefined {
  return targets.find((target) => target.ownerId === ownerId);
}

function dedupeReplies(replies: ManagerReply[]): ManagerReply[] {
  const seen = new Set<string>();
  const unique: ManagerReply[] = [];

  for (const reply of replies) {
    const key = `${reply.ownerId}:${reply.channel}:${reply.peerId}:${reply.kind}:${reply.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(reply);
  }

  return unique;
}

export async function dispatchSupervisionRepliesSafely(input: {
  bridge: ChannelBridge;
  targets: OwnerChannelTarget[];
  supervision: SupervisionResult;
  now?: number;
}): Promise<ReplyDispatchReport> {
  const sent: ManagerReply[] = [];
  const failed: ReplyDispatchFailure[] = [];
  const replies = await buildSupervisionReplies(input);

  for (const reply of replies) {
    try {
      await input.bridge.send(reply);
      sent.push(reply);
    } catch (error) {
      failed.push({
        reply,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { sent, failed };
}

export async function buildSupervisionReplies(input: {
  targets: OwnerChannelTarget[];
  supervision: SupervisionResult;
  now?: number;
}): Promise<ManagerReply[]> {
  const replies: ManagerReply[] = [];

  for (const action of input.supervision.actions) {
    const ownerId = input.supervision.reminders.find((reminder) => reminder.taskId === action.taskId)?.ownerId;
    if (!ownerId) {
      continue;
    }
    const target = findTarget(input.targets, ownerId);
    if (!target) {
      continue;
    }

    replies.push(
      createEscalationReply({
        ownerId: target.ownerId,
        channel: target.channel,
        peerId: target.peerId,
        action,
        now: input.now
      })
    );
  }

  for (const reminder of input.supervision.reminders) {
    const target = findTarget(input.targets, reminder.ownerId);
    if (!target) {
      continue;
    }

    replies.push(
      createReminderReply({
        ownerId: target.ownerId,
        channel: target.channel,
        peerId: target.peerId,
        reminder,
        now: input.now
      })
    );
  }

  return dedupeReplies(replies);
}

export async function dispatchPreparedReplies(input: {
  bridge: ChannelBridge;
  replies: ManagerReply[];
}): Promise<ManagerReply[]> {
  for (const reply of input.replies) {
    await input.bridge.send(reply);
  }

  return input.replies;
}

export async function dispatchSupervisionRepliesLegacy(input: {
  bridge: ChannelBridge;
  targets: OwnerChannelTarget[];
  supervision: SupervisionResult;
  now?: number;
}): Promise<ManagerReply[]> {
  const replies = await buildSupervisionReplies(input);
  return dispatchPreparedReplies({
    bridge: input.bridge,
    replies
  });
}

export async function dispatchSupervisionReplies(input: {
  bridge: ChannelBridge;
  targets: OwnerChannelTarget[];
  supervision: SupervisionResult;
  now?: number;
}): Promise<ManagerReply[]> {
  return dispatchSupervisionRepliesLegacy(input);
}
