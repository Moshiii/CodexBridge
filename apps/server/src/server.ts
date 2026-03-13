import { createServer as createNodeServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { AutoAideRuntimeConfig } from "@autoaide/core-config";
import type { Logger } from "@autoaide/core-logger";

export function createServer(config: AutoAideRuntimeConfig, logger?: Logger) {
  const server = createNodeServer((req, res) => {
    logger?.debug("incoming request", {
      method: req.method ?? "GET",
      url: req.url ?? "/"
    });

    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          app: config.appName
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  return {
    server,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });

      logger?.info("server listening", {
        host: config.host,
        port: (server.address() as AddressInfo).port
      });

      return server.address() as AddressInfo;
    }
  };
}
