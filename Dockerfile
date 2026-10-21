# Personal AI Hub — lean image, CI/smoke safe
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Optional managed Ollama (default OFF)
ARG TARGETARCH=
ARG WITH_OLLAMA=0
ARG OLLAMA_VERSION=v0.40.7
RUN set -eux; \
  if [ "${WITH_OLLAMA}" != "1" ]; then echo "skip Ollama"; exit 0; fi; \
  apt-get update && apt-get install -y --no-install-recommends curl zstd && rm -rf /var/lib/apt/lists/*; \
  arch="${TARGETARCH:-amd64}"; \
  case "$arch" in amd64|x86_64) arch=amd64 ;; arm64|aarch64) arch=arm64 ;; *) exit 0 ;; esac; \
  curl -fsSL -o /tmp/o.tar.zst "https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-linux-${arch}.tar.zst" || exit 0; \
  mkdir -p /tmp/ox /usr/local/bin /usr/lib/ollama; \
  tar --use-compress-program=zstd -xf /tmp/o.tar.zst -C /tmp/ox; \
  if [ -f /tmp/ox/bin/ollama ]; then install -m755 /tmp/ox/bin/ollama /usr/local/bin/ollama; fi; \
  if [ -d /tmp/ox/lib/ollama ]; then cp -a /tmp/ox/lib/ollama/. /usr/lib/ollama/; fi; \
  rm -rf /tmp/o.tar.zst /tmp/ox

# Install production deps — MUST succeed and be importable
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && test -f node_modules/express/package.json \
  && node -e "import('express').then(m => { if (!m.default) process.exit(1); console.log('express', m.default.version || 'ok'); })"

# App source (dockerignore excludes node_modules)
COPY . .
RUN mkdir -p /app/data /app/ollama-data \
  && test -f /app/index.js \
  && node -e "import('express').then(() => console.log('express still ok after COPY'))"

ENV PORT=8080 \
    HOST=0.0.0.0 \
    SERVICE_NAME=personal-ai-hub \
    DATA_DIR=/app/data \
    NODE_ENV=production \
    ENABLE_MANAGED_OLLAMA=0 \
    NODE_OPTIONS=--no-deprecation

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# PID1 = node (no shell). Crash logs go to docker logs.
ENTRYPOINT ["node", "index.js"]
