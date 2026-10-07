import assert from 'node:assert/strict';
import { chatProvider } from './ai-app-kernel/src/providers.js';
import { mountOpenAICompat } from './openai-compat.js';

// Provider-side compatibility: OpenAI-compatible servers may return content blocks
// rather than a bare string. The Hub must normalize both forms to plain text.
const arrayFetch = async () => new Response(JSON.stringify({
  id: 'chatcmpl-test',
  model: 'custom-model',
  choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }
}), { status: 200 });
const normalized = await chatProvider({ type: 'openai-compatible', baseUrl: 'https://custom.example/v1' }, 'test-token', 'custom-model', [{ role: 'user', content: 'hi' }], arrayFetch);
assert.equal(normalized.reply, 'hello world');
assert.equal(normalized.finishReason, 'stop');
assert.equal(normalized.usage.total_tokens, 4);

// Route surface contract: all five public gateway endpoints must remain mounted.
const routes = [];
const app = {
  get(path, ...handlers) { routes.push(['GET', path, handlers]); },
  post(path, ...handlers) { routes.push(['POST', path, handlers]); }
};
const kernel = {
  gateway: {
    async listTokens() { return []; }
  },
  local: { async models() { return { available: false, models: [] }; } },
  keys: { async listKeys() { return []; } },
  logs: { async write() {} },
  async health() { return { local: false, activeKeys: 0, routingMode: 'balanced' }; }
};
mountOpenAICompat(app, { kernel });
for (const route of [
  ['GET','/v1/models'],
  ['POST','/v1/chat/completions'],
  ['POST','/v1/responses'],
  ['POST','/v1/embeddings'],
  ['GET','/v1/health']
]) assert.ok(routes.some(r => r[0] === route[0] && r[1] === route[1]), `${route.join(' ')} missing`);

console.log('OPENAI COMPAT CONTRACT TESTS PASSED');
