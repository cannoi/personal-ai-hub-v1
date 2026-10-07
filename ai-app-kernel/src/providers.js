export const PROVIDERS = {
  openai: {
    id: 'openai', name: 'OpenAI', type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    // free-tier / cheapest first
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o']
  },
  deepseek: {
    id: 'deepseek', name: 'DeepSeek', type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-flash', 'deepseek-v3', 'deepseek-reasoner']
  },
  groq: {
    id: 'groq', name: 'Groq', type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b']
  },
  openrouter: {
    id: 'openrouter', name: 'OpenRouter', type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.1-8b-instruct:free']
  },
  gemini: {
    id: 'gemini', name: 'Google Gemini', type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']
  },
  anthropic: {
    id: 'anthropic', name: 'Anthropic', type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-haiku-latest', 'claude-3-haiku-20240307', 'claude-3-7-sonnet-latest']
  },
  mistral: {
    id: 'mistral', name: 'Mistral', type: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-small-latest', 'mistral-large-latest']
  },
  xai: {
    id: 'xai', name: 'xAI', type: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3-mini', 'grok-3']
  },
  custom: {
    id: 'custom', name: 'Custom OpenAI-compatible', type: 'openai-compatible',
    baseUrl: '', models: []
  },
  local: {
    id: 'local', name: 'Local AI (Ollama)', type: 'ollama',
    baseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    models: []
  }
};

export function providerCatalog(extra = {}) { return { ...PROVIDERS, ...extra }; }

export function isChatCapableModel(id) {
  const s = String(id || '');
  if (!s) return false;
  return !/(embedding|moderation|whisper|tts|transcri|dall-e|audio|image|rerank|babbage|davinci|ada-002|vision-preview-tts|preview-tts|imagen|veo|aqa)/i.test(s);
}

/**
 * Rank models free-tier / cheap-first for ALL providers (Gemini strategy generalized).
 * Sticky preferred (last success) is injected by the kernel.
 */
export function rankChatModels(list, preferred = null) {
  const uniq = [];
  const seen = new Set();
  for (const id of list || []) {
    const s = String(id || '');
    if (!s || seen.has(s) || !isChatCapableModel(s)) continue;
    seen.add(s);
    uniq.push(s);
  }

  const score = (id) => {
    const n = String(id).toLowerCase();
    let s = 0;

    // --- Gemini / Google ---
    if (/3\.1.*flash.*lite/.test(n)) s += 100;
    else if (/3\.1.*flash/.test(n)) s += 90;
    else if (/3\.5.*flash/.test(n)) s += 85;
    else if (/3.*flash/.test(n)) s += 80;
    else if (/2\.5.*flash.*lite/.test(n)) s += 70;
    else if (/2\.5.*flash/.test(n)) s += 65;
    else if (/flash-lite/.test(n)) s += 60;
    else if (/2\.0.*flash/.test(n)) s += 55;
    else if (/flash-latest|gemini-flash/.test(n)) s += 52;
    else if (/1\.5.*flash/.test(n)) s += 40;
    else if (/flash/.test(n)) s += 35;

    // --- OpenAI-family: mini / nano first ---
    if (/\bnano\b/.test(n)) s += 48;
    if (/\bmini\b/.test(n)) s += 45;
    if (/gpt-4o-mini|gpt-4\.1-mini|gpt-3\.5/.test(n)) s += 42;

    // --- Anthropic: haiku first ---
    if (/haiku/.test(n)) s += 44;
    if (/sonnet/.test(n)) s += 10;
    if (/opus/.test(n)) s -= 20;

    // --- DeepSeek: chat/flash before reasoner/pro ---
    if (/deepseek.*flash/.test(n)) s += 50;
    if (/deepseek-chat|deepseek-v3(?!.*pro)/.test(n)) s += 40;
    if (/reasoner/.test(n)) s += 5;
    if (/deepseek.*pro|v4-pro/.test(n)) s -= 15;

    // --- Groq / Llama: smaller / instant first ---
    if (/instant|8b|7b|3b|1b/.test(n)) s += 38;
    if (/70b|405b/.test(n)) s += 8;

    // --- OpenRouter free tags ---
    if (/:free\b/.test(n) || /free\//.test(n)) s += 55;

    // --- Generic cheap signals ---
    if (/\bsmall\b|\btiny\b|\blite\b|\bfast\b/.test(n)) s += 28;
    if (/\bchat\b|\binstruct\b/.test(n)) s += 15;
    if (/gemma|llama|mistral|qwen|phi|gemma/.test(n)) s += 12;

    // --- Expensive / quota-heavy last ---
    if (/\bpro\b|pro-latest|-pro-/.test(n)) s -= 40;
    if (/\bultra\b|\bmax\b|\bo1\b|\bo3\b|reasoner/.test(n) && !/deepseek-chat/.test(n)) s -= 12;
    if (/preview|exp|experimental/.test(n)) s -= 5;
    if (/120b|405b|opus/.test(n)) s -= 8;

    return s;
  };

  uniq.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  if (preferred && seen.has(preferred)) {
    return [preferred, ...uniq.filter(x => x !== preferred)];
  }
  return uniq;
}

export async function listModels(provider, token, fetchImpl = fetch) {
  if (provider.type === 'ollama') {
    // Prefer multi-URL discovery via optional resolver; single URL fallback.
    const base = String(provider.baseUrl || '').replace(/\/$/, '');
    const r = await fetchImpl(`${base}/api/tags`);
    if (!r.ok) throw new Error(`LOCAL_${r.status}`);
    const j = await r.json();
    return (j.models || []).map(m => m.name).filter(Boolean);
  }
  if (provider.type === 'gemini') {
    const r = await fetchImpl(`${provider.baseUrl}/models?key=${encodeURIComponent(token)}`);
    if (!r.ok) throw await providerError(r);
    const j = await r.json();
    return rankChatModels(
      (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, ''))
    );
  }
  if (provider.type === 'anthropic') {
    const r = await fetchImpl(`${provider.baseUrl}/models`, {
      headers: { 'x-api-key': token, 'anthropic-version': '2023-06-01' }
    });
    if (!r.ok) throw await providerError(r);
    const j = await r.json();
    return rankChatModels((j.data || []).map(m => m.id));
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetchImpl(`${provider.baseUrl}/models`, { headers });
  if (!r.ok) throw await providerError(r);
  const j = await r.json();
  const raw = (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean);
  return rankChatModels(raw);
}

function extractTextContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
      if (part.type === 'text' && typeof part.text === 'string') return part.text;
      return '';
    }).join('');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.value === 'string') return content.value;
  }
  return String(content);
}

function extractOpenAICompatibleReply(body) {
  const choice = body?.choices?.[0];
  const messageContent = extractTextContent(choice?.message?.content);
  if (messageContent.trim()) return messageContent;
  const choiceText = extractTextContent(choice?.text);
  if (choiceText.trim()) return choiceText;
  const outputText = extractTextContent(body?.output_text);
  if (outputText.trim()) return outputText;
  const output = Array.isArray(body?.output) ? body.output : [];
  const outputContent = output.flatMap(item => Array.isArray(item?.content) ? item.content : [item?.content]).map(part => extractTextContent(part)).join('');
  return outputContent;
}


/**
 * Classify upstream errors so the router can act at the right scope
 * (key-wide vs model-only vs transient).
 */
export function classifyProviderError(err) {
  const status = Number(err?.status || err?.statusCode || 0) || 0;
  const text = String(err?.message || err?.body || err || '');
  const low = text.toLowerCase();

  if (status === 401 || status === 403
      || /invalid.?api.?key|incorrect api key|authentication|unauthorized|permission.?denied|forbidden/i.test(text)) {
    return { class: 'INVALID', scope: 'key', status: status || 401, retryable: false };
  }
  if (status === 402
      || /credit balance is too low|insufficient.?balance|insufficient.?quota|billing|payment.?required|credit_balance_exhausted|no credits remaining|plans?\s*&\s*billing/i.test(text)) {
    return { class: 'BILLING_REQUIRED', scope: 'key', status: status || 402, retryable: false };
  }
  if (status === 429 || /rate.?limit|too many requests|quota.?exceeded|resource.?exhausted/i.test(text)) {
    if (/shared.?pool|upstream/i.test(text)) {
      return { class: 'UPSTREAM_429', scope: 'model', status: 429, retryable: true };
    }
    return { class: 'MODEL_429', scope: 'model', status: 429, retryable: true };
  }
  if (status === 404 || /model.?not.?found|does not exist|unknown model|not_found_error/i.test(text)) {
    return { class: 'MODEL_UNAVAILABLE', scope: 'model', status: status || 404, retryable: true };
  }
  if (status === 504 || /REQUEST_TIMEOUT|timeout|aborted|ETIMEDOUT|ECONNRESET/i.test(text)) {
    return { class: 'TIMEOUT', scope: 'model', status: status || 504, retryable: true };
  }
  if (status === 400) {
    if (/credit balance|insufficient|billing|quota/i.test(text)) {
      return { class: 'BILLING_REQUIRED', scope: 'key', status: 400, retryable: false };
    }
    if (/model|not.?found|unsupported/i.test(text)) {
      return { class: 'MODEL_UNAVAILABLE', scope: 'model', status: 400, retryable: true };
    }
  }
  if (status >= 500) {
    return { class: 'PROVIDER_5XX', scope: 'model', status, retryable: true };
  }
  return { class: 'PROVIDER_ERROR', scope: 'model', status: status || 502, retryable: true };
}

export function adaptiveTimeoutMs(provider, opts = {}) {
  if (opts.timeoutMs) return Number(opts.timeoutMs);
  const type = provider?.type || '';
  if (type === 'ollama') return Number(process.env.OLLAMA_CHAT_TIMEOUT_MS || 120000);
  if (type === 'gemini') return Number(process.env.CLOUD_CHAT_TIMEOUT_MS || 25000);
  if (type === 'anthropic') return Number(process.env.CLOUD_CHAT_TIMEOUT_MS || 30000);
  return Number(process.env.CLOUD_CHAT_TIMEOUT_MS || 20000);
}

export function adaptiveNumPredict(messages = []) {
  const env = Number(process.env.OLLAMA_NUM_PREDICT || 0);
  if (env > 0) return env;
  const text = (Array.isArray(messages) ? messages : []).map(m => String(m?.content || '')).join(' ');
  const len = text.length;
  if (len < 80) return 96;
  if (len < 400) return 192;
  if (len < 1200) return 320;
  return 512;
}

export async function chatProvider(provider, token, model, messages, fetchImpl = fetch, opts = {}) {
  if (provider.type === 'ollama') {
    // Adaptive: simple questions finish faster; heavy local models still get room.
    const timeoutMs = Number(opts.timeoutMs || process.env.OLLAMA_CHAT_TIMEOUT_MS || 120000);
    const numPredict = Number(opts.numPredict || process.env.OLLAMA_NUM_PREDICT || 0) || adaptiveNumPredict(messages);
    const numCtx = Number(process.env.OLLAMA_NUM_CTX || 2048);
    const base = String(provider.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const r = await fetchImpl(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          num_predict: numPredict,
          num_ctx: numCtx,
          temperature: 0.7
        }
      }),
      timeoutMs
    });
    if (!r.ok) throw await providerError(r);
    const j = await r.json();
    return { reply: j.message?.content || '', model: j.model || model, usage: { prompt_tokens: Number(j.prompt_eval_count || 0), completion_tokens: Number(j.eval_count || 0), total_tokens: Number((j.prompt_eval_count || 0) + (j.eval_count || 0)) } };
  }

  if (provider.type === 'gemini') {
    const system = messages.find(m => m.role === 'system')?.content;
    const userParts = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
    const contents = system
      ? [
          { role: 'user', parts: [{ text: `System:\n${system}` }] },
          { role: 'model', parts: [{ text: 'Understood.' }] },
          ...userParts
        ]
      : userParts;
    const body = {
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    };
    const r = await fetchImpl(
      `${provider.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: adaptiveTimeoutMs(provider, opts)
      }
    );
    if (!r.ok) throw await providerError(r);
    const j = await r.json();
    const parts = j.candidates?.[0]?.content?.parts || [];
    const reply = parts.map(p => p.text || '').join('');
    if (!reply && j.promptFeedback?.blockReason) {
      const e = new Error(`GEMINI_BLOCKED_${j.promptFeedback.blockReason}`);
      e.status = 400;
      throw e;
    }
    return { reply, model, usage: { prompt_tokens: Number(j.usageMetadata?.promptTokenCount || 0), completion_tokens: Number(j.usageMetadata?.candidatesTokenCount || 0), total_tokens: Number(j.usageMetadata?.totalTokenCount || 0) } };
  }

  if (provider.type === 'anthropic') {
    const system = messages.find(m => m.role === 'system')?.content;
    const r = await fetchImpl(`${provider.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': token,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages: messages.filter(m => m.role !== 'system')
      }),
      timeoutMs: 90000
    });
    if (!r.ok) throw await providerError(r);
    const j = await r.json();
    return {
      reply: (j.content || []).map(x => x.text || '').join(''),
      model: j.model || model,
      usage: { prompt_tokens: Number(j.usage?.input_tokens || 0), completion_tokens: Number(j.usage?.output_tokens || 0), total_tokens: Number((j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0)) }
    };
  }

  const r = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
    timeoutMs: adaptiveTimeoutMs(provider, opts)
  });
  if (!r.ok) throw await providerError(r);
  const j = await r.json();
  return {
    reply: extractOpenAICompatibleReply(j),
    model: j.model || model,
    usage: { prompt_tokens: Number(j.usage?.prompt_tokens || 0), completion_tokens: Number(j.usage?.completion_tokens || 0), total_tokens: Number(j.usage?.total_tokens || 0) },
    finishReason: j.choices?.[0]?.finish_reason || null
  };
}

export async function embedProvider(provider, token, model, input, fetchImpl = fetch) {
  if (provider.type === 'ollama') {
    const base = String(provider.baseUrl || '').replace(/\/$/, '');
    const r = await fetchImpl(`${base}/api/embed`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ model, input }), timeoutMs:90000 });
    if (!r.ok) throw await providerError(r);
    const j = await r.json();
    return { object:'list', data:(j.embeddings || []).map((embedding,index)=>({object:'embedding',embedding,index})), usage:{prompt_tokens:0,total_tokens:0} , model};
  }
  if (provider.type === 'openai-compatible') {
    const r = await fetchImpl(`${provider.baseUrl}/embeddings`, { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify({model,input}), timeoutMs:90000 });
    if (!r.ok) throw await providerError(r);
    const j = await r.json();
    return { object:'list', data:j.data || [], usage:{ prompt_tokens:Number(j.usage?.prompt_tokens||0), completion_tokens:Number(j.usage?.completion_tokens||0), total_tokens:Number(j.usage?.total_tokens||0) }, model:j.model || model };
  }
  const e = new Error('EMBEDDINGS_UNSUPPORTED_FOR_PROVIDER'); e.statusCode=400; throw e;
}

async function providerError(r) {
  let body = '';
  try { body = await r.text(); } catch {}
  const e = new Error(`PROVIDER_${r.status}: ${body.slice(0, 400)}`);
  e.status = r.status;
  e.body = body;
  const cls = classifyProviderError(e);
  e.errorClass = cls.class;
  e.errorScope = cls.scope;
  if (cls.class === 'BILLING_REQUIRED' && e.status === 400) e.status = 402;
  if (cls.class === 'INVALID' && !e.status) e.status = 401;
  return e;
}
