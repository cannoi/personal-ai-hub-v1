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

// Ranking M5 list
{
  const list = ['gpt-5','gpt-5-mini','gpt-4o-mini','claude-opus','claude-sonnet','claude-haiku','gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite','totally-unknown-xyz'];
  const r = rankChatModels(list);
  const idx = (id) => r.indexOf(id);
  assert.ok(idx('gemini-2.5-pro') < idx('gemini-2.5-flash'), 'pro before flash');
  assert.ok(idx('gemini-2.5-flash') < idx('gemini-2.5-flash-lite'), 'flash before lite');
  assert.ok(idx('claude-opus') < idx('claude-haiku'), 'opus before haiku');
  assert.ok(idx('totally-unknown-xyz') < idx('gemini-2.5-flash-lite') || idx('totally-unknown-xyz') >= 0, 'unknown present');
  // unknown should not be last if only tiny is lower - standard >= tiny
  assert.ok(idx('totally-unknown-xyz') <= idx('gemini-2.5-flash-lite'), 'unknown not below tiny');
  ok('M5 ranking tiers');
}
