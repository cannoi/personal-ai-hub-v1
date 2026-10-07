# v1.8.8 — Fix MISSING_GATEWAY_TOKEN + NO_ACTIVE_KEY (stale model)

## Root causes
1. **MISSING_GATEWAY_TOKEN**: After any `pah_` token exists, browser Hub UI requests include `Origin` and were rejected unless a gateway token was sent. Hub UI is the control plane — it must use vault provider keys, not `pah_` tokens.
2. **NO_ACTIVE_KEY** with ACTIVE Gemini keys: Client requested `provider=gemini` + `model=gemma-4-31b-it:free` (OpenRouter-style id). `chooseKeys` required the model to be on the key's model list → empty pool despite ACTIVE keys.

## Fixes
- `http.js`: `isHubUiRequest` — exempt `appId=hub-ui` / same-origin Origin from gateway auth.
- `chooseKeys`: if model does not match any key, keep ACTIVE keys for the provider.
- Chat eligibility: fallback `chooseKeys(provider, null)` then any provider.
- Model candidates: only force client model if listed on the key; ignore stale sticky models.

## Unchanged
Gateway auth still required for cross-origin external apps with tokens configured.
