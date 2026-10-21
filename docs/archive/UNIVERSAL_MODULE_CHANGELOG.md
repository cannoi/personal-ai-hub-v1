# Changelog

## 1.3.0 — Custom / Local provider hardening
- Fixed: `Provider returned no usable text model` on Custom/Local. Causes addressed: Base URL given without `/v1` or as a full `/chat/completions` URL; `/models` shapes other than `{data:[...]}` (bare arrays, `{models:[{model}]}`, ...); servers with no `/models` at all; HTML page returned instead of JSON; embedding/speech models picked by `auto`.
- When no model can be discovered the error now says exactly what to do (type the model name in Settings → Model); an explicit model name always works without `/models`.
- Tolerant response parsing: content parts arrays, `choices[].text`, inline `<think>` blocks, SSE bodies, Responses API, Ollama native.
- Auto-adaptation: retries without `temperature` / folds `system` into the user turn / drops `max_tokens` when the server rejects them.
- Fallbacks for Custom/Local: Ollama `/api/tags` for listing; `/responses` and Ollama `/api/chat` for generation.
- Clear diagnostics for connection refused (Docker hint), DNS, TLS, timeout. Chat timeout 60s cloud / 120s local (`AI_TIMEOUT_MS` overrides).
- `Check token` on Custom/Local now runs a real 16-token generation; it no longer reports OK when chat would fail.
- `configured()` for provider `local` now honours the built-in default Base URL.
- `kind` from the provider catalog is honoured; optional `AI_EXTRA_HEADERS` (JSON) for gateways.
- Auto-model cached 5 min and refreshed on model-not-found. Chat response gains `resolvedModel` (additive).
- UI example: "Load models" button was wired to a non-existent id (`setRefreshModels`); fixed. Test/refresh now show warnings.
- New tests: `tests/provider-custom-local.test.js` (real HTTP servers).

## 1.2.1
- Added `assets/ai-icon.png` (production robot icon).
- Added `example/ui/` — full panel HTML, CSS, JS as used on Snake Arcade.
- Added `FEEDBACK_NOTICES.md` — notice sync, badge, mark-read, donate.
- Added `UI_LAYOUT.md` — FAB position, z-index, hide-while-open rules.
- Expanded `AI_CODE_PROMPT.md` into a complete one-shot integration prompt.

## 1.2.0
- Canonical files from Snake Arcade; `localReply`; env-safe Hub defaults.
- Example adapter + server mount + panel skeleton.

## 1.1.0
- Models list + test connection; stronger provider engine.

## 1.0.0
- Initial Universal AI + Feedback split for SoloHost.
