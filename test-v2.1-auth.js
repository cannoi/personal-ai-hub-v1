import assert from 'node:assert/strict';
import { rankChatModels } from './ai-app-kernel/src/providers.js';

let n = 0;
function ok(m) { n++; console.log('PASS', m); }

// Ranking: pro > flash; gpt-5 not dead last
{
  const r = rankChatModels(['gemini-2.5-flash', 'gemini-2.5-pro', 'gpt-5', 'gpt-4o-mini', 'gpt-5-mini']);
  assert.ok(r.indexOf('gemini-2.5-pro') < r.indexOf('gemini-2.5-flash'), 'pro before flash');
  assert.ok(r.indexOf('gpt-5') < r.indexOf('gpt-4o-mini') || r.indexOf('gpt-5') <= 2, 'gpt-5 ranks high');
  ok('ranking pro>flash and gpt-5');
}

console.log('\nAll', n, 'v2.1 unit checks passed.');
