import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createAiKernel } from './ai-app-kernel/src/index.js';
import { mountOpenAICompat } from './openai-compat.js';

function createMiniApp() {
  const routes = [];
  const m = (method) => (p, ...h) => routes.push({ method, path: p, handlers: h });
  return {
    get: m('GET'), post: m('POST'), put: m('PUT'), patch: m('PATCH'), delete: m('DELETE'),
    use() {},
    _routes: routes
  };
}

function runHandlers(handlers, req, res) {
  let i = 0;
  const next = (err) => {
    if (err) { res.statusCode = 500; res.end(JSON.stringify({ error: String(err) })); return; }
    const h = handlers[i++];
    if (!h) return;
    try {
      const out = h(req, res, next);
      if (out && typeof out.then === 'function') out.catch(next);
    } catch (e) { next(e); }
  };
  next();
}

async function start(kernel) {
  const app = createMiniApp();
  mountOpenAICompat(app, { kernel, serviceName: 'personal-ai-hub' });
  assert.ok(app._routes.some(r => r.path === '/v1/models' && r.method === 'GET'));
  assert.ok(app._routes.some(r => r.path === '/v1/chat/completions' && r.method === 'POST'));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const method = req.method || 'GET';
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let json = {};
      if (body) { try { json = JSON.parse(body); } catch {} }
      const route = app._routes.find(r => r.method === method && r.path === url.pathname);
      if (!route) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'NOT_FOUND', path: url.pathname }));
        return;
      }
      const headers = req.headers;
      const fakeReq = {
        method, path: url.pathname, url: req.url, headers, body: json,
        query: Object.fromEntries(url.searchParams),
        get(n) { return n.toLowerCase() === 'host' ? headers.host : headers[n.toLowerCase()]; }
      };
      const fakeRes = {
        statusCode: 200, headers: {},
        status(c) { this.statusCode = c; return this; },
        setHeader(k, v) { this.headers[k] = v; },
        json(obj) {
          res.statusCode = this.statusCode;
          res.setHeader('Content-Type', 'application/json');
          for (const [k, v] of Object.entries(this.headers)) res.setHeader(k, v);
          res.end(JSON.stringify(obj));
        },
        end(s) { res.statusCode = this.statusCode; res.end(s); }
      };
      runHandlers(route.handlers, fakeReq, fakeRes);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

async function httpJson(port, method, p, body, headers = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, text };
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'paihub-'));
const store = { async list() { return []; }, async put() {} };
const actions = { async invoke() { return { ok: true }; }, list() { return []; } };
const fetchImpl = async (url) => {
  const u = String(url);
  if (u.includes('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:1.5b' }] }), { status: 200 });
  if (u.includes('/api/chat')) return new Response(JSON.stringify({ message: { content: 'local-hello' }, model: 'qwen2.5-coder:1.5b' }), { status: 200 });
  if (u.includes('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), { status: 200 });
  if (u.includes('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: 'cloud-hello' } }], model: 'gpt-4o-mini' }), { status: 200 });
  return new Response(JSON.stringify({ error: 'nf' }), { status: 404 });
};

const kernel = createAiKernel({
  store, actions,
  vaultFile: path.join(tmp, 'v.json'), logFile: path.join(tmp, 'l.json'), stateFile: path.join(tmp, 's.json'),
  fetchImpl,
  providers: {
    openai: { id: 'openai', name: 'OpenAI', type: 'openai-compatible', baseUrl: 'https://example.test/v1', models: ['gpt-4o-mini'] },
    local: { id: 'local', name: 'Local', type: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: [] }
  }
});
await kernel.keys.addKey({ provider: 'local', token: '' });
await kernel.keys.addKey({ provider: 'openai', token: 'sk-test-abcdefghijklmnop' });

const { server, port } = await start(kernel);

assert.equal((await httpJson(port, 'GET', '/v1/__ping')).status, 200);
assert.equal((await httpJson(port, 'GET', '/v1/health')).json.hub, 'healthy');

const models = await httpJson(port, 'GET', '/v1/models');
assert.equal(models.status, 200);
assert.equal(models.json.object, 'list');
assert.ok(models.json.data.some(m => m.id === 'auto'));
assert.ok(models.json.data.some(m => String(m.id).includes('qwen2.5-coder')));

const chat = await httpJson(port, 'POST', '/v1/chat/completions', {
  model: 'auto', messages: [{ role: 'user', content: 'Reply only: TEST_OK' }]
}, { 'X-SoloHost-App-ID': 'app-builder' });
assert.equal(chat.status, 200, JSON.stringify(chat.json));
assert.equal(chat.json.object, 'chat.completion');
assert.ok(chat.json.choices[0].message.content);

const localChat = await httpJson(port, 'POST', '/v1/chat/completions', {
  model: 'local/qwen2.5-coder:1.5b', messages: [{ role: 'user', content: 'hi' }]
});
assert.equal(localChat.status, 200);

const stream = await httpJson(port, 'POST', '/v1/chat/completions', {
  model: 'auto', stream: true, messages: [{ role: 'user', content: 'x' }]
});
assert.equal(stream.status, 400);

const tok = await kernel.gateway.createToken({ name: 'app-builder' });
assert.equal((await httpJson(port, 'GET', '/v1/models')).status, 401);
assert.equal((await httpJson(port, 'GET', '/v1/models', null, { Authorization: 'Bearer pah_bad' })).status, 401);
assert.equal((await httpJson(port, 'GET', '/v1/models', null, { Authorization: `Bearer ${tok.token}` })).status, 200);
assert.equal((await httpJson(port, 'POST', '/v1/chat/completions', {
  model: 'auto', messages: [{ role: 'user', content: 'hi' }]
}, { 'X-Personal-AI-Key': tok.token })).status, 200);

assert.ok((await kernel.chat({ message: 'LEGACY_OK' })).reply);

const indexSrc = await fs.readFile(new URL('./index.js', import.meta.url), 'utf8');
assert.ok(indexSrc.includes('mountOpenAICompat(app'));
assert.ok(indexSrc.indexOf('mountOpenAICompat(app') < indexSrc.indexOf("['/api', '/ai', '/v1']"));

server.close();
console.log('ALL TESTS PASSED');
