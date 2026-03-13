import { resolveRuntimeConfig } from "@autoaide/core-config";
import { createLogger } from "@autoaide/core-logger";
import { createServer } from "./server.js";

const config = resolveRuntimeConfig();
const logger = createLogger({ subsystem: "server" });
const { listen } = createServer(config, logger);

void listen().then((address) => {
  logger.info("startup complete", {
    appName: config.appName,
    url: `http://${address.address}:${address.port}`
  });
});
