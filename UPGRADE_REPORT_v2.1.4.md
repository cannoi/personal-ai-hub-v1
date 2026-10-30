# Personal AI Hub v2.1.4 — Managed Local AI startup fix

Date: 2026-10-21

## Root cause confirmed from source

The v2.1.3 Dockerfile defaulted to `WITH_OLLAMA=0`, so the published/default image skipped installing the `ollama` executable. It also set `ENABLE_MANAGED_OLLAMA=0`, while the SoloHost compose template did not enable managed startup. The UI could therefore reach the Hub but the local-model download endpoint had no Ollama service listening on `127.0.0.1:11434`. Worse, a failed Ollama binary download during a build was previously swallowed with `exit 0`, allowing an image without the binary to be built.

## Completed in v2.1.4

- Changed the standard Docker build default to `WITH_OLLAMA=1`.
- Changed the production runtime default to `ENABLE_MANAGED_OLLAMA=1` and explicitly enabled it in the SoloHost compose template.
- Kept Ollama bound to container loopback (`127.0.0.1:11434`); the Ollama port is not published to the host or other containers.
- Kept model pulling user-triggered only; no large model is downloaded at container startup. Existing persistent model volume `personal-ai-ollama-data:/app/ollama-data` is preserved.
- Added retry-on-transient-failure to the Ollama release download, made enabled installation failures fail the image build, fail on unsupported CPU architecture, and verify that `/usr/local/bin/ollama` exists and executes before proceeding.
- Updated the user-facing Local AI diagnostic hint to direct the operator to startup logs and `/health/deep` and state the two required build/runtime settings.
- Preserved the explicit cloud-only/external Ollama escape hatch (`WITH_OLLAMA=0` and/or `ENABLE_MANAGED_OLLAMA=0`).
- Bumped active release metadata to `2.1.4`.
- Added four managed-Ollama regression tests, including a local HTTP probe test that verifies `ensureOllama()` detects an already-running service without starting a duplicate daemon.

## Validation performed

- Baseline `npm test` on the unmodified v2.1.3 source: passed before edits.
- Final `npm test`: passed all configured suites, including 4 new managed-Ollama tests.
- JavaScript syntax scan: passed for all `.js`, `.cjs`, and `.mjs` files outside `node_modules`.
- JSON syntax validation: passed for `package.json`, `package-lock.json`, `models.catalog.json`, and EN/VI locale JSON files.
- Docker/Compose validation could not be run because Docker and Podman are unavailable; regression tests statically verify the relevant Compose settings.
- ZIP integrity checked with `unzip -t`; release archive excludes `node_modules`, `.git`, runtime data, and secret files.

## Preserved / intentionally not changed

- `lib/feedback-module/feedback-service.cjs` — unchanged.
- `public/feedback-module.js` — unchanged.
- `config_options.yml` — unchanged.
- Existing gateway routes, token behavior, model routing, EN/VI locale content, and data volume names — unchanged except release version metadata and explicit managed Ollama environment flag.
- No host Docker socket, privileged mode, or exposed Ollama port added.

## Not verified / remaining

- A real Docker image build and live SoloHost/GHCR deployment could not be executed in this environment because Docker/Podman are unavailable. The regression suite verifies build configuration statically, not the remote release download or final image contents.
- A real model pull and inference against Ollama were not run; this requires a built image with network access and sufficient disk/RAM/CPU.
- The new image must be built and published/redeployed before the existing deployment can benefit. Updating source files alone cannot repair an already-running old image.
- This does not install Ollama on the Windows host; Ollama runs inside the Hub container. Model files are downloaded only after the user requests a model.

## Changed files

`Dockerfile`, `index.js`, `docker-compose.yml`, `ai-app-kernel/src/local.js`, `package.json`, `package-lock.json`, `lib/app-adapter.cjs`, `test-v2-core.js`, `test-managed-ollama-v2.1.4.js`, `README.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`, and this report.
