#!/bin/sh
set -eu
mkdir -p "${DATA_DIR:-/app/data}" "${OLLAMA_MODELS:-/app/ollama-data}" 2>/dev/null || true
exec node index.js
