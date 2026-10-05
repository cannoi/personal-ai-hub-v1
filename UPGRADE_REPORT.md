# v1.7.1 — Admin login UI gate

## Problem
`AI_HUB_ADMIN_PASSWORD` was in SoloHost config/compose, and API had `/api/v1/admin/login`,
but the SPA still loaded fully without prompting for a password (anyone with the public URL could use the control UI).

## Fix
1. **Login overlay** (`#login-gate`) when `passwordConfigured && !authenticated`
2. `fetch` / `json()` uses **`credentials: 'include'`** so HttpOnly session cookie is sent
3. **Logout** button when password mode is on
4. Boot waits for `GET /api/v1/admin/session` before loading dashboard
5. Control-plane routes still use `requireAdmin` (401 without session)

## Data plane (unchanged)
OpenAI `/v1/*` and chat with gateway token do **not** use admin password.

## Tests
- `node test.js` / `node test-security.js` (existing)
