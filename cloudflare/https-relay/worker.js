const PULL_PATH = "/_gory_relay/pull";
const PUSH_PATH = "/_gory_relay/push";
const STATUS_PATH = "/_gory_relay/status";
const PRIVATE_PREFIX = "/_gory_relay/";
const HUB_NAME = "restaurant-main";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function encodeBody(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBody(body) {
  const binary = atob(body || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function combineDecodedChunks(chunks, lastSequence) {
  const decoded = [];
  let length = 0;
  for (let sequence = 0; sequence <= lastSequence; sequence += 1) {
    const part = decodeBody(chunks.get(sequence));
    decoded.push(part);
    length += part.length;
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of decoded) {
    body.set(part, offset);
    offset += part.length;
  }
  return body;
}

function responseHeaders(headers = {}) {
  const result = new Headers(headers);
  result.delete("content-length");
  result.delete("transfer-encoding");
  result.set("cache-control", "no-store, no-transform");
  return result;
}

function bytesStream(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function proxiedResponse(bytes, status, headers) {
  return new Response(bytesStream(bytes), {
    status,
    headers: responseHeaders(headers),
  });
}

function headersToObject(headers) {
  return Object.fromEntries(headers.entries());
}

function safeCloseCode(code) {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code)
    ? code
    : 1000;
}

export class RelayHub {
  constructor(state) {
    this.state = state;
    this.pending = new Map();
  }

  async markRestaurantSeen() {
    const lastSeen = await this.state.storage.get("lastRestaurantSeen");
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen >= 30000) {
      await this.state.storage.put("lastRestaurantSeen", Date.now());
    }
  }

  async isRestaurantConnected() {
    const lastSeen = await this.state.storage.get("lastRestaurantSeen");
    return Number.isFinite(lastSeen) && Date.now() - lastSeen < 45000;
  }

  findClient(id) {
    return this.state.getWebSockets("client").find((socket) => {
      const attachment = socket.deserializeAttachment();
      return socket.readyState === 1 && attachment && attachment.id === id;
    });
  }

  async deliverToRestaurant(message) {
    const outbox = (await this.state.storage.get("outbox")) || [];
    outbox.push(message);
    await this.state.storage.put("outbox", outbox.slice(-1000));
  }

  async pull() {
    await this.markRestaurantSeen();
    const outbox = await this.state.storage.get("outbox");
    if (!Array.isArray(outbox) || !outbox.length) {
      return json({ ok: true, messages: [] });
    }
    const messages = outbox.slice(0, 100);
    const remaining = outbox.slice(100);
    if (remaining.length) {
      await this.state.storage.put("outbox", remaining);
    } else {
      await this.state.storage.delete("outbox");
    }
    return json({ ok: true, messages });
  }

  async push(request) {
    await this.markRestaurantSeen();
    let messages;
    try {
      const payload = await request.json();
      messages = Array.isArray(payload) ? payload : [payload];
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    for (const message of messages) {
      this.handleRestaurantMessage(message);
    }
    return json({ ok: true });
  }

  async connectClient(request) {
    const id = crypto.randomUUID();
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const sockets = Object.values(pair);
    const client = sockets[0];
    const server = sockets[1];
    server.serializeAttachment({ role: "client", id });
    this.state.acceptWebSocket(server, ["client"]);
    if (!await this.isRestaurantConnected()) {
      server.close(1013, "restaurant offline");
    } else {
      await this.deliverToRestaurant({
        type: "ws_open",
        id,
        path: url.pathname + url.search,
        headers: headersToObject(request.headers),
      });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async proxyHttp(request) {
    if (!await this.isRestaurantConnected()) {
      return json({ ok: false, error: "restaurant_offline" }, 503);
    }
    const id = crypto.randomUUID();
    const url = new URL(request.url);
    const buffer = request.method === "GET" || request.method === "HEAD"
      ? new ArrayBuffer(0)
      : await request.arrayBuffer();
    await this.deliverToRestaurant({
      type: "http_request",
      id,
      method: request.method,
      path: url.pathname + url.search,
      headers: headersToObject(request.headers),
      body: encodeBody(buffer),
    });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(json({ ok: false, error: "restaurant_timeout" }, 504));
      }, 30000);
      this.pending.set(id, { resolve, timer, chunks: new Map(), lastSequence: null, status: null, headers: null });
    });
  }

  handleRestaurantMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "http_response") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      pending.resolve(proxiedResponse(decodeBody(message.body), message.status, message.headers));
      return;
    }
    if (message.type === "http_response_chunk") {
      const pending = this.pending.get(message.id);
      if (!pending || !Number.isInteger(message.sequence) || message.sequence < 0) {
        return;
      }
      pending.chunks.set(message.sequence, message.data || "");
      if (message.sequence === 0) {
        pending.status = message.status;
        pending.headers = message.headers;
      }
      if (message.final === true) {
        pending.lastSequence = message.sequence;
      }
      if (pending.lastSequence === null || !Number.isInteger(pending.status)) {
        return;
      }
      for (let sequence = 0; sequence <= pending.lastSequence; sequence += 1) {
        if (!pending.chunks.has(sequence)) {
          return;
        }
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      pending.resolve(proxiedResponse(combineDecodedChunks(pending.chunks, pending.lastSequence), pending.status, pending.headers));
      return;
    }
    const client = this.findClient(message.id);
    if (!client) {
      return;
    }
    if (message.type === "ws_data") {
      client.send(message.binary ? decodeBody(message.data) : message.data);
    } else if (message.type === "ws_close") {
      client.close(safeCloseCode(message.code), message.reason || "");
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === PULL_PATH) {
      return this.pull();
    }
    if (url.pathname === PUSH_PATH) {
      return this.push(request);
    }
    if (url.pathname === STATUS_PATH) {
      return json({ ok: true, connected: await this.isRestaurantConnected() });
    }
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return this.connectClient(request);
    }
    return this.proxyHttp(request);
  }

  async webSocketMessage(socket, message) {
    const attachment = socket.deserializeAttachment() || {};
    if (attachment.role !== "client" || !await this.isRestaurantConnected()) {
      return;
    }
    await this.deliverToRestaurant({
      type: "ws_data",
      id: attachment.id,
      binary: typeof message !== "string",
      data: typeof message === "string" ? message : encodeBody(message),
    });
  }

  async webSocketClose(socket, code, reason) {
    const attachment = socket.deserializeAttachment() || {};
    if (attachment.role === "client" && await this.isRestaurantConnected()) {
      await this.deliverToRestaurant({
        type: "ws_close",
        id: attachment.id,
        code: safeCloseCode(code),
        reason,
      });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isPrivate = url.pathname === PULL_PATH || url.pathname === PUSH_PATH;
    if (isPrivate && request.headers.get("authorization") !== `Bearer ${env.RELAY_REGISTER_TOKEN}`) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (url.pathname.startsWith(PRIVATE_PREFIX) && !isPrivate && url.pathname !== STATUS_PATH) {
      return json({ ok: false, error: "not_found" }, 404);
    }
    const id = env.RELAY_HUB.idFromName(HUB_NAME);
    return env.RELAY_HUB.get(id).fetch(request);
  },
};
