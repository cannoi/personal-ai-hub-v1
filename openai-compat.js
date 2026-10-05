/**
 * OpenAI-compatible API layer for SoloHost apps (Custom Provider / OpenAI-compatible).
 * Thin adapter over existing kernel.chat / keys — does not replace native /api/v1/*.
 */
import { randomUUID } from 'node:crypto';

function extractText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      return '';
    }).join('');
  }
  return String(content);
}

function parseModel(model) {
  const raw = String(model || 'auto').trim();
  if (!raw || raw === 'auto' || raw === 'default') {
    return { provider: null, model: null, auto: true };
  }
  // provider/model or provider:model
  const m = raw.match(/^([a-z0-9_-]+)[/:|](.+)$/i);
  if (m) {
    const prov = m[1].toLowerCase();
    if (['local', 'ollama', 'openai', 'gemini', 'google', 'deepseek', 'groq', 'openrouter', 'anthropic', 'claude'].includes(prov)) {
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
    const text = extractText(msg?.content).trim();
    if (!text) continue;
    if (role === 'system') {
      system = system ? `${system}\n${text}` : text;
    } else if (role === 'assistant') {
      transcript.push(`Assistant: ${text}`);
    } else {
      transcript.push(`User: ${text}`);
    }
  }
  const lastUser = [...list].reverse().find(m => m?.role === 'user');
  const message = lastUser ? extractText(lastUser.content).trim() : transcript.join('\n') || 'Hello';
  // Include prior turns as context in system when multi-turn
  const prior = transcript.slice(0, -1).join('\n');
  if (prior) system = system ? `${system}\n\nConversation so far:\n${prior}` : `Conversation so far:\n${prior}`;
  return { message, system };
}

export function mountOpenAICompat(app, { kernel, serviceName = 'personal-ai-hub' }) {
  const asyncRoute = fn => (req, res) => Promise.resolve(fn(req, res)).catch(async err => {
    const message = String(err?.message || err);
    const status = err?.statusCode || err?.status || 400;
    try {
      await kernel.logs.write('api.error', 'error', {
        path: req.path, method: req.method, error: message,
        appId: req.headers['x-solohost-app-id'] || null
      });
    } catch {}
    // OpenAI-style error envelope
    res.status(status >= 400 && status < 600 ? status : 400).json({
      error: {
        message,
        type: status === 401 ? 'invalid_request_error' : 'api_error',
        code: message,
        request_id: req.headers['x-request-id'] || null
      }
    });
  });

  const gatewayAuth = async (req, res, next) => {
    try {
      const tokens = await kernel.gateway.listTokens();
      if (!tokens.length) return next();
      const hdr = req.headers['x-personal-ai-key']
        || (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1]
        || req.query?.api_key;
      if (!hdr) {
        // Soft: allow same-origin Hub UI; external clients should send key
        return next();
      }
      const ok = await kernel.gateway.validate(hdr);
      if (!ok) {
        return res.status(401).json({
          error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'INVALID_GATEWAY_TOKEN' }
        });
      }
      req.gatewayApp = ok;
      return next();
    } catch {
      return next();
    }
  };

  app.get('/v1/health', asyncRoute(async (_req, res) => {
    const h = await kernel.health();
    res.json({
      status: 'ok',
      object: 'health',
      hub: 'healthy',
      local: !!h.local,
      localStatus: h.localStatus || null,
      activeKeys: h.activeKeys,
      routingMode: h.routingMode || null,
      service: serviceName
    });
  }));

  app.get('/v1/models', gatewayAuth, asyncRoute(async (_req, res) => {
    const keys = await kernel.keys.listKeys();
    const seen = new Set();
    const data = [{
      id: 'auto',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'personal-ai-hub',
      permission: [],
      root: 'auto',
      parent: null
    }];
    seen.add('auto');

    for (const k of keys) {
      if (k.status === 'INVALID' || k.status === 'BILLING_REQUIRED') continue;
      const models = k.models?.length ? k.models : [];
      for (const m of models) {
        const id = String(m);
        if (seen.has(id)) continue;
        seen.add(id);
        data.push({
          id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: k.provider,
          permission: [],
          root: id,
          parent: null
        });
        // Also expose provider/model form for explicit routing
        const pref = `${k.provider}/${id}`;
        if (!seen.has(pref)) {
          seen.add(pref);
          data.push({
            id: pref,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: k.provider,
            permission: [],
            root: id,
            parent: null
          });
        }
      }
    }

    res.json({ object: 'list', data });
  }));

  app.post('/v1/chat/completions', gatewayAuth, asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (body.stream === true) {
      return res.status(400).json({
        error: {
          message: 'stream=true is not supported yet; use stream=false',
          type: 'invalid_request_error',
          code: 'STREAM_NOT_SUPPORTED'
        }
      });
    }

    const parsed = parseModel(body.model);
    const { message, system } = messagesToPrompt(body.messages);
    if (!message) {
      return res.status(400).json({
        error: { message: 'messages required', type: 'invalid_request_error', code: 'MESSAGES_REQUIRED' }
      });
    }

    const requestId = req.headers['x-request-id'] || `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const appId = req.headers['x-solohost-app-id'] || req.gatewayApp?.name || body.user || null;

    const started = Date.now();
    const result = await kernel.chat({
      message,
      system: system || undefined,
      provider: parsed.provider || undefined,
      model: parsed.model || undefined,
      requestId,
      appId
    });

    const latency = Date.now() - started;
    const modelOut = result.model || body.model || 'auto';
    const content = result.reply || '';

    res.json({
      id: requestId.startsWith('chatcmpl-') ? requestId : `chatcmpl-${requestId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelOut,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
          logprobs: null
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      // Hub extensions (non-breaking)
      personal_ai_hub: {
        provider: result.provider || null,
        keyId: result.keyId || null,
        requestId: result.requestId || requestId,
        latencyMs: latency,
        appId
      }
    });
  }));

  // Reject wrong methods clearly
  app.get('/v1/chat/completions', (_req, res) => {
    res.status(405).json({
      error: { message: 'Use POST /v1/chat/completions', type: 'invalid_request_error', code: 'METHOD_NOT_ALLOWED' }
    });
  });
}
