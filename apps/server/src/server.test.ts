import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

const servers: Array<import("node:http").Server> = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        })
    )
  );
  servers.length = 0;
});

describe("createServer", () => {
  it("serves healthz", async () => {
    const { server, listen } = createServer({
      appName: "AutoAide",
      host: "127.0.0.1",
      port: 0
    });
    servers.push(server);

    const address = await listen();
    const response = await fetch(`http://${address.address}:${address.port}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, app: "AutoAide" });
  });

  it("returns not_found for unknown routes", async () => {
    const { server, listen } = createServer({
      appName: "AutoAide",
      host: "127.0.0.1",
      port: 0
    });
    servers.push(server);

    const address = await listen();
    const response = await fetch(`http://${address.address}:${address.port}/missing`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "not_found" });
  });
});
