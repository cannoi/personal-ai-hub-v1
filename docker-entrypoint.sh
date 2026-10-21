#!/bin/sh
# Personal AI Hub entrypoint — HTTP must listen immediately (CI smoke ~90s).
# Managed Ollama is optional and never blocks Node startup.
set -eu

export DATA_DIR="${DATA_DIR:-/app/data}"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/app/ollama-data}"
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"
export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export LD_LIBRARY_PATH="/usr/lib/ollama:/usr/local/lib/ollama:${LD_LIBRARY_PATH:-}"
export OLLAMA_LIBRARY_PATH="/usr/lib/ollama:/usr/local/lib/ollama"

mkdir -p "$DATA_DIR" "$OLLAMA_MODELS" || true

# Default: enable managed Ollama in real deploys. CI smoke can set ENABLE_MANAGED_OLLAMA=0.
ENABLE_MANAGED_OLLAMA="${ENABLE_MANAGED_OLLAMA:-1}"

if [ "$ENABLE_MANAGED_OLLAMA" != "0" ] && command -v ollama >/dev/null 2>&1; then
  echo "[hub] Starting managed Ollama in background (non-blocking)"
  # Redirect to log file so a noisy/failing ollama does not flood PID1 pipes on some runtimes
  ( ollama serve >>/tmp/ollama-serve.log 2>&1 || echo "[hub] WARNING: ollama serve exited $?" ) &
  echo "[hub] Ollama pid $! — Hub will not wait for readiness"
else
  echo "[hub] Managed Ollama disabled or binary missing (ENABLE_MANAGED_OLLAMA=${ENABLE_MANAGED_OLLAMA})"
fi

echo "[hub] Starting Personal AI Hub on 0.0.0.0:${PORT:-8080}"
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node index.js
