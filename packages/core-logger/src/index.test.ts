import { describe, expect, it } from "vitest";
import { createLogger } from "./index.js";

describe("createLogger", () => {
  it("writes structured log lines", () => {
    const lines: string[] = [];
    const logger = createLogger({
      subsystem: "server",
      sink(line) {
        lines.push(line);
      }
    });

    logger.info("started", { port: 3010 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      level: "info",
      message: "started",
      fields: {
        subsystem: "server",
        port: 3010
      }
    });
  });
});
