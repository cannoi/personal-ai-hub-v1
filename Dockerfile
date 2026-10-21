# Personal AI Hub with *managed* Ollama in the same container.
# Avoids broken/empty ollama/ollama sidecar images on SoloHost (0-byte pulls).
# No docker.sock. No host install. Models persist on /app/ollama-data volume.

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget zstd \
    && rm -rf /var/lib/apt/lists/*

# Install full Ollama package (binary + llama-server libs).
# Assets are .tar.zst as of Ollama v0.40.x — must install lib tree or chat fails with
# "llama-server binary not found".
ARG TARGETARCH
ARG WITH_OLLAMA=1
ARG OLLAMA_VERSION=v0.40.7
RUN set -eux; \
  if [ "${WITH_OLLAMA}" = "0" ]; then echo "WITH_OLLAMA=0 — skip Ollama install"; exit 0; fi; \
  arch="${TARGETARCH:-amd64}"; \
  case "$arch" in \
    amd64|x86_64) arch=amd64 ;; \
    arm64|aarch64) arch=arm64 ;; \
    *) echo "WARN: unsupported arch $arch for Ollama — Local AI disabled"; exit 0 ;; \
  esac; \
  url="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-linux-${arch}.tar.zst"; \
  echo "Downloading Ollama ${OLLAMA_VERSION} for ${arch}: $url"; \
  if ! curl -fsSL -o /tmp/ollama.tar.zst "$url"; then \
    echo "WARN: Ollama download failed — Local AI disabled (cloud providers still work)"; \
    exit 0; \
  fi; \
  mkdir -p /tmp/ollama-extract /usr/local/bin /usr/lib/ollama /usr/local/lib/ollama; \
  tar --use-compress-program=zstd -xf /tmp/ollama.tar.zst -C /tmp/ollama-extract; \
  # Layout varies: ./bin/ollama + ./lib/ollama/*  OR nested dist paths
  if [ -f /tmp/ollama-extract/bin/ollama ]; then \
    install -m755 /tmp/ollama-extract/bin/ollama /usr/local/bin/ollama; \
  elif [ -f /tmp/ollama-extract/ollama ]; then \
    install -m755 /tmp/ollama-extract/ollama /usr/local/bin/ollama; \
  else \
    find /tmp/ollama-extract -type f -name ollama -executable -exec install -m755 {} /usr/local/bin/ollama \; ; \
  fi; \
  # Install ALL companion libs (llama-server, runners, .so) where ollama searches
  if [ -d /tmp/ollama-extract/lib/ollama ]; then \
    cp -a /tmp/ollama-extract/lib/ollama/. /usr/lib/ollama/; \
    cp -a /tmp/ollama-extract/lib/ollama/. /usr/local/lib/ollama/; \
  elif [ -d /tmp/ollama-extract/lib ]; then \
    cp -a /tmp/ollama-extract/lib/. /usr/lib/ollama/; \
    cp -a /tmp/ollama-extract/lib/. /usr/local/lib/ollama/; \
  fi; \
  # Also copy any loose llama-server found in the archive
  find /tmp/ollama-extract -type f \( -name 'llama-server' -o -name 'ollama_llama_server' \) -exec cp -a {} /usr/local/lib/ollama/ \; || true; \
  find /tmp/ollama-extract -type f \( -name 'llama-server' -o -name 'ollama_llama_server' \) -exec cp -a {} /usr/lib/ollama/ \; || true; \
  chmod +x /usr/local/bin/ollama 2>/dev/null || true; \
  chmod +x /usr/local/lib/ollama/llama-server 2>/dev/null || true; \
  chmod +x /usr/lib/ollama/llama-server 2>/dev/null || true; \
  echo "=== ollama install layout ==="; \
  ls -la /usr/local/bin/ollama || true; \
  ls -la /usr/lib/ollama 2>/dev/null | head -20 || true; \
  ls -la /usr/local/lib/ollama 2>/dev/null | head -20 || true; \
  /usr/local/bin/ollama --version || echo "WARN: ollama --version failed at build time"; \
  rm -rf /tmp/ollama.tar.zst /tmp/ollama-extract

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /app/data /app/ollama-data

ENV PORT=8080 \
    SERVICE_NAME=personal-ai-hub \
    DATA_DIR=/app/data \
    NODE_ENV=production \
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_MODELS=/app/ollama-data \
    OLLAMA_BASE_URL=http://127.0.0.1:11434 \
    OLLAMA_SERVICE= \
    AI_HUB_SKIP_OLLAMA_WAIT=1 \
    ENABLE_MANAGED_OLLAMA=1 \
    LD_LIBRARY_PATH=/usr/lib/ollama:/usr/local/lib/ollama

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "index.js"]
