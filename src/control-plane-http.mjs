import crypto from "node:crypto";

import { UserInputError } from "./errors.mjs";

export function json(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function okJson(response, payload) {
  json(response, 200, payload);
}

export function text(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(payload);
}

export function html(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(payload);
}

export function unauthorized(response) {
  response.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "www-authenticate": 'Basic realm="CodexBridge Control Plane"',
  });
  response.end(`${JSON.stringify({ error: "Unauthorized" }, null, 2)}\n`);
}

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new UserInputError("Request body must be valid JSON.", {
      code: "invalid_json",
    });
  }
}

export function getWebOperatorToken() {
  return String(process.env.CODEXBRIDGE_WEB_TOKEN || "").trim();
}

export function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function parseBasicAuthPassword(header) {
  const encoded = String(header || "").replace(/^Basic\s+/i, "").trim();
  if (!encoded) {
    return "";
  }
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    return separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;
  } catch {
    return "";
  }
}

export function isWebRequestAuthorized(request, operatorToken = getWebOperatorToken()) {
  const token = String(operatorToken || "").trim();
  if (!token) {
    return true;
  }
  const headers = request?.headers || {};
  const headerValue = typeof headers.get === "function"
    ? (name) => headers.get(name)
    : (name) => headers[name.toLowerCase()] || headers[name];
  const explicitToken = String(headerValue("x-codexbridge-token") || "").trim();
  if (explicitToken && timingSafeEqualString(explicitToken, token)) {
    return true;
  }
  const authorization = String(headerValue("authorization") || "").trim();
  if (/^Bearer\s+/i.test(authorization)) {
    return timingSafeEqualString(authorization.replace(/^Bearer\s+/i, "").trim(), token);
  }
  if (/^Basic\s+/i.test(authorization)) {
    return timingSafeEqualString(parseBasicAuthPassword(authorization), token);
  }
  return false;
}
