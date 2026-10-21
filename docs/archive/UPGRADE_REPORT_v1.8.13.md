# v1.8.13 — Auto public IP + Gateway token management UI

## Public URL (simple for everyone)
- Hub auto-detects public IP via fixed HTTPS services (ipify, ifconfig.me, icanhazip)
- Builds `http://PUBLIC_IP:HOST_PORT/v1` (default port 59971)
- Cache 6h; button **Detect public IP** forces refresh (admin)
- Private/reserved IPs rejected; no metadata/SSRF targets

## Gateway tokens (pah_)
- Dashboard section: Add / list / status / Delete
- Shows clients, today/total usage, bound appId
- Token shown once on create

## Security
- detect-ip requires admin session
- Fixed public echo endpoints only
- Existing vault, rate limit, CORS, token binding unchanged

## Files
- index.js (detectPublicIp, discovery)
- public/index.html (Gateway section + handlers)
- lib/app-adapter.cjs (knowledge)
