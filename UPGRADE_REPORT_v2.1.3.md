# Personal AI Hub v2.1.3 — AI quality-first continuation report

Date: 2026-10-21  
Baseline: `personal-ai-hub-v2.1.2-upgraded.zip`  
Priority: improve Hub assistant response quality and automatic model choice while preserving unrelated app behavior.

## Summary

This is a targeted quality/reliability patch, not a claim that the full original v2.1 prompt is complete. It improves the Hub assistant's language following and response guidance, makes model-family ordering data-driven, prevents a lower-tier sticky model from demoting a higher-tier candidate, extends default cloud generation timeout, and preserves upstream timeout classification in streaming. Transparent `/v1` requests remain isolated from Hub-only prompt/memory behavior.

## Files added

- `models.catalog.json` — model-family tier and conservative capability-hint catalog.
- `ai-app-kernel/src/quality.js` — dependency-free user-language detection and Hub-only response-quality instructions.
- `test-ai-quality-v2.1.3.js` — focused node:test coverage for language, quality rules, catalog tier ordering, sticky tier safety, and streaming timeout classification.
- `UPGRADE_REPORT_v2.1.3.md` — this report.

## Files changed

- `ai-app-kernel/src/providers.js`: catalog-based model ranking and capability hints; same-tier-only sticky preference; longer default cloud generation timeout; distinguish upstream timeout from client abort in streaming; preserve Ollama `tool` role and tool metadata where supported.
- `ai-app-kernel/src/index.js`: apply language-aware quality instructions only to the Hub assistant, keep transparent `/v1` path separate, accept messages-array-only requests, avoid sticky lower-tier model override, preserve 504 timeout classification after streaming key retries.
- `test-smart-router.js`: changed the former sticky-low-tier expectation to assert that a higher-tier model remains first.
- `package.json`, `package-lock.json`, `index.js`, `lib/app-adapter.cjs`: release metadata synchronized to `2.1.3`; `npm test` includes the new quality suite.
- `test-v2-core.js`: version assertion updated.
- `README.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`: describe only the changes and validation that apply to this patch.

## AI quality behavior

1. Hub assistant replies in Vietnamese when the latest user message is clearly Vietnamese, including common unaccented Vietnamese phrases; otherwise English is the default unless UI language provides the fallback.
2. The Hub-only system prompt emphasizes direct actionable answers, accuracy, explicit uncertainty, asking one focused clarification when needed, and avoiding fabricated facts about provider capabilities or installation state.
3. Transparent `/v1` requests do not receive this Hub prompt, Hub knowledge, or Hub memory injection.
4. Model ordering uses catalog tiers: flagship > standard > fast > tiny. Unknown model families default to standard. Provider discovery remains authoritative for actual model availability.
5. A last-used model is only a tie-breaker inside its tier; it cannot demote a higher-tier model during automatic selection.
6. Default cloud timeout is 120 seconds, configurable with `CLOUD_CHAT_TIMEOUT_MS`. Streaming timeout is distinguished from a client disconnect and returns `UPSTREAM_TIMEOUT` / 504 after retries fail.

## Verification results

- `npm test`: PASS — all eight configured suites passed, including four new focused node:test cases.
- The router regression now verifies a sticky `gpt-4o-mini` does not outrank available `gpt-4o` during automatic routing.
- JavaScript syntax scan and ZIP integrity are run as part of final packaging.
- Feedback Hub module/configuration was not edited.
- No new runtime dependency was added.

## Not verified / still incomplete

- No successful clean `npm ci`, `npm audit --omit=dev`, gitleaks run, Docker image build, GHCR publish, or GitHub Actions execution is claimed. The earlier environment had npm registry DNS failures; this package still needs those release checks in a networked CI environment.
- The new model catalog is conservative and intentionally not a live vendor capability database. API-discovered availability still takes precedence; catalog capability hints require ongoing review against current provider APIs.
- Automatic language detection is lightweight heuristic detection, not a language-identification model. Short or mixed-language messages can be ambiguous; UI language is the fallback.
- Full adapter-native streaming and tool-call translation for Anthropic, Gemini, and Ollama are not complete. Ollama maps `developer` to `system` because its chat schema has no separate `developer` role.
- Admin password hashing/progressive lockout, complete `/admin/api` consolidation, full real-Express acceptance suite, embeddings catalog/isolation, token TPM/budget scopes, SQLite/JSONL storage, multi-stage non-root Docker, audio/TTS/image/document APIs, full i18n/CDN cleanup, and legacy-file cleanup remain incomplete.
- No phase commits were created because the supplied ZIP contains no Git metadata.

## Compatibility and rollback

- No state schema migration was introduced.
- Existing port/route/token formats and SoloHost configuration are preserved.
- Feedback Hub was not changed.
- Roll back by redeploying the previous v2.1.2 image/source ZIP; preserve `/app/data` before future state migrations.
