/* Universal AI client adapter for Personal AI Hub.
 * IMPORTANT: this delegates to the existing ai-app-kernel execution plane.
 * It does not create a second provider/token/router system.
 */
window.UniversalAI = (() => {
  async function json(url, options = {}) {
    const r = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.message || j.error || `HTTP ${r.status}`);
      err.status = r.status; err.payload = j; throw err;
    }
    return j;
  }
  function create(opts = {}) {
    const history = [];
    const button = opts.button;
    if (button) button.addEventListener('click', () => opts.onOpen?.());
    return {
      async status() { return json('/ai/health'); },
      async catalog() { return json('/ai/providers'); },
      async keys(provider = '') { return json('/ai/keys' + (provider ? `?provider=${encodeURIComponent(provider)}` : '')); },
      async addKey(provider, token, model = null, baseUrl = '') { return json('/ai/keys', { method: 'POST', body: JSON.stringify({ provider, token, model, baseUrl }) }); },
      async testKey(id) { return json(`/ai/keys/${encodeURIComponent(id)}/test`, { method: 'POST' }); },
      async removeKey(id) { return json(`/ai/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
      async models(force = false) { return json('/ai/local/models' + (force ? '?force=1' : '')); },
      async localPull(name) { return json('/ai/local/models/pull', { method: 'POST', body: JSON.stringify({ name }) }); },
      async localBaseUrl(url) { return json('/ai/local/base-url', { method: 'POST', body: JSON.stringify({ url }) }); },
      async routing() { return json('/ai/routing'); },
      async setRouting(mode) { return json('/ai/routing', { method: 'POST', body: JSON.stringify({ mode }) }); },
      async logs(limit = 300) { return json(`/ai/logs?limit=${limit}`); },
      async clearLogs() { return json('/ai/logs', { method: 'DELETE' }); },
      async chat(message, context = {}, extra = {}) {
        const out = await json('/ai/chat', { method: 'POST', body: JSON.stringify({
          message, context, provider: extra.provider || undefined, model: extra.model || undefined,
          history: history.slice(-8), appId: 'hub-ui'
        }) });
        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: out.reply || '' });
        while (history.length > 20) history.splice(0, 2);
        if (Array.isArray(out.actions)) opts.onActions?.(out.actions);
        return out;
      },
      clearHistory() { history.length = 0; },
      history
    };
  }
  return { create };
})();
