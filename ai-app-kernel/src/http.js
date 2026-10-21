import { createRateLimiter } from './security.js';

const rateLimiter = createRateLimiter({
  perMinute: Number(process.env.AI_HUB_RATE_LIMIT_PER_MIN || 60),
  maxConcurrent: Number(process.env.AI_HUB_MAX_CONCURRENT || 10)
});

export function mountKernel(app, { prefix = '/ai', kernel, requireAdmin = null }) {
  const asyncRoute = fn => (req, res) => Promise.resolve(fn(req, res)).catch(async err => {
    const message = String(err?.message || err);
    try {
      await kernel.logs.write('api.error', 'error', {
        path: req.path, method: req.method, error: message,
        appId: req.headers['x-solohost-app-id'] || null
      });
    } catch {}
    res.status(err?.statusCode || 400).json({
      error: { message, type: 'api_error', code: String(err?.code || err?.message || 'ERROR').slice(0, 64) },
      requestId: req.headers['x-request-id'] || null
    });
  });

  const adminGuard = (req, res, next) => {
    if (!requireAdmin) return next();
    return requireAdmin(req, res, next);
  };

  /**
   * Auth for chat endpoints (v2.1):
   * - pah_ Bearer / X-Personal-AI-Key → external app, transparent gateway
   * - admin cookie session → Hub UI assistant (not transparent)
   * - NEVER open by Origin / X-SoloHost-App-ID alone / empty token list
   */
  const chatAuth = async (req, res, next) => {
    try {
      const hdr = req.headers['x-personal-ai-key']
        || (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1];
      // body gatewayToken is intentionally ignored (security)

      if (hdr) {
        const appId = req.headers['x-solohost-app-id'] || null;
        let ok;
        try {
          ok = await kernel.gateway.validate(hdr, { appId, bind: true });
        } catch (e) {
          if (e.statusCode === 403) {
            return res.status(403).json({
              error: { message: e.message || 'Token bound to a different app', type: 'permission_error', code: 'TOKEN_APP_MISMATCH' }
            });
          }
          if (e.statusCode === 401) {
            return res.status(401).json({
              error: { message: e.message || 'Token expired', type: 'authentication_error', code: e.code || 'TOKEN_EXPIRED' }
            });
          }
          throw e;
        }
        if (!ok) {
          return res.status(401).json({
            error: { message: 'Invalid API key', type: 'authentication_error', code: 'INVALID_GATEWAY_TOKEN' }
          });
        }
        req.gatewayApp = ok;
        req.gatewayTokenId = ok.id;
        req.gatewayTransparent = true; // external apps always transparent
        return next();
      }

      // No token: allow only authenticated admin session (Hub UI)
      if (requireAdmin) {
        return requireAdmin(req, res, (err) => {
          if (err) return next(err);
          // requireAdmin already sent 401 if not admin
          if (res.headersSent) return;
          // Check if admin by re-using the same middleware pattern:
          // requireAdmin calls next() only when admin
          req.gatewayTransparent = false;
          return next();
        });
      }

      return res.status(401).json({
        error: {
          message: 'Missing API key. Send Authorization: Bearer pah_… or X-Personal-AI-Key. Hub UI must be logged in as admin.',
          type: 'authentication_error',
          code: 'MISSING_GATEWAY_TOKEN'
        }
      });
    } catch (e) {
      return res.status(500).json({
        error: { message: String(e?.message || e), type: 'api_error', code: 'AUTH_ERROR' }
      });
    }
  };

  // Wrap chatAuth so requireAdmin path works: requireAdmin sends 401 itself
  const chatAuthFinal = async (req, res, next) => {
    try {
      const hdr = req.headers['x-personal-ai-key']
        || (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1];
      if (hdr) return chatAuth(req, res, next);

      if (requireAdmin) {
        // Admin session required for Hub UI chat without pah_
        return requireAdmin(req, res, (err) => {
          if (err) return next(err);
          if (res.headersSent) return;
          req.gatewayTransparent = false;
          return next();
        });
      }
      return res.status(401).json({
        error: {
          message: 'Missing API key. Send Authorization: Bearer pah_… or login as admin for Hub UI.',
          type: 'authentication_error',
          code: 'MISSING_GATEWAY_TOKEN'
        }
      });
    } catch (e) {
      return res.status(500).json({
        error: { message: String(e?.message || e), type: 'api_error', code: 'AUTH_ERROR' }
      });
    }
  };

  const withRateLimit = async (req, res, next) => {
    const id = req.gatewayTokenId || req.headers['x-solohost-app-id'] || req.ip || 'anon';
    const slot = rateLimiter.tryAcquire(id);
    if (!slot.ok) {
      res.setHeader('Retry-After', String(slot.retryAfter || 60));
      return res.status(429).json({
        error: { message: slot.reason || 'RATE_LIMIT', type: 'rate_limit_error', code: 'rate_limit_exceeded' },
        retryAfter: slot.retryAfter
      });
    }
    res.on('finish', () => { try { slot.release(); } catch {} });
    res.on('close', () => { try { slot.release(); } catch {} });
    return next();
  };

  app.get(`${prefix}/health`, asyncRoute(async (_req, res) => res.json(await kernel.health())));
  app.get(`${prefix}/routing`, adminGuard, asyncRoute(async (_req, res) => res.json(await kernel.routing.get())));
  app.post(`${prefix}/routing`, adminGuard, asyncRoute(async (req, res) => res.json(await kernel.routing.set(req.body?.mode))));
  app.get(`${prefix}/diagnostics`, adminGuard, asyncRoute(async (_req, res) => res.json(await kernel.diagnostics())));
  app.get(`${prefix}/providers`, adminGuard, asyncRoute(async (_req, res) => res.json({ providers: await kernel.keys.providers() })));
  app.get(`${prefix}/keys`, adminGuard, asyncRoute(async (req, res) => res.json({ keys: await kernel.keys.listKeys(req.query.provider) })));
  app.post(`${prefix}/keys`, adminGuard, asyncRoute(async (req, res) => res.status(201).json(await kernel.keys.addKey(req.body || {}))));
  app.post(`${prefix}/keys/:id/test`, adminGuard, asyncRoute(async (req, res) => res.json(await kernel.keys.verifyKey(req.params.id))));
  app.delete(`${prefix}/keys/:id`, adminGuard, asyncRoute(async (req, res) => res.json(await kernel.keys.removeKey(req.params.id))));

  // Chat: token OR admin; transparent when token present
  app.post(`${prefix}/chat`, chatAuthFinal, withRateLimit, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const transparent = !!req.gatewayTransparent;
    // Prefer full messages array when client sends OpenAI-style messages
    const chatInput = {
      message: body.message,
      system: body.system,
      messages: Array.isArray(body.messages) ? body.messages : null,
      provider: body.provider,
      model: body.model,
      appId: req.headers['x-solohost-app-id'] || req.gatewayApp?.appId || body.appId || null,
      transparent,
      temperature: body.temperature,
      max_tokens: body.max_tokens ?? body.max_completion_tokens,
      top_p: body.top_p,
      stop: body.stop,
      seed: body.seed,
      response_format: body.response_format,
      tools: body.tools,
      tool_choice: body.tool_choice,
      hasVision: false
    };
    if (Array.isArray(chatInput.messages)) {
      for (const m of chatInput.messages) {
        if (Array.isArray(m?.content) && m.content.some(p => p?.type && p.type !== 'text')) {
          chatInput.hasVision = true;
          break;
        }
      }
      // Derive message text for logging/legacy if missing
      if (!chatInput.message) {
        const lastUser = [...chatInput.messages].reverse().find(m => m?.role === 'user');
        const c = lastUser?.content;
        chatInput.message = typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(p => p?.type === 'text').map(p => p.text).join('') : '');
      }
    }
    if (!chatInput.message?.trim() && !chatInput.messages?.length) {
      return res.status(400).json({
        error: { message: 'message or messages required', type: 'invalid_request_error', code: 'MESSAGE_REQUIRED' }
      });
    }

    const result = await kernel.chat(chatInput);
    if (result?.error) {
      let status = 502;
      const code = String(result.error || 'AI_PROVIDER_ERROR');
      if (/NO_ACTIVE_KEY|no_provider/i.test(code)) status = 503;
      if (/RATE_LIMIT|QUOTA|429/i.test(code)) status = 429;
      if (/AUTH|INVALID/i.test(code)) status = 401;
      return res.status(status).json({
        error: {
          message: String(result.message || result.error).slice(0, 700),
          type: status === 503 ? 'api_error' : 'api_error',
          code: code.slice(0, 64)
        },
        requestId: result.requestId || null
      });
    }
    // Deprecation notice when using native chat alias
    if (String(prefix).includes('/api/v1')) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Link', '</v1/chat/completions>; rel="successor-version"');
    }
    res.json(result);
  }));

  app.post(`${prefix}/act`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.actions.invoke(req.body?.name, req.body?.args || {}, {
      requestId: req.headers['x-request-id'],
      appId: req.headers['x-solohost-app-id'] || null
    }))
  ));

  app.get(`${prefix}/logs`, adminGuard, asyncRoute(async (req, res) =>
    res.json({ logs: await kernel.logs.list({ limit: Number(req.query.limit) || 200 }) })
  ));
  app.delete(`${prefix}/logs`, adminGuard, asyncRoute(async (_req, res) => {
    await kernel.logs.clear();
    res.json({ success: true });
  }));

  app.get(`${prefix}/memory`, adminGuard, asyncRoute(async (req, res) =>
    res.json({ memory: await kernel.memory.list(Number(req.query.limit) || 100, { admin: true }) })
  ));
  app.delete(`${prefix}/memory`, adminGuard, asyncRoute(async (_req, res) =>
    res.json(await kernel.memory.clear({ admin: true }))
  ));
  app.get(`${prefix}/memory/training`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.memory.trainingExport(Number(req.query.limit) || 200, { admin: true }))
  ));
  app.delete(`${prefix}/memory/training`, adminGuard, asyncRoute(async (_req, res) =>
    res.json(await kernel.memory.clearTraining({ admin: true }))
  ));

  app.get(`${prefix}/local/models`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.local.models({ force: req.query.force === '1' || req.query.force === 'true' }))
  ));
  app.post(`${prefix}/local/models/pull`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.local.pull(req.body?.name))
  ));
  app.post(`${prefix}/local/base-url`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.local.setBaseUrl(req.body?.url || req.body?.baseUrl || ''))
  ));

  app.get(`${prefix}/gateway/tokens`, adminGuard, asyncRoute(async (_req, res) =>
    res.json({ tokens: await kernel.gateway.listTokens() })
  ));
  app.post(`${prefix}/gateway/tokens`, adminGuard, asyncRoute(async (req, res) =>
    res.status(201).json(await kernel.gateway.createToken(req.body || {}))
  ));
  app.delete(`${prefix}/gateway/tokens/:id`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.gateway.revokeToken(req.params.id))
  ));
  app.post(`${prefix}/gateway/tokens/:id/unbind`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.gateway.unbindToken(req.params.id))
  ));
  app.get(`${prefix}/gateway/usage`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.gateway.usage({ tokenId: req.query.tokenId || null, appId: req.query.appId || null }))
  ));
}
