# SoloHost — Personal AI Hub

## Architecture

```
SoloHost apps → POST http://personal-ai-hub:8080/api/v1/chat
                      (or http://172.17.0.1:18080)
                         ↓
              Personal AI Hub container
                 ├── Node API (port 8080)
                 └── Ollama (127.0.0.1:11434)  ← managed in same container
```

Apps never call Ollama. Auth: `X-Personal-AI-Key: pah_…`.

## Volumes

- `personal-ai-hub-data` → settings, keys, logs
- `personal-ai-ollama-data` → local models (survives Hub updates)
