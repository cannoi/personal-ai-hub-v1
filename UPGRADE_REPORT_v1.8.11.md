# v1.8.11 — Public fixed-port Gateway + pah_ token monitoring

## Gateway standard
- Host port **59971** → container 8080 (`docker-compose.yml`)
- Canonical Base URL: `http://YOUR_PUBLIC_IP:59971/v1`
- Discovery prioritizes `PUBLIC_BASE_URL` / derived public IP:59971
- `GET /api/v1/gateway` and `GET /v1` expose `publicOpenaiBaseUrl`, `publishedPort`

## Gateway tokens (pah_)
- Track per-token: client count (appId + IP + UA fingerprint), today/total requests & tokens, errors, lastUsed
- UI lists stats + **Delete** (revoke)
- Usage rows cleaned on revoke

## SoloHost config
- `HOST_PORT` default `59971`
- `PUBLIC_BASE_URL` optional (e.g. `http://203.0.113.10:59971`)

## Files
- docker-compose.yml, config_options.yml
- index.js (discovery)
- ai-app-kernel/src/index.js (token stats)
- openai-compat.js (client in recordUsage)
- public/index.html, public/ai-panel.js
- lib/app-adapter.cjs, SOLOHOST_INTEGRATION.md

## Tests
- test-smart-router (+ token clients/delete) PASS
- test.js, test-security PASS
