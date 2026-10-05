import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAiKernel } from './ai-app-kernel/src/index.js';
import { isPrivateOrBlockedUrl, createRateLimiter } from './ai-app-kernel/src/security.js';

assert.equal(isPrivateOrBlockedUrl('http://127.0.0.1/x'), true);
assert.equal(isPrivateOrBlockedUrl('http://169.254.169.254/latest'), true);
assert.equal(isPrivateOrBlockedUrl('http://10.0.0.1/a'), true);
assert.equal(isPrivateOrBlockedUrl('https://api.openai.com/v1'), false);
assert.equal(isPrivateOrBlockedUrl('http://127.0.0.1:11434', { allowLocalhost: true }), false);

const lim = createRateLimiter({ perMinute: 3, maxConcurrent: 2 });
const a = lim.tryAcquire('t1'); assert.ok(a.ok); a.release();
const b = lim.tryAcquire('t1'); assert.ok(b.ok); b.release();
const c = lim.tryAcquire('t1'); assert.ok(c.ok); c.release();
assert.equal(lim.tryAcquire('t1').ok, false); // 4th in same minute

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pai-sec-'));
const store = { async list() { return []; }, async put() {} };
const actions = { async invoke() { return { ok: true }; }, list() { return []; } };
const fetchImpl = async (url) => {
  const u = String(url);
  if (u.includes('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:1.5b' }] }), { status: 200 });
  if (u.includes('/api/chat')) return new Response(JSON.stringify({ message: { content: 'ok' }, model: 'qwen2.5-coder:1.5b' }), { status: 200 });
  if (u.includes('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), { status: 200 });
  if (u.includes('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: 'cloud' } }], model: 'gpt-4o-mini' }), { status: 200 });
  return new Response('{}', { status: 404 });
};

const k = createAiKernel({
  store, actions,
  vaultFile: path.join(tmp, 'v.json'), logFile: path.join(tmp, 'l.json'), stateFile: path.join(tmp, 's.json'),
  fetchImpl,
  providers: {
    openai: { id: 'openai', name: 'OpenAI', type: 'openai-compatible', baseUrl: 'https://example.test/v1', models: ['gpt-4o-mini'] },
    local: { id: 'local', name: 'Local', type: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: [] }
  }
});
await k.keys.addKey({ provider: 'local', token: '' });

const tok = await k.gateway.createToken({ name: 'builder', type: 'app' });
assert.equal(tok.status, 'unbound');
const v1 = await k.gateway.validate(tok.token, { appId: 'app-builder', bind: true });
assert.equal(v1.appId, 'app-builder');
assert.equal(v1.status, 'bound');
try {
  await k.gateway.validate(tok.token, { appId: 'calculator', bind: true });
  assert.fail('should mismatch');
} catch (e) {
  assert.equal(e.statusCode, 403);
}
await k.gateway.unbindToken(tok.id);
const v2 = await k.gateway.validate(tok.token, { appId: 'calculator', bind: true });
assert.equal(v2.appId, 'calculator');

const shared = await k.gateway.createToken({ name: 'shared', type: 'shared' });
const s1 = await k.gateway.validate(shared.token, { appId: 'app-a', bind: true });
const s2 = await k.gateway.validate(shared.token, { appId: 'app-b', bind: true });
assert.ok(s1 && s2);

// memory isolation via chat
await k.chat({ message: 'hello A', appId: 'app-a', provider: 'local' });
await k.chat({ message: 'hello B', appId: 'app-b', provider: 'local' });
const ma = await k.memory.list(50, { appId: 'app-a' });
const mb = await k.memory.list(50, { appId: 'app-b' });
assert.ok(ma.every(m => (m.appId || 'default') === 'app-a'));
assert.ok(mb.every(m => (m.appId || 'default') === 'app-b'));

console.log('SECURITY TESTS PASSED');
