import { describe, expect, it } from "vitest";
import { resolveRuntimeConfig } from "./index.js";

describe("resolveRuntimeConfig", () => {
  it("returns defaults when env vars are missing", () => {
    expect(resolveRuntimeConfig({})).toEqual({
      appName: "AutoAide",
      host: "127.0.0.1",
      port: 3010
    });
  });

  it("normalizes configured values", () => {
    expect(
      resolveRuntimeConfig({
        AUTOAIDE_APP_NAME: "Manager",
        AUTOAIDE_HOST: "0.0.0.0",
        AUTOAIDE_PORT: "4010"
      })
    ).toEqual({
      appName: "Manager",
      host: "0.0.0.0",
      port: 4010
    });
  });

  it("falls back when port is invalid", () => {
    expect(resolveRuntimeConfig({ AUTOAIDE_PORT: "99999" }).port).toBe(3010);
  });
});
