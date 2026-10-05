# Managed Local AI (same-container Ollama)

From v1.5.0, Ollama runs **inside** the Personal AI Hub container via `docker-entrypoint.sh`.

- No separate `ollama/ollama` image (avoids 0-byte sidecar pulls on SoloHost)
- No docker.sock, no host `apt install`
- Models: volume `/app/ollama-data` (`personal-ai-ollama-data`)

## After deploy

1. Wait ~1 minute for first boot (entrypoint starts `ollama serve`).
2. UI → Local AI → **Refresh** → Ready.
3. Download `qwen3:4b` (or another light model).

## Logs to check

```bash
docker logs personal-ai-hub 2>&1 | head -50
# Expect: [hub] Starting managed Ollama … / [hub] Ollama is ready
```

## If still Unavailable

- Rebuild image so binary is included: `docker compose build --no-cache && docker compose up -d`
- Ensure volume `personal-ai-ollama-data` is writable
- Cloud providers continue to work regardless
