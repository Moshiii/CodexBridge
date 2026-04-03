import http from "node:http";
import { URL } from "node:url";

import {
  canaryRollout,
  healthCheckBot,
  inspectBot,
  listBots,
  readBotLogs,
  restartBot,
  rollbackBot,
  rollingRestartBots,
  startBot,
  stopBot,
  updateBotConfig,
} from "./bots.mjs";
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
        --bg: #f5f1e8;
        --panel: #fffaf2;
        --line: #d9ccb7;
        --text: #1d1a16;
        --muted: #685f52;
        --accent: #0d6b52;
        --danger: #9d2f2f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Iowan Old Style", serif;
        background: radial-gradient(circle at top left, #fffdf7, var(--bg));
        color: var(--text);
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: 32px 20px 64px;
      }
      h1, h2 { margin: 0 0 12px; }
      .subtle { color: var(--muted); }
      .grid {
        display: grid;
        grid-template-columns: 1.2fr 1fr;
        gap: 20px;
        margin-top: 24px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 8px 30px rgba(29, 26, 22, 0.05);
      }
      .bot-row {
        border-top: 1px solid var(--line);
        padding: 12px 0;
      }
      .bot-row:first-child { border-top: 0; }
      .pill {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--line);
        margin-right: 8px;
        font-size: 12px;
      }
      button {
        border: 1px solid var(--line);
        background: white;
        color: var(--text);
        border-radius: 999px;
        padding: 6px 12px;
        cursor: pointer;
        margin-right: 8px;
      }
      button.primary {
        background: var(--accent);
        color: white;
        border-color: var(--accent);
      }
      button.danger {
        color: var(--danger);
      }
      pre {
        background: #f7f2e9;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px;
        overflow: auto;
        white-space: pre-wrap;
      }
      @media (max-width: 900px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>AutoAide Control Plane</h1>
      <p class="subtle">Minimal multi-bot control plane. This is a thin operations surface, not the final product UI.</p>
      <div class="grid">
        <section class="panel">
          <h2>Bots</h2>
          <div id="bots">Loading...</div>
        </section>
        <section class="panel">
          <h2>Detail</h2>
          <div id="detail" class="subtle">Select a bot.</div>
        </section>
      </div>
    </main>
    <script>
      const botsRoot = document.getElementById("bots");
      const detailRoot = document.getElementById("detail");

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

      async function loadBots() {
        const snapshot = await request("/api/bots");
        botsRoot.innerHTML = "";
        snapshot.bots.forEach((bot) => {
          const row = document.createElement("div");
          row.className = "bot-row";
          row.innerHTML = [
            '<div><strong>' + bot.name + '</strong> <span class="pill">' + bot.id + '</span> <span class="pill">' + bot.status + '</span></div>',
            '<div class="subtle">' + (bot.botUsername ? '@' + bot.botUsername : 'no telegram username') + '</div>',
            '<div style="margin-top:10px;"></div>'
          ].join("");
          const actionRow = row.lastElementChild;
          [["start", "primary"], ["stop", ""], ["restart", ""]].forEach(([action, klass]) => {
            const button = document.createElement("button");
            button.textContent = action;
            button.className = klass;
            button.onclick = async () => {
              await request('/api/bots/' + bot.id + '/' + action, { method: 'POST' });
              await loadBots();
              await loadDetail(bot.id);
            };
            actionRow.appendChild(button);
          });
          row.onclick = (event) => {
            if (event.target.tagName !== "BUTTON") {
              void loadDetail(bot.id);
            }
          };
          botsRoot.appendChild(row);
        });
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

      async function loadDetail(botId) {
        const payload = await request('/api/bots/' + botId);
        detailRoot.innerHTML =
          '<p><strong>' + payload.detail.bot.name + '</strong> (' + payload.detail.bot.id + ')</p>' +
          '<p class="subtle">' + payload.health.status + ' / desired ' + payload.health.desiredVersion + '</p>' +
          '<pre>' + JSON.stringify(payload.health, null, 2) + '</pre>' +
          '<p><strong>Access</strong></p>' +
          '<pre>' + JSON.stringify(payload.access, null, 2) + '</pre>' +
          '<p><strong>Config</strong></p>' +
          '<textarea id="config-editor" style="width:100%;min-height:220px;border:1px solid #d9ccb7;border-radius:12px;padding:12px;background:#fffdf8;">' + JSON.stringify(payload.detail.config, null, 2) + '</textarea>' +
          '<div style="margin:10px 0 16px;"><button class="primary" id="save-config">save config</button></div>' +
          '<p><strong>Recent logs</strong></p>' +
          '<pre>' + (payload.logs.content || 'No logs yet.') + '</pre>';
        document.getElementById('save-config').onclick = async () => {
          await saveConfig(botId);
        };
      }

      void loadBots();
    </script>
  </body>
</html>`;
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/bots") {
    return json(response, 200, await getControlPlaneSnapshot());
  }

  const botMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
  if (request.method === "GET" && botMatch) {
    return json(response, 200, await getBotControlPlaneDetail(decodeURIComponent(botMatch[1])));
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
