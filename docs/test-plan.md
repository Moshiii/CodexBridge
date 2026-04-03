# AutoAide Test Plan

> Historical draft. Parts of this plan assume the removed single-daemon architecture. Treat it as archive material, not the current test contract.

## 1. Purpose

This document defines a practical test strategy for the current AutoAide project.

The goal is not to claim infinite coverage.
The goal is to cover all currently implemented product surfaces with a clear mix of:

- automated tests
- integration tests
- manual acceptance checks
- release smoke tests

This plan is written against the current product shape:

- local CLI entrypoint
- single daemon
- persistent runtime home
- workspace bootstrap and Markdown context injection
- Codex-backed turn execution
- Telegram bridge
- Telegram file bridge
- stop/status behavior for Telegram jobs

## 2. Testing Principles

- Prefer high-signal tests over shallow snapshot tests.
- Test product behavior, not just helper functions.
- Keep unit tests small and deterministic.
- Put process lifecycle, filesystem state, and Telegram routing behind integration tests.
- Treat Telegram Bot API traffic as an integration boundary and mock it by default.
- Keep a small manual smoke checklist for real Codex and real Telegram verification.

## 3. Scope

### In Scope

- runtime home creation
- config/state JSON behavior
- workspace seeding and bootstrap completion rules
- workspace prompt assembly
- daemon single-instance behavior
- CLI shell command routing
- Codex runner parsing and status streaming
- Telegram session routing
- Telegram slash commands
- Telegram upload/download file bridge
- Telegram running job control via `/stop`
- Telegram session status via `/status`

### Out of Scope for Full Automation

- exact Codex model output content
- Telegram network reliability in production
- long-running platform-specific shell edge cases
- visual polish of the startup banner

These still need smoke validation, but should not block the main automated suite.

## 4. Recommended Test Layers

### Layer 1: Pure Unit Tests

Use for:

- JSON/state helpers
- prompt assembly
- bootstrap parsing/replacement helpers
- Telegram path validation helpers
- event parsing and status summarization

Recommended tools:

- Node built-in test runner: `node:test`
- Node built-in assertions: `node:assert/strict`

Rationale:

- no extra dependency cost
- enough for this repo
- easy CI portability

### Layer 2: Component/Process Integration Tests

Use for:

- daemon startup behavior
- launcher ensuring a daemon exists
- CLI turn execution with a stub Codex command
- Telegram bridge update processing with mocked Telegram API
- running job cancellation behavior

Recommended approach:

- spawn Node processes in temporary runtime homes
- replace `CODEX_START_COMMAND` and `CODEX_RESUME_COMMAND_TEMPLATE` with deterministic stub commands
- stub `fetch` or route Telegram API requests to a local mock server

### Layer 3: Manual End-to-End Smoke Tests

Use for:

- real `codex` execution
- real Telegram bot pairing
- daemon restart behavior on a developer machine
- install and `npm link` workflow

These should be short and intentional, not exhaustive.

## 5. Test Environments

### Local Automated Test Environment

- isolated temp `AUTOAIDE_HOME`
- no dependency on real `~/.autoaide`
- no dependency on real Telegram
- no dependency on real Codex unless explicitly running smoke tests

### Manual Smoke Environment

- Node.js `>=22`
- real `codex` installed
- optional Telegram bot token and a private chat

## 6. Core Test Matrix

## 6.1 Install and Runtime Home

### Objectives

- confirm runtime directories are created
- confirm default config/state files can be initialized
- confirm repeated setup is idempotent

### Automated Cases

1. `ensureAutoAideHome()` creates:
   - `workspace/`
   - `logs/`
   - `telegram/`
2. `readConfig()` returns defaults when config file is absent.
3. `writeConfig()` persists values and `readConfig()` reads them back.
4. `readCliState()` creates a valid default `main` session when state is missing.
5. `readBootstrapState()` returns the default bootstrap state when missing.

### Manual Smoke

1. Delete a temp runtime home.
2. Run `autoaide`.
3. Confirm `~/.autoaide` structure exists and CLI still boots.

## 6.2 Workspace Bootstrap

### Objectives

- confirm seed files are created correctly
- confirm bootstrap completion requires real identity/user values
- confirm bootstrap cleanup removes `BOOTSTRAP.md`

### Automated Cases

1. `ensureWorkspaceBootstrap()` seeds core files into an empty workspace.
2. Before completion, `BOOTSTRAP.md` exists and `bootstrapPending` is `true`.
3. `completeBootstrap()` updates:
   - `IDENTITY.md`
   - `USER.md`
   - `SOUL.md`
4. `completeBootstrap()` removes `BOOTSTRAP.md`.
5. After completion, `ensureWorkspaceBootstrap()` reports `bootstrapPending=false`.
6. Re-running bootstrap after completion does not overwrite edited identity/user files.

### Edge Cases

1. Identity exists but still has default placeholder name.
2. User file exists but call-name field is empty.
3. Partially seeded workspace from an interrupted first run.

## 6.3 Workspace Context Injection

### Objectives

- confirm prompt assembly is stable
- confirm missing files are tolerated
- confirm file order is consistent

### Automated Cases

1. `buildWorkspacePrompt()` returns raw user input when no context files exist.
2. `buildWorkspacePrompt()` injects `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md` when present.
3. Empty files are ignored.
4. Explicit `options.files` limits injected context to the requested files.

## 6.4 Codex Runner

### Objectives

- confirm JSONL parsing works
- confirm final answer extraction is correct
- confirm CLI status streaming works for real event types

### Automated Cases

1. `runCliTurn()` with a stub command returning JSONL produces:
   - `ok=true`
   - parsed `cliSessionRef`
   - parsed final agent message
2. Non-zero exit returns `ok=false` and preserves stdout/stderr.
3. Status callback receives:
   - `Session started`
   - command execution start/finish messages
4. Duplicate status summaries are not emitted repeatedly.

### Integration Cases

1. Run with `CODEX_START_COMMAND` replaced by a stub shell command that emits valid JSON lines.
2. Run with `CODEX_RESUME_COMMAND_TEMPLATE` and confirm session ID replacement works.

### Manual Smoke

1. Launch `autoaide`.
2. Ask a question that triggers shell commands.
3. Confirm `[status] ...` lines appear before the final answer.

## 6.5 CLI Shell

### Objectives

- confirm slash commands route correctly
- confirm normal turns update the active session
- confirm bootstrap flow can complete

### Automated/Integration Cases

1. `/help` renders available commands.
2. `/status` prints runtime and daemon information.
3. `/where` shows the current session.
4. `/exit` closes the readline loop cleanly.
5. A normal message:
   - builds workspace prompt
   - runs Codex
   - persists `cliSessionRef`
   - updates `updatedAt`

### Manual Smoke

1. First launch with an empty runtime home.
2. Complete bootstrap prompts.
3. Ask two normal questions.
4. Confirm second turn resumes the existing session.

## 6.6 Daemon and Launcher

### Objectives

- confirm single-daemon semantics
- confirm PID file behavior is correct
- confirm Telegram bridge restarts on config changes

### Automated/Integration Cases

1. `runDaemon()` writes the daemon PID file.
2. Starting daemon while one is already running exits safely.
3. PID file is removed on shutdown.
4. Changing Telegram config signature restarts the bridge child.
5. If bridge child exits unexpectedly, daemon restarts it.
6. `ensureDaemonRunning()` starts the daemon when absent.

### Edge Cases

1. stale PID file exists but process is gone
2. invalid PID content
3. Telegram disabled in config

## 6.7 Telegram Pairing

### Objectives

- confirm chat detection logic works
- confirm pairing writes config correctly

### Automated Cases

1. mocked Telegram `getUpdates` returns a private chat and pairing resolves the chat ID.
2. pairing failure surfaces a readable error.

### Manual Smoke

1. Run `/channel` in CLI.
2. pair a real bot token
3. send one Telegram message
4. confirm config is updated with `allowedChatIds`

## 6.8 Telegram Session Router

### Objectives

- confirm chat-scoped active session tracking
- confirm session create/switch logic works

### Automated Cases

1. default router state includes a `main` session.
2. first message from a new chat creates chat state with `main` active.
3. `/new foo` creates a new session and activates it.
4. `/switch foo` changes the active session.
5. `/home` returns the active session to `main`.
6. `/sessions` lists all sessions with tags.
7. `/where` returns active session info.

## 6.9 Telegram Message Processing

### Objectives

- confirm normal messages start/resume Codex correctly
- confirm router state persists the session ref
- confirm concurrent duplicate work is blocked per session

### Automated/Integration Cases

1. first text message starts a new Codex session.
2. second text message on the same active session uses resume.
3. successful result persists `cliSessionRef`.
4. when a job is already running on the active session, a new message receives the busy response.
5. non-text/non-document messages get the unsupported-message response.

## 6.10 Telegram Stop and Status

### Objectives

- confirm a running job can be interrupted
- confirm `/status` reflects running state

### Automated/Integration Cases

1. a long-running stub job is registered in `runningJobs`.
2. `/status` while idle returns:
   - current session
   - backend
   - resume state
   - `Running: no`
3. `/status` during execution returns `Running: yes`.
4. `/stop` on a running session sends stop requested and terminates the child.
5. `/stop` when idle returns `No running task`.
6. interrupted jobs are removed from `runningJobs`.

### Manual Smoke

1. send a long-running Telegram task
2. send `/status`
3. send `/stop`
4. confirm interruption message arrives
5. send `/status` again and confirm idle state

## 6.11 Telegram File Bridge

### Objectives

- confirm uploads are stored safely
- confirm downloads are restricted to approved directories

### Automated Cases

1. document upload is downloaded and saved under `workspace/inbox/`.
2. uploaded filename is sanitized.
3. upload response includes relative workspace path and size.
4. `/files` lists files in allowed roots.
5. `/get inbox/foo.txt` sends the file when present.
6. `/get ../secret.txt` is rejected.
7. `/get unknown-root/file.txt` is rejected.
8. `resolveDownloadPath()` rejects traversal and absolute paths.

## 6.12 Documentation and Packaging Smoke

### Objectives

- confirm the install path and docs remain truthful

### Manual Cases

1. `npm install`
2. `npm link`
3. `autoaide`
4. verify README quickstart still works as written
5. verify Telegram README command examples still match behavior

This matters because the project currently depends on linked global installs, and stale global code is an easy failure mode.

## 7. Proposed Automated Test Structure

Recommended file layout:

```text
test/
  unit/
    config.test.mjs
    workspace-bootstrap.test.mjs
    workspace-context.test.mjs
    codex-runner.test.mjs
    telegram-router.test.mjs
    telegram-paths.test.mjs
  integration/
    cli.test.mjs
    daemon.test.mjs
    telegram-bridge.test.mjs
    telegram-stop.test.mjs
```

## 8. Test Data and Stubs

### Temporary Runtime Home

Each test should create a unique temp directory and set:

```text
AUTOAIDE_HOME=<temp-dir>
```

This avoids cross-test pollution and avoids touching the real user runtime.

### Stub Codex Command

For deterministic tests, replace Codex execution with a fake command that emits JSONL.

Example behavior to simulate:

- `thread.started`
- `item.started` with `command_execution`
- `item.completed` with `command_execution`
- `item.completed` with `agent_message`
- non-zero exit for failure cases
- delayed exit for `/stop` tests

### Mock Telegram API

Recommended options:

- local HTTP mock server
- fetch mocking inside the Node process

Mock endpoints needed:

- `getUpdates`
- `sendMessage`
- `sendDocument`
- `getFile`
- file download URL

## 9. Release Gates

Before any release or demo build, require:

1. Unit suite passes.
2. Integration suite passes.
3. Manual CLI smoke passes.
4. Manual Telegram smoke passes if Telegram is enabled in the release.
5. `npm link` and `autoaide` launch are verified from a clean shell.

## 10. High-Risk Areas

These should receive extra attention first:

1. global install drift
   - repo code and linked global code can diverge
2. daemon lifecycle
   - stale PID files and orphaned background processes
3. Telegram job control
   - bridge must keep polling while jobs run
4. workspace bootstrap correctness
   - partial first-run states are easy to mishandle
5. filesystem path safety
   - Telegram download/export paths must stay constrained

## 11. Suggested Implementation Order

If you want to build the test suite incrementally, do it in this order:

1. unit tests for `config`, `workspace-context`, `workspace-bootstrap`
2. unit tests for `codex-runner` event parsing and status streaming
3. integration tests for CLI turn execution with stub Codex
4. integration tests for daemon PID and single-instance behavior
5. integration tests for Telegram router and slash commands
6. integration tests for `/stop` and `/status`
7. file bridge tests
8. release smoke checklist automation where practical

## 12. Exit Criteria

The current project can be considered reasonably covered when:

- all core runtime modules have automated tests
- all user-facing commands have at least one integration test
- all process lifecycle features have at least one failure-path test
- Telegram stop/status/file-routing flows are covered
- a short manual smoke checklist is documented and repeatable

At that point, the test suite will not be exhaustive in the mathematical sense, but it will be strong enough to protect the real product behavior that exists today.
