# Personal AI Hub v1.8.9 — Fast Smart AI Router

## Done

### 1. Provider error classification
- `classifyProviderError()` in `providers.js`
- Anthropic HTTP 400 + "credit balance is too low" → `BILLING_REQUIRED` (scope: key)
- INVALID / BILLING / MODEL_UNAVAILABLE / MODEL_429 / UPSTREAM_429 / TIMEOUT / PROVIDER_5XX
- Key-wide errors stop the key immediately (no more models on same key)
- Model 429 only cools down that model

### 2. Fast routing + metrics
- Route metrics: success, failure, latency, consecutiveFailures, cooldownUntil
- `keyRank` uses health score (success rate + sticky recency − latency), not raw useCount
- Sticky `selectedModel` strongly preferred
- Max 3 model tries per key (2 for local) instead of 8
- Fingerprint dedupe: no retry same provider+key+model+errorClass in one request

### 3. Adaptive timeouts
- Cloud interactive: ~20–30s (env `CLOUD_CHAT_TIMEOUT_MS`)
- Local Ollama: default 120s (was 600s); env override still works
- Adaptive `num_predict` by message length for local

### 4. Routing modes
- `local_only` / `prefer_local` / `balanced` / `cloud` preserved and respected
- BILLING_REQUIRED / INVALID keys excluded from pool

### 5. Memory isolation
- Chat context memory filtered by `appId` (no cross-app leak)

### 6. Response contract
- `normalizeAssistantReply` strips accidental router JSON; softens "App Builder" branding

### 7. Knowledge + Feedback
- App knowledge updated with Fast Smart Router behavior
- Feedback Hub already embedded (hubId / baseUrl / ingest token server-side)

### 8. Tests
- `test-smart-router.js`: 7 scenarios PASS
- `test.js`, `test-openai-contract.js`, `test-security.js`: PASS
- `node --check` on changed modules: PASS

## Not done / limitations
- True SSE token streaming not added (would change client contract; existing non-stream responses kept)
- Latency before/after not measured on live SoloHost (simulated tests only)
- Cannot verify live Anthropic/Gemini keys in CI without real credentials

## Files changed
- `ai-app-kernel/src/providers.js`
- `ai-app-kernel/src/index.js`
- `lib/app-adapter.cjs`
- `test-smart-router.js` (new)
- `package.json`, `index.js` version → 1.8.9
- `UPGRADE_REPORT_v1.8.9.md`

## Unchanged
- UI layout, vault, gateway tokens, OpenAI `/v1/*` mounts, Ollama managed local, Feedback module wiring
