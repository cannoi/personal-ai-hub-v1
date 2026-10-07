import crypto from 'node:crypto';
import { mountKernel } from './http.js';
import { createSecretVault } from './vault.js';
import { createActivityLogger } from './logger.js';
import { providerCatalog, listModels, chatProvider, embedProvider, isChatCapableModel, rankChatModels, classifyProviderError, adaptiveTimeoutMs, adaptiveNumPredict } from './providers.js';
import { createLocalModelManager } from './local.js';
import { createRateLimiter } from './security.js';

export function createAiKernel(options = {}) {
  const knowledge = options.knowledge || null;
  const localReply = options.localReply || null;
  const getAppContext = options.getAppContext || null;
  const schema = options.schema || { name: 'app', collections: [] };
  const store = options.store || {};
  const actions = options.actions || {};
  const baseFetch = options.fetchImpl || fetch;
  const fetchImpl = async (url, init = {}) => {
    const timeoutMs = Number(init.timeoutMs || options.requestTimeoutMs || 45000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const next = { ...init, signal: init.signal || controller.signal };
      delete next.timeoutMs;
      return await baseFetch(url, next);
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error(`REQUEST_TIMEOUT_${timeoutMs}MS`);
        e.status = 504;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
  const providers = providerCatalog(options.providers || {});
  const vault = createSecretVault(options.vaultFile || './data/ai-vault.json', options.masterFile || './data/.ai-master-key');
  const logger = createActivityLogger(options.logFile || './data/activity-log.json');
  const stateFile = options.stateFile || './data/ai-state.json';
  let state = null;
  const local = createLocalModelManager(providers.local, fetchImpl);
  let lastLocalFailLog = 0;
  const gatewayWindows = new Map();
  const gatewayRateLimiter = createRateLimiter({
    perMinute: Number(process.env.AI_HUB_GATEWAY_RATE_LIMIT_PER_MIN || process.env.AI_HUB_RATE_LIMIT_PER_MIN || 60),
    maxConcurrent: Number(process.env.AI_HUB_GATEWAY_MAX_CONCURRENT || process.env.AI_HUB_MAX_CONCURRENT || 10)
  });

  async function loadState() {
    if (state) return state;
    try {
      state = JSON.parse(await (await import('node:fs/promises')).readFile(stateFile, 'utf8'));
      state.memory ||= [];
      state.keys ||= [];
      state.models ||= {};
      state.routing ||= {};
      state.config ||= {};
      state.training ||= [];
      state.gatewayTokens ||= [];
      state.gatewayUsage ||= {};
      state.config.routingMode ||= 'balanced';
      state.keys = state.keys.map(k => ({
        retryAt: 0,
        useCount: 0,
        models: [],
        ...k,
        models: (k.models || []).filter(isChatCapableModel)
      }));
    } catch {
      state = { keys: [], models: {}, memory: [], routing: {}, config: {}, training: [], gatewayTokens: [], gatewayUsage: {} };
    }
    // Virtual local key only when user has not opted out (config.localKeyEnabled !== false)
    // and no local key exists yet. Do not recreate after explicit delete.
    if (
      providers.local &&
      state.config?.localKeyEnabled !== false &&
      state.config?.localKeyRemoved !== true &&
      !state.keys.some(k => k.provider === 'local')
    ) {
      state.keys.push({
        id: 'local-default',
        provider: 'local',
        masked: 'LOCAL',
        status: 'TEST_REQUIRED',
        models: [],
        selectedModel: null,
        createdAt: new Date().toISOString(),
        lastChecked: null,
        lastUsed: null,
        lastError: null,
        retryAt: 0,
        useCount: 0
      });
      await saveState();
    }
    return state;
  }

  async function saveState() {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  const publicKey = k => ({
    id: k.id,
    provider: k.provider,
    masked: k.masked,
    status: k.status,
    models: k.models || [],
    selectedModel: k.selectedModel || null,
    lastChecked: k.lastChecked || null,
    lastUsed: k.lastUsed || null,
    lastError: k.lastError || null,
    baseUrl: k.provider === 'custom' ? (k.baseUrl || null) : null,
    createdAt: k.createdAt,
    useCount: k.useCount || 0
  });
  const providerInfo = p => ({ id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl, defaultModels: p.models || [] });

  function routeKey(keyId, model) {
    return `${keyId}::${model || '*'}`;
  }

  function getRouteMetric(keyId, model) {
    state.routing = state.routing || {};
    state.routing.metrics = state.routing.metrics || {};
    const id = routeKey(keyId, model);
    if (!state.routing.metrics[id]) {
      state.routing.metrics[id] = {
        success: 0, failure: 0, totalLatencyMs: 0, lastSuccessAt: 0,
        consecutiveFailures: 0, cooldownUntil: 0, lastErrorClass: null
      };
    }
    return state.routing.metrics[id];
  }

  function recordRouteSuccess(keyId, model, latencyMs) {
    const m = getRouteMetric(keyId, model);
    m.success += 1;
    m.totalLatencyMs += Math.max(0, latencyMs || 0);
    m.lastSuccessAt = Date.now();
    m.consecutiveFailures = 0;
    m.cooldownUntil = 0;
    m.lastErrorClass = null;
  }

  function recordRouteFailure(keyId, model, errorClass, scope) {
    const m = getRouteMetric(keyId, model);
    m.failure += 1;
    m.consecutiveFailures = (m.consecutiveFailures || 0) + 1;
    m.lastErrorClass = errorClass;
    const now = Date.now();
    // Model-level circuit breaker; key-wide handled via key.status
    if (errorClass === 'MODEL_429' || errorClass === 'UPSTREAM_429') {
      m.cooldownUntil = now + 45_000;
    } else if (errorClass === 'TIMEOUT') {
      m.cooldownUntil = now + 20_000;
    } else if (errorClass === 'MODEL_UNAVAILABLE') {
      m.cooldownUntil = now + 120_000;
    } else if (m.consecutiveFailures >= 3) {
      m.cooldownUntil = now + 30_000;
    }
  }

  function routeHealthScore(keyId, model) {
    const m = getRouteMetric(keyId, model);
    const now = Date.now();
    if (m.cooldownUntil && m.cooldownUntil > now) return -1e9;
    const attempts = m.success + m.failure;
    const successRate = attempts ? m.success / attempts : 0.5;
    const avgLat = m.success ? (m.totalLatencyMs / m.success) : 15000;
    const stickyBoost = m.lastSuccessAt ? Math.max(0, 1 - (now - m.lastSuccessAt) / 3_600_000) : 0;
    // Higher is better: success rate, recency, lower latency
    return successRate * 100 + stickyBoost * 40 - Math.min(avgLat, 60000) / 1000 - m.consecutiveFailures * 15;
  }

  function keyRank(a, b) {
    // Prefer keys with healthy sticky model + high success rate (not raw useCount)
    const scoreA = routeHealthScore(a.id, a.selectedModel) + (a.status === 'ACTIVE' ? 10 : 0);
    const scoreB = routeHealthScore(b.id, b.selectedModel) + (b.status === 'ACTIVE' ? 10 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    // Fewer consecutive key failures first
    const fa = a.consecutiveFailures || 0;
    const fb = b.consecutiveFailures || 0;
    if (fa !== fb) return fa - fb;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  }

  function rankModels(list, preferred = null, keyId = null) {
    const uniq = [];
    const seen = new Set();
    for (const m of list || []) {
      const id = String(m || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      uniq.push(id);
    }
    // Drop models currently in circuit-breaker cooldown
    const now = Date.now();
    const live = keyId
      ? uniq.filter(m => {
          const met = getRouteMetric(keyId, m);
          return !(met.cooldownUntil && met.cooldownUntil > now);
        })
      : uniq;
    const base = live.length ? live : uniq;
    // Prefer sticky success then free/cheap rank
    return rankChatModels(base, preferred);
  }

  function normalizeAssistantReply(text) {
    let s = String(text || '').trim();
    if (!s) return s;
    // Strip accidental internal router JSON if model echoed it
    if (/^\{\s*"route"\s*:/.test(s) || /^\{\s*"provider"\s*:/.test(s)) {
      try {
        const j = JSON.parse(s);
        if (j && typeof j.reply === 'string' && j.reply.trim()) return j.reply.trim();
      } catch {}
    }
    // Never surface App Builder branding from Hub assistant
    s = s.replace(/\bApp Builder\b/gi, 'this SoloHost app');
    return s;
  }


  async function chooseKeys(provider, model, allowProviderFallback = true) {
    await loadState();
    const now = Date.now();
    const mode = state.config?.routingMode || 'balanced';
    const usable = k => {
      if (k.status === 'BILLING_REQUIRED' || k.status === 'INVALID') return false;
      if (k.retryAt && k.retryAt > now && k.status !== 'ACTIVE') return false;
      return k.status === 'ACTIVE'
        || (k.status === 'ERROR' && (k.models || []).length > 0 && (!k.retryAt || k.retryAt <= now))
        || (k.status === 'COOLDOWN' && (!k.retryAt || k.retryAt <= now));
    };

    let pool = state.keys.filter(usable);
    // Routing policies
    if (provider === 'local' || mode === 'local_only') {
      pool = pool.filter(k => k.provider === 'local');
    } else if (mode === 'cloud' && !provider) {
      pool = pool.filter(k => k.provider !== 'local');
    } else if (provider) {
      pool = pool.filter(k => k.provider === provider);
    }

    // Prefer keys that list the requested model, but do NOT drop ACTIVE keys
    // when the client sends a stale/wrong model id (e.g. openrouter free id on gemini).
    if (model) {
      const matched = pool.filter(k => (k.models || []).includes(model) || k.selectedModel === model);
      if (matched.length) pool = matched;
    }

    // prefer_local: local keys first
    if (!provider && mode === 'prefer_local') {
      pool = [
        ...pool.filter(k => k.provider === 'local').sort(keyRank),
        ...pool.filter(k => k.provider !== 'local').sort(keyRank)
      ];
      return pool;
    }

    pool = pool.sort(keyRank);
    if (pool.length || !provider || !allowProviderFallback || mode === 'local_only') return pool;

    // fallback to other providers when requested provider empty (balanced / prefer_local)
    if (mode === 'local_only') return [];
    return state.keys
      .filter(usable)
      .filter(k => !provider || k.provider !== provider)
      .filter(k => mode !== 'cloud' || k.provider !== 'local')
      .filter(k => !k.retryAt || k.retryAt <= now)
      .sort(keyRank);
  }

  async function activatePendingKeys(provider, model, requestId) {
    await loadState();
    const pending = state.keys.filter(k =>
      (k.status === 'TEST_REQUIRED' || k.status === 'ERROR' || k.status === 'COOLDOWN')
      && (!provider || k.provider === provider)
      && (!model || !k.models?.length || k.models.includes(model) || k.selectedModel === model)
    );
    for (const k of pending.slice(0, 5)) {
      await logger.write('token.auto_verify.start', 'info', { requestId, provider: k.provider, keyId: k.id });
      const checked = await kernel.keys.verifyKey(k.id);
      if (checked.status === 'ACTIVE') {
        await logger.write('token.auto_verify.success', 'info', {
          requestId, provider: k.provider, keyId: k.id, modelCount: checked.models?.length || 0
        });
      } else {
        await logger.write('token.auto_verify.failed', 'warn', {
          requestId, provider: k.provider, keyId: k.id, status: checked.status, error: checked.lastError
        });
      }
    }
    return chooseKeys(provider, model, !provider);
  }

  const kernel = {
    schema, store, actions, providers,

    async chat({ message, provider, model, system, appId, strictProvider = false }) {
      const requestId = crypto.randomUUID();
      if (!message?.trim()) throw Object.assign(new Error('MESSAGE_REQUIRED'), { statusCode: 400 });

      const requestStartedAt = Date.now();
      await logger.write('chat.request', 'info', {
        requestId, provider, model, appId: appId || 'hub-ui', messageLength: String(message).length
      });

      let eligible = await chooseKeys(provider, model, !provider && !strictProvider);
      if (!eligible.length) eligible = await activatePendingKeys(provider, model, requestId);
      // Stale sticky model on wrong provider → still use ACTIVE keys for that provider
      if (!eligible.length && provider) eligible = await chooseKeys(provider, null, !strictProvider);
      if (!eligible.length && !strictProvider) eligible = await chooseKeys(null, null, true);

      if (!eligible.length) {
        await logger.write('chat.failed', 'warn', {
          requestId, reason: 'NO_ACTIVE_KEY', provider, model,
          available: state.keys.filter(k => !provider || k.provider === provider)
            .map(k => ({ provider: k.provider, status: k.status, keyId: k.id, lastError: k.lastError }))
        });
        if (typeof localReply === 'function') {
          try {
            const guide = await localReply(message, { appId: appId || 'hub-ui', reason: 'NO_ACTIVE_KEY' });
            if (guide?.reply) {
              return {
                reply: guide.reply,
                provider: guide.provider || 'local-guide',
                model: guide.model || 'offline-manual',
                offline: true,
                needsUserAction: true,
                requestId
              };
            }
          } catch {}
        }
        return {
          reply: '',
          error: 'NO_ACTIVE_KEY',
          message: 'No usable AI key is available. Open Settings → Activity Log for the exact provider/key error, then Test / refresh models on a key.',
          needsUserAction: true,
          requestId
        };
      }

      await loadState();
      const memApp = appId || 'hub-ui';
      const memories = (state.memory || [])
        .filter(x => (x.appId || 'hub-ui') === memApp)
        .slice(-8)
        .map(x => `${x.role}: ${x.content}`)
        .join('\n');
      const appKnowledge = (typeof knowledge === 'string' && knowledge.trim())
        ? knowledge.trim()
        : '';
      const contextSystem = [
        system || 'You are the Personal AI Hub assistant for this SoloHost AI Gateway. Guide the user using the app knowledge below. Be concise. Reply in the user language.',
        appKnowledge ? `APP KNOWLEDGE (authoritative):\n${appKnowledge}` : '',
        memories ? `Relevant recent private interaction memory:\n${memories}` : ''
      ].filter(Boolean).join('\n\n');

      const failures = [];
      for (const k of eligible) {
        const p = providers[k.provider];
        if (!p) continue;

        // Prefer sticky + discovered models only. Catalog defaults are last-resort
        // when the key has no discovered list (avoids 404 on removed models like Groq llama-3.1-8b-instant).
        const preferred = k.selectedModel || null;
        let candidates = [];
        const discovered = k.models || [];
        // Only force client model if this key actually lists it
        const modelOnKey = model && (
          !discovered.length
          || discovered.includes(model)
          || preferred === model
        );
        if (modelOnKey) candidates.push(model);
        if (discovered.length) candidates.push(...discovered);
        else candidates.push(...(p.models || []));
        const stickyOk = preferred && (!discovered.length || discovered.includes(preferred));
        candidates = rankModels(candidates, stickyOk ? preferred : null, k.id);
        if (modelOnKey) candidates = [model, ...candidates.filter(m => m !== model)];
        // Fast path: sticky healthy model first, then at most 2 alternates
        if (stickyOk && preferred) {
          candidates = [preferred, ...candidates.filter(m => m !== preferred)];
        }

        if (!candidates.length) {
          failures.push({ provider: k.provider, reason: 'NO_MODEL' });
          continue;
        }

        let chosen = candidates[0];
        try {
          const token = k.provider === 'local' ? '' : await vault.get(k.id);
          if (k.provider !== 'local' && !token) throw new Error('TOKEN_NOT_FOUND');

          let result = null;
          let lastModelError = null;
          let quotaHits = 0;
          const seenFingerprints = new Set();
          // Fast Smart Router: try sticky + few alternates, not the whole catalog
          const maxTry = Math.min(candidates.length, k.provider === 'local' ? 2 : 3);
          for (let i = 0; i < maxTry; i++) {
            chosen = candidates[i];
            try {
              await logger.write('chat.attempt', 'info', { requestId, provider: k.provider, model: chosen, keyId: k.id });
              if (k.provider === 'local') {
                const live = local.baseUrl?.() || providers.local?.baseUrl;
                if (live) p.baseUrl = live;
              }
              const providerForKey = k.baseUrl ? { ...p, baseUrl: k.baseUrl } : p;
              result = await chatProvider(
                providerForKey, token, chosen,
                [{ role: 'system', content: contextSystem }, { role: 'user', content: message }],
                fetchImpl
              );
              const reply = String(result.reply || '').trim();
              if (!reply) {
                const e = new Error('PROVIDER_EMPTY_RESPONSE');
                e.status = 502;
                throw e;
              }
              break;
            } catch (candidateErr) {
              lastModelError = candidateErr;
              const cls = classifyProviderError(candidateErr);
              const fingerprint = `${k.provider}|${k.id}|${chosen}|${cls.class}`;
              if (seenFingerprints.has(fingerprint)) continue;
              seenFingerprints.add(fingerprint);
              recordRouteFailure(k.id, chosen, cls.class, cls.scope);

              // Key-wide: stop this key immediately (no more models on same key)
              if (cls.scope === 'key' || cls.class === 'INVALID' || cls.class === 'BILLING_REQUIRED') {
                candidateErr.status = cls.class === 'BILLING_REQUIRED' ? 402 : (candidateErr.status || 401);
                candidateErr.errorClass = cls.class;
                throw candidateErr;
              }

              if (cls.class === 'TIMEOUT') {
                await logger.write('model.unavailable', 'warn', {
                  requestId, provider: k.provider, model: chosen, keyId: k.id,
                  status: 504, suggestedModel: null, error: safeError(candidateErr), errorClass: cls.class
                });
                // Fail this key fast on timeout — try next key/route
                throw candidateErr;
              }

              if (cls.class === 'MODEL_429' || cls.class === 'UPSTREAM_429' || candidateErr.status === 429) {
                quotaHits += 1;
                // Cooldown model only — keep key ACTIVE for other models
                k.models = (k.models || []).filter(m => m !== chosen);
                await logger.write('model.quota', 'warn', {
                  requestId, provider: k.provider, model: chosen, keyId: k.id,
                  status: 429, error: safeError(candidateErr), errorClass: cls.class
                });
                continue;
              }

              const suggested = extractModelHint(candidateErr.message || candidateErr.body || '');
              if (suggested && isChatCapableModel(suggested) && !candidates.includes(suggested)) {
                candidates.push(suggested);
              }
              if (cls.class === 'MODEL_UNAVAILABLE' || candidateErr.status === 404) {
                k.models = (k.models || []).filter(m => m !== chosen);
              }
              await logger.write('model.unavailable', 'warn', {
                requestId, provider: k.provider, model: chosen, keyId: k.id,
                status: candidateErr.status || null, suggestedModel: suggested || null,
                error: safeError(candidateErr), errorClass: cls.class
              });
              if (model && chosen === model && candidateErr.status !== 404) throw candidateErr;
            }
          }
          if (!result) {
            // Cool down the key only when quota exhausted across tried models.
            if (quotaHits > 0 && quotaHits >= Math.min(maxTry, 3)) {
              const e = lastModelError || new Error('PROVIDER_QUOTA_ALL_MODELS');
              e.status = 429;
              throw e;
            }
            throw lastModelError || new Error('PROVIDER_NO_USABLE_MODEL');
          }

          const reply = normalizeAssistantReply(String(result.reply || '').trim());
          const now = new Date().toISOString();
          const latencyMs = Date.now() - (requestStartedAt || Date.now());
          recordRouteSuccess(k.id, result.model || chosen, latencyMs);
          k.lastUsed = now;
          k.lastError = null;
          k.status = 'ACTIVE';
          k.useCount = (k.useCount || 0) + 1;
          k.retryAt = 0;
          k.consecutiveFailures = 0;
          // Sticky preferred model — strong priority next request
          k.selectedModel = result.model || chosen;
          if (result.model && isChatCapableModel(result.model)) {
            k.models = rankModels([result.model, ...(k.models || [])], result.model);
          }

          state.memory.push({ role: 'user', content: message, ts: now, provider: k.provider, model: result.model, requestId, appId: appId || 'default' });
          state.memory.push({ role: 'assistant', content: reply, ts: new Date().toISOString(), provider: k.provider, model: result.model, requestId, appId: appId || 'default' });
          state.memory = state.memory.slice(-200);

          // Training pairs for local AI self-learning (cloud → local knowledge transfer)
          if (k.provider !== 'local') {
            state.training = state.training || [];
            state.training.push({
              id: requestId,
              ts: now,
              provider: k.provider,
              model: result.model,
              user: message,
              assistant: reply,
              appId: appId || 'default'
            });
            state.training = state.training.slice(-500);
          }

          await saveState();
          await logger.write('chat.success', 'info', {
            requestId, provider: k.provider, model: result.model, keyId: k.id,
            appId: appId || 'hub-ui', responseLength: reply.length
          });
          return { ...result, reply, provider: k.provider, keyId: k.id, requestId, usage: result.usage || null };
        } catch (err) {
          const messageSafe = safeError(err);
          const cls = classifyProviderError(err);
          if (cls.class === 'INVALID') {
            k.status = 'INVALID'; k.retryAt = 0;
          } else if (cls.class === 'BILLING_REQUIRED') {
            k.status = 'BILLING_REQUIRED'; k.retryAt = 0;
          } else if (cls.class === 'MODEL_429' || cls.class === 'UPSTREAM_429') {
            // Keep key ACTIVE — model already cooled down in metrics
            k.status = 'ACTIVE';
            k.retryAt = 0;
          } else if (cls.class === 'TIMEOUT') {
            k.status = 'ERROR';
            k.retryAt = Date.now() + 20_000;
            k.consecutiveFailures = (k.consecutiveFailures || 0) + 1;
          } else if (cls.class === 'MODEL_UNAVAILABLE' || err.status === 404) {
            // Model-level; key stays usable for other models
            k.status = 'ACTIVE';
            k.retryAt = 0;
          } else {
            k.status = 'ERROR';
            k.retryAt = Date.now() + 15_000;
            k.consecutiveFailures = (k.consecutiveFailures || 0) + 1;
          }
          k.lastError = messageSafe;
          k.lastChecked = new Date().toISOString();
          failures.push({
            provider: k.provider, model: chosen, reason: messageSafe,
            status: err.status || null, errorClass: cls.class
          });
          await logger.write('provider.chat.failed', 'error', {
            requestId, provider: k.provider, model: chosen, keyId: k.id,
            error: messageSafe, status: err.status || null, errorClass: cls.class
          });
          await saveState();
          // Key-wide billing/auth: skip remaining keys of same provider with same fingerprint? continue to next key
        }
      }

      await logger.write('chat.failed', 'error', {
        requestId, reason: 'ALL_PROVIDERS_FAILED', provider, model,
        attempts: failures.length, failures
      });
      return {
        reply: '',
        error: 'ALL_PROVIDERS_FAILED',
        message: 'All eligible AI routes failed. Open Settings → Activity Log for the exact failure, then Test / refresh models.',
        failures,
        needsUserAction: true,
        requestId
      };
    },

    async embed({ input, provider, model, appId } = {}) {
      const requestId = crypto.randomUUID();
      const values = Array.isArray(input) ? input : [input];
      if (!values.length || values.some(v => typeof v !== 'string' || !v.trim())) {
        throw Object.assign(new Error('INPUT_REQUIRED'), { statusCode: 400 });
      }
      await loadState();
      const now = Date.now();
      let eligible = state.keys.filter(k => (k.status === 'ACTIVE' || (k.status === 'ERROR' && (!k.retryAt || k.retryAt <= now))) && (!provider || k.provider === provider));
      if (!eligible.length) throw Object.assign(new Error('NO_ACTIVE_KEY'), { statusCode: 503 });
      for (const k of eligible) {
        const p = providers[k.provider];
        if (!p) continue;
        const chosen = model || k.selectedModel || k.models?.[0] || p.models?.[0];
        if (!chosen) continue;
        const token = k.provider === 'local' ? '' : await vault.get(k.id);
        try {
          const result = await embedProvider(p, token, chosen, values, fetchImpl);
          return { ...result, model: result.model || chosen, provider: k.provider, keyId: k.id, requestId };
        } catch (err) {
          if (err.status === 401 || err.status === 403) k.status = 'INVALID';
          else if (err.status === 429) { k.status = 'COOLDOWN'; k.retryAt = Date.now() + 60000; }
          else k.status = 'ERROR';
          k.lastError = safeError(err);
          await saveState();
        }
      }
      throw Object.assign(new Error('ALL_PROVIDERS_FAILED'), { statusCode: 503 });
    },

    keys: {
      async listKeys(provider) {
        await loadState();
        return state.keys.filter(k => !provider || k.provider === provider).map(publicKey);
      },

      async addKey({ provider, token, model, baseUrl }) {
        await loadState();
        if (!providers[provider]) throw Object.assign(new Error('UNKNOWN_PROVIDER'), { statusCode: 400 });
        if (!['local','custom'].includes(provider) && !token?.trim()) throw Object.assign(new Error('TOKEN_REQUIRED'), { statusCode: 400 });
        if (provider === 'custom' && !String(baseUrl || '').trim()) throw Object.assign(new Error('CUSTOM_BASE_URL_REQUIRED'), { statusCode: 400 });

        // Detect mismatched token prefixes and warn via logs (still allow explicit provider).
        const hint = detectProviderHint(token);
        if (hint && hint !== provider && provider !== 'local') {
          await logger.write('token.provider_mismatch', 'warn', {
            requestedProvider: provider, suggestedProvider: hint, tokenPrefix: String(token).slice(0, 6)
          });
        }

        const id = crypto.randomUUID();
        const masked = provider === 'local' ? 'LOCAL' : `${token.slice(0, 4)}...${token.slice(-4)}`;
        const key = {
          id, provider, masked, status: 'TEST_REQUIRED', models: [],
          selectedModel: model || null, baseUrl: provider === 'custom' ? String(baseUrl || '').trim().replace(/\/$/, '') : null, createdAt: new Date().toISOString(),
          lastChecked: null, lastError: null, retryAt: 0, useCount: 0
        };
        state.keys.push(key);
        await vault.set(id, token || '');
        await saveState();
        await logger.write('token.added', 'info', { provider, keyId: id });

        // Always verify server-side (including local) so keys do not stay TEST_REQUIRED forever.
        return await kernel.keys.verifyKey(id);
      },

      async verifyKey(id) {
        await loadState();
        const k = state.keys.find(x => x.id === id);
        if (!k) throw Object.assign(new Error('KEY_NOT_FOUND'), { statusCode: 404 });
        const p = providers[k.provider];
        if (!p) throw Object.assign(new Error('UNKNOWN_PROVIDER'), { statusCode: 400 });

        await logger.write('token.verify.start', 'info', { provider: k.provider, keyId: k.id });
        const previousModels = [...(k.models || [])];

        try {
          const token = k.provider === 'local' ? '' : await vault.get(k.id);
          if (k.provider !== 'local' && !token) throw new Error('TOKEN_NOT_FOUND');

          let models;
          if (k.provider === 'local') {
            // Multi-URL Ollama discovery (host.docker.internal, etc.) — not single baseUrl.
            const localInfo = await kernel.local.models();
            if (!localInfo.available) throw new Error(localInfo.error || 'LOCAL_UNAVAILABLE');
            models = localInfo.models || [];
          } else {
            models = await listModels(k.baseUrl ? { ...p, baseUrl: k.baseUrl } : p, token, fetchImpl);
          }
          k.models = models.length ? models.filter(isChatCapableModel) : (p.models || []).filter(isChatCapableModel);
          k.status = k.provider === 'local' && !k.models.length ? 'ERROR' : 'ACTIVE';
          if (k.provider === 'local' && !k.models.length) k.lastError = 'NO_LOCAL_MODELS_PULLED';
          else k.lastError = null;
          k.lastChecked = new Date().toISOString();
          k.retryAt = 0;
          if (k.selectedModel && !k.models.includes(k.selectedModel)) k.selectedModel = k.models[0] || null;
          await saveState();
          await logger.write('token.verified', 'info', {
            provider: k.provider, keyId: k.id, modelCount: k.models.length
          });
          return publicKey(k);
        } catch (err) {
          const isAuth = err.status === 401 || err.status === 403;
          const isLocalDown = k.provider === 'local';
          k.status = isAuth ? 'INVALID'
            : err.status === 402 ? 'BILLING_REQUIRED'
            : err.status === 429 ? 'COOLDOWN'
            : isLocalDown ? 'ERROR'
            : 'ERROR';
          k.retryAt = k.status === 'COOLDOWN' ? Date.now() + 60_000 : (isLocalDown ? Date.now() + 30_000 : 0);
          k.lastChecked = new Date().toISOString();
          k.lastError = safeError(err);
          // Preserve previously discovered models on transient failure so UI still shows them.
          if (!isAuth && previousModels.length && !(k.models || []).length) k.models = previousModels;
          await saveState();
          await logger.write('token.verify.failed', 'error', {
            provider: k.provider, keyId: k.id, error: safeError(err), status: err.status || null
          });
          return publicKey(k);
        }
      },

      async removeKey(id) {
        await loadState();
        const removed = state.keys.find(x => x.id === id);
        state.keys = state.keys.filter(x => x.id !== id);
        await vault.remove(id);
        if (removed?.provider === 'local') {
          state.config = state.config || {};
          state.config.localKeyRemoved = true;
        }
        await saveState();
        await logger.write('token.removed', 'info', { keyId: id, provider: removed?.provider || null });
        return { success: true };
      },

      async providers() {
        return Object.values(providers).map(providerInfo);
      }
    },

    logs: logger,

    local: {
      async models(opts = {}) {
        await loadState();
        // Restore saved custom base URL once
        if (state.config?.ollamaBaseUrl) local.setBaseUrl(state.config.ollamaBaseUrl);
        const health = await local.models({ force: !!opts.force });
        if (health.available) {
          if (health.baseUrl && providers.local) providers.local.baseUrl = health.baseUrl;
          // Log only on fresh success, not every cached hit
          // Rate-limit success logs (health probes often) — at most 1 / 10 min
          if (!health.cached && Date.now() - (globalThis.__paiLocalOkLog || 0) > 600_000) {
            globalThis.__paiLocalOkLog = Date.now();
            await logger.write('local.models.ok', 'info', { count: (health.models || []).length, base: health.baseUrl });
          }
          const lk = state.keys.find(k => k.provider === 'local');
          if (lk) {
            lk.models = health.models || [];
            lk.status = (health.models || []).length ? 'ACTIVE' : 'ERROR';
            lk.lastChecked = new Date().toISOString();
            lk.lastError = (health.models || []).length ? null : 'NO_LOCAL_MODELS_PULLED';
            await saveState();
          }
          return {
            available: true,
            models: health.models || [],
            baseUrl: health.baseUrl || local.getBaseUrl(),
            candidates: health.candidates || local.candidateUrls?.() || [],
            configuredBaseUrl: state.config?.ollamaBaseUrl || null
          };
        }
        // Offline path — log at most when not from cache
        // Rate-limit logs: at most once per 5 minutes (Docker health hits /health often)
        if (!health.cached && Date.now() - lastLocalFailLog > 300_000) {
          lastLocalFailLog = Date.now();
          await logger.write('local.models.failed', 'warn', {
            error: health.error,
            code: health.code || null,
            retryAfterMs: health.retryAfterMs || null
          });
        }
        const lk = state.keys.find(k => k.provider === 'local');
        if (lk) {
          lk.status = 'ERROR';
          lk.lastError = health.error || 'LOCAL_UNAVAILABLE';
          lk.lastChecked = new Date().toISOString();
          await saveState();
        }
        return {
          available: false,
          models: [],
          error: health.error || 'LOCAL_UNAVAILABLE',
          candidates: health.candidates || local.candidateUrls?.() || [],
          cached: !!health.cached,
          retryAfterMs: health.retryAfterMs || null,
          configuredBaseUrl: state.config?.ollamaBaseUrl || null,
          hint: 'Install Ollama on the SoloHost host, ensure it listens on 0.0.0.0:11434, then set Base URL (e.g. http://host.docker.internal:11434) and press Save / Refresh.'
        };
      },
      async setBaseUrl(url) {
        await loadState();
        state.config = state.config || {};
        const cleaned = url ? String(url).trim().replace(/\/$/, '') : '';
        state.config.ollamaBaseUrl = cleaned || null;
        local.setBaseUrl(cleaned || null);
        if (cleaned && providers.local) providers.local.baseUrl = cleaned;
        await saveState();
        await logger.write('local.base_url.set', 'info', { base: cleaned || null });
        return kernel.local.models({ force: true });
      },
      async pull(name) {
        if (!name?.trim()) throw Object.assign(new Error('MODEL_NAME_REQUIRED'), { statusCode: 400 });
        await loadState();
        if (state.config?.ollamaBaseUrl) local.setBaseUrl(state.config.ollamaBaseUrl);
        await logger.write('local.model.pull.start', 'info', { model: name, base: local.baseUrl?.() });
        try {
          const r = await local.pull(name);
          await logger.write('local.model.pull.success', 'info', { model: name, base: local.baseUrl?.() });
          const refreshed = await kernel.local.models({ force: true });
          return {
            success: true,
            model: name,
            status: r?.status || 'success',
            models: refreshed.models,
            baseUrl: refreshed.baseUrl
          };
        } catch (err) {
          await logger.write('local.model.pull.failed', 'error', { model: name, error: safeError(err) });
          const e = new Error(safeError(err));
          e.statusCode = err.statusCode || 502;
          throw e;
        }
      }
    },

    memory: {
      async list(limit = 100, { appId = null, admin = false } = {}) {
        await loadState();
        let rows = state.memory || [];
        if (!admin) {
          const id = appId || 'default';
          rows = rows.filter(m => (m.appId || 'default') === id);
        }
        return rows.slice(-Math.min(limit, 200)).reverse();
      },
      async clear({ appId = null, admin = false } = {}) {
        await loadState();
        if (admin && !appId) {
          state.memory = [];
        } else {
          const id = appId || 'default';
          state.memory = (state.memory || []).filter(m => (m.appId || 'default') !== id);
        }
        await saveState();
        await logger.write('memory.cleared', 'info', { appId: appId || (admin ? '*' : 'default') });
        return { success: true };
      },
      async trainingExport(limit = 200, { appId = null, admin = false } = {}) {
        await loadState();
        let pairs = state.training || [];
        if (!admin) {
          const id = appId || 'default';
          pairs = pairs.filter(p => (p.appId || 'default') === id);
        }
        return {
          format: 'chat-pairs',
          count: Math.min(pairs.length, limit),
          pairs: pairs.slice(-limit)
        };
      },
      async clearTraining({ appId = null, admin = false } = {}) {
        await loadState();
        if (admin && !appId) {
          state.training = [];
        } else {
          const id = appId || 'default';
          state.training = (state.training || []).filter(p => (p.appId || 'default') !== id);
        }
        await saveState();
        await logger.write('training.cleared', 'info', { appId: appId || (admin ? '*' : 'default') });
        return { success: true };
      }
    },

    gateway: {
      async listTokens() {
        await loadState();
        const day = new Date().toISOString().slice(0, 10);
        return (state.gatewayTokens || []).map(t => {
          const stats = t.stats || { requests: 0, errors: 0, totalTokens: 0, clients: {} };
          const clients = Object.values(stats.clients || {});
          const usageRows = Object.values(state.gatewayUsage || {}).filter(u => u.tokenId === t.id);
          const today = usageRows.filter(u => u.period === day);
          const todayRequests = today.reduce((n, u) => n + (u.requests || 0), 0);
          const todayTokens = today.reduce((n, u) => n + (u.totalTokens || 0), 0);
          return {
            id: t.id,
            name: t.name,
            prefix: t.prefix,
            type: t.type || 'app',
            status: t.appId ? 'bound' : 'unbound',
            appId: t.appId || null,
            createdAt: t.createdAt,
            lastUsed: t.lastUsed || null,
            limits: t.limits || null,
            clientCount: clients.length,
            clients: clients
              .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')))
              .slice(0, 20)
              .map(c => ({
                appId: c.appId || null,
                ip: c.ip || null,
                ua: c.ua ? String(c.ua).slice(0, 80) : null,
                requests: c.requests || 0,
                lastSeen: c.lastSeen || null
              })),
            usage: {
              totalRequests: stats.requests || 0,
              totalErrors: stats.errors || 0,
              totalTokens: stats.totalTokens || 0,
              todayRequests,
              todayTokens
            }
          };
        });
      },
      async createToken({ name, type = 'app', limits = {} } = {}) {
        await loadState();
        const kind = type === 'shared' ? 'shared' : 'app';
        const raw = 'pah_' + crypto.randomBytes(24).toString('base64url');
        const id = crypto.randomUUID();
        const entry = {
          id,
          name: String(name || (kind === 'shared' ? 'Shared SoloHost' : 'SoloHost app')).slice(0, 80),
          type: kind,
          appId: null, // UNBOUND until first use (app tokens only)
          prefix: raw.slice(0, 10) + '…',
          hash: crypto.createHash('sha256').update(raw).digest('hex'),
          createdAt: new Date().toISOString(),
          lastUsed: null,
          _lastPersist: 0,
          limits: {
            perMinute: Number(limits.perMinute || process.env.AI_HUB_GATEWAY_RATE_LIMIT_PER_MIN || 60),
            maxConcurrent: Number(limits.maxConcurrent || process.env.AI_HUB_GATEWAY_MAX_CONCURRENT || 10),
            dailyTokens: Number(limits.dailyTokens || process.env.AI_HUB_GATEWAY_DAILY_TOKENS || 0),
            monthlyTokens: Number(limits.monthlyTokens || process.env.AI_HUB_GATEWAY_MONTHLY_TOKENS || 0)
          }
        };
        state.gatewayTokens = state.gatewayTokens || [];
        state.gatewayTokens.push(entry);
        await vault.set(`gateway:${id}`, raw);
        await saveState();
        await logger.write('gateway.token.created', 'info', { tokenId: id, name: entry.name, type: kind });
        return {
          id, name: entry.name, type: kind, status: 'unbound', appId: null,
          token: raw, prefix: entry.prefix, createdAt: entry.createdAt, limits: entry.limits
        };
      },
      async revokeToken(id) {
        await loadState();
        state.gatewayTokens = (state.gatewayTokens || []).filter(t => t.id !== id);
        // Drop usage rows for this token
        for (const k of Object.keys(state.gatewayUsage || {})) {
          if (k.startsWith(id + ':') || (state.gatewayUsage[k] && state.gatewayUsage[k].tokenId === id)) {
            delete state.gatewayUsage[k];
          }
        }
        try { await vault.del?.(`gateway:${id}`); } catch {}
        await saveState();
        await logger.write('gateway.token.revoked', 'info', { tokenId: id });
        return { success: true, deleted: id };
      },
      async unbindToken(id) {
        await loadState();
        const hit = (state.gatewayTokens || []).find(t => t.id === id);
        if (!hit) throw Object.assign(new Error('TOKEN_NOT_FOUND'), { statusCode: 404 });
        hit.appId = null;
        await saveState();
        await logger.write('gateway.token.unbound', 'info', { tokenId: id });
        return { id: hit.id, status: 'unbound', appId: null, type: hit.type || 'app' };
      },
      /**
       * Validate gateway token + optional App-ID binding.
       * App tokens: first use binds to X-SoloHost-App-ID; later mismatches → 403.
       * Shared tokens: any appId allowed.
       */
      async validate(raw, { appId = null, bind = true } = {}) {
        if (!raw) return null;
        await loadState();
        const hash = crypto.createHash('sha256').update(String(raw)).digest('hex');
        const hit = (state.gatewayTokens || []).find(t => t.hash === hash);
        if (!hit) return null;
        const kind = hit.type || 'app';
        const claimed = appId ? String(appId).slice(0, 80) : null;

        if (kind === 'app') {
          if (!hit.appId && claimed && bind) {
            hit.appId = claimed;
            await logger.write('gateway.token.bound', 'info', { tokenId: hit.id, appId: claimed });
            await saveState();
          } else if (hit.appId && claimed && hit.appId !== claimed) {
            const e = new Error('TOKEN_APP_MISMATCH');
            e.statusCode = 403;
            e.code = 'TOKEN_APP_MISMATCH';
            throw e;
          }
        }

        // Throttle lastUsed disk writes (max once / 30s per token)
        const now = Date.now();
        hit.lastUsed = new Date().toISOString();
        if (!hit._lastPersist || now - hit._lastPersist > 30_000) {
          hit._lastPersist = now;
          await saveState();
        }
        return {
          id: hit.id,
          name: hit.name,
          type: kind,
          appId: hit.appId || claimed || null,
          status: hit.appId ? 'bound' : 'unbound'
        };
      },
      async usage({ tokenId = null, appId = null } = {}) {
        await loadState();
        const all = Object.values(state.gatewayUsage || {});
        const rows = all.filter(x => (!tokenId || x.tokenId === tokenId) && (!appId || x.appId === appId));
        return rows.reduce((a, x) => ({
          requests: a.requests + (x.requests || 0),
          promptTokens: a.promptTokens + (x.promptTokens || 0),
          completionTokens: a.completionTokens + (x.completionTokens || 0),
          totalTokens: a.totalTokens + (x.totalTokens || 0),
          errors: a.errors + (x.errors || 0)
        }), { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, errors: 0 });
      },
      async acquire(raw, { appId = null } = {}) {
        const ok = await this.validate(raw, { appId, bind: true });
        if (!ok) return null;
        await loadState();
        const token = state.gatewayTokens.find(t => t.id === ok.id);
        const limits = {
          perMinute: Number(token?.limits?.perMinute || process.env.AI_HUB_GATEWAY_RATE_LIMIT_PER_MIN || 60),
          maxConcurrent: Number(token?.limits?.maxConcurrent || process.env.AI_HUB_GATEWAY_MAX_CONCURRENT || 10),
          dailyTokens: Number(token?.limits?.dailyTokens || 0),
          monthlyTokens: Number(token?.limits?.monthlyTokens || 0)
        };
        const slot = gatewayRateLimiter.tryAcquire(ok.id);
        if (!slot.ok) { const e = new Error(slot.reason || 'RATE_LIMIT'); e.statusCode = 429; e.retryAfter = slot.retryAfter; throw e; }
        const nowTs = Date.now();
        let window = gatewayWindows.get(ok.id);
        if (!window || nowTs - window.startedAt >= 60_000) window = { startedAt: nowTs, timestamps: [], concurrent: 0 };
        window.timestamps = window.timestamps.filter(t => nowTs - t < 60_000);
        if (window.timestamps.length >= limits.perMinute || window.concurrent >= limits.maxConcurrent) {
          slot.release(); const e = new Error(window.concurrent >= limits.maxConcurrent ? 'CONCURRENT_LIMIT' : 'RATE_LIMIT'); e.statusCode = 429; e.retryAfter = Math.max(1, Math.ceil((60_000 - (nowTs - (window.timestamps[0] || nowTs))) / 1000)); throw e;
        }
        window.timestamps.push(nowTs); window.concurrent += 1; gatewayWindows.set(ok.id, window);
        const release = slot.release; slot.release = () => { release(); const w=gatewayWindows.get(ok.id); if(w) { w.concurrent=Math.max(0,w.concurrent-1); gatewayWindows.set(ok.id,w); } };
        const day = new Date().toISOString().slice(0,10);
        const month = day.slice(0,7);
        const rows = Object.values(state.gatewayUsage || {});
        const dayTokens = rows.filter(x => x.tokenId === ok.id && x.period === day).reduce((n,x)=>n+(x.totalTokens||0),0);
        const monthTokens = rows.filter(x => x.tokenId === ok.id && x.period.startsWith(month)).reduce((n,x)=>n+(x.totalTokens||0),0);
        if ((limits.dailyTokens && dayTokens >= limits.dailyTokens) || (limits.monthlyTokens && monthTokens >= limits.monthlyTokens)) { slot.release(); const e = new Error('USAGE_QUOTA_EXCEEDED'); e.statusCode=429; e.retryAfter=60; throw e; }
        return { ...ok, slot, limits };
      },
      async recordUsage({ tokenId, appId = null, usage = null, error = false, client = null } = {}) {
        if (!tokenId) return;
        await loadState();
        const day = new Date().toISOString().slice(0,10);
        const id = `${tokenId}:${appId || 'default'}:${day}`;
        const u = state.gatewayUsage[id] ||= { tokenId, appId: appId || null, period: day, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, errors: 0 };
        u.requests += 1;
        if (error) u.errors += 1;
        u.promptTokens += Number(usage?.prompt_tokens || 0);
        u.completionTokens += Number(usage?.completion_tokens || 0);
        u.totalTokens += Number(usage?.total_tokens || 0);

        const tok = (state.gatewayTokens || []).find(x => x.id === tokenId);
        if (tok) {
          tok.lastUsed = new Date().toISOString();
          tok.stats = tok.stats || { requests: 0, errors: 0, totalTokens: 0, clients: {} };
          tok.stats.requests = (tok.stats.requests || 0) + 1;
          if (error) tok.stats.errors = (tok.stats.errors || 0) + 1;
          tok.stats.totalTokens = (tok.stats.totalTokens || 0) + Number(usage?.total_tokens || 0);
          const ip = client?.ip || null;
          const ua = client?.ua || null;
          const fingerprint = [appId || '', ip || '', (ua || '').slice(0, 40)].join('|') || 'unknown';
          const c = tok.stats.clients[fingerprint] ||= {
            appId: appId || null, ip, ua: ua ? String(ua).slice(0, 120) : null,
            requests: 0, lastSeen: null
          };
          c.requests += 1;
          c.lastSeen = tok.lastUsed;
          c.appId = appId || c.appId;
          // Cap stored clients per token
          const keys = Object.keys(tok.stats.clients);
          if (keys.length > 50) {
            const sorted = keys.sort((a, b) => String(tok.stats.clients[a].lastSeen || '').localeCompare(String(tok.stats.clients[b].lastSeen || '')));
            for (const k of sorted.slice(0, keys.length - 50)) delete tok.stats.clients[k];
          }
        }
        await saveState();
      },
    },

    routing: {
      async get() {
        await loadState();
        return {
          mode: state.config?.routingMode || 'balanced',
          modes: ['local_only', 'prefer_local', 'balanced', 'cloud'],
          description: {
            local_only: 'Only managed Ollama',
            prefer_local: 'Ollama first, then cloud',
            balanced: 'Any ready provider (least used)',
            cloud: 'Cloud providers only'
          }
        };
      },
      async set(mode) {
        const allowed = ['local_only', 'prefer_local', 'balanced', 'cloud'];
        if (!allowed.includes(mode)) throw Object.assign(new Error('INVALID_ROUTING_MODE'), { statusCode: 400 });
        await loadState();
        state.config = state.config || {};
        state.config.routingMode = mode;
        await saveState();
        await logger.write('routing.mode.set', 'info', { mode });
        return this.get();
      }
    },

    async health() {
      await loadState();
      const keys = state.keys.map(publicKey);
      const byProvider = {};
      for (const k of keys) {
        const bucket = byProvider[k.provider] ||= {
          total: 0, active: 0, invalid: 0, error: 0, cooldown: 0, billing: 0, modelUnavailable: 0, testRequired: 0
        };
        bucket.total++;
        if (k.status === 'ACTIVE') bucket.active++;
        else if (k.status === 'INVALID') bucket.invalid++;
        else if (k.status === 'COOLDOWN') bucket.cooldown++;
        else if (k.status === 'BILLING_REQUIRED') bucket.billing++;
        else if (k.status === 'MODEL_UNAVAILABLE') bucket.modelUnavailable++;
        else if (k.status === 'TEST_REQUIRED') bucket.testRequired++;
        else bucket.error++;
      }
      const localInfo = await kernel.local.models();
      return {
        ok: true,
        activeKeys: keys.filter(k => k.status === 'ACTIVE').length,
        totalKeys: keys.length,
        providers: Object.values(providers).length,
        local: localInfo.available,
        localModels: localInfo.models?.length || 0,
        localStatus: localInfo.status || (localInfo.available ? 'ready' : 'unavailable'),
        localCode: localInfo.code || null,
        routingMode: state.config?.routingMode || 'balanced',
        byProvider
      };
    },

    async diagnostics() {
      const h = await kernel.health();
      return {
        ...h,
        executionPlane: 'Unified AI Kernel → Provider Adapter → Model',
        privacy: 'local memory + encrypted provider credentials + local training pairs',
        chat: 'secondary UI; Hub APIs are primary integration surface',
        gateway: { chat: '/api/v1/chat', keys: '/api/v1/keys', health: '/api/v1/health' }
      };
    }
  };

  const backup = {
    async exportEncrypted(passphrase) {
      await loadState();
      const password = String(passphrase || '');
      if (password.length < 8) throw Object.assign(new Error('BACKUP_PASSWORD_TOO_SHORT'), { statusCode: 400 });
      const secrets = {};
      for (const k of state.keys || []) {
        if (k.provider === 'local') continue;
        const secret = await vault.get(k.id);
        if (secret) secrets[`key:${k.id}`] = secret;
      }
      for (const t of state.gatewayTokens || []) {
        const raw = await vault.get(`gateway:${t.id}`);
        if (raw) secrets[`gateway:${t.id}`] = raw;
      }
      const payload = {
        format: 'personal-ai-hub-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        state: {
          keys: (state.keys || []).map(k => ({ ...k })),
          routing: state.routing || {},
          config: state.config || {},
          gatewayTokens: (state.gatewayTokens || []).map(t => ({ ...t, _lastPersist: 0 }))
        },
        secrets
      };
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256');
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.from(JSON.stringify(payload), 'utf8');
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      return {
        format: 'personal-ai-hub-backup', version: 1,
        kdf: 'PBKDF2-SHA256', iterations: 210000,
        salt: salt.toString('base64'), iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64')
      };
    },
    async importEncrypted(backup, passphrase) {
      const password = String(passphrase || '');
      if (password.length < 8) throw Object.assign(new Error('BACKUP_PASSWORD_TOO_SHORT'), { statusCode: 400 });
      if (!backup || backup.format !== 'personal-ai-hub-backup' || Number(backup.version) !== 1) {
        throw Object.assign(new Error('INVALID_BACKUP_FILE'), { statusCode: 400 });
      }
      try {
        const key = crypto.pbkdf2Sync(password, Buffer.from(backup.salt, 'base64'), Number(backup.iterations || 210000), 32, 'sha256');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(backup.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(backup.tag, 'base64'));
        const clear = Buffer.concat([decipher.update(Buffer.from(backup.data, 'base64')), decipher.final()]);
        const payload = JSON.parse(clear.toString('utf8'));
        if (payload.format !== 'personal-ai-hub-backup') throw new Error('INVALID_BACKUP_PAYLOAD');
        await loadState();
        const importedKeys = Array.isArray(payload.state?.keys) ? payload.state.keys : [];
        const secrets = payload.secrets && typeof payload.secrets === 'object' ? payload.secrets : {};
        const existing = new Map((state.keys || []).map(k => [k.id, k]));
        for (const rawKey of importedKeys) {
          if (!rawKey?.id || !providers[rawKey.provider]) continue;
          const copy = { ...rawKey, retryAt: 0 };
          if (copy.provider !== 'local') {
            const secret = secrets[`key:${copy.id}`];
            if (!secret) continue;
            await vault.set(copy.id, secret);
          }
          existing.set(copy.id, copy);
        }
        state.keys = [...existing.values()];
        state.routing = { ...(state.routing || {}), ...(payload.state?.routing || {}) };
        state.config = { ...(state.config || {}), ...(payload.state?.config || {}) };
        const gatewayExisting = new Map((state.gatewayTokens || []).map(t => [t.id, t]));
        for (const rawToken of (Array.isArray(payload.state?.gatewayTokens) ? payload.state.gatewayTokens : [])) {
          if (!rawToken?.id) continue;
          const raw = secrets[`gateway:${rawToken.id}`];
          if (!raw) continue;
          const copy = { ...rawToken, _lastPersist: 0, hash: crypto.createHash('sha256').update(raw).digest('hex') };
          gatewayExisting.set(copy.id, copy);
          await vault.set(`gateway:${copy.id}`, raw);
        }
        state.gatewayTokens = [...gatewayExisting.values()];
        await saveState();
        await logger.write('backup.imported', 'info', { keyCount: state.keys.length, gatewayTokenCount: state.gatewayTokens.length });
        return { ok: true, keys: state.keys.length, gatewayTokens: state.gatewayTokens.length };
      } catch (err) {
        await logger.write('backup.import.failed', 'error', { error: safeError(err) });
        throw Object.assign(new Error('BACKUP_PASSWORD_OR_FILE_INVALID'), { statusCode: 400 });
      }
    }
  };

  return {
    ...kernel,
    backup,
    mount(app, prefix = '/ai', opts = {}) {
      mountKernel(app, { prefix, kernel: this, requireAdmin: opts.requireAdmin || null });
    }
  };
}

function extractModelHint(message) {
  const text = String(message || '');
  // Gemini: "Please update your code to use models/gemini-3.1-pro-preview"
  const patterns = [
    /use models\/([A-Za-z0-9._:-]+)/i,
    /models\/([A-Za-z0-9._:-]+)/i,
    /model[:\s]+[`'"]?([A-Za-z0-9._:-]+)/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match && match[1] && !/generateContent|list/i.test(match[1])) return match[1];
  }
  return null;
}

function detectProviderHint(token) {
  const t = String(token || '');
  if (/^gsk_/i.test(t)) return 'groq';
  if (/^sk-or-/i.test(t)) return 'openrouter';
  if (/^AIza/i.test(t)) return 'gemini';
  if (/^sk-ant-/i.test(t)) return 'anthropic';
  if (/^xai-/i.test(t)) return null;
  // bare sk- is ambiguous (OpenAI / DeepSeek) — never auto-assign
  return null;
}

function safeError(err) {
  return String(err?.message || err || 'UNKNOWN_ERROR')
    .replace(/(?:sk-|key-|token-|Bearer\s+|AIza)[A-Za-z0-9._-]+/gi, '[REDACTED]')
    .slice(0, 500);
}

export { createActionRegistry } from './actions.js';
export { createJsonFileStore } from './store.js';

