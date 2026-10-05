import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAiKernel } from './ai-app-kernel/src/index.js';
import { SUGGESTED_LOCAL_MODELS } from './ai-app-kernel/src/local.js';
import { readFileSync } from 'node:fs';

assert.ok(SUGGESTED_LOCAL_MODELS.length > 0);
// Ensure openai-compat module loads
const compatSrc = readFileSync(new URL('./openai-compat.js', import.meta.url), 'utf8');
assert.ok(compatSrc.includes('mountOpenAICompat'));
assert.ok(compatSrc.includes('/v1/chat/completions'));
assert.ok(compatSrc.includes('/v1/models'));

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'paihub-'));
const store = { async list() { return []; }, async put() {} };
const actions = { async invoke() { return { ok: true }; }, list() { return []; } };

const fetchImpl = async (url) => {
  const u = String(url);
  if (u.includes('/api/tags')) {
    return new Response(JSON.stringify({ models: [{ name: 'llama3.2:1b' }] }), { status: 200 });
  }
  if (u.includes('/api/chat')) {
    return new Response(JSON.stringify({ message: { content: 'local-hi' }, model: 'llama3.2:1b' }), { status: 200 });
  }
  if (u.includes('/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), { status: 200 });
  }
  if (u.includes('/chat/completions')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: 'cloud-hi' } }], model: 'gpt-4o-mini' }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'nf' }), { status: 404 });
};

const kernel = createAiKernel({
  store, actions,
  vaultFile: path.join(tmp, 'v.json'),
  logFile: path.join(tmp, 'l.json'),
  stateFile: path.join(tmp, 's.json'),
  fetchImpl,
  providers: {
    openai: { id: 'openai', name: 'OpenAI', type: 'openai-compatible', baseUrl: 'https://example.test/v1', models: ['gpt-4o-mini'] },
    local: { id: 'local', name: 'Local', type: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: [] }
  }
});

await kernel.keys.addKey({ provider: 'local', token: '' });
await kernel.keys.addKey({ provider: 'openai', token: 'sk-test-abcdefghijklmnop' });
const tok = await kernel.gateway.createToken({ name: 'app-builder' });
assert.ok(tok.token.startsWith('pah_'));
assert.ok(await kernel.gateway.validate(tok.token));
assert.equal(await kernel.gateway.validate('pah_invalid'), null);

const native = await kernel.chat({ message: 'hi', requestId: 't1', appId: 'app-builder' });
assert.ok(native.reply);
assert.ok(native.provider);

await kernel.routing.set('cloud');
const cloud = await kernel.chat({ message: 'hi2' });
assert.equal(cloud.reply, 'cloud-hi');

await kernel.routing.set('prefer_local');
const local = await kernel.chat({ message: 'hi3', provider: 'local' });
assert.equal(local.reply, 'local-hi');

const keys = await kernel.keys.listKeys();
const modelIds = new Set(['auto']);
for (const k of keys) for (const m of k.models || []) modelIds.add(m);
assert.ok(modelIds.has('auto'));
assert.ok(modelIds.size >= 2);

const health = await kernel.health();
assert.equal(health.ok, true);

// index.js wires mountOpenAICompat
const indexSrc = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
assert.ok(indexSrc.includes('mountOpenAICompat'));
assert.ok(indexSrc.includes("['/api', '/ai', '/v1']"));

console.log('ALL TESTS PASSED');
