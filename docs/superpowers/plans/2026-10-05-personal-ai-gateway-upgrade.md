# Personal AI Hub Gateway Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Personal AI Hub into a broadly usable OpenAI-compatible AI Gateway with routing, authentication, health/fallback, and enforceable usage controls while preserving existing app/UI behavior.

**Architecture:** Keep the existing AI kernel, provider vault, routing, memory, admin UI, and SoloHost integration. Strengthen only the API gateway and shared kernel interfaces needed for compatibility, quotas, usage accounting, and health state. New gateway features are backward-compatible with existing `/api/v1/*` and `/v1/chat/completions` clients.

**Tech Stack:** Node.js ESM, Express 4, native fetch, JSON-file state, Node assert tests.

**Spec:** User-approved in-chat design for Personal AI Hub Gateway + Routing + Local AI + Provider management + authentication + health/fallback + usage control.

## Global Constraints

- Preserve existing UI, provider management, Local AI, routing, memory, SDK, SoloHost integration, and native `/api/v1/*` behavior unless required for shared gateway correctness.
- Provider secrets remain in the existing vault; never expose them through gateway responses or logs.
- Gateway clients authenticate with `Authorization: Bearer pah_*` or `X-Personal-AI-Key` and optional `X-SoloHost-App-ID` binding.
- `stream=false` remains backward-compatible; `stream=true` adds SSE compatibility without requiring upstream streaming.
- Usage limits apply to OpenAI-compatible gateway traffic as well as the existing native chat gateway.
- No docker.sock, privileged mode, destructive commands, or package-format changes.

## Review Focus

- Missing/invalid gateway credentials must return standards-shaped 401/403 errors without leaking secrets.
- Per-token/per-app rate and concurrency limits must apply to `/v1/chat/completions`, `/v1/responses`, and `/v1/embeddings`.
- Streaming clients must receive valid SSE chunks and `[DONE]` without changing non-streaming behavior.
- Provider/model failures must preserve existing fallback behavior and record usage only for successful requests.
- Restart/version/discovery responses must consistently advertise the package version and available compatibility endpoints.

### Task 1: Gateway usage limits and accounting

**Files:**
- Modify: `ai-app-kernel/src/security.js`
- Modify: `ai-app-kernel/src/index.js`
- Modify: `ai-app-kernel/src/http.js`
- Test: `test-gateway-upgrade.js`

**Interfaces:**
- Add a reusable per-key rate/concurrency limiter with cleanup-safe release.
- Add kernel gateway usage methods for recording and querying request/token counters.

- [ ] Write failing tests for gateway rate limiting, usage accounting, and quota rejection.
- [ ] Run the new test and confirm the expected failures.
- [ ] Implement minimal limiter/usage APIs.
- [ ] Run tests and confirm pass.

### Task 2: OpenAI-compatible chat/response/embedding surface

**Files:**
- Modify: `openai-compat.js`
- Modify: `ai-app-kernel/src/providers.js`
- Modify: `ai-app-kernel/src/index.js`
- Test: `test-gateway-upgrade.js`

**Interfaces:**
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- SSE for `stream=true` on chat completions.

- [ ] Write failing tests for routes, SSE shape, usage fields, responses mapping, and embeddings.
- [ ] Run and verify RED.
- [ ] Implement provider usage extraction and compatible gateway endpoints.
- [ ] Run tests and verify GREEN.

### Task 3: Authentication hardening and discovery consistency

**Files:**
- Modify: `openai-compat.js`
- Modify: `index.js`
- Test: `test-gateway-upgrade.js`

**Interfaces:**
- Reject API keys in query parameters.
- Keep browser same-origin exception only where existing UI requires it.
- Add gateway request IDs and standard errors.
- Make `/version` and `/api/v1/gateway` report package version and full gateway capabilities.

- [ ] Add failing tests for query-key rejection, request IDs, version consistency, and capability discovery.
- [ ] Run and verify RED.
- [ ] Implement hardening and discovery updates.
- [ ] Run tests and verify GREEN.

### Task 4: Regression verification and package integrity

**Files:**
- Modify: `test.js`
- Modify: `test-security.js`
- Modify: `package.json` only if needed for tests.
- Create: `UPGRADE_REPORT_v1.8.0.md`

- [ ] Run existing tests before final packaging.
- [ ] Run new gateway tests.
- [ ] Run syntax checks across all JS files.
- [ ] Verify ZIP file count and manifest against the working tree.
- [ ] Package the complete app without dropping existing files.
- [ ] Report completed, intentionally unchanged, and not-implemented items.
