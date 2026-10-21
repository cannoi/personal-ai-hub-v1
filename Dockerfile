# Personal AI Hub — production image with managed Local AI enabled by default.
# Override WITH_OLLAMA=0 only for an intentionally cloud-only/lean build.
FROM node:22-bookworm-slim

WORKDIR /app

# Base OS dependencies; curl/zstd are installed only for managed-Ollama builds
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Managed Ollama runtime (enabled by default for functional Local AI downloads)
ARG TARGETARCH
ARG WITH_OLLAMA=1
ARG OLLAMA_VERSION=v0.40.7
RUN set -eux; \
  if [ "${WITH_OLLAMA}" != "1" ]; then \
    echo "WITH_OLLAMA!=1 — intentionally skipping Ollama (cloud-only image)"; \
    exit 0; \
  fi; \
  apt-get update && apt-get install -y --no-install-recommends curl zstd \
    && rm -rf /var/lib/apt/lists/*; \
  arch="${TARGETARCH:-amd64}"; \
  case "$arch" in amd64|x86_64) arch=amd64 ;; arm64|aarch64) arch=arm64 ;; \
    *) echo "ERROR: unsupported architecture for managed Ollama: $arch (use amd64/arm64 or build with WITH_OLLAMA=0)"; exit 1 ;; esac; \
  url="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-linux-${arch}.tar.zst"; \
  curl --retry 3 --retry-delay 2 --retry-all-errors -fsSL -o /tmp/ollama.tar.zst "$url"; \
  mkdir -p /tmp/ox /usr/local/bin /usr/lib/ollama /usr/local/lib/ollama; \
  tar --use-compress-program=zstd -xf /tmp/ollama.tar.zst -C /tmp/ox; \
  if [ -f /tmp/ox/bin/ollama ]; then install -m755 /tmp/ox/bin/ollama /usr/local/bin/ollama; \
  elif [ -f /tmp/ox/ollama ]; then install -m755 /tmp/ox/ollama /usr/local/bin/ollama; \
  else find /tmp/ox -type f -name ollama -executable -exec install -m755 {} /usr/local/bin/ollama \; ; fi; \
  if [ -d /tmp/ox/lib/ollama ]; then cp -a /tmp/ox/lib/ollama/. /usr/lib/ollama/; cp -a /tmp/ox/lib/ollama/. /usr/local/lib/ollama/; \
  elif [ -d /tmp/ox/lib ]; then cp -a /tmp/ox/lib/. /usr/lib/ollama/; cp -a /tmp/ox/lib/. /usr/local/lib/ollama/; fi; \
  rm -rf /tmp/ollama.tar.zst /tmp/ox; \
  test -x /usr/local/bin/ollama; \
  /usr/local/bin/ollama --version

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /app/data /app/ollama-data \
  && test -f /app/index.js \
  && test -d /app/node_modules/express \
  && node --check /app/index.js

ENV PORT=8080 \
    SERVICE_NAME=personal-ai-hub \
    DATA_DIR=/app/data \
    NODE_ENV=production \
    ENABLE_MANAGED_OLLAMA=1 \
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_MODELS=/app/ollama-data \
    OLLAMA_BASE_URL=http://127.0.0.1:11434 \
    LD_LIBRARY_PATH=/usr/lib/ollama:/usr/local/lib/ollama

EXPOSE 8080

# Node-only healthcheck (no wget dependency)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exercise the real server startup during image build so import/runtime crashes fail early.
RUN node /app/scripts/smoke-test.js

# Direct Node as PID1 — no shell entrypoint that can mask exit codes
ENTRYPOINT ["node", "index.js"]
