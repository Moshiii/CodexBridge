import http from "node:http";
import { URL } from "node:url";

import {
  canaryRollout,
  createBot,
  deleteBot,
  healthCheckBot,
  inspectBot,
  listBots,
  readBotLogs,
  restartBot,
  rollbackBot,
  rollingRestartBots,
  setActiveBot,
  setBotEnabled,
  startBot,
  stopBot,
  updateBotConfig,
} from "./bots.mjs";
import { readActiveBotId } from "./config.mjs";
import { hydrateTelegramMetadata } from "./telegram-metadata.mjs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMergeConfig(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = isPlainObject(value) ? deepMergeConfig(base[key] ?? {}, value) : value;
  }
  return merged;
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function text(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(payload);
}

function html(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(payload);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export async function getControlPlaneSnapshot() {
  const bots = await listBots();
  const health = await Promise.all(
    bots.map(async (bot) => ({
      id: bot.id,
      health: await healthCheckBot(bot.id),
    })),
  );
  return {
    generatedAt: new Date().toISOString(),
    currentBotId: await readActiveBotId(),
    bots,
    health,
  };
}

export async function getBotControlPlaneDetail(botId) {
  const detail = await inspectBot(botId);
  detail.config = await hydrateTelegramMetadata(detail.bot.homePath).catch(() => detail.config);
  const telegram = detail.config.channels?.telegram ?? {};
  const metadata = telegram.metadata ?? { chats: {}, users: {} };
  const formatEntry = (id, source) => {
    const entry = source?.[id];
    if (entry?.label) {
      return `${entry.label} (${id})`;
    }
    if (entry?.username) {
      return `@${String(entry.username).replace(/^@+/, "")} (${id})`;
    }
    if (entry?.title) {
      return `${entry.title} (${id})`;
    }
    return String(id);
  };
  return {
    detail,
    health: await healthCheckBot(botId),
    logs: await readBotLogs(botId, 50),
    access: {
      privateChats: (telegram.private?.allowedChatIds ?? []).map((id) => formatEntry(id, metadata.chats)),
      groupChats: (telegram.groups?.allowedChatIds ?? []).map((id) => formatEntry(id, metadata.chats)),
      groupUsers: (telegram.groups?.allowedUserIds ?? []).map((id) => formatEntry(id, metadata.users)),
    },
  };
}

function renderHtmlPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AutoAide Control Plane</title>
    <style>
      :root {
        --bg: #f3efe7;
        --bg-accent: #e7dcc7;
        --panel: #fffaf2;
        --panel-strong: #fffdf8;
        --line: #d9ccb7;
        --text: #1d1a16;
        --muted: #685f52;
        --accent: #0d6b52;
        --accent-soft: #d7efe7;
        --danger: #9d2f2f;
        --warn: #8a5a18;
        --shadow: 0 10px 30px rgba(29, 26, 22, 0.07);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Iowan Old Style", serif;
        background:
          radial-gradient(circle at top left, #fffdf7, transparent 28%),
          linear-gradient(135deg, var(--bg), var(--bg-accent));
        color: var(--text);
      }
      main {
        max-width: 1480px;
        margin: 0 auto;
        padding: 24px 18px 40px;
      }
      h1, h2, h3 { margin: 0; }
      .subtle { color: var(--muted); }
      .app-shell {
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 18px;
        margin-top: 18px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 18px;
        box-shadow: var(--shadow);
      }
      .topbar {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 16px;
        align-items: center;
      }
      .headline {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .status-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pill {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        font-size: 12px;
        background: #fff;
      }
      .pill.accent {
        background: var(--accent-soft);
        border-color: #b5d9ce;
        color: #124d3f;
      }
      .pill.danger {
        color: var(--danger);
        border-color: #e1b9b9;
        background: #fff3f3;
      }
      button {
        border: 1px solid var(--line);
        background: white;
        color: var(--text);
        border-radius: 999px;
        padding: 8px 14px;
        cursor: pointer;
        margin-right: 8px;
        margin-bottom: 8px;
        font: inherit;
      }
      button.primary {
        background: var(--accent);
        color: white;
        border-color: var(--accent);
      }
      button.danger {
        color: var(--danger);
      }
      button.ghost {
        background: transparent;
      }
      pre {
        background: #f7f2e9;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px;
        overflow: auto;
        white-space: pre-wrap;
      }
      textarea, input, select {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 10px 12px;
        background: var(--panel-strong);
        color: var(--text);
        font: inherit;
      }
      textarea {
        min-height: 180px;
        resize: vertical;
      }
      .fleet-rail {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .fleet-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .bot-row {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 12px;
        background: #fffdf8;
        cursor: pointer;
      }
      .bot-row.current {
        border-color: #0d6b52;
        box-shadow: inset 0 0 0 1px #0d6b52;
      }
      .main-panel {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .bot-hero {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 16px;
        align-items: start;
      }
      .hero-actions {
        text-align: right;
      }
      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .tab {
        padding: 9px 14px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: #fff;
        cursor: pointer;
      }
      .tab.active {
        background: var(--accent);
        color: white;
        border-color: var(--accent);
      }
      .tab-panel {
        display: none;
      }
      .tab-panel.active {
        display: block;
      }
      .card-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .overview-metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 14px;
      }
      .metric {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px 16px;
        background: linear-gradient(180deg, #fffdf8, #fbf5eb);
      }
      .metric-label {
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .metric-value {
        margin-top: 8px;
        font-size: 24px;
        line-height: 1.1;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px;
        background: #fffdf8;
        min-width: 0;
      }
      .kv {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 8px 14px;
        margin-top: 10px;
        min-width: 0;
      }
      .kv div:nth-child(odd) {
        color: var(--muted);
      }
      .kv div:nth-child(even) {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .two-col {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 14px;
      }
      .chat-shell {
        display: grid;
        grid-template-columns: 260px 1fr;
        gap: 14px;
      }
      .list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .list-item {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 12px;
        background: #fff;
      }
      .muted-box {
        border: 1px dashed var(--line);
        border-radius: 14px;
        padding: 14px;
        color: var(--muted);
        background: rgba(255,255,255,0.45);
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .section-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .toast {
        position: fixed;
        right: 18px;
        bottom: 18px;
        background: #1d1a16;
        color: white;
        padding: 12px 14px;
        border-radius: 14px;
        box-shadow: var(--shadow);
        max-width: 360px;
        display: none;
        z-index: 20;
      }
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(22, 18, 14, 0.35);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        z-index: 30;
      }
      .modal {
        width: min(560px, 100%);
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 18px;
        box-shadow: var(--shadow);
      }
      .modal-grid {
        display: grid;
        gap: 12px;
        margin-top: 12px;
      }
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      @media (max-width: 1120px) {
        .app-shell,
        .chat-shell,
        .two-col,
        .card-grid,
        .bot-hero,
        .overview-metrics {
          grid-template-columns: 1fr;
        }
        .hero-actions {
          text-align: left;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel topbar">
        <div class="headline">
          <h1>AutoAide Web Console</h1>
          <p class="subtle">Multi-bot operations desktop. Phase-complete UI mock for demos, with current control-plane actions still wired where available.</p>
        </div>
        <div class="status-strip">
          <span class="pill accent" id="top-current-bot">current bot: loading</span>
          <span class="pill" id="top-runtime">runtime: unknown</span>
          <span class="pill" id="top-telegram">telegram: unknown</span>
          <span class="pill" id="top-enabled">enabled: unknown</span>
        </div>
      </section>

      <div class="app-shell">
        <aside class="panel fleet-rail">
          <div class="section-title">
            <h2>Fleet</h2>
            <button class="primary" id="open-create-bot">+ New Bot</button>
          </div>
          <div class="muted-box">
            Phase 1 live:
            start, stop, restart, config, logs.
            Phase 2-5 UI below is demo-clickable for stakeholder review.
          </div>
          <div id="bots" class="fleet-list">Loading...</div>
          <div class="toolbar">
            <button id="demo-current">Set Current</button>
            <button id="demo-delete" class="danger">Delete</button>
          </div>
        </aside>

        <section class="main-panel">
          <section class="panel bot-hero">
            <div>
              <h2 id="bot-title">Select a bot</h2>
              <p class="subtle" id="bot-subtitle">No bot selected.</p>
              <div class="badge-row" id="bot-badges"></div>
            </div>
            <div class="hero-actions">
              <button class="primary" id="action-start">Start</button>
              <button id="action-stop">Stop</button>
              <button id="action-restart">Restart</button>
              <button id="action-enable">Enable / Disable</button>
              <button id="action-use">Set Current</button>
            </div>
          </section>

          <section class="panel">
            <div class="tabs" id="tabs">
              <button class="tab active" data-tab="overview">Overview</button>
              <button class="tab" data-tab="telegram">Telegram</button>
              <button class="tab" data-tab="sessions">Sessions</button>
              <button class="tab" data-tab="chat">Chat</button>
              <button class="tab" data-tab="goals">Goals</button>
              <button class="tab" data-tab="schedules">Schedules</button>
              <button class="tab" data-tab="workspace">Workspace</button>
              <button class="tab" data-tab="skills">Skills</button>
              <button class="tab" data-tab="logs">Logs</button>
              <button class="tab" data-tab="config">Config</button>
              <button class="tab" data-tab="rollout">Rollout</button>
            </div>
          </section>

          <section class="panel tab-panel active" id="tab-overview">
            <div class="overview-metrics">
              <div class="metric">
                <div class="metric-label">Current Bot</div>
                <div class="metric-value" id="metric-bot">-</div>
              </div>
              <div class="metric">
                <div class="metric-label">Runtime</div>
                <div class="metric-value" id="metric-runtime">-</div>
              </div>
              <div class="metric">
                <div class="metric-label">Telegram</div>
                <div class="metric-value" id="metric-telegram">-</div>
              </div>
              <div class="metric">
                <div class="metric-label">Model</div>
                <div class="metric-value" id="metric-model">-</div>
              </div>
            </div>
            <div class="card-grid">
              <div class="card">
                <h3>Runtime</h3>
                <div class="kv" id="overview-runtime"></div>
              </div>
              <div class="card">
                <h3>Telegram</h3>
                <div class="kv" id="overview-telegram"></div>
              </div>
              <div class="card">
                <h3>Workspace</h3>
                <div class="kv" id="overview-workspace"></div>
              </div>
              <div class="card">
                <h3>Recent Error</h3>
                <pre id="overview-error">No error.</pre>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-telegram">
            <div class="two-col">
              <div class="card">
                <div class="section-title">
                  <h3>Pairing</h3>
                  <div>
                    <button class="primary" id="telegram-repair">Pair / Re-pair</button>
                    <button id="telegram-refresh-meta">Refresh Metadata</button>
                  </div>
                </div>
                <div class="kv" id="telegram-pairing"></div>
              </div>
              <div class="card">
                <h3>Troubleshooting</h3>
                <div class="list">
                  <div class="list-item">If the bot is in a group, disable Group Privacy in BotFather for reliable message delivery.</div>
                  <div class="list-item">If group replies are ignored, check mention requirement and allowed users.</div>
                  <div class="list-item">If re-pairing fails, another runtime may still be consuming Telegram updates.</div>
                </div>
              </div>
            </div>
            <div class="card-grid" style="margin-top:14px;">
              <div class="card">
                <h3>Private Access</h3>
                <pre id="telegram-private-access">Loading...</pre>
              </div>
              <div class="card">
                <h3>Group Access</h3>
                <pre id="telegram-group-access">Loading...</pre>
              </div>
              <div class="card">
                <div class="section-title">
                  <h3>Seen Chats</h3>
                  <button id="demo-seen-chat">Allow Selected</button>
                </div>
                <div class="list" id="telegram-seen-chats"></div>
              </div>
              <div class="card">
                <div class="section-title">
                  <h3>Seen Users</h3>
                  <button id="demo-seen-user">Allow Selected</button>
                </div>
                <div class="list" id="telegram-seen-users"></div>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-sessions">
            <div class="section-title">
              <h3>Sessions</h3>
              <button class="primary" id="demo-create-session">Create Session</button>
            </div>
            <div class="list" id="sessions-list"></div>
          </section>

          <section class="panel tab-panel" id="tab-chat">
            <div class="chat-shell">
              <div class="card">
                <h3>Session Context</h3>
                <div class="kv">
                  <div>Bot</div><div id="chat-bot-name">-</div>
                  <div>Session</div><div>main</div>
                  <div>Run state</div><div>idle</div>
                </div>
                <div class="toolbar">
                  <button class="primary" id="demo-run-chat">Run Prompt</button>
                  <button id="demo-stop-chat">Stop Turn</button>
                </div>
              </div>
              <div class="card">
                <h3>Composer</h3>
                <textarea id="chat-input">Summarize the current repo and propose next steps.</textarea>
                <div class="toolbar">
                  <button class="primary" id="demo-send-chat">Send</button>
                </div>
                <h3 style="margin-top:16px;">Output</h3>
                <pre id="chat-output">Phase 2 UI demo. Hook this to real session execution later.</pre>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-goals">
            <div class="section-title">
              <h3>Goals</h3>
              <button class="primary" id="demo-create-goal">Create Goal</button>
            </div>
            <div class="list" id="goals-list"></div>
          </section>

          <section class="panel tab-panel" id="tab-schedules">
            <div class="section-title">
              <h3>Schedules</h3>
              <button class="primary" id="demo-create-schedule">Create Schedule</button>
            </div>
            <div class="list" id="schedules-list"></div>
          </section>

          <section class="panel tab-panel" id="tab-workspace">
            <div class="two-col">
              <div class="card">
                <h3>Workspace Tree</h3>
                <div class="list" id="workspace-tree"></div>
              </div>
              <div class="card">
                <h3>Editor</h3>
                <textarea id="workspace-editor"># IDENTITY.md\n\nPhase 5 UI demo editor.</textarea>
                <div class="toolbar">
                  <button class="primary" id="demo-save-workspace">Save File</button>
                </div>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-skills">
            <div class="section-title">
              <h3>Skills</h3>
              <button class="primary" id="demo-install-skill">Install Skill</button>
            </div>
            <div class="list" id="skills-list"></div>
          </section>

          <section class="panel tab-panel" id="tab-logs">
            <div class="two-col">
              <div class="card">
                <div class="section-title">
                  <h3>Runtime Log</h3>
                  <button id="logs-refresh">Refresh</button>
                </div>
                <pre id="runtime-log">Loading...</pre>
              </div>
              <div class="card">
                <h3>Bridge Notes</h3>
                <pre id="bridge-log">Phase 1 live log hooked to existing runtime log source. Separate bridge log UI can be connected later.</pre>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-config">
            <div class="two-col">
              <div class="card">
                <h3>Common Settings</h3>
                <div class="modal-grid">
                  <label>Name<input id="config-name" /></label>
                  <label>Model<input id="config-model" /></label>
                  <label>Bot Username<input id="config-bot-username" /></label>
                  <label>Mention Required<select id="config-mention-required"><option value="true">true</option><option value="false">false</option></select></label>
                </div>
                <div class="toolbar" style="margin-top:14px;">
                  <button class="primary" id="save-form-config">Save Form</button>
                </div>
              </div>
              <div class="card">
                <h3>Raw Config</h3>
                <textarea id="config-editor"></textarea>
                <div class="toolbar" style="margin-top:14px;">
                  <button class="primary" id="save-config">Save Raw Config</button>
                </div>
              </div>
            </div>
          </section>

          <section class="panel tab-panel" id="tab-rollout">
            <div class="section-title">
              <h3>Rollout</h3>
              <div>
                <button class="primary" id="demo-restart-all">Restart All</button>
                <button id="demo-canary">Canary</button>
                <button id="demo-rollback">Rollback</button>
              </div>
            </div>
            <div class="card-grid">
              <div class="card">
                <h3>Fleet Restart</h3>
                <p class="subtle">Phase 5 mock surface for restart-all and fleet orchestration.</p>
              </div>
              <div class="card">
                <h3>Canary / Rollback</h3>
                <p class="subtle">Phase 5 mock surface for staged rollout and rollback coordination.</p>
              </div>
            </div>
          </section>
        </section>
      </div>

      <div class="toast" id="toast"></div>

      <div class="modal-backdrop" id="create-bot-modal-backdrop">
        <div class="modal">
          <div class="section-title">
            <h3>Create Bot</h3>
            <button class="ghost" id="close-create-bot">Close</button>
          </div>
          <div class="modal-grid">
            <label>Bot ID<input id="create-bot-id" placeholder="research" /></label>
            <label>Name<input id="create-bot-name" placeholder="Research" /></label>
            <label>Enabled on Create
              <select id="create-bot-enabled">
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
          </div>
          <div class="toolbar" style="margin-top:14px;">
            <button class="primary" id="submit-create-bot">Create</button>
          </div>
        </div>
      </div>

      <div class="modal-backdrop" id="demo-modal-backdrop">
        <div class="modal">
          <div class="section-title">
            <h3 id="demo-modal-title">Demo Action</h3>
            <button class="ghost" id="close-demo-modal">Close</button>
          </div>
          <p class="subtle" id="demo-modal-body">This Phase UI is present for demo review and not fully wired yet.</p>
        </section>
      </div>
    </main>
    <script>
      function compactPath(value) {
        const home = "/Users/moshiwei";
        return String(value || "").startsWith(home) ? "~" + String(value).slice(home.length) : String(value || "");
      }

      const botsRoot = document.getElementById("bots");
      const toastRoot = document.getElementById("toast");
      const tabButtons = Array.from(document.querySelectorAll(".tab"));
      const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
      const createBotModal = document.getElementById("create-bot-modal-backdrop");
      const demoModal = document.getElementById("demo-modal-backdrop");
      const state = {
        currentBotId: null,
        selectedBotId: null,
        bots: [],
        detail: null,
      };

      async function request(path, options = {}) {
        const response = await fetch(path, {
          headers: { "content-type": "application/json" },
          ...options,
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || response.statusText);
        }
        return await response.json();
      }

      function showToast(message) {
        toastRoot.textContent = message;
        toastRoot.style.display = "block";
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => {
          toastRoot.style.display = "none";
        }, 2400);
      }

      function openDemoModal(title, body) {
        document.getElementById("demo-modal-title").textContent = title;
        document.getElementById("demo-modal-body").textContent = body;
        demoModal.style.display = "flex";
      }

      function setTopStatus(detail) {
        const bot = detail?.detail?.bot;
        const config = detail?.detail?.config;
        document.getElementById("top-current-bot").textContent = "current bot: " + (state.currentBotId || bot?.id || "none");
        document.getElementById("top-runtime").textContent = "runtime: " + (bot?.status || "unknown");
        document.getElementById("top-telegram").textContent = "telegram: " + ((config?.channels?.telegram?.enabled && config?.channels?.telegram?.botToken) ? "paired" : "unpaired");
        document.getElementById("top-enabled").textContent = "enabled: " + (bot?.enabled ? "yes" : "no");
      }

      function renderBadges(bot, config) {
        const root = document.getElementById("bot-badges");
        root.innerHTML = "";
        [
          { label: bot.id, klass: "accent" },
          { label: bot.status || "unknown", klass: bot.status === "running" ? "accent" : "" },
          { label: bot.enabled ? "enabled" : "disabled", klass: bot.enabled ? "" : "danger" },
          { label: config?.channels?.telegram?.enabled ? "telegram paired" : "telegram unpaired", klass: config?.channels?.telegram?.enabled ? "" : "danger" },
          { label: state.currentBotId === bot.id ? "current" : "not current", klass: state.currentBotId === bot.id ? "accent" : "" },
        ].forEach((item) => {
          const badge = document.createElement("span");
          badge.className = "pill " + (item.klass || "");
          badge.textContent = item.label;
          root.appendChild(badge);
        });
      }

      function setSelectedTab(tabName) {
        tabButtons.forEach((button) => {
          button.classList.toggle("active", button.dataset.tab === tabName);
        });
        tabPanels.forEach((panel) => {
          panel.classList.toggle("active", panel.id === "tab-" + tabName);
        });
      }

      function renderKV(rootId, rows) {
        const root = document.getElementById(rootId);
        root.innerHTML = "";
        rows.forEach(([key, value]) => {
          const k = document.createElement("div");
          const v = document.createElement("div");
          k.textContent = key;
          v.textContent = value;
          root.appendChild(k);
          root.appendChild(v);
        });
      }

      function demoList(items, actionLabel) {
        return items.map((item) => {
          return '<div class="list-item"><strong>' + item.title + '</strong><div class="subtle">' + item.meta + '</div>' +
            (actionLabel ? '<div class="toolbar"><button onclick="window.__demoClick(\\'' + actionLabel + '\\')">' + actionLabel + '</button></div>' : '') +
            '</div>';
        }).join("");
      }

      async function loadBots() {
        const snapshot = await request("/api/bots");
        state.bots = snapshot.bots;
        state.currentBotId = snapshot.currentBotId || (snapshot.bots.find((bot) => bot.isCurrent)?.id ?? snapshot.bots[0]?.id ?? null);
        if (!state.selectedBotId) {
          state.selectedBotId = state.currentBotId;
        }
        botsRoot.innerHTML = "";
        snapshot.bots.forEach((bot) => {
          const row = document.createElement("div");
          row.className = "bot-row" + (state.selectedBotId === bot.id ? " current" : "");
          row.innerHTML = [
            '<div><strong>' + bot.name + '</strong></div>',
            '<div class="subtle">' + bot.id + '</div>',
            '<div class="badge-row" style="margin-top:8px;">' +
              '<span class="pill ' + (bot.status === 'running' ? 'accent' : '') + '">' + bot.status + '</span>' +
              '<span class="pill ' + (bot.enabled ? '' : 'danger') + '">' + (bot.enabled ? 'enabled' : 'disabled') + '</span>' +
              '<span class="pill ' + (state.currentBotId === bot.id ? 'accent' : '') + '">' + (state.currentBotId === bot.id ? 'current' : 'bot') + '</span>' +
            '</div>'
          ].join("");
          row.onclick = () => {
            state.selectedBotId = bot.id;
            void loadBots().then(() => loadDetail(bot.id));
          };
          botsRoot.appendChild(row);
        });
      }

      function applyFormFromConfig(config) {
        document.getElementById("config-name").value = config.name || "";
        document.getElementById("config-model").value = config.runtime?.model || "";
        document.getElementById("config-bot-username").value = config.channels?.telegram?.botUsername || "";
        document.getElementById("config-mention-required").value = String(config.channels?.telegram?.groups?.requireExplicitMention ?? true);
      }

      async function saveConfig(botId) {
        const field = document.getElementById('config-editor');
        const nextConfig = JSON.parse(field.value);
        await request('/api/bots/' + botId + '/config', {
          method: 'POST',
          body: JSON.stringify(nextConfig),
        });
        await loadBots();
        await loadDetail(botId);
      }

      async function saveFormConfig(botId) {
        const payload = {
          name: document.getElementById("config-name").value.trim(),
          runtime: {
            model: document.getElementById("config-model").value.trim(),
          },
          channels: {
            telegram: {
              botUsername: document.getElementById("config-bot-username").value.trim(),
              groups: {
                requireExplicitMention: document.getElementById("config-mention-required").value === "true",
              },
            },
          },
        };
        await request('/api/bots/' + botId + '/config', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast("Saved form config");
        await loadBots();
        await loadDetail(botId);
      }

      async function mutateBot(botId, action) {
        await request('/api/bots/' + botId + '/' + action, { method: 'POST' });
        showToast('Bot ' + action + ' complete');
        await loadBots();
        await loadDetail(botId);
      }

      async function loadDetail(botId) {
        const payload = await request('/api/bots/' + botId);
        state.detail = payload;
        const bot = payload.detail.bot;
        const config = payload.detail.config;
        document.getElementById("bot-title").textContent = bot.name;
        document.getElementById("bot-subtitle").textContent =
          bot.id + " | " + bot.homePath + " | desired " + (payload.health.desiredVersion || "v1");
        renderBadges(bot, config);
        setTopStatus(payload);
        document.getElementById("metric-bot").textContent = bot.name;
        document.getElementById("metric-runtime").textContent = payload.health.healthy ? "Online" : "Offline";
        document.getElementById("metric-telegram").textContent = config.channels?.telegram?.enabled ? "Paired" : "Unpaired";
        document.getElementById("metric-model").textContent = config.runtime?.model || "gpt-5.4";
        renderKV("overview-runtime", [
          ["status", payload.health.status || "unknown"],
          ["runtime pid", bot.runtimePid ? String(bot.runtimePid) : "none"],
          ["healthy", payload.health.healthy ? "yes" : "no"],
          ["desired version", payload.health.desiredVersion || "v1"],
          ["running version", payload.health.runningVersion || "none"],
        ]);
        renderKV("overview-telegram", [
          ["paired", config.channels?.telegram?.enabled ? "yes" : "no"],
          ["bot username", config.channels?.telegram?.botUsername ? "@" + config.channels.telegram.botUsername : "none"],
          ["private access", (payload.access.privateChats || []).join(", ") || "(none)"],
          ["group users", (payload.access.groupUsers || []).join(", ") || "(none)"],
          ["mention required", String(config.channels?.telegram?.groups?.requireExplicitMention ?? true)],
        ]);
        renderKV("overview-workspace", [
          ["workspace", compactPath(payload.detail.paths.homePath + "/workspace")],
          ["config", compactPath(payload.detail.paths.configPath)],
          ["runtime log", compactPath(payload.detail.paths.runtimeLogPath)],
          ["bridge log", compactPath(payload.detail.paths.bridgeLogPath)],
        ]);
        document.getElementById("overview-error").textContent = payload.health.lastError || "No error.";
        renderKV("telegram-pairing", [
          ["paired", config.channels?.telegram?.enabled ? "yes" : "no"],
          ["bot username", config.channels?.telegram?.botUsername ? "@" + config.channels.telegram.botUsername : "none"],
          ["token present", config.channels?.telegram?.botToken ? "yes" : "no"],
          ["mention required", String(config.channels?.telegram?.groups?.requireExplicitMention ?? true)],
        ]);
        document.getElementById("telegram-private-access").textContent = JSON.stringify(payload.access.privateChats || [], null, 2);
        document.getElementById("telegram-group-access").textContent = JSON.stringify({
          groupChats: payload.access.groupChats || [],
          groupUsers: payload.access.groupUsers || [],
          mentionRequired: config.channels?.telegram?.groups?.requireExplicitMention ?? true,
        }, null, 2);
        document.getElementById("telegram-seen-chats").innerHTML = demoList([
          { title: "Astock Research Group", meta: "recently seen group, can be promoted into allow list" },
          { title: "Trading Ops", meta: "recently seen group, demo data for Phase 3" },
        ], "Allow");
        document.getElementById("telegram-seen-users").innerHTML = demoList([
          { title: "@moshiwei", meta: "recently seen sender, can be promoted into allow list" },
          { title: "@analyst_user", meta: "demo sender entity" },
        ], "Allow");
        document.getElementById("sessions-list").innerHTML = demoList([
          { title: "main", meta: "active, started, resume ref present" },
          { title: "research-plan", meta: "secondary session, idle" },
          { title: "ops-draft", meta: "secondary session, not started" },
        ], "Use");
        document.getElementById("goals-list").innerHTML = demoList([
          { title: "goal_20260403_001", meta: "running | objective: summarize market open drivers" },
          { title: "goal_20260402_004", meta: "completed | objective: produce weekly recap" },
        ], "Inspect");
        document.getElementById("schedules-list").innerHTML = demoList([
          { title: "sched_daily_open", meta: "0 30 9 * * 1-5 | Asia/Shanghai | enabled" },
          { title: "sched_weekly_wrap", meta: "0 0 18 * * 5 | Asia/Shanghai | enabled" },
        ], "Run Now");
        document.getElementById("workspace-tree").innerHTML = demoList([
          { title: "AGENTS.md", meta: "core operating rules" },
          { title: "IDENTITY.md", meta: "assistant identity" },
          { title: "USER.md", meta: "user profile" },
          { title: "SOUL.md", meta: "style and stance" },
          { title: "TOOLS.md", meta: "machine-specific notes" },
        ], "Open");
        document.getElementById("skills-list").innerHTML = demoList([
          { title: "akshare-a-share-daily", meta: "installed | finance workflow skill" },
          { title: "wechat-ocr-guarded", meta: "installed | GUI workflow skill" },
        ], "Inspect");
        document.getElementById("runtime-log").textContent = payload.logs.content || 'No logs yet.';
        document.getElementById("bridge-log").textContent =
          "Bridge log panel placeholder for Phase 1.\\n\\nCurrent implementation still uses existing runtime log source.\\nAdd dedicated bridge log endpoint later.";
        document.getElementById("config-editor").value = JSON.stringify(payload.detail.config, null, 2);
        applyFormFromConfig(payload.detail.config);
        document.getElementById("chat-bot-name").textContent = bot.name;
      }

      document.getElementById('save-config').onclick = async () => {
        if (!state.selectedBotId) return;
        await saveConfig(state.selectedBotId);
        showToast("Saved raw config");
      };

      document.getElementById('save-form-config').onclick = async () => {
        if (!state.selectedBotId) return;
        await saveFormConfig(state.selectedBotId);
      };

      document.getElementById('action-start').onclick = async () => state.selectedBotId && mutateBot(state.selectedBotId, 'start');
      document.getElementById('action-stop').onclick = async () => state.selectedBotId && mutateBot(state.selectedBotId, 'stop');
      document.getElementById('action-restart').onclick = async () => state.selectedBotId && mutateBot(state.selectedBotId, 'restart');
      document.getElementById('action-enable').onclick = async () => openDemoModal("Enable / Disable", "Phase 1 backend endpoint can be wired here next. UI is ready for demo.");
      document.getElementById('action-use').onclick = async () => openDemoModal("Set Current", "Current bot switching UI is present for demo. Wire /api/bots/:id/use next.");
      document.getElementById('demo-current').onclick = () => openDemoModal("Set Current", "Fleet-level current bot action is prepared for demo.");
      document.getElementById('demo-delete').onclick = () => openDemoModal("Delete Bot", "Delete flow UI is prepared for demo with confirm modal support.");
      document.getElementById('telegram-repair').onclick = () => openDemoModal("Telegram Pairing", "Full pairing wizard UI belongs to Phase 3. Current button exists for demo review.");
      document.getElementById('telegram-refresh-meta').onclick = () => showToast("Metadata refresh UI demo");
      document.getElementById('logs-refresh').onclick = async () => state.selectedBotId && loadDetail(state.selectedBotId);
      document.getElementById('demo-create-session').onclick = () => openDemoModal("Create Session", "Session creation UI is mocked for Phase 2.");
      document.getElementById('demo-run-chat').onclick = () => showToast("Phase 2 run flow mock");
      document.getElementById('demo-stop-chat').onclick = () => showToast("Phase 2 stop flow mock");
      document.getElementById('demo-send-chat').onclick = () => {
        document.getElementById('chat-output').textContent =
          "Demo output:\\n\\nThis is where browser-native bot interaction will appear in Phase 2.";
        showToast("Sent demo prompt");
      };
      document.getElementById('demo-create-goal').onclick = () => openDemoModal("Create Goal", "Goal creation UI is mocked for Phase 4.");
      document.getElementById('demo-create-schedule').onclick = () => openDemoModal("Create Schedule", "Schedule creation UI is mocked for Phase 4.");
      document.getElementById('demo-save-workspace').onclick = () => showToast("Workspace save UI mock");
      document.getElementById('demo-install-skill').onclick = () => openDemoModal("Install Skill", "Skill installation UI is mocked for Phase 5.");
      document.getElementById('demo-restart-all').onclick = () => openDemoModal("Restart All", "Fleet rollout controls are mocked for Phase 5.");
      document.getElementById('demo-canary').onclick = () => openDemoModal("Canary Rollout", "Canary rollout UI is mocked for Phase 5.");
      document.getElementById('demo-rollback').onclick = () => openDemoModal("Rollback", "Rollback UI is mocked for Phase 5.");
      document.getElementById('demo-seen-chat').onclick = () => showToast("Seen chat allow-list action demo");
      document.getElementById('demo-seen-user').onclick = () => showToast("Seen user allow-list action demo");
      document.getElementById('open-create-bot').onclick = () => { createBotModal.style.display = 'flex'; };
      document.getElementById('close-create-bot').onclick = () => { createBotModal.style.display = 'none'; };
      document.getElementById('close-demo-modal').onclick = () => { demoModal.style.display = 'none'; };
      document.getElementById('submit-create-bot').onclick = async () => {
        const id = document.getElementById('create-bot-id').value.trim();
        const name = document.getElementById('create-bot-name').value.trim() || id;
        const enabled = document.getElementById('create-bot-enabled').value === 'true';
        if (!id) {
          showToast('Bot id is required');
          return;
        }
        try {
          await request('/api/bots', {
            method: 'POST',
            body: JSON.stringify({ id, name, enabled }),
          });
          createBotModal.style.display = 'none';
          document.getElementById('create-bot-id').value = '';
          document.getElementById('create-bot-name').value = '';
          showToast('Created bot ' + id);
          state.selectedBotId = id;
          await loadBots();
          await loadDetail(id);
        } catch (error) {
          showToast(error.message);
        }
      };

      createBotModal.onclick = (event) => {
        if (event.target === createBotModal) createBotModal.style.display = 'none';
      };
      demoModal.onclick = (event) => {
        if (event.target === demoModal) demoModal.style.display = 'none';
      };

      tabButtons.forEach((button) => {
        button.onclick = () => setSelectedTab(button.dataset.tab);
      });

      window.__demoClick = (label) => {
        showToast(label + " action is mocked for demo");
      };

      void loadBots().then(async () => {
        if (state.selectedBotId) {
          await loadDetail(state.selectedBotId);
        }
      });
    </script>
  </body>
</html>`;
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/bots") {
    return json(response, 200, await getControlPlaneSnapshot());
  }

  if (request.method === "POST" && pathname === "/api/bots") {
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await createBot({
        id: body.id,
        name: body.name,
        enabled: body.enabled === true,
      }),
    );
  }

  const botMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (request.method === "GET" && botMatch) {
    return json(response, 200, await getBotControlPlaneDetail(decodeURIComponent(botMatch[1])));
  }

  const botDeleteMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (request.method === "DELETE" && botDeleteMatch) {
    const botId = decodeURIComponent(botDeleteMatch[1]);
    await deleteBot(botId);
    return json(response, 200, { botId, deleted: true });
  }

  const botUseMatch = pathname.match(/^\/api\/bots\/([^/]+)\/use$/);
  if (request.method === "POST" && botUseMatch) {
    const botId = decodeURIComponent(botUseMatch[1]);
    await setActiveBot(botId);
    return json(response, 200, { currentBotId: botId });
  }

  const botToggleMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(enable|disable)$/);
  if (request.method === "POST" && botToggleMatch) {
    const botId = decodeURIComponent(botToggleMatch[1]);
    const enabled = botToggleMatch[2] === "enable";
    return json(response, 200, await setBotEnabled(botId, enabled));
  }

  const botLogsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/logs$/);
  if (request.method === "GET" && botLogsMatch) {
    return json(response, 200, await readBotLogs(decodeURIComponent(botLogsMatch[1]), 200));
  }

  const botActionMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(start|stop|restart)$/);
  if (request.method === "POST" && botActionMatch) {
    const botId = decodeURIComponent(botActionMatch[1]);
    const action = botActionMatch[2];
    if (action === "start") {
      return json(response, 200, { botId, pid: await startBot(botId) });
    }
    if (action === "stop") {
      return json(response, 200, { botId, stopped: await stopBot(botId) });
    }
    return json(response, 200, { botId, pid: await restartBot(botId) });
  }

  const botConfigMatch = pathname.match(/^\/api\/bots\/([^/]+)\/config$/);
  if (request.method === "POST" && botConfigMatch) {
    const botId = decodeURIComponent(botConfigMatch[1]);
    const body = await readJsonBody(request);
    return json(
      response,
      200,
      await updateBotConfig(botId, (config) => deepMergeConfig(config, body)),
    );
  }

  if (request.method === "POST" && pathname === "/api/rollout/restart-all") {
    return json(response, 200, await rollingRestartBots());
  }

  if (request.method === "POST" && pathname === "/api/rollout/canary") {
    const body = await readJsonBody(request);
    return json(response, 200, await canaryRollout(body.botIds || [], body.desiredVersion || "v1"));
  }

  const rollbackMatch = pathname.match(/^\/api\/rollout\/rollback\/([^/]+)$/);
  if (request.method === "POST" && rollbackMatch) {
    const body = await readJsonBody(request);
    return json(response, 200, await rollbackBot(decodeURIComponent(rollbackMatch[1]), body.version || "v1"));
  }

  return false;
}

export async function startControlPlaneWebServer({ port = 8787, host = "127.0.0.1" } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      if (url.pathname === "/") {
        html(response, 200, renderHtmlPage());
        return;
      }
      const handled = await handleApi(request, response, url.pathname);
      if (handled === false) {
        json(response, 404, { error: "Not found" });
      }
    } catch (error) {
      json(response, 500, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    port: resolvedPort,
    host,
    close: async () => await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
