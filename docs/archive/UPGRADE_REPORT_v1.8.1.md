# v1.8.1 — SoloHost Feedback Hub UI integration

## Done
- Embedded `public/shfh-client.js` (Feedback Hub module)
- `GET /api/shfh-config` — defaults built-in (hub URL, ingest token, appId); env overrides optional
- `POST /api/shfh-proxy` — same-origin proxy for mixed-content safety
- Main header **Feedback** button + badge for unread notices
- Panel: **Donate** account text from Hub policy, **unread notices**, **send feedback** form
- No user configuration required

## Defaults
- Hub: `http://14.176.78.46:8090`
- Hub ID: `SHFH-CANNOI-0905428801`
- App ID: `personal-ai-hub`

## Unchanged
AI Gateway, routing, Ollama, providers, admin login, OpenAI `/v1`, vault

## Not done
- Full payment/reportPayment UI (SDK supports it; not required for this UX)
- Live E2E against remote Feedback Hub depends on network from device
