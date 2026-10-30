# Personal AI Hub v1.8.4 — Feedback UI Orphan Fix

## Purpose
Fix the main UI being polluted by a non-dismissible Feedback block rendered above the Header, while preserving the v1.8.3 AI/Feedback architecture.

## Root cause
`public/index.html` contained an orphaned fragment of the previous Feedback UI directly under `<body>`. The fragment had lost its original wrapper/opening markup during the universal AI + Feedback panel integration, so it rendered as normal page content before the Header.

## Changes
- Removed only the orphaned legacy Feedback HTML fragment from `public/index.html`.
- Kept the unified Feedback tab inside the single AI panel unchanged.
- Kept the server-side Feedback Hub module unchanged.
- Kept the existing `ai-app-kernel` as the single AI execution plane.
- Bumped application patch version from `1.8.3` to `1.8.4`.
- No provider, gateway, routing, local AI, authentication, health/fallback, backup, or usage-control architecture was rebuilt.

## Verification
- HTML structural parse: PASS.
- Body direct-child inspection: PASS — no orphan Feedback controls before Header.
- Duplicate HTML IDs: PASS.
- Legacy orphan Feedback IDs: PASS — removed.
- Unified AI panel Feedback tab: PASS — retained.
- JavaScript syntax sweep: PASS.
- Existing application tests: PASS.
- Security tests: PASS.
- Gateway upgrade tests: PASS.
- Universal module smoke/provider tests: PASS.
- ZIP integrity: PASS.

## Intentionally unchanged
All existing Personal AI Hub capabilities from v1.8.3 remain intact: AI Gateway, smart routing, provider management, Local AI/Ollama, authentication, health/fallback handling, usage controls, encrypted backup/restore, and the unified AI + Feedback panel.
