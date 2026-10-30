# v1.8.12 — UI click fix + SoloHost config cleanup

## Root cause (Settings / Chat / AI panel dead)
1. `public/ai-panel.js` — corrupted `loadGateway()` left an unclosed template literal → entire panel script failed to parse.
2. `public/index.html` — broken escape sequence in curl sample string → second inline script failed.
3. `settings-btn` / `chat-nav-btn` handlers were overwritten after correct binding, routing everything through the broken AI panel.

## Fixes
- Rewrote `loadGateway()` with plain string concat (no broken templates).
- Fixed curl sample construction via array join.
- Restored Settings → settings-panel, Chat → main chat panel; FAB remains for AI panel.
- SoloHost install: only Admin password + HOST_PORT (default 59971). Removed PUBLIC_BASE_URL from startup form.
- Knowledge updated; Feedback Hub still hardcoded in source.

## Tests
- node --check all public JS + inline scripts OK
- test-smart-router, test.js PASS
