/**
 * OpenAI-compatible API for SoloHost Custom Providers.
 * Registers explicit paths on the Express app (no Router dependency).
 * MUST be called before the /v1 JSON 404 catch-all in index.js.
 */
import { randomUUID } from 'node:crypto';

function extractText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.type === 'image_url') return '[image]';
      if (part?.type === 'input_audio') return '[audio]';
      if (part?.type === 'file') return '[file]';
      return '';
    }).join('');
  }
  return String(content);
}

/** True if any message has non-text multimodal parts */
function hasMultimodal(messages) {
  for (const msg of messages || []) {
    const c = msg?.content;
    if (!Array.isArray(c)) continue;
    for (const part of c) {
      if (part && typeof part === 'object' && part.type && part.type !== 'text') return true;
    }
  }
  return false;
}

/** Normalize OpenAI-style messages for upstream (preserve image_url parts) */
function normalizeMessagesForUpstream(messages) {
  const out = [];
  for (const msg of messages || []) {
    const role = String(msg?.role || 'user');
    if (role === 'tool') {
      out.push({ role: 'tool', content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || ''), tool_call_id: msg.tool_call_id });
      continue;
    }
    const mappedRole = role === 'developer' ? 'system' : role;
    const content = msg?.content ?? msg?.text;
    if (Array.isArray(content)) {
      const parts = content.map(part => {
        if (typeof part === 'string') return { type: 'text', text: part };
        if (part?.type === 'text') return { type: 'text', text: part.text || '' };
        if (part?.type === 'image_url') {
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
          return { type: 'image_url', image_url: { url: url || '', detail: part.image_url?.detail || 'auto' } };
        }
        if (part?.type === 'input_audio') return part;
        if (part?.type === 'file') return part;
        return { type: 'text', text: String(part?.text || '') };
      }).filter(Boolean);
      out.push({ role: mappedRole, content: parts });
    } else {
      out.push({ role: mappedRole, content: content == null ? '' : String(content) });
    }
    if (msg.tool_calls) out[out.length - 1].tool_calls = msg.tool_calls;
  }
  return out;
}

function parseModel(model) {
  const raw = String(model || 'auto').trim();
  if (!raw || raw === 'auto' || raw === 'default') {
    return { provider: null, model: null, auto: true };
  }
  const m = raw.match(/^([a-z0-9_-]+)[/:|](.+)$/i);
  if (m) {
    const prov = m[1].toLowerCase();
    const known = ['local', 'ollama', 'openai', 'gemini', 'google', 'deepseek', 'groq', 'openrouter', 'anthropic', 'claude', 'mistral', 'xai', 'custom'];
    if (known.includes(prov)) {
      const map = { ollama: 'local', google: 'gemini', claude: 'anthropic' };
      return { provider: map[prov] || prov, model: m[2], auto: false };
    }
  }
  return { provider: null, model: raw, auto: false };
}

function messagesToPrompt(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let system = '';
  const transcript = [];
  for (const msg of list) {
    const role = String(msg?.role || 'user');
    const text = extractText(msg?.content ?? msg?.text).trim();
    if (!text) continue;
    if (role === 'system') system = system ? `${system}\n${text}` : text;
    else if (role === 'assistant') transcript.push(`Assistant: ${text}`);
    else transcript.push(`User: ${text}`);
  }
  const lastUser = [...list].reverse().find(m => m?.role === 'user');
  const message = lastUser ? extractText(lastUser.content).trim() : (transcript.join('\n') || 'Hello');
  const prior = transcript.slice(0, -1).join('\n');
  if (prior) system = system ? `${system}\n\nConversation so far:\n${prior}` : `Conversation so far:\n${prior}`;
  return { message, system };
}

function isBrowserSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return false;
  const host = (typeof req.get === 'function' ? req.get('host') : null) || req.headers?.host || '';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}


/** Capability defaults for known providers — Builder-friendly metadata */
const CLOUD_MODEL_META = {
  // rough defaults; discovery overrides when possible
  default: { context_window: 128000, max_output_tokens: 8192, supports_json: true, supports_tools: true, supports_vision: false, supports_reasoning: false, supports_streaming: true },
  'gpt-4o': { context_window: 128000, max_output_tokens: 16384, supports_vision: true, supports_tools: true },
  'gpt-4o-mini': { context_window: 128000, max_output_tokens: 16384, supports_vision: true },
  'gemini-2.5-flash': { context_window: 1048576, max_output_tokens: 8192, supports_vision: true, supports_tools: true },
  'gemini-2.0-flash': { context_window: 1048576, max_output_tokens: 8192, supports_vision: true },
  'claude-3-5-haiku': { context_window: 200000, max_output_tokens: 8192, supports_tools: true },
  'deepseek-chat': { context_window: 64000, max_output_tokens: 8192, supports_json: true },
  'deepseek-reasoner': { context_window: 64000, max_output_tokens: 8192, supports_reasoning: true },
};

function metaForCloud(modelId, provider) {
  const id = String(modelId || '');
  const lower = id.toLowerCase();
  let base = { ...CLOUD_MODEL_META.default };
  for (const [k, v] of Object.entries(CLOUD_MODEL_META)) {
    if (k !== 'default' && lower.includes(k)) base = { ...base, ...v };
  }
  if (/vision|gpt-4o|gemini|claude-3/i.test(lower)) base.supports_vision = true;
  if (/reason|o1|o3|r1/i.test(lower)) base.supports_reasoning = true;
  if (provider === 'anthropic') base.supports_tools = true;
  return base;
}

function buildModelEntry({ id, owned_by, provider = null, localDetail = null, latency_ms = null, health = 'unknown' }) {
  const isLocal = owned_by === 'local' || provider === 'local';
  let meta;
  if (isLocal && localDetail) {
    meta = {
      context_window: localDetail.context_window || 8192,
      max_output_tokens: localDetail.max_output_tokens || 4096,
      supports_json: true,
      supports_tools: false,
      supports_vision: /llava|vision|bakllava/i.test(id),
      supports_reasoning: /reason|r1|qwq/i.test(id),
      supports_streaming: true,
      loaded: !!localDetail.loaded,
      size_bytes: localDetail.size || null,
      family: localDetail.family || null,
      parameter_size: localDetail.parameter_size || null,
      quantization: localDetail.quantization || null
    };
  } else if (isLocal) {
    meta = {
      context_window: 8192,
      max_output_tokens: 4096,
      supports_json: true,
      supports_tools: false,
      supports_vision: false,
      supports_reasoning: false,
      supports_streaming: true,
      loaded: false
    };
  } else {
    meta = metaForCloud(id, provider || owned_by);
  }
  return {
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: owned_by || 'personal-ai-hub',
    permission: [],
    root: id,
    parent: null,
    // Builder / international provider metadata
    context_window: meta.context_window,
    max_output_tokens: meta.max_output_tokens,
    supports_json: !!meta.supports_json,
    supports_tools: !!meta.supports_tools,
    supports_vision: !!meta.supports_vision,
    supports_reasoning: !!meta.supports_reasoning,
    supports_streaming: meta.supports_streaming !== false,
    latency_ms: latency_ms,
    health: health,
    loaded: meta.loaded != null ? !!meta.loaded : null,
    provider: provider || owned_by || null,
    // local extras
    size_bytes: meta.size_bytes || null,
    family: meta.family || null,
    parameter_size: meta.parameter_size || null,
    quantization: meta.quantization || null
  };
}

export function mountOpenAICompat(app, { kernel, serviceName = 'personal-ai-hub' }) {
  const clientFromReq = (req) => ({
    // Prefer Express req.ip when trust proxy is enabled; never trust raw XFF alone
    ip: (req.ip || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null),
    ua: String(req.headers['user-agent'] || '').slice(0, 180) || null
  });

  if (!app || typeof app.get !== 'function') {
    throw new Error('mountOpenAICompat requires an Express-like app');
  }

  const asyncRoute = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(async err => {
      const message = String(err?.message || err);
      let status = err?.statusCode || err?.status || 400;
      if (/NO_ACTIVE_KEY|NO_PROVIDER|ALL_PROVIDERS/i.test(message)) status = 503;
      if (/RATE_LIMIT|USAGE_QUOTA_EXCEEDED/i.test(message)) status = 429;
      if (/INVALID_GATEWAY|AUTH|MISSING_GATEWAY/i.test(message)) status = 401;
      try {
        if (req.gatewayLease?.slot) req.gatewayLease.slot.release();
        if (req.gatewayTokenId) await kernel.gateway.recordUsage({ tokenId: req.gatewayTokenId, appId: req.headers['x-solohost-app-id'] || req.gatewayApp?.appId || null, error: true, client: clientFromReq(req) });
        await kernel.logs.write('api.error', 'error', {
          path: req.path, method: req.method, error: message,
          appId: req.headers['x-solohost-app-id'] || null
        });
      } catch {}
      if (!res.headersSent) {
        res.status(status >= 400 && status < 600 ? status : 400).json({
          error: {
            message,
            type: status === 401 ? 'invalid_request_error' : 'api_error',
            code: message.slice(0, 64),
            request_id: req.headers['x-request-id'] || null
          }
        });
      }
    });
  };

  const gatewayAuth = async (req, res, next) => {
    try {
      const tokens = await kernel.gateway.listTokens();
      if (!tokens.length) {
        return res.status(401).json({
          error: {
            message: "No gateway tokens configured. Create a token in Hub Settings first.",
            type: "authentication_error",
            code: "no_tokens_configured"
          }
        });
      }
      const hdr = req.headers['x-personal-ai-key']
        || (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1];
      if (req.query?.api_key) {
        return res.status(401).json({ error: { message: 'API keys in query parameters are not supported. Use Authorization: Bearer or X-Personal-AI-Key.', type: 'invalid_request_error', code: 'API_KEY_IN_QUERY_NOT_ALLOWED' } });
      }
      if (!hdr) {
        return res.status(401).json({
          error: {
            message: 'Missing API key. Send Authorization: Bearer pah_… or X-Personal-AI-Key.',
            type: 'invalid_request_error',
            code: 'MISSING_GATEWAY_TOKEN'
          }
        });
      }
      const appIdHdr = req.headers['x-solohost-app-id'] || null;
      let ok;
      try {
        ok = await kernel.gateway.validate(hdr, { appId: appIdHdr, bind: true });
      } catch (e) {
        if (e.statusCode === 403) {
          return res.status(403).json({
            error: {
              message: e.message || 'Token is bound to a different app',
              type: 'invalid_request_error',
              code: 'TOKEN_APP_MISMATCH'
            }
          });
        }
        throw e;
      }
      if (!ok) {
        return res.status(401).json({
          error: {
            message: 'Invalid API key',
            type: 'invalid_request_error',
            code: 'INVALID_GATEWAY_TOKEN'
          }
        });
      }
      const lease = await kernel.gateway.acquire(hdr, { appId: appIdHdr });
      if (!lease) return res.status(401).json({ error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'INVALID_GATEWAY_TOKEN' } });
      // Endpoint scope (token.allowedEndpoints)
      const allowedEp = lease.allowedEndpoints || ok.allowedEndpoints;
      if (Array.isArray(allowedEp) && allowedEp.length) {
        const path = String(req.path || req.url || '').split('?')[0];
        const norm = path.replace(/^\/openai/, '');
        const okEp = allowedEp.some(ep => {
          const e = String(ep);
          return norm === e || norm.endsWith(e) || norm.includes(e);
        });
        if (!okEp) {
          try { lease.slot?.release?.(); } catch {}
          return res.status(403).json({
            error: {
              message: `This token is not allowed to call ${norm}`,
              type: 'permission_error',
              code: 'endpoint_not_allowed',
              param: 'allowed_endpoints'
            }
          });
        }
      }
      req.gatewayApp = { ...lease, ...ok };
      req.gatewayTokenId = lease.id;
      req.gatewayTokenRaw = hdr;
      req.gatewayLease = lease;
      req.gatewayScope = {
        allowedModels: ok.allowedModels || lease.allowedModels || null,
        allowedEndpoints: allowedEp || null,
        allowFallback: ok.allowFallback !== false
      };
      return next();
    } catch (e) {
      const code = e.code || (e.statusCode === 401 ? 'TOKEN_EXPIRED' : 'AUTH_ERROR');
      const status = e.statusCode || 500;
      return res.status(status).json({
        error: { message: String(e?.message || e), type: status === 401 ? 'authentication_error' : 'api_error', code }
      });
    }
  };

  function assertModelAllowed(req, modelId) {
    const allowed = req.gatewayScope?.allowedModels;
    if (!Array.isArray(allowed) || !allowed.length) return null;
    if (!modelId || modelId === 'auto' || modelId === 'auto-vision' || modelId === 'auto-fast' || modelId === 'auto-best') return null;
    const id = String(modelId);
    const ok = allowed.some(m => id === m || id.endsWith('/' + m) || id.startsWith(m + '/') || id.includes(m));
    if (ok) return null;
    return {
      status: 403,
      error: {
        message: `Model '${id}' is not allowed for this token`,
        type: 'permission_error',
        code: 'model_not_allowed',
        param: 'model'
      }
    };
  }

  const listModels = asyncRoute(async (req, res) => {
    const seen = new Set();
    const data = [];
    const push = (entry) => {
      const key = String(entry.id || '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      data.push(entry);
    };
    push(buildModelEntry({
      id: 'auto', owned_by: 'personal-ai-hub', provider: 'personal-ai-hub',
      health: 'ready', latency_ms: null
    }));
    // auto is smart-routed
    data[0].supports_tools = true;
    data[0].supports_json = true;
    data[0].supports_streaming = true;
    data[0].context_window = 128000;
    data[0].max_output_tokens = 8192;

    let localMeta = { available: false, modelDetails: [], loaded: [], cold_start: null, memory: null, status: 'unavailable' };
    try {
      localMeta = await kernel.local.models() || localMeta;
      if (localMeta?.available && Array.isArray(localMeta.models)) {
        const detailMap = Object.fromEntries((localMeta.modelDetails || []).map(d => [d.name, d]));
        for (const m of localMeta.models) {
          const name = typeof m === 'string' ? m : (m?.name || m?.model);
          if (!name) continue;
          const detail = detailMap[name] || null;
          const health = detail?.loaded ? 'loaded' : (localMeta.cold_start ? 'cold' : 'ready');
          const entry = (suffix, id) => buildModelEntry({
            id, owned_by: 'local', provider: 'local', localDetail: detail, health,
            latency_ms: detail?.loaded ? 50 : 2000
          });
          push(entry(null, name));
          // Alias only once for local disambiguation
          push(entry(null, `local/${name}`));
        }
      }
    } catch {}

    try {
      const keys = await kernel.keys.listKeys();
      for (const k of keys) {
        if (k.status === 'INVALID' || k.status === 'BILLING_REQUIRED') continue;
        if (k.provider === 'local') continue;
        const health = k.status === 'ACTIVE' ? 'ready' : String(k.status || 'unknown').toLowerCase();
        for (const m of k.models || []) {
          push(buildModelEntry({ id: m, owned_by: k.provider, provider: k.provider, health }));
          // Prefix form only when bare id already taken by another provider
          const prefixed = `${k.provider}/${m}`;
          if (seen.has(m) && m !== prefixed) {
            push(buildModelEntry({ id: prefixed, owned_by: k.provider, provider: k.provider, health }));
          }
        }
      }
    } catch {}

    const allowed = req.gatewayScope?.allowedModels;
    let out = data;
    if (Array.isArray(allowed) && allowed.length) {
      out = data.filter(m => m.id === 'auto' || m.id === 'auto-vision' || allowed.some(a => String(m.id) === a || String(m.id).endsWith('/' + a) || String(m.id).includes(a)));
    }
    res.json({
      object: 'list',
      data: out,
      hub: {
        local: {
          available: !!localMeta.available,
          status: localMeta.status || null,
          cold_start: !!localMeta.cold_start,
          loaded_count: localMeta.loadedCount || (localMeta.loaded || []).length,
          memory: localMeta.memory || null
        }
      }
    });
  });

  const chatCompletions = asyncRoute(async (req, res) => {
    const body = req.body || {};
    const parsed = parseModel(body.model);
    const modelDenied = assertModelAllowed(req, body.model);
    if (modelDenied) return res.status(modelDenied.status).json({ error: modelDenied.error });
    if (!Array.isArray(body.messages) || !body.messages.length) {
      return res.status(400).json({ error: { message: 'messages required', type: 'invalid_request_error', code: 'MESSAGES_REQUIRED' } });
    }
    // NEVER collapse history into "Conversation so far" — pass full roles through
    const upstreamMessages = normalizeMessagesForUpstream(body.messages);
    const multimodal = hasMultimodal(body.messages);
    const lastUser = [...body.messages].reverse().find(m => m?.role === 'user');
    const message = lastUser ? extractText(lastUser.content).trim() : extractText(body.messages[body.messages.length - 1]?.content).trim();
    if (!message && !multimodal && !body.messages.some(m => m?.tool_calls || m?.role === 'tool')) {
      return res.status(400).json({ error: { message: 'messages required', type: 'invalid_request_error', code: 'MESSAGES_REQUIRED' } });
    }
    const requestId = req.headers['x-request-id'] || `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const appId = req.headers['x-solohost-app-id'] || req.gatewayApp?.appId || body.user || null;
    const started = Date.now();
    const id = requestId.startsWith('chatcmpl-') ? requestId : `chatcmpl-${requestId}`;
    let routeModel = parsed.model || undefined;
    let routeProvider = parsed.provider || undefined;
    if (multimodal && (!body.model || body.model === 'auto' || body.model === 'default')) {
      routeModel = 'auto-vision';
    }
    // Extract system messages for legacy path; full array is authoritative
    const systemParts = upstreamMessages.filter(m => m.role === 'system').map(m => extractText(m.content)).filter(Boolean);
    const chatArgs = {
      message: message || '[multimodal]',
      system: systemParts.join('\n\n') || undefined,
      messages: upstreamMessages,
      provider: routeProvider, model: routeModel,
      appId, transparent: true,
      temperature: body.temperature, max_tokens: body.max_tokens ?? body.max_completion_tokens,
      top_p: body.top_p, stop: body.stop, seed: body.seed,
      response_format: body.response_format, tools: body.tools, tool_choice: body.tool_choice,
      hasVision: multimodal,
      allowFallback: req.gatewayScope?.allowFallback !== false
    };

    // --- True SSE streaming path (headers only after first successful event) ---
    if (body.stream === true) {
      const ac = new AbortController();
      const onClose = () => { try { ac.abort(); } catch {} };
      req.on('close', onClose);
      req.on('aborted', onClose);

      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let servedModel = body.model || 'auto';
      let provider = null;
      let keyId = null;
      let hadError = false;
      let firstDelta = true;
      let headersSent = false;
      const created = Math.floor(Date.now() / 1000);
      let keepAlive = null;

      const openSse = () => {
        if (headersSent || res.headersSent) return;
        headersSent = true;
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Request-Id', requestId);
        res.flushHeaders?.();
        keepAlive = setInterval(() => {
          try { res.write(': keep-alive\n\n'); } catch {}
        }, 15000);
      };

      const jsonError = (status, code, message) => {
        if (headersSent || res.headersSent) return false;
        hadError = true;
        res.status(status).json({
          error: {
            message: String(message || code).slice(0, 700),
            type: status === 401 ? 'authentication_error' : (status === 404 ? 'invalid_request_error' : 'api_error'),
            code: String(code).slice(0, 64),
            request_id: requestId
          }
        });
        return true;
      };

      try {
        for await (const ev of kernel.chatStream({ ...chatArgs, signal: ac.signal })) {
          if (ev.type === 'error') {
            hadError = true;
            let status = Number(ev.statusCode) || 502;
            const code = String(ev.error || 'STREAM_ERROR');
            if (/NO_ACTIVE_KEY|NO_PROVIDER|ALL_PROVIDERS|no_provider/i.test(code)) status = 503;
            if (/RATE_LIMIT|QUOTA|429/i.test(code)) status = 429;
            if (/AUTH|INVALID/i.test(code)) status = 401;
            if (/model_not_found|MODEL_NOT/i.test(code)) status = 404;
            if (jsonError(status, code, ev.message || ev.error)) break;
            openSse();
            res.write(`data: ${JSON.stringify({
              id, object: 'chat.completion.chunk', created, model: servedModel,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              error: { message: ev.message || ev.error, type: 'api_error', code }
            })}\n\n`);
            res.write('data: [DONE]\n\n');
            break;
          }
          if (ev.type === 'meta') {
            provider = ev.provider;
            keyId = ev.keyId;
            servedModel = ev.model || servedModel;
            openSse();
            continue;
          }
          if (ev.type === 'delta' && (ev.content || ev.tool_calls)) {
            openSse();
            if (ev.model) servedModel = ev.model;
            const delta = firstDelta
              ? { role: 'assistant', content: ev.content || null }
              : { content: ev.content || null };
            if (ev.tool_calls) delta.tool_calls = ev.tool_calls;
            firstDelta = false;
            res.write(`data: ${JSON.stringify({
              id, object: 'chat.completion.chunk', created, model: servedModel,
              choices: [{ index: 0, delta, finish_reason: null }]
            })}\n\n`);
            continue;
          }
          if (ev.type === 'done') {
            openSse();
            if (ev.model) servedModel = ev.model;
            if (ev.usage) usage = ev.usage;
            res.write(`data: ${JSON.stringify({
              id, object: 'chat.completion.chunk', created, model: servedModel,
              choices: [{ index: 0, delta: {}, finish_reason: ev.finish_reason || 'stop' }]
            })}\n\n`);
            if (body.stream_options?.include_usage === true && usage) {
              res.write(`data: ${JSON.stringify({
                id, object: 'chat.completion.chunk', created, model: servedModel,
                choices: [], usage
              })}\n\n`);
            }
            res.write('data: [DONE]\n\n');
            break;
          }
        }
      } catch (err) {
        hadError = true;
        if (!jsonError(502, 'STREAM_FAILED', err?.message || err)) {
          try {
            openSse();
            res.write(`data: ${JSON.stringify({
              error: { message: String(err?.message || err).slice(0, 400), type: 'api_error', code: 'STREAM_FAILED' }
            })}\n\n`);
            res.write('data: [DONE]\n\n');
          } catch {}
        }
      } finally {
        if (keepAlive) clearInterval(keepAlive);
        req.off?.('close', onClose);
        req.off?.('aborted', onClose);
        try {
          await kernel.gateway.recordUsage({
            tokenId: req.gatewayTokenId, appId, usage, error: hadError, client: clientFromReq(req)
          });
        } catch {}
        if (req.gatewayLease?.slot) req.gatewayLease.slot.release();
        if (headersSent) {
          try { res.end(); } catch {}
        }
      }
      return;
    }

    // --- Non-streaming path ---
    const result = await kernel.chat({ ...chatArgs, requestId });
    const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    await kernel.gateway.recordUsage({ tokenId: req.gatewayTokenId, appId, usage, error: !!result.error, client: clientFromReq(req) });
    if (req.gatewayLease?.slot) req.gatewayLease.slot.release();

    if (result && result.error) {
      let status = 502;
      const code = String(result.error || 'AI_PROVIDER_ERROR');
      if (/NO_ACTIVE_KEY|NO_PROVIDER|ALL_PROVIDERS|no_provider/i.test(code)) status = 503;
      if (/MODEL_NOT_FOUND|model_not_found/i.test(code)) status = 404;
      if (/RATE_LIMIT|USAGE_QUOTA|QUOTA/i.test(code) || /429/.test(String(result.message || ''))) status = 429;
      if (/AUTH|INVALID_GATEWAY|FORBIDDEN/i.test(code)) status = 401;
      return res.status(status).json({
        error: {
          message: String(result.message || result.error || 'AI provider unavailable').slice(0, 700),
          type: status === 401 ? 'authentication_error' : (status === 503 ? 'api_error' : 'api_error'),
          code: code.slice(0, 64),
          request_id: result.requestId || requestId,
          personal_ai_hub: {
            provider: result.provider || null,
            keyId: result.keyId || null,
            failures: Array.isArray(result.failures) ? result.failures.slice(0, 8) : undefined,
            needsUserAction: !!result.needsUserAction
          }
        }
      });
    }

    const content = String(result.reply || '').trim();
    const toolCalls = result.tool_calls || null;
    if (!content && !(Array.isArray(toolCalls) && toolCalls.length)) {
      return res.status(502).json({
        error: {
          message: 'Upstream returned an empty assistant message. Check Settings → Activity Log and Test provider keys.',
          type: 'api_error',
          code: 'EMPTY_ASSISTANT_CONTENT',
          request_id: result.requestId || requestId
        }
      });
    }

    const assistantMessage = { role: 'assistant', content: content || null };
    if (toolCalls?.length) assistantMessage.tool_calls = toolCalls;
    const finish = result.finishReason || (toolCalls?.length ? 'tool_calls' : 'stop');
    const payload = {
      id, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
      model: result.model || body.model || 'auto',
      choices: [{ index: 0, message: assistantMessage, finish_reason: finish, logprobs: null }],
      usage,
      personal_ai_hub: {
        provider: result.provider || null, keyId: result.keyId || null,
        requestId: result.requestId || requestId, latencyMs: Date.now() - started, appId
      }
    };
    res.setHeader('X-Request-Id', requestId);
    if (result.provider) res.setHeader('X-Hub-Provider', String(result.provider));
    if (result.model) res.setHeader('X-Hub-Model', String(result.model));
    if (body.model && result.model && String(body.model) !== 'auto' && !String(body.model).startsWith('auto-')
        && String(result.model) !== String(body.model) && String(result.model) !== String(parsed.model || '')) {
      res.setHeader('X-Hub-Fallback-From', String(body.model));
    }
    return res.json(payload);
  });

  const responses = asyncRoute(async (req, res) => {
    const body = req.body || {};
    let messages = [];
    if (typeof body.input === 'string') {
      messages = [{ role: 'user', content: body.input }];
    } else if (Array.isArray(body.input)) {
      messages = body.input.map(item => {
        if (typeof item === 'string') return { role: 'user', content: item };
        if (item && typeof item === 'object') {
          const role = ['system','developer','user','assistant'].includes(String(item.role)) ? String(item.role) : 'user';
          return { role: role === 'developer' ? 'system' : role, content: item.content ?? item.text ?? '' };
        }
        return { role: 'user', content: '' };
      });
    }
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    const upstream = normalizeMessagesForUpstream(messages);
    if (instructions) upstream.unshift({ role: 'system', content: instructions });
    const lastUser = [...upstream].reverse().find(m => m.role === 'user');
    const input = lastUser ? extractText(lastUser.content).trim() : '';
    if (!input && !upstream.length) return res.status(400).json({ error:{message:'input required',type:'invalid_request_error',code:'INPUT_REQUIRED'} });
    const parsed = parseModel(body.model);
    const requestId = req.headers['x-request-id'] || `resp-${randomUUID().replace(/-/g,'').slice(0,24)}`;
    const appId = req.headers['x-solohost-app-id'] || req.gatewayApp?.appId || null;
    const result = await kernel.chat({
      message: input || '[input]',
      messages: upstream,
      system: instructions || undefined,
      provider: parsed.provider || undefined, model: parsed.model || undefined,
      appId, requestId, transparent: true,
      temperature: body.temperature, max_tokens: body.max_tokens ?? body.max_completion_tokens,
      top_p: body.top_p, stop: body.stop, seed: body.seed,
      response_format: body.response_format, tools: body.tools, tool_choice: body.tool_choice,
      allowFallback: req.gatewayScope?.allowFallback !== false
    });
    const usage = result.usage || {prompt_tokens:0,completion_tokens:0,total_tokens:0};
    await kernel.gateway.recordUsage({tokenId:req.gatewayTokenId,appId,usage,error:!!result.error,client:clientFromReq(req)});
    if (req.gatewayLease?.slot) req.gatewayLease.slot.release();
    res.setHeader('X-Request-Id', requestId);
    if (result && result.error) {
      let status = 502;
      const code = String(result.error || 'AI_PROVIDER_ERROR');
      if (/NO_ACTIVE_KEY|NO_PROVIDER|ALL_PROVIDERS/i.test(code)) status = 503;
      if (/RATE_LIMIT|USAGE_QUOTA|QUOTA/i.test(code) || /429/.test(String(result.message || ''))) status = 429;
      if (/AUTH|INVALID_GATEWAY|FORBIDDEN/i.test(code)) status = 401;
      return res.status(status).json({
        error: {
          message: String(result.message || result.error || 'AI provider unavailable').slice(0, 700),
          type: status === 401 ? 'invalid_request_error' : 'api_error',
          code: code.slice(0, 64),
          request_id: result.requestId || requestId
        }
      });
    }
    const text = String(result.reply || '').trim();
    if (!text) {
      return res.status(502).json({
        error: {
          message: 'Personal AI Hub returned an empty assistant message. Check Settings → Activity Log and Test provider keys.',
          type: 'api_error',
          code: 'EMPTY_ASSISTANT_CONTENT',
          request_id: result.requestId || requestId
        }
      });
    }
    const responseId = requestId.startsWith('resp-') ? requestId : `resp-${requestId}`;
    return res.json({
      id: responseId,
      object: 'response',
      created_at: Math.floor(Date.now()/1000),
      model: result.model || body.model || 'auto',
      output: [{
        id: `msg_${randomUUID().replace(/-/g,'').slice(0,20)}`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text }]
      }],
      output_text: text,
      status: 'completed',
      usage
    });
  });

  const embeddings = asyncRoute(async (req, res) => {
    const body=req.body||{};
    const modelDenied = assertModelAllowed(req, body.model);
    if (modelDenied) return res.status(modelDenied.status).json({ error: modelDenied.error });
    if (!body.input || (Array.isArray(body.input) && !body.input.length)) return res.status(400).json({error:{message:'input required',type:'invalid_request_error',code:'INPUT_REQUIRED'}});
    const parsed=parseModel(body.model);
    const appId=req.headers['x-solohost-app-id']||req.gatewayApp?.appId||null;
    const result=await kernel.embed({input:body.input,provider:parsed.provider||undefined,model:parsed.model||undefined,appId});
    await kernel.gateway.recordUsage({tokenId:req.gatewayTokenId,appId,usage:result.usage,error:false,client:clientFromReq(req)});
    if (req.gatewayLease?.slot) req.gatewayLease.slot.release();
    res.setHeader('X-Request-Id',result.requestId);
    return res.json({object:'list',data:result.data||[],model:result.model||body.model,usage:result.usage||{prompt_tokens:0,total_tokens:0}});
  });

  const health = asyncRoute(async (_req, res) => {
    const h = await kernel.health();
    res.json({
      status: 'ok',
      object: 'health',
      hub: 'healthy',
      local: {
        available: !!h.local,
        status: h.localStatus || null,
        models: h.localModels || 0,
        loaded: h.localLoaded || [],
        loaded_count: h.localLoadedCount || 0,
        cold_start: !!h.localColdStart,
        memory: h.localMemory || null,
        model_details: h.localModelDetails || []
      },
      localAvailable: !!h.local,
      localStatus: h.localStatus || null,
      localModels: h.localModels || 0,
      activeKeys: h.activeKeys,
      routingMode: h.routingMode || null,
      gateway: { authentication: true, rateLimit: true, usageControl: true, fallback: true, endpoints: ['/v1/models','/v1/chat/completions','/v1/responses','/v1/embeddings'] },
      service: serviceName
    });
  });

  const ping = (_req, res) => {
    res.json({ ok: true, service: serviceName, layer: 'openai-compat' });
  };


  const getModel = asyncRoute(async (req, res) => {
    const id = decodeURIComponent(String(req.params.id || '')).trim();
    if (!id) return res.status(400).json({ error: { message: 'model id required', type: 'invalid_request_error', code: 'MODEL_ID_REQUIRED' } });
    // Reuse list and find — simple and consistent
    const fakeRes = {
      statusCode: 200,
      body: null,
      json(obj) { this.body = obj; },
      status(c) { this.statusCode = c; return this; }
    };
    // Build list inline by calling listModels logic is heavy; duplicate minimal lookup
    const models = [];
    const seen = new Set();
    const push = (e) => { if (e?.id && !seen.has(e.id)) { seen.add(e.id); models.push(e); } };
    push(buildModelEntry({ id: 'auto', owned_by: 'personal-ai-hub', provider: 'personal-ai-hub', health: 'ready' }));
    try {
      const localMeta = await kernel.local.models() || {};
      if (localMeta?.available && Array.isArray(localMeta.models)) {
        for (const m of localMeta.models) {
          const name = typeof m === 'string' ? m : (m?.name || m?.model);
          if (name) {
            push(buildModelEntry({ id: name, owned_by: 'local', provider: 'local', health: 'ready' }));
            push(buildModelEntry({ id: `local/${name}`, owned_by: 'local', provider: 'local', health: 'ready' }));
          }
        }
      }
    } catch {}
    try {
      const keys = await kernel.keys.listKeys();
      for (const k of keys) {
        if (k.status === 'INVALID' || k.status === 'BILLING_REQUIRED') continue;
        if (k.provider === 'local') continue;
        for (const m of k.models || []) {
          push(buildModelEntry({ id: m, owned_by: k.provider, provider: k.provider, health: k.status === 'ACTIVE' ? 'ready' : 'unknown' }));
          push(buildModelEntry({ id: `${k.provider}/${m}`, owned_by: k.provider, provider: k.provider, health: k.status === 'ACTIVE' ? 'ready' : 'unknown' }));
        }
      }
    } catch {}
    const hit = models.find(m => m.id === id);
    if (!hit) {
      return res.status(404).json({
        error: { message: `The model '${id}' does not exist`, type: 'invalid_request_error', code: 'model_not_found', param: 'model' }
      });
    }
    return res.json(hit);
  });


  const unsupported = (capability, hint) => asyncRoute(async (_req, res) => {
    res.status(400).json({
      error: {
        message: `${capability} is not enabled on this Personal AI Hub build. ${hint || ''}`.trim(),
        type: 'invalid_request_error',
        code: 'unsupported_capability',
        param: capability
      }
    });
  });

  // Audio: accept multipart contract shape; if no suitable provider, return clear 400
  const audioTranscriptions = asyncRoute(async (req, res) => {
    // Full Whisper proxy needs multipart parsing (busboy). Until then, clear capability error.
    return res.status(400).json({
      error: {
        message: 'Audio transcription requires a Whisper-capable provider key and multipart upload support. Add OpenAI/Groq whisper model or use a provider that supports /audio/transcriptions, then upgrade Hub for multipart.',
        type: 'invalid_request_error',
        code: 'unsupported_capability',
        param: 'audio.transcriptions'
      }
    });
  });
  const audioSpeech = asyncRoute(async (req, res) => {
    return res.status(400).json({
      error: {
        message: 'Text-to-speech requires a TTS-capable provider (e.g. OpenAI tts-1). Configure that key and model, then retry in a later Hub build with /v1/audio/speech proxy.',
        type: 'invalid_request_error',
        code: 'unsupported_capability',
        param: 'audio.speech'
      }
    });
  });
  const imagesGenerations = asyncRoute(async (req, res) => {
    return res.status(400).json({
      error: {
        message: 'Image generation requires a provider with image models (e.g. DALL·E, Flux). Not enabled in this build; use a dedicated image API or wait for Hub image proxy.',
        type: 'invalid_request_error',
        code: 'unsupported_capability',
        param: 'images.generations'
      }
    });
  });

  // Explicit full paths — registered on the root app so nothing can strip /v1
  const paths = [
    ['get', '/v1/__ping', [ping]],
    ['get', '/v1/health', [health]],
    ['get', '/v1/models', [gatewayAuth, listModels]],
    ['get', '/v1/models/:id', [gatewayAuth, getModel]],
    ['post', '/v1/chat/completions', [gatewayAuth, chatCompletions]],
    ['post', '/v1/responses', [gatewayAuth, responses]],
    ['post', '/v1/embeddings', [gatewayAuth, embeddings]],
    ['post', '/v1/audio/transcriptions', [gatewayAuth, audioTranscriptions]],
    ['post', '/v1/audio/speech', [gatewayAuth, audioSpeech]],
    ['post', '/v1/images/generations', [gatewayAuth, imagesGenerations]],
    ['get', '/v1/chat/completions', [(_req, res) => res.status(405).json({
      error: { message: 'Use POST /v1/chat/completions', type: 'invalid_request_error', code: 'METHOD_NOT_ALLOWED' }
    })]],
    // aliases
    ['get', '/openai/v1/__ping', [ping]],
    ['get', '/openai/v1/health', [health]],
    ['get', '/openai/v1/models', [gatewayAuth, listModels]],
    ['get', '/openai/v1/models/:id', [gatewayAuth, getModel]],
    ['post', '/openai/v1/chat/completions', [gatewayAuth, chatCompletions]],
    ['post', '/openai/v1/responses', [gatewayAuth, responses]],
    ['post', '/openai/v1/embeddings', [gatewayAuth, embeddings]],
    ['post', '/openai/v1/audio/transcriptions', [gatewayAuth, audioTranscriptions]],
    ['post', '/openai/v1/audio/speech', [gatewayAuth, audioSpeech]],
    ['post', '/openai/v1/images/generations', [gatewayAuth, imagesGenerations]]
  ];

  for (const [method, path, handlers] of paths) {
    app[method](path, ...handlers);
  }

  console.log('[hub] OpenAI-compatible routes mounted: GET /v1/models POST /v1/chat/completions POST /v1/responses POST /v1/embeddings GET /v1/health');
}
