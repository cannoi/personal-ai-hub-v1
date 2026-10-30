/**
 * Personal AI Hub — app adapter for Universal AI panel / kernel guidance.
 * Knowledge is accurate to this app (SoloHost AI Gateway). No secrets.
 */
'use strict';

const KNOWLEDGE = `
APP NAME: Personal AI Hub
VERSION: 2.1.5
ROLE: Private OpenAI-compatible AI Gateway for the Pi SoloHost ecosystem (not a generic chatbot).

WHAT THIS APP DOES (v2.1.5)
- Shared AI server for other SoloHost apps (App Builder, Calculator, games, Feedback Hub, Telegram bots, etc.).
- Multi-provider routing: Gemini, OpenAI, DeepSeek, Groq, OpenRouter, Anthropic, Mistral, xAI, Custom OpenAI-compatible, Local Ollama.
- Local AI via managed Ollama inside the Hub container when available.
- OpenAI-compatible API at /v1 (models, chat/completions, responses, embeddings). External apps use Base URL http://personal-ai-hub:8080/v1 (or public http://IP:59971/v1) and a pah_ gateway token.
- Vision: OpenAI-style image_url parts (data: base64) are forwarded. Gemini uses inlineData; Ollama uses message.images; auto prefers vision-capable models when images are present.
- CRITICAL (v2): The /v1 gateway is TRANSPARENT. It does NOT inject Hub knowledge, persona, server memory, or rewrite answers. What the client sends is what the upstream model receives.
- Hub UI assistant (robot panel / admin chat) still uses app knowledge and can guide users; that path is separate from /v1.
- Admin password (AI_HUB_ADMIN_PASSWORD) is REQUIRED for control plane. If unset at first start, a random password is generated and printed once in the log.
- Gateway tokens (pah_…): required for ALL /v1 calls. App tokens bind to first X-SoloHost-App-ID; Shared tokens work for many apps. Admin can unbind/revoke.
- Feedback tab talks to SoloHost Feedback Hub (credentials are built-in; notices, donate, send feedback). No user configuration needed.

MAIN USER WORKFLOWS
1) Set admin password (or note the one generated on first boot) → login to Settings.
2) Add a cloud key: Settings → provider → paste API key → Test / refresh models → status ACTIVE.
3) Local AI: ensure Ollama is ready → Refresh local models → Download a small model (e.g. qwen2.5-coder:1.5b, llama3.2:3b).
4) Routing modes: quality (default) | balanced | economy | local_first | local_only | cloud.
5) Create gateway token for another SoloHost app → copy Base URL + pah_ token only (never provider keys) → app uses /v1 with model=auto or a specific model.
6) Feedback: open robot panel → Feedback tab → read notices / donate / send message (never put passwords or keys in messages).
7) Notes: optional Hub notes via chat actions (Hub UI only).

WHAT USERS SHOULD NOT DO
- Do not put provider API keys into App Builder or other apps; keys stay inside this Hub.
- Do not expose Ollama port 11434 publicly.
- Do not share admin password or pah_ tokens publicly.
- Do not paste secrets into Feedback messages.
- Do not expect /v1 to answer as "Personal AI Hub" — that path is a pure AI proxy.

TROUBLESHOOTING SHORT GUIDE
- Chat /v1 fails with no_tokens_configured or MISSING_GATEWAY_TOKEN: create a token in Settings first.
- NO_ACTIVE_KEY / no_provider_configured (503): add or Test a key; check Activity Log. /v1 never returns Hub guide text as a fake AI answer.
- Local models / OLLAMA: wait for managed Ollama, Refresh, or check volume ollama-data.
- /v1/models empty: add keys and Test them; rebuild image if routes missing; check GET /version.
- App cannot reach Hub: use http://personal-ai-hub:8080 (Docker DNS), not 127.0.0.1 from another container.
- Wrong App-ID after binding: Admin → Tokens → Unbind or create a new Shared token.

CONNECTING OTHER APPS (App Builder, Universal AI modules, etc.)
- Base URL: http://personal-ai-hub:8080/v1   (or public http://YOUR_IP:59971/v1)
- API Key: pah_… token from Hub Settings (Authorization: Bearer or X-Personal-AI-Key)
- Header (recommended): X-SoloHost-App-ID: your-app-id
- Model: auto  (or a specific model id from /v1/models)
- The gateway is transparent: your system prompt and messages are forwarded without Hub injection.

PUBLIC GATEWAY
- Host port default 59971 (container 8080). Configurable via HOST_PORT / config_options.
- Canonical remote Base URL: http://YOUR_PUBLIC_IP:59971/v1
- Set PUBLIC_BASE_URL if you need a fixed advertised URL.
- Gateway tokens track usage; admin can delete unused ones.

SECURITY (v2 highlights)
- Master vault key is generated at runtime (never shipped in the image).
- /v1 always requires a pah_ token; browser same-origin bypass removed.
- Admin control plane requires password; open mode removed.
- Feedback credentials are server-side only.

LANGUAGE
Reply in the user's language. Be concise and practical. For Hub UI assistant only: use the knowledge above. For /v1 traffic the gateway stays transparent.`.trim();

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
