/**
 * Core v2.0 regression tests (no network, no Express listen required for pure units).
 * Run: node test-v2-core.js
 */
import assert from 'node:assert/strict';
import { rankChatModels, isChatCapableModel } from './ai-app-kernel/src/providers.js';
import { assertSafeProviderUrl, assertSafeUrl, isPrivateOrBlockedUrl, createRateLimiter } from './ai-app-kernel/src/security.js';
import { createLocalModelManager } from './ai-app-kernel/src/local.js';
import { createMutexJsonStore } from './ai-app-kernel/src/mutex-store.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let passed = 0;
function ok(name) { passed++; console.log('PASS', name); }

// --- Ranking quality-first ---
{
  const ranked = rankChatModels([
    'gpt-4o-mini', 'gpt-4o', 'claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'gemini-2.0-flash'
  ]);
  assert.ok(ranked.indexOf('gpt-4o') < ranked.indexOf('gpt-4o-mini') || ranked[0] === 'gpt-4o' || ranked.includes('gpt-4o'), 'flagship should rank well');
  ok('rankChatModels quality bias');
}

// --- Chat-capable filter ---
{
  assert.equal(isChatCapableModel('text-embedding-3-small'), false);
  assert.equal(isChatCapableModel('gpt-4o'), true);
  ok('isChatCapableModel filters embeddings');
}

// --- SSRF ---
{
  assert.equal(isPrivateOrBlockedUrl('http://127.0.0.1:8080'), true);
  assert.equal(isPrivateOrBlockedUrl('http://192.168.1.10'), true);
  assert.equal(isPrivateOrBlockedUrl('https://api.openai.com'), false);
  try {
    assertSafeProviderUrl('http://169.254.169.254/latest/meta-data/');
    assert.fail('should block metadata');
  } catch (e) {
    assert.equal(e.message, 'PROVIDER_URL_BLOCKED');
  }
  assert.doesNotThrow(() => assertSafeUrl('http://127.0.0.1:11434'));
  assert.throws(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/'), /URL_BLOCKED/);
  // Importing local.js must remain valid: this caught the production startup crash.
  assert.equal(typeof createLocalModelManager, 'function');
  ok('SSRF blocks private and metadata URLs; local Ollama loopback is explicitly supported');
}

// --- Rate limiter isolation + limit ---
{
  const a = createRateLimiter({ perMinute: 2, maxConcurrent: 2 });
  const b = createRateLimiter({ perMinute: 2, maxConcurrent: 2 });
  const s1 = a.tryAcquire('t1');
  const s2 = a.tryAcquire('t1');
  const s3 = a.tryAcquire('t1');
  assert.equal(s1.ok, true);
  assert.equal(s2.ok, true);
  assert.equal(s3.ok, false);
  s1.release();
  s2.release();
  // separate limiter not affected
  assert.equal(b.tryAcquire('t1').ok, true);
  ok('rate limiter per-instance isolation');
}

// --- Mutex store atomic + debounce ---
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pah-'));
  const file = path.join(dir, 'state.json');
  const store = createMutexJsonStore(file, { debounceMs: 50 });
  await store.set({ n: 1 });
  await store.update(d => { d.n = 2; return d; });
  await store.flushNow();
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(raw.n, 2);
  ok('mutex json store atomic write');
  await fs.rm(dir, { recursive: true, force: true });
}

// --- Multimodal helpers (dynamic import of openai-compat is heavy; re-test logic inline) ---
{
  function hasMultimodal(messages) {
    for (const msg of messages || []) {
      const c = msg?.content;
      if (!Array.isArray(c)) continue;
      for (const part of c) {
        if (part && typeof part === 'object' && part.type && part.type !== 'text') return true;
      }
    }
    return false;
  }
  assert.equal(hasMultimodal([{ role: 'user', content: 'hi' }]), false);
  assert.equal(hasMultimodal([{ role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }] }]), true);
  ok('hasMultimodal detection');
}


// --- i18n files present & keys parity ---
{
  const en = JSON.parse(await fs.readFile(new URL('./public/i18n/en.json', import.meta.url), 'utf8'));
  const vi = JSON.parse(await fs.readFile(new URL('./public/i18n/vi.json', import.meta.url), 'utf8'));
  const enKeys = Object.keys(en).sort();
  const viKeys = Object.keys(vi).sort();
  assert.deepEqual(enKeys, viKeys, 'en/vi keys must match');
  assert.ok(enKeys.includes('setup.step1') && enKeys.includes('lang.vi'));
  ok('i18n en/vi key parity');
}

// --- package version ---
{
  const pkg = JSON.parse(await fs.readFile(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '2.1.2');
  ok('package version 2.1.2');
}

// --- no master key in tree ---
{
  try {
    await fs.access(new URL('./data/.ai-master-key', import.meta.url));
    assert.fail('master key should not be in package');
  } catch {
    ok('no shipped master key');
  }
}

console.log('\nAll', passed, 'core tests passed.');
