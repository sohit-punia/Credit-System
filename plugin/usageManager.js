// plugin/usageManager.js
// Usage: import usageManager from './usageManager.js'
import { v4 as uuidv4 } from 'uuid';

const API = {
  base: '',
  userId: null,
  headers() { return { 'Content-Type': 'application/json', 'x-user-id': this.userId }; },
  async get(path) { const r = await fetch(this.base + path, { headers: this.headers() }); return r.json(); },
  async post(path, body) { const r = await fetch(this.base + path, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) }); return r.json(); }
};

const Queue = {
  key: 'usage_queue',
  push(item) {
    const arr = JSON.parse(localStorage.getItem(this.key) || '[]');
    arr.push(item);
    localStorage.setItem(this.key, JSON.stringify(arr));
  },
  popAll() { const arr = JSON.parse(localStorage.getItem(this.key) || '[]'); localStorage.removeItem(this.key); return arr; }
};

const usageManager = {
  pricing: null,
  balance: 0,
  async init({ apiBaseUrl, userId }) {
    API.base = apiBaseUrl;
    API.userId = userId;
    this.pricing = await API.get('/api/pricing');
    const bal = await API.get('/api/credits');
    this.balance = bal.balance;
    this.flushQueue();
    return { pricing: this.pricing, balance: this.balance };
  },

  computeEstimate(toolId, params = {}) {
    const p = this.pricing.find(x => x.toolId === toolId);
    if (!p) return 0;
    let cost = p.base || 0;
    if (toolId === 'pdf_exporter') {
      const pages = params.pages || 1;
      cost += (pages > 1) ? (pages - 1) * (p.perPage || 0) : 0;
      if (params.multiPage) cost += (p.addons && p.addons.multiPage) || 0;
      if (params.hiRes) cost += (p.addons && p.addons.highRes) || 0;
    }
    if (toolId === 'palette') {
      if (params.wcag) cost += (p.addons && p.addons.wcagCheck) || 0;
    }
    if (toolId === 'unit_convert') {
      // adjust if perItem pricing needed
    }
    if (toolId === 'import_tool') {
      if (params.largeFile) cost += (p.addons && p.addons.largeFile) || 0;
    }
    return Math.max(0, Math.floor(cost));
  },

  async trackUsage({ toolId, params = {}, run }) {
    const estimate = this.computeEstimate(toolId, params);
    if (this.balance < estimate) {
      throw { code: 'INSUFFICIENT_FUNDS', needed: estimate - this.balance };
    }

    const idempotencyKey = uuidv4();
    const pluginRequestId = `${toolId}-${Date.now().toString(36).slice(2,8)}`;

    const startResp = await API.post('/api/usage/start', { toolId, estimate, meta: params, pluginRequestId, idempotencyKey, hold: true });
    if (!startResp || !startResp.ok) {
      if (startResp && startResp.code === 'INSUFFICIENT_FUNDS') throw startResp;
      throw { code: 'NETWORK_ERROR', detail: startResp };
    }

    if (typeof startResp.newBalance === 'number') this.balance = startResp.newBalance;

    let runResult;
    try {
      runResult = await run(); // the tool's async work
    } catch (err) {
      await API.post('/api/usage/cancel', { pluginRequestId, idempotencyKey, reason: err.message }).catch(()=>{});
      throw err;
    }

    const actualCost = this.computeEstimate(toolId, { ...params, ...runResult });

    try {
      const fin = await API.post('/api/usage/finalize', { pluginRequestId, idempotencyKey, actualCost, meta: runResult });
      if (!fin || !fin.ok) {
        Queue.push({ type: 'finalize', payload: { pluginRequestId, idempotencyKey, actualCost, meta: runResult } });
        return { status: 'queued_finalization' };
      }
      this.balance = fin.newBalance;
      return { status: 'ok', newBalance: this.balance, runResult };
    } catch (err) {
      Queue.push({ type: 'finalize', payload: { pluginRequestId, idempotencyKey, actualCost, meta: runResult } });
      return { status: 'queued_finalization' };
    }
  },

  async flushQueue() {
    const items = Queue.popAll();
    for (const item of items) {
      if (item.type === 'finalize') {
        try {
          const fin = await API.post('/api/usage/finalize', item.payload);
          if (fin && fin.ok) this.balance = fin.newBalance;
        } catch (e) {
          Queue.push(item);
        }
      }
    }
  }
};

export default usageManager;
