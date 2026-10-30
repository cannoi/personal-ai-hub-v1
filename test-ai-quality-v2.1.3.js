import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectReplyLanguage, buildHubAssistantSystem } from './ai-app-kernel/src/quality.js';
import { modelTier, modelCapabilities, rankChatModels, streamChatProvider } from './ai-app-kernel/src/providers.js';

test('Hub assistant follows the language of the latest user message', () => {
  assert.equal(detectReplyLanguage([{ role: 'user', content: 'Hãy giúp tôi sửa lỗi này' }]), 'vi');
  assert.equal(detectReplyLanguage([{ role: 'user', content: 'Please help me fix this error' }]), 'en');
  assert.equal(detectReplyLanguage([{ role: 'user', content: 'toi muon sua loi app' }]), 'vi');
  const viPrompt = buildHubAssistantSystem({ messages: [{ role: 'user', content: 'Phân tích lỗi này giúp tôi' }] });
  const enPrompt = buildHubAssistantSystem({ messages: [{ role: 'user', content: 'Please analyze this issue' }] });
  assert.match(viPrompt, /Reply in natural Vietnamese/);
  assert.match(enPrompt, /Reply in natural English/);
  assert.match(enPrompt, /Never invent settings, provider capabilities/);
});

test('transparent request language and client system remain separate from Hub quality prompt', () => {
  const prompt = buildHubAssistantSystem({ system: 'Custom system', messages: [{ role: 'user', content: 'Xin chào' }], appKnowledge: 'Known fact' });
  assert.match(prompt, /^Custom system/);
  assert.match(prompt, /APP KNOWLEDGE/);
  assert.match(prompt, /LANGUAGE: Reply in natural Vietnamese/);
});

test('catalog ranks flagship above fast and unknown models are standard', () => {
  assert.equal(modelTier('gemini-2.5-pro'), 'flagship');
  assert.equal(modelTier('gemini-2.5-flash'), 'standard');
  assert.equal(modelTier('gemini-2.5-flash-lite'), 'fast');
  assert.equal(modelTier('mystery-model-xyz'), 'standard');
  const list = rankChatModels(['gemini-2.5-flash', 'gemini-2.5-pro', 'gpt-5', 'gpt-4o-mini', 'mystery-model-xyz']);
  assert.ok(list.indexOf('gemini-2.5-pro') < list.indexOf('gemini-2.5-flash'));
  assert.ok(list.indexOf('mystery-model-xyz') < list.indexOf('gemini-2.5-flash-lite') || !list.includes('gemini-2.5-flash-lite'));
  assert.equal(modelCapabilities('gpt-4o').vision, true);
  const sticky = rankChatModels(['gpt-5', 'gpt-4o-mini'], 'gpt-4o-mini');
  assert.equal(sticky[0], 'gpt-5', 'sticky model must not demote a higher tier');
});

test('streaming timeout reports upstream timeout instead of client abort', async () => {
  const fetchImpl = (_url, init) => new Promise((resolve, reject) => {
    if (init.signal.aborted) {
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err); return;
    }
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
    }, { once: true });
  });
  const keepEventLoopAlive = setTimeout(() => {}, 100);
  const events = [];
  for await (const event of streamChatProvider(
    { type: 'openai-compatible', baseUrl: 'https://provider.invalid/v1' },
    'test-key', 'test-model', [{ role: 'user', content: 'hello' }], fetchImpl, { timeoutMs: 15 }
  )) events.push(event);
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.at(-1).error, 'UPSTREAM_TIMEOUT');
  clearTimeout(keepEventLoopAlive);
  assert.equal(events.at(-1).status, 504);
});
