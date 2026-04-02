#!/usr/bin/env node

import { startCli } from "../src/cli.mjs";
import { runDaemon } from "../src/daemon.mjs";
import { ensureDaemonRunning } from "../src/launcher.mjs";
import {
  formatSkillInstallResult,
  formatSkillsOverview,
  installSkillFromPath,
  listSkills,
} from "../src/skills.mjs";

const command = process.argv[2]?.trim();
const subcommand = process.argv[3]?.trim();
const arg = process.argv.slice(4).join(" ").trim();

if (command === "daemon") {
  await runDaemon();
} else if (command === "skills") {
  if (!subcommand || subcommand === "list") {
    console.log(formatSkillsOverview(await listSkills()));
  } else if (subcommand === "install") {
    if (!arg) {
      console.error("Usage: autoaide skills install <zip-or-path>");
      process.exit(1);
    }
    try {
      const installed = await installSkillFromPath(arg, { force: true });
      console.log(formatSkillInstallResult(installed));
    } catch (error) {
      console.error(`Skill install failed: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.error("Usage: autoaide skills [list] | autoaide skills install <zip-or-path>");
    process.exit(1);
  }
} else {
  await ensureDaemonRunning();
  await startCli();
}
