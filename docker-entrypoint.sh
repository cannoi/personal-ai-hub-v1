#!/bin/sh
set -eu

export DATA_DIR="${DATA_DIR:-/app/data}"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/app/ollama-data}"
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"
export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
# Ollama runners (llama-server) live under these paths after full package install
export LD_LIBRARY_PATH="/usr/lib/ollama:/usr/local/lib/ollama:${LD_LIBRARY_PATH:-}"
export OLLAMA_LIBRARY_PATH="/usr/lib/ollama:/usr/local/lib/ollama"

mkdir -p "$DATA_DIR" "$OLLAMA_MODELS"

if command -v ollama >/dev/null 2>&1; then
  echo "[hub] Ollama binary: $(command -v ollama)"
  ls -la /usr/lib/ollama 2>/dev/null | head -15 || echo "[hub] /usr/lib/ollama empty or missing"
  ls -la /usr/local/lib/ollama 2>/dev/null | head -15 || echo "[hub] /usr/local/lib/ollama empty or missing"
  if [ ! -e /usr/lib/ollama/llama-server ] && [ ! -e /usr/local/lib/ollama/llama-server ]; then
    echo "[hub] WARNING: llama-server not found under lib/ollama — local chat may fail until image is rebuilt with full Ollama package"
  fi
  echo "[hub] Starting managed Ollama on $OLLAMA_HOST (models: $OLLAMA_MODELS)"
  ollama serve >/proc/1/fd/1 2>/proc/1/fd/2 &
  OLLAMA_PID=$!

  i=0
  while [ "$i" -lt 45 ]; do
    if wget -qO- "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
      echo "[hub] Ollama is ready"
      break
    fi
    i=$((i + 1))
    sleep 2
  done
  if ! kill -0 "$OLLAMA_PID" 2>/dev/null; then
    echo "[hub] WARNING: Ollama process exited early — cloud providers still work"
  fi
else
  echo "[hub] WARNING: ollama binary not found in image — Local AI disabled; cloud providers still work"
fi

echo "[hub] Starting Personal AI Hub on 0.0.0.0:${PORT:-8080}"
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node index.js
