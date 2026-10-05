# UPGRADE REPORT — v1.7.0 Security + multi-app isolation

## Conclusion: SECURE WITH LIMITATIONS

### Findings addressed
| Area | Change |
|------|--------|
| Admin | `AI_HUB_ADMIN_PASSWORD` + HttpOnly session cookie; protects control-plane |
| Gateway tokens | type `app`/`shared`; **UNBOUND → first-use bind** to X-SoloHost-App-ID; mismatch → 403; admin **unbind** |
| Memory / training | Tagged + filtered by `appId` |
| Rate limit | 60/min/token, 10 concurrent (env configurable); health excluded |
| CORS | No `*` with credentials; reflect origin or `AI_HUB_ALLOWED_ORIGINS` |
| SSRF | `security.js` blocks private/metadata URLs (Ollama localhost allowed internally) |
| Secret leakage | Existing redaction kept; admin password never in health/gateway |
| lastUsed writes | Throttled to ≥30s |

### Files changed
- `ai-app-kernel/src/index.js` — gateway bind/unbind, memory isolation
- `ai-app-kernel/src/http.js` — admin guard, rate limit, unbind route
- `ai-app-kernel/src/security.js` — **NEW** rate limit + SSRF helpers
- `openai-compat.js` — app binding on validate
- `index.js` — admin login/logout/session, CORS, security headers
- `docker-compose.yml` — image-only SoloHost + `AI_HUB_ADMIN_PASSWORD`
- `test-security.js` — **NEW** binding/isolation/SSRF tests
- `test.js` — regression OpenAI routes

### Not done / limitations
- Full SPA admin login form (API ready; without password control plane stays open)
- Custom cloud provider URL SSRF not fully wired into every provider add path
- Daily cloud budget (optional) not implemented
- Non-root Docker user not forced (Ollama compatibility)
- No Redis (in-memory rate limit only)

### Tests
- `node test.js` → PASS (OpenAI /v1 HTTP)
- `node test-security.js` → PASS (bind, shared, isolation, SSRF, rate limit)

### SoloHost
```yaml
environment:
  AI_HUB_ADMIN_PASSWORD: "CHANGE_THIS_PASSWORD"
```
Image: `ghcr.io/cannoi/personal-ai-hub-v1:latest` — no build, no docker.sock, no :11434 public.
