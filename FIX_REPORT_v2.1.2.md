# Personal AI Hub v2.1.2 — Fix Report

## Confirmed root cause of the GitHub Actions stopped-container failure
`ai-app-kernel/src/local.js` imported the named export `assertSafeUrl` from `ai-app-kernel/src/security.js`, but that export did not exist. Node ESM validates named imports before running the app and terminates with a `SyntaxError`, so `node index.js` exits immediately. This directly explains why the container was stopped before the Actions smoke test could `docker exec` into it.

## Changes made
- Added the missing `assertSafeUrl` export. It allows loopback for an explicitly configured local Ollama endpoint while rejecting metadata/private-network and non-HTTP(S) targets under the existing URL guard.
- Added `scripts/smoke-test.js`; it launches the real server, polls `/health`, validates `/v1` discovery, and prints captured stdout/stderr if startup fails.
- Added a Docker build-time `RUN node /app/scripts/smoke-test.js`, so future import/runtime startup failures stop the build with diagnostic logs instead of appearing only as an exited container in a later smoke-test step.
- Fixed `package-lock.json` root version metadata that still said `1.8.14` while `package.json` identified `2.1.0`.
- Bumped release metadata to `2.1.2` and updated README, changelog, and release notes.

## Validation results
- PASS: `node --check` for `index.js`, `scripts/smoke-test.js`, and `ai-app-kernel/src/security.js`.
- PASS: `test-v2-core.js` — 9 checks.
- PASS: `test-v2.1-auth.js` — ranking checks.
- PASS: `test-openai-contract.js`.
- PASS: `test-security.js`.
- PASS: `test-smart-router.js`.
- FAIL / needs separate investigation: `test-gateway-upgrade.js` returns HTTP 400 for its streaming chat assertion (expected 200). This test path is not touched by the startup-import fix; it remains an outstanding regression and is explicitly not claimed as fixed.
- Not run: a full Docker image build/runtime smoke test. The execution environment could not complete a clean npm dependency install, so the new build-time smoke test still needs to be verified by GitHub Actions.

## Scope and preservation
No UI layout, English/Vietnamese translation content, provider routing strategy, API contract implementation, stored user data, or SoloHost compose behavior was intentionally changed beyond release version metadata. The uploaded ZIP did not contain `.github/workflows`, so the existing Actions workflow itself could not be edited; the Dockerfile now performs the startup smoke check during image build.
