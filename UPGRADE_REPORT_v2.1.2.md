# Personal AI Hub v2.1.2 — Upgrade audit and verification report

Date: 2026-10-21  
Baseline: supplied `personal-ai-hub-v2.1.1-fixed.zip` (itself based on the v2.1.0 source).  
Scope: continue the supplied v2.1 upgrade prompt without rewriting unrelated modules. Feedback Hub source/configuration was not intentionally changed.

## Summary

This is a targeted follow-up patch, not a claim that every item in the original multi-stage v2.1 prompt is complete. The highest-value verified fixes in this patch are stricter token scopes, preserving the OpenAI `developer` role, forwarding streaming tool-call deltas through the provider/kernel layers, removing raw `X-Forwarded-For` fallback, and making `npm test` execute the existing regression suites rather than only two small tests.

## Files changed

- `openai-compat.js`: exact/glob endpoint and model scope checks; endpoint short-path compatibility; client IP selection no longer trusts raw `X-Forwarded-For`; preserve `developer` role; forward streamed tool-call deltas into SSE chunks.
- `ai-app-kernel/src/index.js`: forward tool-call deltas from provider streams through `chatStream` instead of dropping them.
- `ai-app-kernel/src/providers.js`: parse and emit `delta.tool_calls` from OpenAI-compatible SSE responses.
- `test.js`: authenticate protected `/v1` tests with a real test gateway token, retain an explicit unauthenticated rejection check, and use a proper SSE fixture for stream tests.
- `test-gateway-upgrade.js`: proper SSE fixture, streaming tool-call regression assertion, and a regression test that rejects endpoint-scope substring matching.
- `test-v2-core.js`: update version assertion.
- `package.json`, `package-lock.json`, active version metadata, `README.md`, `RELEASE_NOTES.md`, `CHANGELOG.md`: synchronized release version to 2.1.2; `npm test` now runs seven existing suites.
- `FIX_REPORT_v2.1.2.md`, `UPGRADE_REPORT_v2.1.2.md`: release/audit documentation.

No new runtime dependency was added. No files in `lib/feedback-module/` were modified.

## Verification results

- `npm test`: PASS, all seven configured suites.
- JavaScript syntax scan: PASS, 34/34 JavaScript files checked.
- Gateway test: PASS, including token auth, OpenAI-compatible responses, SSE, embeddings, usage, and endpoint-scope substring rejection.
- ZIP integrity: checked when packaging.

### Not verified

- The Docker image startup smoke test could not complete locally because the environment could not download npm packages (`EAI_AGAIN` from `registry.npmjs.org`); `node_modules/express` was therefore incomplete. This is an environment/network limitation, not a passing Docker result.
- Docker build, published GHCR image, GitHub Actions workflow, `npm audit`, and gitleaks were not run successfully here.
- No `.git` metadata was present in the supplied ZIP, so phase-by-phase commits could not be created.

## Prompt completion matrix

| Area | Status in v2.1.2 | Notes |
|---|---|---|
| CI/test coverage | Partial | Seven existing suites run through `npm test`; acceptance suite A1–R1 and actual GitHub workflow still need implementation/verification. |
| Token auth | Partial | `/v1` token requirement and regression tests exist; the full `/api/v1/chat`/admin-cookie/control-plane unification still needs review and HTTP acceptance tests. |
| Token scope | Improved | Exact or explicit wildcard matching replaces substring checks for model/endpoint scope. No TPM or monetary budget added. |
| Message history | Partial | Normalization preserves `developer`, tool role, tool IDs and multimodal parts in existing code paths; full upstream fidelity across every adapter and both stream/non-stream still needs HTTP-level fixtures. |
| Streaming tool calls | Partial | OpenAI-compatible `delta.tool_calls` are now forwarded through provider/kernel/SSE path; non-stream tool calls and all Anthropic/Gemini/Ollama tool translation are not complete. |
| Streaming timeouts | Incomplete | Current stream timeout behavior still needs a hanging-upstream regression test and error mapping to `upstream_timeout` before/after SSE headers. |
| Model catalog/routing | Partial | Existing catalog and ranking tests remain; full catalog-driven capability resolution, strict unknown-model 404, user primary/fallback chain and per-app/task metrics are not complete. |
| Embeddings | Incomplete | Separate embedding catalog, dimensions/encoding format, and proof that embedding failures never alter chat-key health remain to be implemented. |
| Admin security | Incomplete | Admin password hashing/scrypt, progressive login lockout, password change UI, and Origin enforcement for all mutations are not complete. |
| State/logging | Incomplete | `mutex-store.js` is still not wired into all production state paths; JSONL rotation and concurrency/usage accuracy test remain. |
| Docker | Partial | Existing image uses Node 22 and a build smoke test; multi-stage build, non-root runtime, pinned Ollama checksums and successful image execution are not verified. |
| Audio/images/documents | Incomplete | Real transcription, TTS, image generation, and document extraction paths remain unsupported or incomplete. |
| UI/i18n/CDN | Incomplete | EN/VI JSON parity test exists, but inline strings, FontAwesome and Tailwind CDN remain. UI redesign/cleanup was deliberately not attempted in this narrow reliability patch. |
| Cleanup | Deferred | Legacy docs/vendor/client files were retained to avoid deleting potentially referenced assets without a dependency/reference audit, especially around Feedback Hub. |
| Migration/rollback | Partial | No state schema migration was introduced by this patch; retain the previous ZIP/image for rollback. Full 2.0.0 migration checklist remains outstanding. |

## Compatibility and rollback

- Keeps port 8080, SoloHost host port configuration, existing `pah_` gateway tokens, and current routes.
- No state schema migration was introduced.
- Rollback: redeploy the previous image/tag and restore the previous ZIP/source. Keep a backup of `/app/data` before any future state-schema migration.

## Remaining high-priority work

1. Add the full real-Express HTTP acceptance suite from the supplied prompt (A1–R1) and run it in CI.
2. Fix and test stream timeouts/hanging upstream behavior; return correct JSON status before SSE starts.
3. Complete strict model selection/fallback policy and provider-specific tools/history/streaming adapters.
4. Implement admin password hashing/lockout/Origin checks and unify admin control routes.
5. Finish model catalog, embeddings isolation, storage/log rotation, Docker non-root build, and supported multimodal routes.
6. Remove CDN dependencies and unify UI translations only after adding visual/UI regression checks.
7. Run clean `npm ci`, `npm audit --omit=dev`, gitleaks, Docker build, and GitHub Actions against the exact release image.
