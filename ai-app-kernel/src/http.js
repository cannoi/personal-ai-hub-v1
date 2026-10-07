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
      error: message,
      requestId: req.headers['x-request-id'] || null
    });
  });

  const adminGuard = (req, res, next) => {
    if (!requireAdmin) return next();
    return requireAdmin(req, res, next);
  };

  /** Gateway auth for data-plane chat */
  const gatewayAuth = async (req, res, next) => {
    try {
      const tokens = await kernel.gateway.listTokens();
      if (!tokens.length) return next();
      const hdr = req.headers['x-personal-ai-key']
        || (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1]
        || req.body?.gatewayToken;
      if (!hdr) {
        // Hub UI same-origin may omit; soft allow without Origin is OK for bootstrap of native UI
        if (!req.headers.origin) return next();
        return res.status(401).json({ error: 'MISSING_GATEWAY_TOKEN' });
      }
      const appId = req.headers['x-solohost-app-id'] || req.body?.appId || null;
      try {
        const ok = await kernel.gateway.validate(hdr, { appId, bind: true });
        if (!ok) return res.status(401).json({ error: 'INVALID_GATEWAY_TOKEN' });
        req.gatewayApp = ok;
        req.gatewayTokenId = ok.id;
        return next();
      } catch (e) {
        if (e.statusCode === 403) return res.status(403).json({ error: e.message || 'TOKEN_APP_MISMATCH' });
        throw e;
      }
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  };

  const withRateLimit = async (req, res, next) => {
    const id = req.gatewayTokenId || req.headers['x-solohost-app-id'] || req.ip || 'anon';
    const slot = rateLimiter.tryAcquire(id);
    if (!slot.ok) {
      res.setHeader('Retry-After', String(slot.retryAfter || 60));
      return res.status(429).json({ error: slot.reason || 'RATE_LIMIT', retryAfter: slot.retryAfter });
    }
    res.on('finish', () => { try { slot.release(); } catch {} });
    return next();
  };

  app.get(`${prefix}/health`, asyncRoute(async (_req, res) => res.json(await kernel.health())));
  app.get(`${prefix}/routing`, asyncRoute(async (_req, res) => res.json(await kernel.routing.get())));
  app.post(`${prefix}/routing`, adminGuard, asyncRoute(async (req, res) => res.json(await kernel.routing.set(req.body?.mode))));
  app.get(`${prefix}/diagnostics`, adminGuard, asyncRoute(async (_req, res) => res.json(await kernel.diagnostics())));
  app.get(`${prefix}/providers`, asyncRoute(async (_req, res) => res.json({ providers: await kernel.keys.providers() })));
  app.get(`${prefix}/keys`, adminGuard, asyncRoute(async (req, res) => res.json({ keys: await kernel.keys.listKeys(req.query.provider) })));
  app.post(`${prefix}/keys`, adminGuard, asyncRoute(async (req, res) => res.status(201).json(await kernel.keys.addKey(req.body || {}))));
  app.post(`${prefix}/keys/:id/test`, adminGuard, asyncRoute(async (req, res) => res.json(await kernel.keys.verifyKey(req.params.id))));
  app.delete(`${prefix}/keys/:id`, adminGuard, asyncRoute(async (req, res) => res.json(await kernel.keys.removeKey(req.params.id))));

  app.post(`${prefix}/chat`, gatewayAuth, withRateLimit, asyncRoute(async (req, res) => {
    const body = {
      ...(req.body || {}),
      appId: req.headers['x-solohost-app-id'] || req.gatewayApp?.appId || req.gatewayApp?.name || req.body?.appId || null
    };
    res.json(await kernel.chat(body));
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

  app.post(`${prefix}/backup/export`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.backup.exportEncrypted(req.body?.passphrase))
  ));
  app.post(`${prefix}/backup/import`, adminGuard, asyncRoute(async (req, res) =>
    res.json(await kernel.backup.importEncrypted(req.body?.backup, req.body?.passphrase))
  ));

  app.get(`${prefix}/local/models`, asyncRoute(async (req, res) =>
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
