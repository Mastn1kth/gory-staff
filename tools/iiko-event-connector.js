"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const DEFAULT_SERVER_URL = "http://127.0.0.1:4000";
const DEFAULT_ENV_FILE = path.join(root, "server", ".env");
const DEFAULT_STATE_FILE = path.join(root, "runtime", "iiko-event-connector-state.json");
const DEFAULT_EVENTS_DIR = path.join(root, "runtime", "iiko", "events");
const ORDER_EVENT_PATH = "/iiko/events/order-updated";
const PAYMENT_EVENT_PATH = "/iiko/events/payment-paid";

const PAYMENT_TYPES = new Set([
  "payment_paid",
  "payment-paid",
  "paymentpaid",
  "payment_succeeded",
  "payment-succeeded",
  "order_paid",
  "order-paid",
  "order_closed",
  "order-closed",
  "paid",
]);

const PAID_STATUSES = new Set([
  "paid",
  "closed",
  "completed",
  "complete",
  "success",
  "succeeded",
  "processed",
  "payment_succeeded",
  "order_paid",
  "order_closed",
]);

const ORDER_TYPES = new Set([
  "order_updated",
  "order-updated",
  "orderupdated",
  "order_changed",
  "order-changed",
  "orderchanged",
  "order_created",
  "order-created",
  "ordercreated",
  "order_opened",
  "order-opened",
  "orderopened",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function firstText(...values) {
  for (const value of values) {
    const text = compactText(value);
    if (text) return text;
  }
  return null;
}

function normalizedToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "_")
    .replace(/\s+/g, "_");
}

function hasOrderIdentity(event) {
  const order = asObject(event.order);
  return Boolean(firstText(event.order_id, event.orderId, event.iiko_order_id, event.iikoOrderId, order.id, order.order_id, order.orderId));
}

function classifyIikoConnectorEvent(event) {
  const payload = asObject(event);
  const eventType = normalizedToken(firstText(payload.type, payload.event_type, payload.eventType, payload.name));
  const status = normalizedToken(firstText(payload.status, payload.payment_status, payload.paymentStatus, asObject(payload.payment).status));

  if (
    PAYMENT_TYPES.has(eventType) ||
    PAID_STATUSES.has(status) ||
    payload.paid === true ||
    payload.is_paid === true
  ) {
    return "payment-paid";
  }

  if (ORDER_TYPES.has(eventType) || hasOrderIdentity(payload)) {
    return "order-updated";
  }

  return null;
}

function connectorTargetPath(event) {
  const type = classifyIikoConnectorEvent(event);
  if (type === "payment-paid") return PAYMENT_EVENT_PATH;
  if (type === "order-updated") return ORDER_EVENT_PATH;
  return null;
}

function readConnectorEventsFromText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];

  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === "object");
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      // Fall through to JSONL parsing.
    }
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((item) => item && typeof item === "object");
}

async function readEventsFromFile(file) {
  return readConnectorEventsFromText(await fs.readFile(file, "utf8"));
}

async function readEventsFromDirectory(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(json|jsonl)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  const events = [];
  for (const file of files) {
    events.push(...(await readEventsFromFile(file)));
  }
  return events;
}

async function readEventsFromStdin(stdin = process.stdin) {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return readConnectorEventsFromText(Buffer.concat(chunks).toString("utf8"));
}

function parseConnectorEnvFile(text) {
  const env = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadConnectorEnvFile(envFile = DEFAULT_ENV_FILE) {
  if (!envFile) return {};
  try {
    return parseConnectorEnvFile(await fs.readFile(envFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function eventDedupKey(event) {
  const payload = asObject(event);
  const order = asObject(payload.order);
  const payment = asObject(payload.payment ?? (Array.isArray(payload.payments) ? payload.payments[0] : null));
  const eventId = firstText(payload.event_id, payload.eventId, payload.id);
  const paymentId = firstText(payload.payment_id, payload.paymentId, payload.iiko_payment_id, payload.iikoPaymentId, payment.id);
  const orderId = firstText(payload.order_id, payload.orderId, payload.iiko_order_id, payload.iikoOrderId, order.id);

  if (eventId) return `event:${eventId}`;
  if (paymentId) return `payment:${paymentId}`;
  if (orderId) return `order:${orderId}:${classifyIikoConnectorEvent(payload) || "unknown"}`;
  return `payload:${JSON.stringify(payload)}`;
}

async function loadState(stateFile) {
  if (!stateFile) return { sentEventKeys: [] };
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, "utf8"));
    return {
      sentEventKeys: Array.isArray(parsed.sentEventKeys) ? parsed.sentEventKeys.filter(Boolean) : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") return { sentEventKeys: [] };
    throw error;
  }
}

async function saveState(stateFile, state) {
  if (!stateFile) return;
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const payload = {
    sentEventKeys: Array.from(new Set(state.sentEventKeys || [])).sort(),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function sendIikoConnectorEvent(options = {}) {
  const event = asObject(options.event);
  const targetPath = connectorTargetPath(event);
  if (!targetPath) {
    return { status: "skipped", reason: "unsupported_event_type" };
  }

  const serverUrl = String(options.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, "");
  const secret = String(options.secret || "").trim();
  if (!secret) throw new Error("IIKO webhook secret is required.");

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node runtime.");

  const response = await fetchImpl(`${serverUrl}${targetPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-gory-iiko-secret": secret,
    },
    body: JSON.stringify(event),
  });
  const body = await parseResponseBody(response);
  if (!response.ok) {
    const message = typeof body === "string" ? body : body?.error || response.statusText || "request failed";
    const error = new Error(`iiko webhook ${targetPath} returned ${response.status}: ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return { status: "sent", targetPath, response: body };
}

async function loadInputEvents(options = {}) {
  if (options.events) return Array.isArray(options.events) ? options.events : [options.events];
  if (options.file) return readEventsFromFile(options.file);
  if (options.dir) return readEventsFromDirectory(options.dir);
  return readEventsFromStdin(options.stdin);
}

async function runIikoEventConnector(options = {}) {
  const stateFile = options.stateFile === undefined ? DEFAULT_STATE_FILE : options.stateFile;
  const state = await loadState(stateFile);
  const sentKeys = new Set(state.sentEventKeys || []);
  const events = await loadInputEvents(options);
  const summary = { read: events.length, sent: 0, skipped: 0, failed: 0 };

  for (const event of events) {
    const key = eventDedupKey(event);
    if (sentKeys.has(key)) {
      summary.skipped += 1;
      continue;
    }
    let result;
    try {
      result = await sendIikoConnectorEvent({
        event,
        serverUrl: options.serverUrl,
        secret: options.secret,
        fetchImpl: options.fetchImpl,
      });
    } catch (error) {
      summary.failed += 1;
      options.logger?.warn?.(`Failed to send iiko event ${key}: ${error.message}`);
      continue;
    }
    if (result.status === "skipped") {
      summary.skipped += 1;
      continue;
    }
    sentKeys.add(key);
    summary.sent += 1;
  }

  state.sentEventKeys = Array.from(sentKeys);
  await saveState(stateFile, state);
  return summary;
}

function addSummaries(left, right) {
  return {
    read: Number(left.read ?? 0) + Number(right.read ?? 0),
    sent: Number(left.sent ?? 0) + Number(right.sent ?? 0),
    skipped: Number(left.skipped ?? 0) + Number(right.skipped ?? 0),
    failed: Number(left.failed ?? 0) + Number(right.failed ?? 0),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runIikoEventConnectorWatch(options = {}) {
  const iterations = options.watchIterations === undefined ? Infinity : Number(options.watchIterations);
  const intervalMs = Math.max(100, Number(options.watchIntervalMs ?? 1000));
  const delayImpl = options.delayImpl || delay;
  const aggregate = { iterations: 0, read: 0, sent: 0, skipped: 0, failed: 0 };

  for (let index = 0; index < iterations; index += 1) {
    const summary = await runIikoEventConnector(options);
    const total = addSummaries(aggregate, summary);
    aggregate.iterations += 1;
    aggregate.read = total.read;
    aggregate.sent = total.sent;
    aggregate.skipped = total.skipped;
    aggregate.failed = total.failed;
    options.logger?.log?.(JSON.stringify({ ...summary, iteration: aggregate.iterations }));
    if (index + 1 < iterations) {
      await delayImpl(intervalMs);
    }
  }

  return aggregate;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      options.file = argv[++index];
    } else if (arg === "--dir") {
      options.dir = argv[++index];
    } else if (arg === "--state-file") {
      options.stateFile = argv[++index];
    } else if (arg === "--server-url") {
      options.serverUrl = argv[++index];
    } else if (arg === "--secret") {
      options.secret = argv[++index];
    } else if (arg === "--env-file") {
      options.envFile = argv[++index];
    } else if (arg === "--watch") {
      options.watch = true;
    } else if (arg === "--interval-ms") {
      options.watchIntervalMs = Number(argv[++index]);
    } else if (arg === "--no-state") {
      options.stateFile = null;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node tools/iiko-event-connector.js --file runtime/iiko/events.jsonl",
    "  node tools/iiko-event-connector.js --dir runtime/iiko/events",
    "  type events.jsonl | node tools/iiko-event-connector.js",
    "  node tools/iiko-event-connector.js --dir runtime/iiko/events --watch",
    "",
    "Options:",
    "  --server-url <url>       Gory Staff server URL. Default: GORY_SERVER_URL or http://127.0.0.1:4000",
    "  --secret <secret>        IIKO webhook secret. Default: IIKO_WEBHOOK_SECRET or GORY_IIKO_WEBHOOK_SECRET",
    "  --env-file <path>        Load env values from a file. Default: server/.env",
    "  --file <path>            Read one JSON/JSONL file.",
    "  --dir <path>             Read all .json/.jsonl files in a directory.",
    "  --watch                  Keep polling --file or --dir. Default input for watch: runtime/iiko/events",
    "  --interval-ms <ms>       Watch polling interval. Default: 1000",
    "  --state-file <path>      State file for sent event ids. Default: runtime/iiko-event-connector-state.json",
    "  --no-state               Disable connector-side dedup state.",
  ].join("\n");
}

function resolveConnectorConfig(cli = {}, env = {}) {
  return {
    serverUrl: cli.serverUrl || env.GORY_SERVER_URL || DEFAULT_SERVER_URL,
    secret: cli.secret || env.IIKO_WEBHOOK_SECRET || env.GORY_IIKO_WEBHOOK_SECRET,
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }
  const fileEnv = await loadConnectorEnvFile(cli.envFile === undefined ? DEFAULT_ENV_FILE : cli.envFile);
  const config = resolveConnectorConfig(cli, { ...fileEnv, ...process.env });
  const runOptions = {
    ...cli,
    ...config,
    dir: cli.watch && !cli.file && !cli.dir ? DEFAULT_EVENTS_DIR : cli.dir,
    logger: console,
  };
  const summary = cli.watch
    ? await runIikoEventConnectorWatch(runOptions)
    : await runIikoEventConnector(runOptions);
  console.log(JSON.stringify(summary));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  classifyIikoConnectorEvent,
  connectorTargetPath,
  eventDedupKey,
  loadConnectorEnvFile,
  parseArgs,
  parseConnectorEnvFile,
  readConnectorEventsFromText,
  resolveConnectorConfig,
  runIikoEventConnector,
  runIikoEventConnectorWatch,
  sendIikoConnectorEvent,
};
