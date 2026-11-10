// Thin REST client for the Hydro Go backend (see ../../openapi.yaml).
// Pure ES module: no DOM dependencies, so it also runs under Node for headless tests.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function createApi({ baseUrl = '', mlKey = 'dev-ml-secret-key' } = {}) {
  async function call(method, path, body, { auth = false, okStatuses = [] } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && mlKey) headers.Authorization = `Bearer ${mlKey}`;
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text }; }
    }
    if (!res.ok && !okStatuses.includes(res.status)) throw new ApiError(res.status, data);
    return { status: res.status, data };
  }

  const sim = (id) => `/api/v1/simulations/${encodeURIComponent(id)}`;

  return {
    health: () => call('GET', '/healthz').then((r) => r.data),

    // Farms
    validateFarm: (spec) => call('POST', '/api/v1/farms/validate', spec, { okStatuses: [422] }).then((r) => r.data),
    createFarm: (spec) => call('POST', '/api/v1/farms', spec).then((r) => r.data),
    listFarms: () => call('GET', '/api/v1/farms').then((r) => r.data),

    // Simulations
    createSimulation: (body) => call('POST', '/api/v1/simulations', body).then((r) => r.data),
    getSimulation: (id) => call('GET', sim(id)).then((r) => r.data),
    advance: (id, steps) => call('POST', `${sim(id)}/advance`, { steps }).then((r) => r.data),
    setClock: (id, mode, speed) => call('POST', `${sim(id)}/clock`, { mode, speed_multiplier: speed }).then((r) => r.data),
    injectFault: (id, fault) => call('POST', `${sim(id)}/faults`, fault).then((r) => r.data),

    // Telemetry
    readings: (id, limit = 200) => call('GET', `${sim(id)}/readings?limit=${limit}`).then((r) => r.data || []),
    groundTruth: (id) => call('GET', `${sim(id)}/ground-truth`).then((r) => r.data),

    // Controller I/O (POST requires the ML bearer key; the PLC guardian may answer 422)
    listAlerts: (id) => call('GET', `${sim(id)}/alerts`).then((r) => r.data || []),
    listCommands: (id) => call('GET', `${sim(id)}/commands`).then((r) => r.data || []),
    postAlert: (id, alert) => call('POST', `${sim(id)}/alerts`, alert, { auth: true }).then((r) => r.data),
    postCommand: (id, cmd) => call('POST', `${sim(id)}/commands`, cmd, { auth: true, okStatuses: [422] }).then((r) => r.data),
  };
}
