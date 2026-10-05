# Personal AI Hub v1.8.0 — International Gateway / Routing / Usage Upgrade

## Goal

Upgrade the existing Personal AI Hub into a reusable SoloHost AI Gateway for multiple apps while preserving the existing UI, Local AI/Ollama, provider management, vault, routing, memory, SDK, health/fallback, and SoloHost package behavior.

## Completed

### 1. OpenAI-compatible gateway

The shared gateway now exposes:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- `GET /v1/health`
- `GET /v1/__ping`

The same chat/response/embedding routes are also available under `/openai/v1/*` for clients that use that common base-path convention.

`/v1/chat/completions` remains backward compatible for `stream=false` and now supports `stream=true` using SSE framing with a final `data: [DONE]` marker.

### 2. Authentication

Gateway authentication remains based on the existing `pah_*` token system:

- `Authorization: Bearer pah_...`
- `X-Personal-AI-Key: pah_...`
- optional `X-SoloHost-App-ID` binding

API keys in query strings are now rejected. This avoids accidental credential exposure through URLs, browser history, proxy logs, and analytics.

Admin login now has an in-memory login-attempt rate limit.

CORS was hardened: without `AI_HUB_ALLOWED_ORIGINS`, the default is same-origin only. Cross-origin browser clients must explicitly configure allowed origins.

### 3. Usage control

Gateway tokens now carry configurable limits:

- requests/minute
- concurrent requests
- daily token quota
- monthly token quota

Defaults can be configured with:

- `AI_HUB_GATEWAY_RATE_LIMIT_PER_MIN`
- `AI_HUB_GATEWAY_MAX_CONCURRENT`
- `AI_HUB_GATEWAY_DAILY_TOKENS`
- `AI_HUB_GATEWAY_MONTHLY_TOKENS`

Token-specific limits can also be supplied when creating a gateway token.

Usage is persisted per token/app/day and can be queried through the admin endpoint:

`GET /api/v1/gateway/usage`

The response tracks requests, prompt tokens, completion tokens, total tokens, and errors.

### 4. Token usage reporting

Provider responses now preserve usage metadata where the upstream provider supplies it:

- OpenAI-compatible providers
- Anthropic
- Gemini
- Ollama

This is exposed through the normal OpenAI-compatible `usage` object where available.

### 5. Responses compatibility

`POST /v1/responses` accepts a simple text `input` and optional `instructions`, routes through the existing Hub routing/fallback system, and returns an OpenAI-style response envelope.

### 6. Embeddings compatibility

`POST /v1/embeddings` now routes embeddings for:

- OpenAI-compatible providers
- Ollama installations exposing `/api/embed`

Provider-specific unsupported embedding backends fail explicitly instead of silently returning fake vectors.

### 7. Routing / fallback preservation

The existing smart-routing and fallback implementation was retained. The upgrade does not replace the provider router.

Existing behavior remains:

- Local Only
- Prefer Local
- Balanced
- Cloud
- model discovery
- model rotation after provider/model errors
- quota/error cooldown behavior
- local Ollama support

### 8. Version/discovery consistency

Version was bumped to `1.8.0` and the gateway discovery/version documents now advertise the newly supported compatibility endpoints.

## Files intentionally changed

Only these existing files were changed:

- `ai-app-kernel/src/http.js`
- `ai-app-kernel/src/index.js`
- `ai-app-kernel/src/providers.js`
- `index.js`
- `openai-compat.js`
- `package.json`
- `package-lock.json`
- `test.js`

New files:

- `test-gateway-upgrade.js`
- `UPGRADE_REPORT_v1.8.0.md`
- `docs/superpowers/plans/2026-10-05-personal-ai-gateway-upgrade.md`

No original application files were removed.

## Preserved unchanged

The following areas were intentionally left intact unless shared gateway plumbing required a compatible extension:

- existing Personal AI Hub UI
- provider/key management UI and vault design
- Local AI/Ollama manager
- memory/training system
- routing modes
- provider discovery and model ranking
- SoloHost integration/configuration
- Docker/compose structure
- existing SDK
- existing admin login/session model
- existing native `/api/v1/*` API semantics
- SSRF protections
- existing health/fallback logic

## Not fully implemented / limitations

These items are deliberately **not claimed as complete**:

1. `stream=true` is API-compatible SSE, but it currently emits the completed Hub answer as one generated SSE payload rather than transparently streaming provider tokens from every upstream provider. True end-to-end streaming would require provider-specific streaming implementations for Ollama, Gemini, Anthropic, and OpenAI-compatible providers.

2. `/v1/responses` implements the common text-input path, not the entire modern Responses API feature set. Advanced response items, background jobs, built-in tools, computer-use/tool orchestration, and provider-specific extensions are not exposed.

3. Tool/function calling is not fully normalized across all providers. The existing provider abstraction remains primarily text-chat oriented.

4. Multimodal/vision/audio inputs are not fully normalized across all providers. The current compatibility layer intentionally avoids pretending unsupported content types are supported.

5. Embeddings are not implemented for Gemini or Anthropic through their native APIs in this release. They return an explicit unsupported-provider error rather than fabricating output.

6. Admin sessions remain in memory, so an application restart invalidates active admin sessions. This was preserved to avoid changing the existing authentication/storage model beyond the requested gateway hardening.

7. A complete production-grade distributed quota/counter backend is not included. Usage persistence is JSON-file based, consistent with the existing lightweight SoloHost architecture.

8. The container runtime could not be fully boot-tested in this workspace because the uploaded project did not contain `node_modules`; `npm ci --ignore-scripts` timed out in the execution environment. Syntax checks and all repository tests that do not require Express runtime installation were completed successfully.

## Verification

Passed:

- `npm test`
- existing regression tests
- existing security tests
- new gateway upgrade tests
- JavaScript syntax checks for the application source
- original-vs-working-tree file comparison: no original application files missing
- original file count: 43 regular files
- final application file count: 46 regular files (3 intentional new test/plan/report files are part of the upgrade package)

The generated ZIP does not include temporary runtime data or `node_modules`.
