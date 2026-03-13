import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@autoaide/core-config": path.resolve("packages/core-config/src/index.ts"),
      "@autoaide/core-logger": path.resolve("packages/core-logger/src/index.ts"),
      "@autoaide/task-system": path.resolve("packages/task-system/src/index.ts"),
      "@autoaide/memory-system": path.resolve("packages/memory-system/src/index.ts"),
      "@autoaide/manager-core": path.resolve("packages/manager-core/src/index.ts"),
      "@autoaide/manager-runtime": path.resolve("packages/manager-runtime/src/index.ts"),
      "@autoaide/worker-orchestrator": path.resolve("packages/worker-orchestrator/src/index.ts"),
      "@autoaide/executor-codex": path.resolve("packages/executor-codex/src/index.ts"),
      "@autoaide/owner-interface": path.resolve("packages/owner-interface/src/index.ts"),
      "@autoaide/supervision-core": path.resolve("packages/supervision-core/src/index.ts"),
      "@autoaide/terminal-ui": path.resolve("packages/terminal-ui/src/index.ts"),
      "@autoaide/tui": path.resolve("apps/tui/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"]
  }
});
