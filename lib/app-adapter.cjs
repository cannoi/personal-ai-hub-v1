/**
 * Personal AI Hub — app adapter for Universal AI panel / kernel guidance.
 * Knowledge is accurate to this app (SoloHost AI Gateway). No secrets.
 */
'use strict';

const KNOWLEDGE = `
APP NAME: Personal AI Hub
ROLE: Private AI Gateway for the Pi SoloHost ecosystem (not a generic chatbot).

WHAT THIS APP DOES
- Shared AI server for other SoloHost apps (App Builder, Calculator, Snake, Feedback Hub, Telegram bots, etc.).
- Multi-provider routing: Gemini, OpenAI, DeepSeek, Groq, OpenRouter, Anthropic, Mistral, xAI, Custom OpenAI-compatible, Local Ollama.
- Local AI (managed Ollama inside the Hub container when available).
- OpenAI-compatible API at /v1 (models, chat/completions) so external apps use Base URL http://personal-ai-hub:8080/v1 and a pah_ gateway token.
- Native API: POST /api/v1/chat and /ai/* for Hub UI and control plane.
- Admin password (AI_HUB_ADMIN_PASSWORD) protects Settings / keys / tokens when configured.
- Gateway tokens (pah_…): App tokens bind to first X-SoloHost-App-ID; Shared tokens work for many apps. Admin can unbind/revoke.
- Feedback tab talks to SoloHost Feedback Hub (notices, donate info from Hub only, send bug/improvement/question).

MAIN USER WORKFLOWS
1) Add a cloud key: Settings → choose provider → paste API key → Test / refresh models → status ACTIVE.
2) Local AI: ensure Ollama is ready → Refresh local models → Download a small model (e.g. qwen2.5-coder:1.5b, llama3.2:3b).
3) Routing modes: local_only | prefer_local | balanced | cloud.
4) Create gateway token for another SoloHost app → give only the pah_ token (not provider keys) → app uses /v1 with model=auto.
5) Feedback: open robot panel → Feedback tab → read notices / donate / send message (no passwords or keys in messages).
6) Notes: optional Hub notes via chat actions create_note / list_notes.

WHAT USERS SHOULD NOT DO
- Do not put provider API keys into App Builder or other apps; keys stay inside this Hub.
- Do not expose Ollama port 11434 publicly.
- Do not share admin password or pah_ tokens publicly.
- Do not paste secrets into Feedback messages.

TROUBLESHOOTING SHORT GUIDE
- Chat fails / NO_ACTIVE_KEY: add or Test a key; check Activity Log.
- Local models failed / OLLAMA: wait for managed Ollama, Refresh, or check volume ollama-data.
- /v1/models 404: rebuild image so OpenAI routes are mounted; check GET /version.
- App cannot reach Hub: use http://personal-ai-hub:8080 (Docker DNS), not 127.0.0.1 from another container.
- Wrong App-ID after binding: Admin Unbind token, then first use again with correct X-SoloHost-App-ID.


ROUTING (Fast Smart AI Router)
- Modes: local_only | prefer_local | balanced | cloud
- balanced picks the healthiest/fastest route (success rate + latency + sticky model), not raw useCount.
- selectedModel after a successful reply is strongly preferred next time.
- Billing/auth errors (e.g. Anthropic "credit balance is too low" even on HTTP 400) disable the whole key immediately — no more models tried on that key.
- Model 429 only cools down that model; other models on the same key stay usable.
- Timeouts fail the route quickly and move on; interactive cloud timeout ~20–30s, local ~120s adaptive.
- Simple local questions use lower num_predict so Ollama finishes faster.
- Memory is partitioned by appId so other SoloHost apps do not leak into Hub chat context.

LANGUAGE
Reply in the user's language. Be concise and practical.
`.trim();

const actions = [
  { name: 'list_notes', description: 'List notes stored in the Hub', requiresConfirmation: false },
  { name: 'create_note', description: 'Create a note with title and content', requiresConfirmation: false },
  { name: 'open_settings', description: 'Tell user how to open Settings (keys, local AI, routing)', requiresConfirmation: false },
  { name: 'explain_gateway', description: 'Explain how other apps connect via /v1 and pah_ tokens', requiresConfirmation: false }
];

async function getContext() {
  return {
    screen: 'personal-ai-hub',
    role: 'solohost-ai-gateway',
    surfaces: {
      mainUi: 'Hub dashboard + Settings',
      robotPanel: 'Chat | Feedback | Settings | Logs',
      externalApi: 'GET/POST /v1/* OpenAI-compatible'
    }
  };
}

async function executeAction({ name, args = {} } = {}) {
  const allowed = actions.map(a => a.name);
  if (!allowed.includes(name)) return { ok: false, error: 'Action not allowed' };
  if (name === 'open_settings') {
    return { ok: true, action: name, hint: 'Use the gear icon or Settings in the robot panel to manage provider keys, local AI, and routing.' };
  }
  if (name === 'explain_gateway') {
    return {
      ok: true,
      action: name,
      hint: 'Other SoloHost apps should call http://personal-ai-hub:8080/v1 with Authorization: Bearer pah_… and model=auto. Provider keys never leave this Hub.'
    };
  }
  // create_note / list_notes are handled by Hub action registry when available
  return { ok: true, action: name, args };
}

/** Offline guide when no cloud/local key can answer. */
async function localReply(message, live = {}) {
  const q = String(message || '').toLowerCase();
  const tips = [];

  if (/token|pah_|gateway|builder|app builder|\/v1/.test(q)) {
    tips.push(
      'Gateway for other apps: create a token in Settings (or robot panel → Settings).',
      'Base URL for App Builder Custom Provider: http://personal-ai-hub:8080/v1',
      'Header: Authorization: Bearer pah_… and optionally X-SoloHost-App-ID.',
      'Model: auto. Do not put Gemini/OpenAI keys into Builder.'
    );
  }
  if (/local|ollama|offline|model/.test(q)) {
    tips.push(
      'Local AI: open Settings → Local AI → Refresh. If Ready, download a small model (qwen2.5-coder:1.5b or llama3.2:3b).',
      'Routing prefer_local or local_only uses Ollama first when available.'
    );
  }
  if (/key|api key|provider|gemini|openai|deepseek|groq/.test(q)) {
    tips.push(
      'Add a provider key under Settings → AI Providers. Paste key only → Test / refresh models until ACTIVE.',
      'Keys are stored encrypted in the Hub vault and never sent to other apps.'
    );
  }
  if (/feedback|donate|notice/.test(q)) {
    tips.push(
      'Open the robot button → Feedback tab for notices, donate info from Feedback Hub, and to send a message.',
      'Never put passwords or API keys in feedback.'
    );
  }
  if (/password|admin|login/.test(q)) {
    tips.push(
      'Admin password is set in SoloHost install (AI_HUB_ADMIN_PASSWORD). It protects the control plane, not the pah_ gateway tokens.'
    );
  }
  if (!tips.length) {
    tips.push(
      'Personal AI Hub is the shared AI gateway for SoloHost.',
      '1) Add a provider key or enable Local AI in Settings.',
      '2) Create a pah_ token so other apps can use http://personal-ai-hub:8080/v1 with model=auto.',
      '3) Use the robot panel for guided chat, Feedback, and logs.',
      'Ask specifically about keys, local AI, gateway tokens, or Feedback if you need steps.'
    );
  }

  const ctx = live && live.screen ? ` (screen: ${live.screen})` : '';
  return {
    ok: true,
    reply: `Local guide${ctx} — no active cloud/local model answered this turn:\n\n• ` + tips.join('\n• '),
    provider: 'local-guide',
    model: 'offline-manual'
  };
}

module.exports = {
  knowledge: KNOWLEDGE,
  actions,
  getContext,
  executeAction,
  localReply
};
