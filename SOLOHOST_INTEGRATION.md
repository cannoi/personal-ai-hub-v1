# SoloHost AI Gateway

## For App Builder / Custom Provider

| Field | Value |
|-------|--------|
| Provider type | OpenAI-compatible / Custom |
| Base URL | `http://personal-ai-hub:8080/v1` |
| API Key | `pah_…` from Hub → Gateway tokens |
| Model | `auto` |

Alternative (host bridge): `http://172.17.0.1:18080/v1`

Native Hub API (unchanged): `POST http://personal-ai-hub:8080/api/v1/chat`

## Auth

```
Authorization: Bearer pah_…
# or
X-Personal-AI-Key: pah_…
X-SoloHost-App-ID: app-builder
```

Provider cloud keys never leave the Hub vault.
