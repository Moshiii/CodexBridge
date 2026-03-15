import { applyWorkPlan, planOwnerGoal } from "@autoaide/manager-core";
import { InMemoryTaskStore } from "@autoaide/task-system";
import type { ManagerConversationContext, ManagerOwnerMessage, ManagerRuntime, ManagerRuntimeResponse } from "../contracts.js";
import { interpretOwnerMessage } from "../policy/owner-intent.js";

export class DeterministicManagerRuntime implements ManagerRuntime {
  async respond(input: {
    message: ManagerOwnerMessage;
    store: InMemoryTaskStore;
    memory?: import("@autoaide/memory-system").InMemoryManagerMemory;
    conversation?: ManagerConversationContext;
    rootTaskId: string;
    now?: number;
  }): Promise<ManagerRuntimeResponse> {
    const intent = interpretOwnerMessage(input.message);
    if (intent.mode === "conversation_only") {
      return {
        intent,
        reply: {
          kind: "summary",
          text: "I can understand your request, decide when clarification is needed, turn work into tasks, assign workers, track blockers and progress, and report the outcome back clearly."
        },
        toolCalls: []
      };
    }
    if (intent.needsClarification) {
      return {
        intent,
        reply: {
          kind: "clarification",
          text: intent.clarificationQuestion ?? "Please provide more task detail."
        },
        toolCalls: [
          {
            kind: "ask_owner",
            question: intent.clarificationQuestion ?? "Please provide more task detail.",
            reason: "owner_goal_is_underspecified"
          }
        ]
      };
    }

    const plan = planOwnerGoal({
      ownerId: intent.ownerId,
      rootTaskId: input.rootTaskId,
      title: intent.title,
      goal: intent.goal,
      now: input.now
    });

    applyWorkPlan(input.store, plan);

    return {
      intent,
      plan,
      reply: {
        kind: "summary",
        text: `Captured "${intent.title}" and created ${1 + plan.tasks.length} tasks. Next: the manager will continue assigning executors.`
      },
      toolCalls: [
        {
          kind: "create_tasks",
          steps: [
            {
              title: plan.rootTask.title,
              goal: plan.rootTask.goal,
              priority: plan.rootTask.priority
            },
            ...plan.tasks.map((task) => ({
              title: task.title,
              goal: task.goal,
              priority: task.priority
            }))
          ],
          reason: "convert_owner_goal_into_task_graph"
        },
        {
          kind: "record_decision",
          summary: `Created the first task graph for owner goal "${intent.title}"`
        },
        {
          kind: "assign_worker",
          taskId: plan.tasks[0]?.id ?? plan.rootTask.id,
          taskTitle: plan.tasks[0]?.title ?? plan.rootTask.title,
          objective: plan.tasks[0]?.goal ?? plan.rootTask.goal,
          deliverable: "Return a concise progress summary and any concrete findings.",
          completionSignal: "The worker reports a concrete result summary for the assigned task.",
          reason: "first_planned_step_is_ready_for_execution"
        },
        {
          kind: "schedule_followup",
          taskId: plan.rootTask.id,
          taskTitle: plan.rootTask.title,
          summary: `Follow up on overall progress for owner goal "${intent.title}"`,
          dueInMinutes: 60,
          reason: "manager_should_revisit_new_goal"
        }
      ]
    };
  }
}
