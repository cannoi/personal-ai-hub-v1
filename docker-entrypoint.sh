#!/bin/sh
# Minimal entrypoint: always start Node immediately. Never block on Ollama.
set -eu
export DATA_DIR="${DATA_DIR:-/app/data}"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/app/ollama-data}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export LD_LIBRARY_PATH="/usr/lib/ollama:/usr/local/lib/ollama:${LD_LIBRARY_PATH:-}"
mkdir -p "$DATA_DIR" "$OLLAMA_MODELS" 2>/dev/null || true
echo "[hub] exec node index.js (PORT=${PORT:-8080})"
if [ "$#" -gt 0 ]; then exec "$@"; fi
exec node index.js
