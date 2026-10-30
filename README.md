# Personal AI Hub v2.1.5

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
- **i18n**: EN/VI with a floating language toggle; the Hub assistant explicitly follows the latest user message language.
- **AI quality**: model-family catalog, conservative auto-routing tiers, clearer uncertainty guidance, and longer cloud generation timeout.
- **Icons**: SVG icon module is available; removal of all legacy CSS/icon CDN references remains pending.

## Security
- Admin password required; `/v1` always requires `pah_` token.
- Master vault key generated at runtime (not shipped in the image).
- Feedback Hub credentials are server-side only.

See [CHANGELOG.md](./CHANGELOG.md) for the full v2.0 list.

## Local AI (Ollama)

The standard production image now includes the Ollama runtime and starts `ollama serve` automatically. The model itself is **not** downloaded automatically; choose a model in the Local AI panel to avoid unexpected disk, bandwidth, RAM, or CPU use. Model files persist in the `personal-ai-ollama-data` volume.

- **Managed Local AI (default)**: the image builds with `WITH_OLLAMA=1`; runtime uses `ENABLE_MANAGED_OLLAMA=1`. Ollama listens on container loopback only and its port is not published.
- **External Ollama**: set `ENABLE_MANAGED_OLLAMA=0` and `OLLAMA_BASE_URL=http://host:11434` (or your Ollama service).
- **Intentionally cloud-only image**: build with `docker build --build-arg WITH_OLLAMA=0 -t personal-ai-hub:cloud-only .` and set `ENABLE_MANAGED_OLLAMA=0`.

If the Ollama release download fails during an enabled image build, the build now fails explicitly rather than publishing an image that silently lacks the Ollama binary. `GET /health` remains instant; use `GET /health/deep` for Local AI status. Startup logs report whether Ollama is ready or why it could not start.


## Upgrade audit

See [`UPGRADE_REPORT_v2.1.5.md`](./UPGRADE_REPORT_v2.1.5.md) for verified changes, tests, remaining gaps, and rollback notes.
