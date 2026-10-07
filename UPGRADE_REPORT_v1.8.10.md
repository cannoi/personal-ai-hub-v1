# v1.8.10 — Fix client connectivity (Host not found)

## Root cause
- `http://personal-ai-hub:8080/v1` only resolves when the **caller shares the Hub Docker network**. App Builder on another SoloHost stack gets “Host not found”.
- `http://127.0.0.1:62117/v1` from **another container** points at that container’s loopback, not the Hub (62117 is the SoloHost **host** published port).

Hub API routes and listen-on-0.0.0.0 were already correct; this is a **reachability / discovery** issue.

## Fixes
1. **Smart discovery** `GET /api/v1/gateway`
   - Prioritizes the **request Host** (the URL that already reached the Hub)
   - Lists try-order: thisRequest → PUBLIC_BASE_URL → Docker DNS → host.docker.internal:HOST_PORT
   - Troubleshooting fields for Host not found / 127.0.0.1 misuse
2. **`GET /v1`** returns JSON discovery (not SPA HTML)
3. **docker-compose** network aliases: `personal-ai-hub`, `personal_ai_hub`, `ai-hub`
4. **config_options** optional `HOST_PORT` + `PUBLIC_BASE_URL`
5. **UI** gateway panel shows try-order Base URLs
6. **Knowledge** + SOLOHOST_INTEGRATION.md updated for accurate AI guidance

## What users should put in App Builder
1. Base URL = same host as Hub UI + `/v1` (e.g. `http://192.168.x.x:62117/v1`)
2. Or `http://host.docker.internal:62117/v1` if calling from another container
3. API Key = `pah_…` · Model = `auto`
4. Avoid `127.0.0.1` and avoid bare `personal-ai-hub` unless networks are shared

## Tests
- test-smart-router.js PASS
- test.js PASS
- node --check index.js PASS

## Unchanged
- Routing, vault, providers, Ollama, OpenAI route handlers, Feedback hardcoding
