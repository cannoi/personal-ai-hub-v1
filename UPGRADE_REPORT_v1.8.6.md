# v1.8.6 — Universal AI + Feedback modules v1.3.0

## Done
- Replaced `lib/ai-module/provider-engine.cjs` with Universal module **v1.3.0** (Custom/Local hardening, tolerant models/chat parsing).
- Updated `lib/ai-module/ai-service.cjs` and `routes.cjs` to v1.3.0 sources.
- Confirmed `public/feedback-module.js` matches Universal Feedback client (token never in browser).
- Kept `lib/feedback-module/feedback-service.cjs` (server-only ingest token, base64 default) — API compatible with v1.3.
- Kept `public/ai-module.js` as **host-kernel adapter** (`/ai/*`) so Hub does **not** run a second AI system.
- Vendor tree: `vendor/universal-ai-feedback-v1.3.0/` (reference + example).
- Docs: FEEDBACK_NOTICES, UI_LAYOUT, INTEGRATION_GUIDE, module CHANGELOG.

## Intentionally NOT mounted
Standalone `createAIService` / `/api/ai/*` from the module is **not** mounted. Personal AI Hub continues to use `ai-app-kernel` as the only execution plane (keys, routing, Ollama, OpenAI `/v1`). Mounting both would duplicate provider state.

## Unchanged
- OpenAI-compatible gateway `/v1`
- Admin login, gateway tokens, rate limit
- Feedback panel (donate / notices / send) already aligned with module UX
- Docker/SoloHost packaging

## Tests
- `node --check` on ai-module CJS files: OK
- `require()` exports verified for provider-engine and feedback-service

## Not done
- Live E2E against remote Feedback Hub depends on device network
- Mounting dual AI service (explicitly avoided by design)
