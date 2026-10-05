import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAiKernel } from './ai-app-kernel/src/index.js';
import { SUGGESTED_LOCAL_MODELS } from './ai-app-kernel/src/local.js';

assert.ok(SUGGESTED_LOCAL_MODELS.some(m => m.id.includes('qwen')));

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'paihub-'));
const store = { async list() { return []; }, async put() {} };
const actions = { async invoke() { return { ok: true }; }, list() { return []; } };

let ollamaUp = true;
const fetchImpl = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('ollama') || u.includes('/api/tags') || u.includes('/api/pull') || u.includes('/api/chat')) {
    if (!ollamaUp) throw new Error('fetch failed');
    if (u.includes('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'qwen3:4b' }] }), { status: 200 });
    }
    if (u.includes('/api/pull')) return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
    if (u.includes('/api/chat')) {
      return new Response(JSON.stringify({ message: { content: 'local-hi' }, model: 'qwen3:4b' }), { status: 200 });
    }
  }
  if (u.endsWith('/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), { status: 200 });
  }
  if (u.endsWith('/chat/completions')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: 'cloud-hi' } }], model: 'gpt-4o-mini' }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'nf' }), { status: 404 });
};

const k = createAiKernel({
  store, actions,
  vaultFile: path.join(tmp, 'v.json'),
  logFile: path.join(tmp, 'l.json'),
  stateFile: path.join(tmp, 's.json'),
  fetchImpl,
  providers: {
    openai: { id: 'openai', name: 'OpenAI', type: 'openai-compatible', baseUrl: 'https://example.test/v1', models: ['gpt-4o-mini'] },
    local: { id: 'local', name: 'Local', type: 'ollama', baseUrl: 'http://ollama:11434', models: [] }
  }
});

await k.routing.set('prefer_local');
assert.equal((await k.routing.get()).mode, 'prefer_local');

const local = await k.local.models({ force: true });
assert.equal(local.available, true);
assert.ok(local.models.includes('qwen3:4b'));

// ensure local key exists and active for routing
await k.keys.addKey({ provider: 'local', token: '' });
const openai = await k.keys.addKey({ provider: 'openai', token: 'sk-test-abcdefghijklmnop' });
assert.equal(openai.status, 'ACTIVE');

const chatLocal = await k.chat({ message: 'hi', provider: 'local' });
assert.equal(chatLocal.reply, 'local-hi');
assert.equal(chatLocal.provider, 'local');

await k.routing.set('cloud');
const chatCloud = await k.chat({ message: 'hi' });
assert.equal(chatCloud.reply, 'cloud-hi');

// Ollama down must not crash hub / cloud still works
ollamaUp = false;
const offline = await k.local.models({ force: true });
assert.equal(offline.available, false);
const stillCloud = await k.chat({ message: 'hi2' });
assert.equal(stillCloud.reply, 'cloud-hi');

const tok = await k.gateway.createToken({ name: 'app-builder' });
assert.ok(tok.token.startsWith('pah_'));

console.log('ALL TESTS PASSED');
