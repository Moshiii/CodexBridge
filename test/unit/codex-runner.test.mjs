import test from "node:test";
import assert from "node:assert/strict";

import { importFresh, withTempHome } from "../helpers/module.js";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

test("runCliTurn parses session id and final agent message from JSONL", async () => {
  await withTempHome(async () => {
    const { runCliTurn } = await importFresh("../../src/codex-runner.mjs");
    const commandConfig = {
      cwd: process.cwd(),
      startCommand: [
        "node",
        "-e",
        shellQuote([
          "console.log(JSON.stringify({type:'thread.started',thread_id:'thread-123'}));",
          "console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}));",
        ].join("")),
      ].join(" "),
      resumeTemplate: "unused __SESSION_ID__",
    };

    const result = await runCliTurn("hello", null, commandConfig);

    assert.equal(result.ok, true);
    assert.equal(result.cliSessionRef, "thread-123");
    assert.equal(result.output, "done");
  });
});

test("runCliTurn preserves existing session id on resume", async () => {
  await withTempHome(async () => {
    const { runCliTurn } = await importFresh("../../src/codex-runner.mjs");
    const commandConfig = {
      cwd: process.cwd(),
      startCommand: "unused",
      resumeTemplate: [
        "node",
        "-e",
        shellQuote("console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'resumed'}}));"),
        "__SESSION_ID__",
      ].join(" "),
    };

    const result = await runCliTurn("hello", "existing-session", commandConfig);

    assert.equal(result.cliSessionRef, "existing-session");
    assert.equal(result.output, "resumed");
  });
});

test("runCliTurn returns failure details for non-zero exit", async () => {
  await withTempHome(async () => {
    const { runCliTurn } = await importFresh("../../src/codex-runner.mjs");
    const commandConfig = {
      cwd: process.cwd(),
      startCommand: [
        "node",
        "-e",
        shellQuote("console.error('bad run'); process.exit(7);"),
      ].join(" "),
      resumeTemplate: "unused __SESSION_ID__",
    };

    const result = await runCliTurn("hello", null, commandConfig);

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 7);
    assert.match(result.stderr, /bad run/);
  });
});

test("runCliTurn streams status updates for real event types without duplicates", async () => {
  await withTempHome(async () => {
    const { runCliTurn } = await importFresh("../../src/codex-runner.mjs");
    const seen = [];
    const script = [
      "console.log(JSON.stringify({type:'thread.started',thread_id:'thread-1'}));",
      "console.log(JSON.stringify({type:'thread.started',thread_id:'thread-1'}));",
      "console.log(JSON.stringify({type:'item.started',item:{type:'command_execution',command:'/bin/zsh -lc pwd'}}));",
      "console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'/bin/zsh -lc pwd'}}));",
      "console.log(JSON.stringify({type:'item.started',item:{type:'reasoning'}}));",
      "console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'all set'}}));",
    ].join("");
    const commandConfig = {
      cwd: process.cwd(),
      startCommand: ["node", "-e", shellQuote(script)].join(" "),
      resumeTemplate: "unused __SESSION_ID__",
      onStatus(status) {
        seen.push(status);
      },
    };

    const result = await runCliTurn("hello", null, commandConfig);

    assert.equal(result.output, "all set");
    assert.deepEqual(seen, [
      "Session started",
      "Running /bin/zsh -lc pwd...",
      "Finished /bin/zsh -lc pwd.",
      "Thinking...",
    ]);
  });
});

test("startCliTurn exposes child handle and resolves final parsed result", async () => {
  await withTempHome(async () => {
    const { startCliTurn } = await importFresh("../../src/codex-runner.mjs");
    const commandConfig = {
      cwd: process.cwd(),
      startCommand: [
        "node",
        "-e",
        shellQuote([
          "setTimeout(() => console.log(JSON.stringify({type:'thread.started',thread_id:'thread-55'})), 20);",
          "setTimeout(() => console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'async done'}})), 40);",
        ].join("")),
      ].join(" "),
      resumeTemplate: "unused __SESSION_ID__",
    };

    const started = startCliTurn("hello", null, commandConfig);
    assert.ok(started.child.pid > 0);

    const result = await started.result;
    assert.equal(result.cliSessionRef, "thread-55");
    assert.equal(result.output, "async done");
  });
});
