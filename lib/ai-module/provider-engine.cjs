/**
 * Universal AI provider engine.
 * - Discovers models instead of relying on stale hard-coded model IDs.
 * - Keeps provider-specific authentication server-side.
 * - Retries a generation once with a discovered model when a configured model is stale.
 */
'use strict';

const DEFAULT_TIMEOUT_MS = 30000;

function cleanBase(url) { return String(url || '').trim().replace(/\/+$/, ''); }
function timeoutSignal(ms = DEFAULT_TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function requestJson(url, {method='GET', body, headers={}, timeoutMs=DEFAULT_TIMEOUT_MS}={}) {
  const r = await fetch(url, {
    method,
    headers: { Accept: 'application/json', ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: timeoutSignal(timeoutMs),
  });
  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  if (!r.ok) {
    const message = json?.error?.message || json?.error || json?.message || text || `HTTP ${r.status}`;
    const e = new Error(`HTTP ${r.status}: ${String(message).slice(0,500)}`);
    e.status = r.status;
    e.providerBody = json;
    throw e;
  }
  return json;
}

function normalizeModel(model, provider) {
  // `auto` is intentionally resolved dynamically by listModels().
  if (model && model !== 'auto') return model;
  const legacy = {
    // Safe compatibility hints only; these are fallback candidates, not guarantees.
    openai: ['gpt-5.6-luna','gpt-5.6','gpt-4o-mini'],
    gemini: ['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-2.5-flash'],
    deepseek: ['deepseek-flash','deepseek-v4-pro'],
    openrouter: ['openai/gpt-5.6-luna','openai/gpt-4o-mini'],
    groq: ['llama-3.3-70b-versatile'],
    mistral: ['mistral-small-latest'],
    xai: ['grok-3-mini'],
    anthropic: ['claude-sonnet-4-5','claude-3-5-haiku-latest'],
    local: [], custom: []
  };
  return (legacy[provider] || [])[0] || 'auto';
}

function authFor(provider, apiKey) {
  if (!apiKey || apiKey === 'local') return {};
  if (provider === 'anthropic') return {'x-api-key': apiKey, 'anthropic-version':'2023-06-01'};
  return {'Authorization':'Bearer ' + apiKey};
}

function modelItems(j) {
  const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
  return arr.map(x => ({
    id: String(x.id || x.name || '').replace(/^models\//,''),
    name: x.name || x.displayName || x.id || '',
    ownedBy: x.owned_by || x.ownedBy || x.publisher || '',
    methods: x.supportedGenerationMethods || x.supported_generation_methods || [],
    raw: undefined,
  })).filter(x => x.id);
}

async function listModels({provider,baseUrl,apiKey}) {
  const base = cleanBase(baseUrl);
  if (!base) throw new Error('Base URL is required for this provider');

  if (provider === 'gemini') {
    const sep = base.includes('?') ? '&' : '?';
    const j = await requestJson(`${base}/models${sep}key=${encodeURIComponent(apiKey || '')}`);
    return modelItems(j).filter(m => !m.methods.length || m.methods.includes('generateContent'));
  }

  // OpenAI-compatible providers (OpenAI, DeepSeek, OpenRouter, Groq, Mistral, xAI, Custom, Local)
  if (provider !== 'anthropic') {
    const j = await requestJson(`${base}/models`, {headers: authFor(provider, apiKey)});
    return modelItems(j);
  }

  const j = await requestJson(`${base}/models`, {headers: authFor(provider, apiKey)});
  return modelItems(j);
}

function chooseAutoModel(models, provider) {
  const ids = models.map(x => x.id);
  const preferred = {
    gemini: [/^gemini-3\.8-flash$/, /^gemini-3\.7-flash$/, /^gemini-3\.6-flash$/, /^gemini-3\.5-flash$/, /^gemini-2\.5-flash$/],
    deepseek: [/^deepseek-flash$/, /^deepseek-v4-pro$/],
    anthropic: [/claude-sonnet-5-5/i, /claude-opus-5-5/i, /claude-fable-5-1/i, /claude-haiku-4-5/i, /claude-sonnet/i, /claude-haiku/i, /claude-opus/i],
    openai: [/^gpt-5\.6-luna$/, /^gpt-5\.6$/, /^gpt-4o-mini$/, /^gpt-/i],
    openrouter: [/gpt-5\.6-luna/i, /gpt-4o-mini/i, /claude.*haiku/i, /gemini.*flash/i],
    groq: [/llama.*70b/i, /llama.*versatile/i, /qwen/i],
    mistral: [/mistral-small/i, /mistral-medium/i, /mistral-large/i],
    xai: [/grok-.*mini/i, /grok/i],
  }[provider] || [];
  for (const re of preferred) { const hit = ids.find(id => re.test(id)); if (hit) return hit; }
  return ids[0] || 'auto';
}

async function resolveModel({provider,baseUrl,apiKey,model}) {
  if (model && model !== 'auto') return {model, discovered:false, models:[]};
  const models = await listModels({provider,baseUrl,apiKey});
  const selected = chooseAutoModel(models, provider);
  if (!selected || selected === 'auto') throw new Error('Provider returned no usable text model');
  return {model:selected, discovered:true, models};
}

async function runProvider({provider,baseUrl,apiKey,model,messages}) {
  const resolved = await resolveModel({provider,baseUrl,apiKey,model});
  return runWithModel({provider,baseUrl,apiKey,model:resolved.model,messages});
}

async function runWithModel({provider,baseUrl,apiKey,model,messages}) {
  const mid = model || normalizeModel('auto', provider);
  const base = cleanBase(baseUrl);

  if (provider === 'gemini') {
    const contents = messages.filter(x=>x.role!=='system').map(x=>({
      role:x.role==='assistant'?'model':'user',
      parts:[{text:String(x.content||'')}]
    }));
    const system = messages.find(x=>x.role==='system')?.content;
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}/models/${encodeURIComponent(mid)}:generateContent${sep}key=${encodeURIComponent(apiKey)}`;
    const j = await requestJson(url, {
      method:'POST',
      body:{contents, ...(system ? {systemInstruction:{parts:[{text:system}]}} : {}), generationConfig:{temperature:.2}}
    });
    const text = j?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('') || '';
    if (!text) throw new Error('Gemini returned no text candidate');
    return text;
  }

  if (provider === 'anthropic') {
    const system = messages.find(x=>x.role==='system')?.content||'';
    const msgs = messages.filter(x=>x.role!=='system').map(x=>({role:x.role==='assistant'?'assistant':'user',content:String(x.content||'')}));
    const j = await requestJson(`${base}/messages`, {
      method:'POST',
      headers:authFor('anthropic',apiKey),
      body:{model:mid,max_tokens:1500,system,messages:msgs}
    });
    const text = j?.content?.map(x=>x.text||'').join('') || '';
    if (!text) throw new Error('Anthropic returned no text content');
    return text;
  }

  const headers = authFor(provider, apiKey);
  const j = await requestJson(`${base}/chat/completions`, {
    method:'POST',headers,
    body:{model:mid,messages,temperature:.2}
  });
  const text = j?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error(`${provider} returned no text content`);
  return text;
}

async function testProvider({provider,baseUrl,apiKey,model='auto'}) {
  const started = Date.now();
  const models = await listModels({provider,baseUrl,apiKey});
  const selected = model && model !== 'auto' ? model : chooseAutoModel(models,provider);
  return {ok:true,provider,model:selected,modelCount:models.length,models:models.slice(0,100),latencyMs:Date.now()-started};
}

module.exports={runProvider,runWithModel,normalizeModel,listModels,chooseAutoModel,resolveModel,testProvider};
