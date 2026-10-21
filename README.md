# Personal AI Hub v2.1.1

Private **OpenAI-compatible AI Gateway** for SoloHost / Pi Network.

Lean international app: **English + Vietnamese**, suitable icons, chat in the user’s language, useful AI for everyday users.

## Quick start
1. Set `AI_HUB_ADMIN_PASSWORD` (or note the auto-generated password in the first log).
2. Add cloud API keys **or** enable Ollama.
3. Create a gateway token (`pah_…`).
4. Point other apps to `http://personal-ai-hub:8080/v1` (or public `http://IP:59971/v1`) with the token.

## Highlights
- **Transparent `/v1`**: no Hub knowledge injection into third-party apps.
- **Real SSE streaming** for OpenAI-compatible providers.
- **Vision**: `image_url` (data URLs) via OpenAI-compatible, Gemini, Ollama.
- **Token scopes**: rate limits, allowed models/endpoints, expiry.
- **i18n**: EN/VI with floating language toggle; Hub assistant replies in the user language.
- **Onboarding**: 3-step wizard + inline SVG icons (no icon CDN).

## Security
- Admin password required; `/v1` always requires `pah_` token.
- Master vault key generated at runtime (not shipped in the image).
- Feedback Hub credentials are server-side only.

See [CHANGELOG.md](./CHANGELOG.md) for the full v2.0 list.

## Local AI (Ollama)

Published CI images are **lean** (`WITH_OLLAMA=0`) so smoke tests pass and pulls stay small.

- **External Ollama**: set `OLLAMA_BASE_URL=http://host:11434` (or your Ollama service).
- **Managed Ollama in the same image**: build with  
  `docker build --build-arg WITH_OLLAMA=1 -t personal-ai-hub:local .`  
  then run with `ENABLE_MANAGED_OLLAMA=1`.

`GET /health` is always instant. Use `GET /health/deep` for Local AI status.
