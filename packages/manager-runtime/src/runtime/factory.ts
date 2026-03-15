import type { ManagerRuntime } from "../contracts.js";
import { createCodexManagerRuntime } from "./codex.js";
import { DeterministicManagerRuntime } from "./deterministic.js";

export function createDefaultManagerRuntime(options?: {
  mode?: "deterministic" | "codex";
  workspaceRoot?: string;
  maxRuntimeMs?: number;
}): ManagerRuntime {
  if (options?.mode === "deterministic") {
    return new DeterministicManagerRuntime();
  }

  return createCodexManagerRuntime({
    workspaceRoot: options?.workspaceRoot,
    maxRuntimeMs: options?.maxRuntimeMs
  });
}
