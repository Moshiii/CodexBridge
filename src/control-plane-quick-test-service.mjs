import { buildQuickTestPreflight } from "./control-plane-readiness-service.mjs";

export const QUICK_TEST_PROMPT = "Reply with one short sentence confirming CodexBridge is ready.";

export const WORKSPACE_DEMO_PROMPTS = [
  {
    id: "create-file",
    title: "Create file",
    description: "Ask the assistant to create a reusable markdown file in the workspace.",
    prompt: [
      "Create a 3-day Beijing weekend plan for two people as a markdown file.",
      "Make it relaxed, include food, walks, cafes, and one backup indoor option per day.",
      "Save it as beijing-weekend-plan.md in the workspace.",
    ].join("\n"),
  },
  {
    id: "edit-draft",
    title: "Edit draft",
    description: "Turn rough workspace notes into a clear file.",
    prompt: [
      "Read raw-notes.md and rewrite it into a clear product one-pager.",
      "Save the result as product-one-pager.md.",
      "Keep it concise and suitable for a GitHub README or investor intro.",
    ].join("\n"),
  },
  {
    id: "continue-project",
    title: "Continue project",
    description: "Reopen an existing workspace file and keep the project moving.",
    prompt: [
      "Open launch-checklist.md.",
      "Mark the README positioning work as done.",
      "Add the next three tasks for a public demo.",
    ].join("\n"),
  },
];

const WORKSPACE_FILE_DEMO_PROMPT = WORKSPACE_DEMO_PROMPTS.find((item) => item.id === "create-file")?.prompt || QUICK_TEST_PROMPT;

export function normalizeQuickTestMode(mode) {
  return mode === "workspace_file_demo" ? "workspace_file_demo" : "smoke";
}

export function resolveQuickTestPrompt(mode) {
  return normalizeQuickTestMode(mode) === "workspace_file_demo"
    ? WORKSPACE_FILE_DEMO_PROMPT
    : QUICK_TEST_PROMPT;
}

export async function startQuickTest({
  botId,
  mode,
  getDetail,
  startChat,
} = {}) {
  const normalizedMode = normalizeQuickTestMode(mode);
  const detail = await getDetail(botId);
  const prompt = resolveQuickTestPrompt(normalizedMode);
  const run = await startChat(botId, {
    prompt,
    sessionLabel: "main",
  });
  return {
    ...run,
    mode: normalizedMode,
    preflight: buildQuickTestPreflight(detail.setupGuide),
  };
}
