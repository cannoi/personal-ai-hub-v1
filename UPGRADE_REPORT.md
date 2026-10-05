# UPGRADE REPORT — v1.6.2 OpenAI-compatible routes

## Root cause
`openai-compat.js` existed and gateway docs advertised `/v1/*`, but earlier builds either:
1. never called `mountOpenAICompat(app, …)`, or
2. deployed an older image without the mount.

Result: `GET /v1/models` and `POST /v1/chat/completions` hit the JSON catch-all → **404**.

## Fix (surgical)
| File | Change |
|------|--------|
| `index.js` | Calls `mountOpenAICompat(app, { kernel: ai, serviceName })` **before** `/v1` catch-all; logs routes at boot; `GET /version` |
| `openai-compat.js` | Explicit `app.get/post` for `/v1/models`, `/v1/chat/completions`, `/v1/health`, `/v1/__ping` (+ `/openai/v1/*` aliases) |
| `test.js` | Real HTTP integration tests (status + JSON), not source-grep |

## Auth
- No gateway tokens yet → open (bootstrap)
- Tokens exist → require `Authorization: Bearer pah_…` or `X-Personal-AI-Key`
- Invalid/missing → 401 JSON

## Model discovery
`GET /v1/models` returns `auto` + live Ollama models + usable cloud key models.

## Smart routing
`model=auto` → existing `kernel.chat` / routing modes. No second router.

## Tests
```
node test.js → ALL TESTS PASSED
```
Includes: /v1/__ping, /v1/health, /v1/models (auto + local), chat completions, stream reject, token auth, legacy kernel.chat.

## Deploy verification
After rebuild, from App Builder container:
```
wget -qO- http://personal-ai-hub:8080/version
wget -qO- http://personal-ai-hub:8080/v1/__ping
wget -qO- http://personal-ai-hub:8080/v1/models --header="Authorization: Bearer pah_…"
```
If `/version` is missing, the running image is **not** 1.6.2.

## App Builder
```
Base URL: http://personal-ai-hub:8080/v1
API Key:  pah_…
Model:    auto
```

## Unchanged
POST /api/v1/chat, vault, providers, Ollama, UI shell, no docker.sock, no :11434 public.

## Limitations
- stream=true not supported
- usage tokens reported as 0
