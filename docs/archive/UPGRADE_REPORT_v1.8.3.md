# Personal AI Hub v1.8.3 — Universal AI + Feedback / Usability Upgrade

## Implemented
- Integrated the Universal AI + Feedback module as an additive AI FAB/panel.
- Kept `ai-app-kernel` as the single AI execution plane; the copied module AI server is not mounted as a second provider/token system.
- Added Chat / Feedback / Settings / Logs panel with unread badge and mobile-friendly layout.
- Added provider-specific setup guidance, including Custom and Local AI instructions.
- Added Mistral, xAI and Custom to the provider UI.
- Removed the legacy browser Feedback Hub configuration/proxy that exposed the ingest token.
- Feedback Hub credentials remain server-side and `/api/feedback/config` is public-safe.
- Added encrypted backup/restore for provider keys, routing/configuration and SoloHost gateway tokens.
- Gateway token raw values are stored encrypted server-side so an encrypted backup can restore them.
- Main dashboard no longer shows unnecessary numeric infrastructure counters; it uses user-oriented guidance instead.
- Added clear SoloHost app connection guidance: use the Hub OpenAI-compatible `/v1` endpoint and a Hub-created app token; provider keys remain inside the Hub.

## Verification
- Existing core tests: PASS.
- Security tests: PASS.
- Gateway upgrade tests: PASS.
- Universal module provider tests: PASS.
- Universal module mock integration tests: PASS.
- Universal module smoke/security test: PASS.
- Encrypted backup export/import regression: PASS.
- Wrong backup password rejection: PASS.
- Feedback public config secret-redaction test: PASS.
- JavaScript syntax sweep: PASS.
- No legacy `/api/shfh-config` or `/api/shfh-proxy` runtime route remains.
- No `shfh-client.js` remains in the runtime public assets.

## Important design decision
The module's standalone `ai-service` is included as reference/source compatibility material, but is intentionally NOT mounted. Personal AI Hub's existing `ai-app-kernel` remains the only AI router/provider/token execution plane. This prevents two competing AI systems and avoids split token/model state.

## Backup security
Backups are encrypted with AES-256-GCM using a passphrase-derived key (PBKDF2-SHA256). The backup file contains provider/gateway secrets only inside the encrypted payload. A backup password of at least 8 characters is required.
