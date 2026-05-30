const DEFAULT_IIKO_API_BASE = 'https://api-ru.iiko.services';

function normalizeApiBase(value) {
  return String(value || DEFAULT_IIKO_API_BASE).replace(/\/+$/, '');
}

function iikoErrorMessage(path, response, payload) {
  const detail =
    payload?.errorDescription ||
    payload?.description ||
    payload?.message ||
    payload?.error ||
    response.statusText;
  return `iiko request ${path} failed with ${response.status}: ${detail}`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function createIikoHttpClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime.');
  }

  const apiBase = normalizeApiBase(config.apiBase);
  let token = null;

  async function post(path, body, auth = true) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Timeout: '15',
    };
    if (auth) {
      if (!token) {
        token = await accessToken();
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(`${apiBase}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(iikoErrorMessage(path, response, payload));
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async function accessToken() {
    const response = await post('/api/1/access_token', { apiLogin: config.apiLogin }, false);
    if (!response?.token) {
      throw new Error('iiko access token response did not contain token.');
    }
    return response.token;
  }

  return {
    async fetchOrganizations(organizationIds = null) {
      return await post('/api/1/organizations', {
        organizationIds,
        returnAdditionalInfo: true,
        includeDisabled: false,
      });
    },
    async fetchNomenclature(organizationId) {
      return await post('/api/1/nomenclature', {
        organizationId,
        startRevision: 0,
      });
    },
    async fetchStopLists(organizationId, terminalGroupId = null) {
      const body = {
        organizationIds: [organizationId],
        returnSize: true,
      };
      if (terminalGroupId) {
        body.terminalGroupsIds = [terminalGroupId];
      }
      return await post('/api/1/stop_lists', body);
    },
    async fetchTerminalGroups(organizationIds) {
      return await post('/api/1/terminal_groups', {
        organizationIds: Array.isArray(organizationIds) ? organizationIds : [organizationIds],
        includeDisabled: false,
      });
    },
    async fetchPaymentTypes(organizationIds) {
      return await post('/api/1/payment_types', {
        organizationIds: Array.isArray(organizationIds) ? organizationIds : [organizationIds],
      });
    },
    async createTableOrder(payload) {
      return await post('/api/1/order/create', payload);
    },
    async addOrderItems(payload) {
      return await post('/api/1/order/add_items', payload);
    },
    async fetchOrderById(payload) {
      return await post('/api/1/order/by_id', payload);
    },
    async closeOrder(payload) {
      return await post('/api/1/order/close', payload);
    },
    async fetchCommandStatus(payload) {
      return await post('/api/1/commands/status', payload);
    },
  };
}

module.exports = {
  DEFAULT_IIKO_API_BASE,
  createIikoHttpClient,
  normalizeApiBase,
};
