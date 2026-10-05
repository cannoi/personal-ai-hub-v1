import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import { createAiKernel, createActionRegistry, createJsonFileStore } from './ai-app-kernel/src/index.js';
import { ensureOllama } from './start-ollama.js';
import { mountOpenAICompat } from './openai-compat.js';
import { createRateLimiter } from './ai-app-kernel/src/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
/** DNS name other SoloHost containers should use (docker compose service name). */
const SERVICE_NAME = process.env.SERVICE_NAME || process.env.HOSTNAME || 'personal-ai-hub';
/**
 * Optional public URL advertised to other apps (e.g. http://192.168.1.10:18080).
 * When unset, discovery lists service-DNS and common host aliases.
 */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.AI_HUB_PUBLIC_URL || '').replace(/\/$/, '');

await mkdir(DATA_DIR, { recursive: true });

const app = express();
app.set('trust proxy', true);

// --- CORS + security headers ---
const ALLOWED_ORIGINS = String(process.env.AI_HUB_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  const origin = req.headers.origin;
  if (!origin) {
    // server-to-server: no CORS headers required
  } else if (ALLOWED_ORIGINS.length === 0) {
    // Secure default: same-origin only. Cross-origin browser apps must explicitly configure AI_HUB_ALLOWED_ORIGINS.
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === req.get('host'); } catch {}
    if (sameOrigin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    else if (req.method === 'OPTIONS') return res.status(403).end();
  } else if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // blocked browser origin — still answer OPTIONS/preflight cleanly for non-credential probes
    if (req.method === 'OPTIONS') return res.status(403).end();
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Personal-AI-Key, X-SoloHost-App-ID, X-Request-Id'
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '2mb' }));

// SoloHost Feedback Hub — defaults embedded (env can override)
const SHFH_DEFAULTS = {
  hubId: process.env.SHFH_HUB_ID || 'SHFH-CANNOI-0905428801',
  hubUrl: (process.env.SHFH_HUB_URL || 'http://14.176.78.46:8090').replace(/\/$/, ''),
  ingestToken: process.env.SHFH_INGEST_TOKEN || 'cannoi_7Kp9xV2mQ8rN4tY6cL3wA5zD1eF0uH9',
  appId: process.env.SHFH_APP_ID || 'personal-ai-hub',
  appName: process.env.SHFH_APP_NAME || 'Personal AI Hub',
  version: process.env.npm_package_version || '1.8.1',
  enabled: process.env.SHFH_ENABLED !== '0'
};
app.get('/api/shfh-config', (_req, res) => {
  const hubUrl = SHFH_DEFAULTS.hubUrl;
  res.json({
    hubId: SHFH_DEFAULTS.hubId,
    hubUrl,
    formUrl: hubUrl + '/feedback',
    ingestToken: SHFH_DEFAULTS.ingestToken,
    appId: SHFH_DEFAULTS.appId,
    appName: SHFH_DEFAULTS.appName,
    version: SHFH_DEFAULTS.version,
    platform: 'solohost',
    enabled: SHFH_DEFAULTS.enabled
  });
});
app.post('/api/shfh-proxy', express.json({ limit: '32kb' }), async (req, res) => {
  if (!SHFH_DEFAULTS.enabled) return res.status(503).json({ error: 'SHFH_DISABLED' });
  const path = String(req.body?.path || '').replace(/^\/+/, '');
  if (!path.startsWith('api/')) return res.status(400).json({ error: 'INVALID_PATH' });
  try {
    const r = await fetch(SHFH_DEFAULTS.hubUrl + '/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer ' + SHFH_DEFAULTS.ingestToken
      },
      body: JSON.stringify(req.body?.payload || {})
    });
    const text = await r.text();
    res.status(r.status).type('application/json').send(text || '{}');
  } catch (e) {
    res.status(502).json({ error: 'SHFH_PROXY_FAILED', message: String(e?.message || e) });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const schema = {
  name: 'personal-ai-hub',
  collections: [
    { name: 'notes', fields: ['id', 'title', 'content', 'createdAt'] },
    { name: 'settings', fields: ['key', 'value'] }
  ]
};

const store = createJsonFileStore(path.join(DATA_DIR, 'app.json'), {
  notes: [
    {
      id: '1',
      title: 'Welcome Note',
      content: 'Welcome to your Personal AI Hub — the shared AI server for SoloHost apps.',
      createdAt: new Date().toISOString()
    }
  ],
  settings: []
});

const actions = createActionRegistry()
  .register({
    name: 'create_note',
    description: 'Create a new note in the hub',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title of the note' },
        content: { type: 'string', description: 'The content of the note' }
      },
      required: ['title', 'content']
    },
    async run({ title, content }) {
      const note = {
        id: Math.random().toString(36).substring(2, 11),
        title,
        content,
        createdAt: new Date().toISOString()
      };
      await store.put('notes', note);
      return { success: true, note };
    }
  })
  .register({
    name: 'list_notes',
    description: 'List all notes stored in the hub',
    parameters: { type: 'object', properties: {} },
    async run() {
      const notes = await store.list('notes');
      return { notes };
    }
  });

const ai = createAiKernel({
  schema,
  store,
  actions,
  stateFile: path.join(DATA_DIR, 'ai-state.json'),
  vaultFile: path.join(DATA_DIR, 'ai-vault.json'),
  masterFile: path.join(DATA_DIR, '.ai-master-key'),
  logFile: path.join(DATA_DIR, 'activity-log.json'),
  stickyFile: path.join(DATA_DIR, 'ai-sticky.json'),
  healthFile: path.join(DATA_DIR, 'ai-health.json')
});


// --- Admin authentication (password from AI_HUB_ADMIN_PASSWORD) ---
const ADMIN_PASSWORD = String(process.env.AI_HUB_ADMIN_PASSWORD || '').trim();
const sessions = new Map(); // sid -> { exp }
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const adminLoginLimiter = createRateLimiter({ perMinute: Number(process.env.AI_HUB_ADMIN_LOGIN_PER_MIN || 10), maxConcurrent: 2 });

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('=') || '');
  }
  return out;
}

function isAdmin(req) {
  if (!ADMIN_PASSWORD) return true; // open control plane until password configured
  const sid = parseCookies(req).ai_hub_admin;
  const s = sid && sessions.get(sid);
  if (!s) return false;
  if (s.exp < Date.now()) { sessions.delete(sid); return false; }
  return true;
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(401).json({ error: 'ADMIN_REQUIRED', message: 'Admin login required' });
}

app.post('/api/v1/admin/login', express.json(), (req, res) => {
  const slot = adminLoginLimiter.tryAcquire(req.ip || req.headers['x-forwarded-for'] || 'admin');
  if (!slot.ok) { res.setHeader('Retry-After', String(slot.retryAfter || 60)); return res.status(429).json({ error: 'LOGIN_RATE_LIMIT', message: 'Too many login attempts. Try again later.' }); }
  if (!ADMIN_PASSWORD) { slot.release();
    return res.json({ ok: true, mode: 'open', message: 'AI_HUB_ADMIN_PASSWORD not set — set it in SoloHost config to lock the admin UI' });
  }
  const password = String(req.body?.password || '');
  // Constant-time compare via SHA-256 digests (equal length)
  const dig = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const ok = crypto.timingSafeEqual(dig(password), dig(ADMIN_PASSWORD));
  if (!ok) {
    return res.status(401).json({ error: 'INVALID_PASSWORD', message: 'Wrong admin password' });
  }
  slot.release();
  const sid = crypto.randomBytes(24).toString('base64url');
  sessions.set(sid, { exp: Date.now() + SESSION_TTL_MS });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `ai_hub_admin=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`
  );
  res.json({ ok: true, authenticated: true });
});

app.post('/api/v1/admin/logout', (req, res) => {
  const sid = parseCookies(req).ai_hub_admin;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'ai_hub_admin=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/v1/admin/session', (req, res) => {
  res.json({
    authenticated: isAdmin(req),
    passwordConfigured: !!ADMIN_PASSWORD
  });
});


// Hub UI + internal control plane
ai.mount(app, '/ai', { requireAdmin });
// Shared AI API for every SoloHost app (same execution plane)
ai.mount(app, '/api/v1', { requireAdmin });

// OpenAI-compatible Universal Provider — MUST be registered before /v1 JSON 404 catch-all
mountOpenAICompat(app, { kernel: ai, serviceName: SERVICE_NAME });


function buildConnectionHints(req) {
  const host = req.get('host') || `${SERVICE_NAME}:${PORT}`;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const requestBase = `${proto}://${host}`;
  const bases = [];
  if (PUBLIC_BASE_URL) bases.push(PUBLIC_BASE_URL);
  bases.push(`http://${SERVICE_NAME}:${PORT}`);
  bases.push(requestBase);
  // Host-gateway aliases useful when apps run in Docker and Hub is published on the host
  if (process.env.HOST_PORT) {
    bases.push(`http://host.docker.internal:${process.env.HOST_PORT}`);
    bases.push(`http://172.17.0.1:${process.env.HOST_PORT}`);
  }
  return [...new Set(bases.filter(Boolean))];
}

app.get('/version', (_req, res) => {
  res.json({
    name: 'personal-ai-hub',
    version: '1.7.1',
    openaiCompatible: true,
    routes: ['GET /v1/models', 'POST /v1/chat/completions', 'POST /v1/responses', 'POST /v1/embeddings', 'GET /v1/health', 'GET /v1/__ping']
  });
});

app.get('/health', async (_req, res) => {
  try {
    const h = await ai.health();
    // Hub is healthy even when Ollama is down — cloud providers still work
    res.json({
      status: 'healthy',
      service: SERVICE_NAME,
      role: 'personal-ai-hub',
      timestamp: new Date().toISOString(),
      hub: h,
      ollama: {
        available: !!h.local,
        models: h.localModels || 0
      }
    });
  } catch {
    res.json({ status: 'healthy', service: SERVICE_NAME, timestamp: new Date().toISOString() });
  }
});

/**
 * Discovery document for SoloHost apps (App Builder, etc.).
 * NEVER returns HTML — always JSON.
 */
app.get('/api/v1/gateway', (req, res) => {
  const hostPort = process.env.HOST_PORT || '18080';
  const dockerBase = `http://${SERVICE_NAME}:8080`;
  const hostBase = `http://172.17.0.1:${hostPort}`;
  const externalBase = PUBLIC_BASE_URL || null;
  const primary = PUBLIC_BASE_URL || dockerBase;
  res.json({
    service: SERVICE_NAME,
    role: 'solohost-ai-gateway',
    version: process.env.npm_package_version || '1.7.1',
    openaiCompatible: true,
    defaultModel: 'auto',
    connections: {
      docker: {
        baseUrl: dockerBase,
        openaiBaseUrl: `${dockerBase}/v1`,
        note: 'Use from other SoloHost containers on the same Docker network'
      },
      host: {
        baseUrl: hostBase,
        openaiBaseUrl: `${hostBase}/v1`,
        note: 'Docker bridge gateway — for containers that cannot resolve service DNS'
      },
      ...(externalBase ? {
        external: {
          baseUrl: externalBase,
          openaiBaseUrl: `${externalBase}/v1`,
          note: 'Advertised PUBLIC_BASE_URL (browser / WAN). Not a bind address.'
        }
      } : {})
    },
    recommended: {
      serverToServer: `${dockerBase}/v1`,
      browser: externalBase ? `${externalBase}/v1` : `${hostBase}/v1`,
      external: externalBase ? `${externalBase}/v1` : null,
      nativeChat: `${dockerBase}/api/v1/chat`
    },
    endpoints: {
      openaiModels: 'GET /v1/models',
      openaiChat: 'POST /v1/chat/completions',
      openaiResponses: 'POST /v1/responses',
      openaiEmbeddings: 'POST /v1/embeddings',
      openaiHealth: 'GET /v1/health',
      nativeChat: 'POST /api/v1/chat',
      health: 'GET /api/v1/health',
      gateway: 'GET /api/v1/gateway',
      gatewayTokens: '/api/v1/gateway/tokens',
      gatewayUsage: '/api/v1/gateway/usage'
    },
    auth: {
      header: 'Authorization: Bearer pah_…  OR  X-Personal-AI-Key: pah_…',
      createToken: 'POST /api/v1/gateway/tokens'
    },
    example: {
      curl: `curl -s ${dockerBase}/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer pah_YOUR_TOKEN" -H "X-SoloHost-App-ID: app-builder" -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'`
    },
    notes: [
      'Provider API keys stay in the Hub vault; apps only use pah_ gateway tokens.',
      'Managed Ollama runs inside the Hub container — apps never call Ollama directly.',
      'model=auto uses Hub smart routing (routing mode + health + fallback).',
      'Do not use http://127.0.0.1 from another container.'
    ]
  });
});

// Explicit JSON probe — never HTML
app.get('/api/v1/chat', (_req, res) => {
  res.status(405).json({
    error: 'METHOD_NOT_ALLOWED',
    message: 'Use POST /api/v1/chat with JSON body { "message": "..." }',
    service: SERVICE_NAME
  });
});

// API routes must never fall through to the SPA HTML shell.
app.use(['/api', '/ai', '/v1'], (req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    path: req.path,
    method: req.method,
    service: SERVICE_NAME,
    hint: 'See GET /api/v1/gateway for available endpoints'
  });
});

// SPA UI only for non-API GETs
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Smart health: do NOT continuously probe Ollama or re-verify ACTIVE keys.
// Only re-check ERROR / TEST_REQUIRED / COOLDOWN cloud keys on a long interval.
// Local Ollama is probed on demand (UI Refresh / pull) with negative caching.
const HEALTH_INTERVAL_MS = Number(process.env.AI_HEALTH_INTERVAL_MS || 60 * 60 * 1000); // 1h default
const runHealthCheck = async () => {
  try {
    const all = await ai.keys.listKeys();
    for (const key of all) {
      if (key.provider === 'local') continue; // never auto-spam Ollama
      if (key.status === 'ACTIVE' || key.status === 'INVALID' || key.status === 'BILLING_REQUIRED') continue;
      if (key.status === 'ERROR' || key.status === 'TEST_REQUIRED' || key.status === 'COOLDOWN') {
        await ai.keys.verifyKey(key.id);
      }
    }
  } catch (err) {
    console.error('AI health refresh failed:', err.message);
  }
};
// First run after 60s (not 2s) to avoid startup storm
setTimeout(runHealthCheck, 60_000);
setInterval(runHealthCheck, HEALTH_INTERVAL_MS).unref();

// Managed Local AI: start Ollama in background — never block API listen
ensureOllama()
  .then((ollamaBoot) => console.log('[hub] Ollama boot status:', JSON.stringify(ollamaBoot)))
  .catch((err) => console.warn('[hub] ensureOllama failed:', err?.message || err));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Personal AI Hub listening on 0.0.0.0:${PORT}`);
  console.log('OpenAI routes: GET /v1/models, POST /v1/chat/completions, POST /v1/responses, POST /v1/embeddings, GET /v1/health, GET /v1/__ping');
  console.log(`Service DNS name: ${SERVICE_NAME}`);
  console.log(`Gateway discovery: http://${SERVICE_NAME}:${PORT}/api/v1/gateway`);
  if (PUBLIC_BASE_URL) console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log('Other SoloHost apps must call the Hub via service name or host port — never 127.0.0.1 from another container.');
});
