"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const zlib = require("zlib");
const WebSocket = require("ws");

const root = path.resolve(__dirname, "..");
const publicUrl = (process.env.GORY_PUBLIC_URL || "https://app.gory-staff.ru").replace(/\/+$/, "");
const localPort = Number(process.env.GORY_LOCAL_PORT || 4000);
const tokenPath = process.env.GORY_RELAY_TOKEN_PATH || path.join(root, "runtime", "https-relay", "register-token.txt");
const logPath = path.join(root, "runtime", "logs", "edge-connector.log");
const pidPath = path.join(root, "runtime", "https-relay", "edge-connector.pid");
const localSockets = new Map();
const HTTP_RESPONSE_CHUNK_BYTES = 16 * 1024;
const GZIP_MIN_RESPONSE_BYTES = 8 * 1024;
const RELAY_REQUEST_TIMEOUT_MS = 35000;
const PUSH_REQUEST_TIMEOUT_MS = 5000;
const RETRYABLE_PUSH_TYPES = new Set(["http_response", "http_response_chunk"]);
const PUSH_MAX_ATTEMPTS = 4;
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.mkdirSync(path.dirname(pidPath), { recursive: true });
fs.writeFileSync(pidPath, String(process.pid), "ascii");

function log(text) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${text}\n`, "utf8");
}

function relayToken() {
  return fs.readFileSync(tokenPath, "utf8").trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeCloseCode(code) {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code)
    ? code
    : 1000;
}

function cleanRequestHeaders(headers) {
  const result = { ...headers, host: `127.0.0.1:${localPort}` };
  delete result["content-length"];
  delete result["cf-connecting-ip"];
  delete result["cf-ray"];
  delete result["cf-visitor"];
  delete result["cf-ipcountry"];
  return result;
}

function cleanResponseHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP_RESPONSE_HEADERS.has(name.toLowerCase())) {
      result[name] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
  return result;
}

function requestAcceptsGzip(headers = {}) {
  const explicitRelayGzip = String(headers["x-gory-accept-gzip"] || headers["X-Gory-Accept-Gzip"] || "") === "1";
  return explicitRelayGzip && String(headers["accept-encoding"] || headers["Accept-Encoding"] || "").toLowerCase().includes("gzip");
}

function isCompressibleResponse(headers = {}) {
  const contentType = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  return /json|text|javascript|xml/.test(contentType);
}

function withVaryAcceptEncoding(headers) {
  const current = String(headers.vary || headers.Vary || "").trim();
  if (!current) {
    headers.vary = "Accept-Encoding";
    return;
  }
  if (!current.toLowerCase().split(",").map((item) => item.trim()).includes("accept-encoding")) {
    headers.vary = `${current}, Accept-Encoding`;
  }
}

function prepareResponsePayload(requestHeaders, responseHeaders, body) {
  const headers = cleanResponseHeaders(responseHeaders);
  const shouldGzip =
    body.length >= GZIP_MIN_RESPONSE_BYTES &&
    requestAcceptsGzip(requestHeaders) &&
    isCompressibleResponse(headers) &&
    !headers["content-encoding"] &&
    !headers["Content-Encoding"];

  if (!shouldGzip) {
    return { headers, body, encoding: "identity" };
  }

  const compressed = zlib.gzipSync(body);
  if (compressed.length >= body.length) {
    return { headers, body, encoding: "identity" };
  }

  headers["content-encoding"] = "gzip";
  withVaryAcceptEncoding(headers);
  return { headers, body: compressed, encoding: "gzip" };
}

function relayRequest(endpoint, message = {}, timeoutMs = RELAY_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const url = new URL(endpoint, publicUrl);
    const request = https.request(url, {
      method: "POST",
      agent: false,
      headers: {
        authorization: `Bearer ${relayToken()}`,
        "content-type": "application/json; charset=utf-8",
        "content-length": body.length,
        connection: "close",
      },
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`relay ${endpoint} returned ${response.statusCode}: ${text}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`relay ${endpoint} returned invalid JSON`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`relay ${endpoint} timed out after ${timeoutMs}ms`)));
    request.on("error", reject);
    request.end(body);
  });
}

async function push(message) {
  const maxAttempts = RETRYABLE_PUSH_TYPES.has(message.type) ? PUSH_MAX_ATTEMPTS : 1;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await relayRequest("/_gory_relay/push", message, PUSH_REQUEST_TIMEOUT_MS);
      if (attempt > 1) {
        log(`Push recovered for ${message.type} after ${attempt} attempts.`);
      }
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await delay(250 * attempt);
      }
    }
  }
  log(`Push failed for ${message.type} after ${maxAttempts} attempts: ${lastError.message}`);
  return false;
}

async function pushHttpResponse(message) {
  const body = Buffer.from(message.body || "", "base64");
  if (body.length <= HTTP_RESPONSE_CHUNK_BYTES) {
    return push(message);
  }
  const chunkCount = Math.ceil(body.length / HTTP_RESPONSE_CHUNK_BYTES);
  for (let sequence = 0; sequence < chunkCount; sequence += 1) {
    const start = sequence * HTTP_RESPONSE_CHUNK_BYTES;
    const delivered = await push({
      type: "http_response_chunk",
      id: message.id,
      sequence,
      final: sequence === chunkCount - 1,
      status: sequence === 0 ? message.status : undefined,
      headers: sequence === 0 ? message.headers : undefined,
      data: body.subarray(start, start + HTTP_RESPONSE_CHUNK_BYTES).toString("base64"),
    });
    if (!delivered) {
      return false;
    }
  }
  return true;
}

function handleHttpRequest(message) {
  log(`Forwarding public HTTP ${message.method || "GET"} ${message.path || "/"}.`);
  const request = http.request({
    hostname: "127.0.0.1",
    port: localPort,
    path: message.path,
    method: message.method,
    headers: cleanRequestHeaders(message.headers),
  }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", async () => {
      const body = Buffer.concat(chunks);
      const payload = prepareResponsePayload(message.headers, response.headers, body);
      const delivered = await pushHttpResponse({
        type: "http_response",
        id: message.id,
        status: response.statusCode || 502,
        headers: payload.headers,
        body: payload.body.toString("base64"),
      });
      log(`Completed public HTTP ${message.method || "GET"} ${message.path || "/"}: status=${response.statusCode || 502}, bytes=${body.length}, sent=${payload.body.length}, encoding=${payload.encoding}, delivered=${delivered}.`);
    });
  });
  request.on("error", async (error) => {
    const delivered = await pushHttpResponse({
      type: "http_response",
      id: message.id,
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: Buffer.from(JSON.stringify({ ok: false, error: "local_api_unreachable" })).toString("base64"),
    });
    log(`HTTP relay failed for ${message.method || "GET"} ${message.path || "/"}: ${error.message}, delivered=${delivered}.`);
  });
  if (message.body) {
    request.write(Buffer.from(message.body, "base64"));
  }
  request.end();
}

function handleWebSocketOpen(message) {
  if (localSockets.has(message.id)) {
    return;
  }
  log(`Opening local WebSocket ${message.id}.`);
  const local = new WebSocket(`ws://127.0.0.1:${localPort}${message.path}`, {
    headers: cleanRequestHeaders(message.headers),
  });
  localSockets.set(message.id, local);
  local.on("message", (data, isBinary) => {
    push({
      type: "ws_data",
      id: message.id,
      binary: isBinary,
      data: isBinary ? Buffer.from(data).toString("base64") : data.toString(),
    });
  });
  local.on("close", (code, reason) => {
    localSockets.delete(message.id);
    log(`Local WebSocket closed ${message.id} (code ${code}, reason ${reason.toString() || "none"}).`);
    push({ type: "ws_close", id: message.id, code: safeCloseCode(code), reason: reason.toString() });
  });
  local.on("error", (error) => {
    log(`Local WebSocket failed: ${error.message}`);
  });
}

function handleRelayMessage(message) {
  if (message.type === "http_request") {
    handleHttpRequest(message);
    return;
  }
  if (message.type === "ws_open") {
    handleWebSocketOpen(message);
    return;
  }
  const local = localSockets.get(message.id);
  if (!local) {
    return;
  }
  if (message.type === "ws_data" && local.readyState === WebSocket.OPEN) {
    local.send(message.binary ? Buffer.from(message.data, "base64") : message.data);
  } else if (message.type === "ws_close") {
    local.close(safeCloseCode(message.code), message.reason || "");
  }
}

async function pollLoop(name) {
  log(`HTTPS relay poller ${name} started.`);
  let offlineLogged = false;
  while (true) {
    try {
      const reply = await relayRequest("/_gory_relay/pull");
      if (offlineLogged) {
        log(`HTTPS relay poller ${name} connected again.`);
        offlineLogged = false;
      }
      for (const message of reply.messages || []) {
        handleRelayMessage(message);
      }
      await delay(1500);
    } catch (error) {
      if (!offlineLogged) {
        log(`HTTPS relay poller ${name} failed: ${error.message}`);
        offlineLogged = true;
      }
      await delay(1000);
    }
  }
}

process.on("exit", () => {
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // PID cleanup is best effort.
  }
});

log("Starting restaurant HTTPS relay connector.");
pollLoop("A");
