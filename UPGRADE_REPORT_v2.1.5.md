# Personal AI Hub v2.1.5 — GitHub Actions npm lockfile fix

Date: 2026-10-21

## Root cause

The supplied GitHub Actions log shows Docker failing during `RUN npm ci --omit=dev` because `package-lock.json` referenced `https://registry.npmjs.org/ms/-/ms-2.1.4.tgz`, and the registry returned HTTP 404. This is a lockfile/dependency resolution failure, not an Ollama inference failure.

## Changes made

- Bumped the app/package release metadata to `2.1.5`.
- Added npm override `"overrides": { "ms": "2.1.3" }` so transitive dependencies use the available `ms@2.1.3` release rather than the unavailable `2.1.4` tarball.
- Aligned `package-lock.json` entries for `send` and `node_modules/send/node_modules/ms` with `ms@2.1.3` and its published tarball URL; removed all lock references to `ms-2.1.4.tgz`.
- Added `test-npm-lock-v2.1.5.js` and included it in `npm test` to prevent the exact regression.
- Kept the v2.1.4 Managed Ollama defaults and startup implementation, the SoloHost compose layout, private loopback Ollama endpoint, EN/VI quality behavior, AI Gateway routes, and existing Feedback Hub.

## Validation performed

- `npm test`: PASS. All configured suites completed, including core, gateway, OpenAI compatibility, smart routing, security, AI quality, Managed Ollama, and the new lockfile regression tests.
- New lockfile regression tests: 2/2 PASS.
- Managed Ollama tests: 4/4 PASS.
- JavaScript syntax scan: PASS (all `.js`, `.cjs`, and `.mjs` files outside runtime/dependency directories).
- JSON parse checks for `package.json`, `package-lock.json`, and `models.catalog.json`: PASS.
- Version synchronization: package.json, lockfile and application metadata updated to 2.1.5.
- ZIP integrity and secret/runtime-file exclusion: PASS.
- Feedback Hub and SoloHost config preservation: checked against v2.1.4 source for `lib/feedback-module/feedback-service.cjs`, `public/feedback-module.js`, and `config_options.yml`; content hashes unchanged.

## Not verified in this environment

- A real Docker image build and GitHub Actions rerun were not performed in this environment. The reported npm failure is directly addressed in the lockfile and covered by regression tests, but only a new CI run can confirm the hosted runner completes the entire Docker build.
- No live provider API calls or real model download/inference test was performed.

## Files intentionally changed

- `package.json`, `package-lock.json`
- `index.js`, `lib/app-adapter.cjs`
- `README.md`, `RELEASE_NOTES.md`, `CHANGELOG.md`
- `test-v2-core.js`, `test-npm-lock-v2.1.5.js`
- `UPGRADE_REPORT_v2.1.5.md`

No Feedback Hub implementation, SoloHost `config_options.yml`, gateway route behavior, provider credentials, or runtime user data was intentionally changed.
