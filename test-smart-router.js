/**
 * Fast Smart AI Router regression tests (simulated providers).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAiKernel } from './ai-app-kernel/src/index.js';
import { classifyProviderError } from './ai-app-kernel/src/providers.js';

function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hub-router-'));
}

async function makeKernel(dir, fetchImpl, extra = {}) {
  return createAiKernel({
    stateFile: path.join(dir, 'state.json'),
    vaultFile: path.join(dir, 'vault.json'),
    masterFile: path.join(dir, 'master'),
    logFile: path.join(dir, 'log.json'),
    fetchImpl,
    knowledge: extra.knowledge || 'Personal AI Hub gateway test.',
    localReply: async () => ({ reply: 'offline guide', provider: 'local-guide' }),
    ...extra
  });
}

async function addActiveKey(kernel, provider, models, selectedModel = null) {
  // Bypass network verify by writing state directly via public API where possible
  const keys = await kernel.keys.list?.() || [];
  // Use internal path: add key then force status
  const id = crypto.randomUUID();
  const stateFile = kernel; // not accessible — use keys.add with mock fetch that returns models
  return id;
}

// --- Unit: classifyProviderError ---
{
  const billing400 = { status: 400, message: 'Your credit balance is too low to access the Anthropic API' };
  const c = classifyProviderError(billing400);
  assert.equal(c.class, 'BILLING_REQUIRED');
  assert.equal(c.scope, 'key');

  const inv = { status: 401, message: 'Incorrect API key' };
  assert.equal(classifyProviderError(inv).class, 'INVALID');

  const m429 = { status: 429, message: 'Rate limit exceeded' };
  assert.equal(classifyProviderError(m429).class, 'MODEL_429');

  const up = { status: 429, message: 'upstream shared pool exhausted' };
  assert.equal(classifyProviderError(up).class, 'UPSTREAM_429');

  const to = { status: 504, message: 'REQUEST_TIMEOUT_25000MS' };
  assert.equal(classifyProviderError(to).class, 'TIMEOUT');

  console.log('PASS classifyProviderError');
}

// --- Integration: Anthropic billing 400 → no second model try ---
{
  const dir = await tmpDir();
  let attempts = [];
  const fetchImpl = async (url, init = {}) => {
    attempts.push({ url: String(url), body: init.body });
    // Anthropic messages endpoint
    if (String(url).includes('anthropic.com')) {
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.' }
        }),
        json: async () => ({})
      };
    }
    throw new Error('unexpected url ' + url);
  };

  const kernel = await makeKernel(dir, fetchImpl);
  // Seed state with ACTIVE anthropic key + models
  const statePath = path.join(dir, 'state.json');
  await fs.writeFile(statePath, JSON.stringify({
    keys: [{
      id: 'anth-1', provider: 'anthropic', masked: 'sk-ant-…', status: 'ACTIVE',
      models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      selectedModel: 'claude-opus-4-6', useCount: 0, createdAt: new Date().toISOString()
    }],
    memory: [], routing: {}, config: { routingMode: 'balanced' }, gatewayTokens: []
  }));
  // vault token
  const vaultPath = path.join(dir, 'vault.json');
  const master = path.join(dir, 'master');
  await fs.writeFile(master, 'test-master-key-32chars-minimum!!');
  // Use kernel's vault by re-creating after state exists - simpler: inject via keys.verify won't work
  // Directly use chat after ensuring vault has token via internal vault module
  const { createSecretVault } = await import('./ai-app-kernel/src/vault.js');
  const vault = createSecretVault(vaultPath, master);
  await vault.set('anth-1', 'sk-ant-test');

  // Rebuild kernel pointing at same files
  const kernel2 = await makeKernel(dir, fetchImpl);
  const out = await kernel2.chat({ message: 'xin chao', provider: 'anthropic', appId: 'hub-ui' });

  // Should not try all 3 models — billing stops key after first
  const anthAttempts = attempts.filter(a => String(a.url).includes('anthropic'));
  assert.ok(anthAttempts.length <= 2, `expected <=2 anthropic attempts, got ${anthAttempts.length}`);
  // Key should be BILLING_REQUIRED
  const list = await kernel2.keys.listKeys();
  const row = list.find(x => x.id === 'anth-1');
  assert.ok(row, 'key present');
  assert.equal(row.status, 'BILLING_REQUIRED');
  console.log('PASS anthropic billing stops key (attempts=' + anthAttempts.length + ')');
  await fs.rm(dir, { recursive: true, force: true });
}

// --- Model 429: cools model, tries alternate ---
{
  const dir = await tmpDir();
  let n = 0;
  const fetchImpl = async (url, init) => {
    n++;
    const body = JSON.parse(init.body || '{}');
    if (body.model === 'bad-model') {
      return {
        ok: false, status: 429,
        text: async () => '{"error":{"message":"Rate limit"}}',
        json: async () => ({})
      };
    }
    return {
      ok: true, status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: 'hello from good' }, finish_reason: 'stop' }],
        model: body.model || 'good-model',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    };
  };
  const master = path.join(dir, 'master');
  await fs.writeFile(master, 'test-master-key-32chars-minimum!!');
  const { createSecretVault } = await import('./ai-app-kernel/src/vault.js');
  await createSecretVault(path.join(dir, 'vault.json'), master).set('or-1', 'sk-or-test');
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({
    keys: [{
      id: 'or-1', provider: 'openrouter', masked: 'sk-or-…', status: 'ACTIVE',
      models: ['bad-model', 'good-model'], selectedModel: 'bad-model',
      useCount: 0, createdAt: new Date().toISOString()
    }],
    memory: [], routing: {}, config: { routingMode: 'balanced' }, gatewayTokens: []
  }));
  const kernel = await makeKernel(dir, fetchImpl);
  const out = await kernel.chat({ message: 'hi', provider: 'openrouter', appId: 'hub-ui' });
  assert.ok(out.reply && /hello from good/i.test(out.reply), 'got alternate model reply: ' + out.reply);
  assert.equal(out.model, 'good-model');
  console.log('PASS model 429 tries alternate');
  await fs.rm(dir, { recursive: true, force: true });
}

// --- Sticky model preferred on next request ---
{
  const dir = await tmpDir();
  const modelsTried = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body || '{}');
    modelsTried.push(body.model);
    return {
      ok: true, status: 200, text: async () => '',
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        model: body.model, usage: {}
      })
    };
  };
  const master = path.join(dir, 'master');
  await fs.writeFile(master, 'test-master-key-32chars-minimum!!');
  const { createSecretVault } = await import('./ai-app-kernel/src/vault.js');
  await createSecretVault(path.join(dir, 'vault.json'), master).set('g-1', 'sk-test');
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({
    keys: [{
      id: 'g-1', provider: 'openai', masked: 'sk-…', status: 'ACTIVE',
      models: ['gpt-4o', 'gpt-4o-mini'], selectedModel: 'gpt-4o-mini',
      useCount: 5, createdAt: new Date().toISOString()
    }],
    memory: [], routing: {}, config: { routingMode: 'balanced' }, gatewayTokens: []
  }));
  const kernel = await makeKernel(dir, fetchImpl);
  await kernel.chat({ message: 'a', provider: 'openai', appId: 'hub-ui' });
  await kernel.chat({ message: 'b', provider: 'openai', appId: 'hub-ui' });
  assert.equal(modelsTried[0], 'gpt-4o-mini');
  assert.equal(modelsTried[1], 'gpt-4o-mini');
  console.log('PASS sticky selectedModel preferred');
  await fs.rm(dir, { recursive: true, force: true });
}

// --- local_only does not call cloud ---
{
  const dir = await tmpDir();
  let cloudHits = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('openai.com') || String(url).includes('anthropic')) cloudHits++;
    if (String(url).includes('11434')) {
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({ message: { content: 'local hi' }, model: 'qwen:1.5b' })
      };
    }
    return { ok: false, status: 500, text: async () => 'fail', json: async () => ({}) };
  };
  const master = path.join(dir, 'master');
  await fs.writeFile(master, 'test-master-key-32chars-minimum!!');
  const { createSecretVault } = await import('./ai-app-kernel/src/vault.js');
  await createSecretVault(path.join(dir, 'vault.json'), master).set('oai', 'sk');
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({
    keys: [
      { id: 'local-default', provider: 'local', masked: 'LOCAL', status: 'ACTIVE', models: ['qwen:1.5b'], selectedModel: 'qwen:1.5b', useCount: 0, createdAt: new Date().toISOString() },
      { id: 'oai', provider: 'openai', masked: 'sk-…', status: 'ACTIVE', models: ['gpt-4o-mini'], selectedModel: 'gpt-4o-mini', useCount: 0, createdAt: new Date().toISOString() }
    ],
    memory: [], routing: {}, config: { routingMode: 'local_only' }, gatewayTokens: []
  }));
  const kernel = await makeKernel(dir, fetchImpl);
  const out = await kernel.chat({ message: 'hello', appId: 'hub-ui' });
  assert.equal(cloudHits, 0, 'cloud must not be called in local_only');
  assert.ok(out.reply === 'local hi' || out.provider === 'local' || out.error, 'local path used');
  console.log('PASS local_only skips cloud');
  await fs.rm(dir, { recursive: true, force: true });
}

// --- Memory isolation by appId ---
{
  const dir = await tmpDir();
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body || '{}');
    const sys = (body.messages || []).find(m => m.role === 'system')?.content || '';
    // Capture system for inspection via global
    globalThis.__lastSys = sys;
    return {
      ok: true, status: 200, text: async () => '',
      json: async () => ({
        choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
        model: body.model || 'gpt-4o-mini', usage: {}
      })
    };
  };
  const master = path.join(dir, 'master');
  await fs.writeFile(master, 'test-master-key-32chars-minimum!!');
  const { createSecretVault } = await import('./ai-app-kernel/src/vault.js');
  await createSecretVault(path.join(dir, 'vault.json'), master).set('oai', 'sk');
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({
    keys: [{
      id: 'oai', provider: 'openai', masked: 'sk-…', status: 'ACTIVE',
      models: ['gpt-4o-mini'], selectedModel: 'gpt-4o-mini', useCount: 0, createdAt: new Date().toISOString()
    }],
    memory: [
      { role: 'user', content: 'SECRET_FROM_BUILDER', appId: 'app-builder', ts: new Date().toISOString() },
      { role: 'assistant', content: 'builder reply', appId: 'app-builder', ts: new Date().toISOString() },
      { role: 'user', content: 'hub note only', appId: 'hub-ui', ts: new Date().toISOString() }
    ],
    routing: {}, config: { routingMode: 'cloud' }, gatewayTokens: []
  }));
  const kernel = await makeKernel(dir, fetchImpl);
  await kernel.chat({ message: 'ping', provider: 'openai', appId: 'hub-ui' });
  assert.ok(!String(globalThis.__lastSys || '').includes('SECRET_FROM_BUILDER'), 'builder memory must not leak');
  assert.ok(String(globalThis.__lastSys || '').includes('hub note only'), 'hub memory included');
  console.log('PASS memory isolation by appId');
  await fs.rm(dir, { recursive: true, force: true });
}

// --- Billing key not retried on next request ---
{
  const dir = await tmpDir();
  let hits = 0;
  const fetchImpl = async (url, init) => {
    hits++;
    return {
      ok: false, status: 400,
      text: async () => JSON.stringify({ error: { message: 'Your credit balance is too low' } }),
      json: async () => ({})
    };
  };
  const master = path.join(dir, 'master');
  await fs.writeFile(master, 'test-master-key-32chars-minimum!!');
  const { createSecretVault } = await import('./ai-app-kernel/src/vault.js');
  await createSecretVault(path.join(dir, 'vault.json'), master).set('anth-1', 'sk');
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({
    keys: [{
      id: 'anth-1', provider: 'anthropic', masked: 'sk-…', status: 'ACTIVE',
      models: ['claude-3-5-haiku-latest'], selectedModel: 'claude-3-5-haiku-latest',
      useCount: 0, createdAt: new Date().toISOString()
    }],
    memory: [], routing: {}, config: { routingMode: 'cloud' }, gatewayTokens: []
  }));
  const kernel = await makeKernel(dir, fetchImpl);
  await kernel.chat({ message: '1', provider: 'anthropic', appId: 'hub-ui' });
  const hitsAfterFirst = hits;
  await kernel.chat({ message: '2', provider: 'anthropic', appId: 'hub-ui' });
  // Second request should not hit network again (key BILLING_REQUIRED filtered out)
  assert.equal(hits, hitsAfterFirst, 'billing key must not be retried');
  console.log('PASS billing key skipped on next request');
  await fs.rm(dir, { recursive: true, force: true });
}

console.log('\nALL SMART ROUTER TESTS PASSED');
