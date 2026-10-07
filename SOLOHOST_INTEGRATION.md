# SoloHost AI Gateway — connect App Builder & other apps

## Recommended Base URL (try in order)

1. **Same URL you open the Hub UI with** + `/v1`  
   Example: Hub UI is `http://192.168.1.10:62117` → Base URL = `http://192.168.1.10:62117/v1`

2. **Docker DNS** (only if both apps share a network):  
   `http://personal-ai-hub:8080/v1`

3. **Host gateway** (when DNS fails):  
   `http://host.docker.internal:<HOST_PORT>/v1`  
   Alternatives: `host.containers.internal`, `172.17.0.1`

## Never

- `http://127.0.0.1:<port>/v1` **from another container** (points at that container, not the Hub)

## App Builder fields

| Field | Value |
|-------|--------|
| Type | OpenAI-compatible / Custom |
| Base URL | see list above (must end with `/v1`) |
| API Key | `pah_…` from Hub → Gateway tokens |
| Model | `auto` |

```bash
# Discovery (JSON)
curl -s http://HOST:PORT/api/v1/gateway
curl -s http://HOST:PORT/v1

# Models
curl -s http://HOST:PORT/v1/models -H "Authorization: Bearer pah_YOUR_TOKEN"

# Chat
curl -s http://HOST:PORT/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pah_YOUR_TOKEN" \
  -H "X-SoloHost-App-ID: app-builder" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

Optional SoloHost config: set `HOST_PORT` and/or `PUBLIC_BASE_URL` so discovery advertises the correct host-gateway URL.
