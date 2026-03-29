#!/usr/bin/env node

import { startCli } from "../src/cli.mjs";
import { runDaemon } from "../src/daemon.mjs";
import { ensureDaemonRunning } from "../src/launcher.mjs";

const command = process.argv[2]?.trim();

if (command === "daemon") {
  await runDaemon();
} else {
  await ensureDaemonRunning();
  await startCli();
}
