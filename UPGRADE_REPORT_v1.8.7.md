# v1.8.7 — Hub knowledge adapter + offline local guide

## Goal
Personal AI Hub lacked authoritative in-app knowledge for guiding users (gateway tokens, /v1, keys, Local AI, Feedback). Integrate Universal AI + Feedback pattern **without** a second competing AI execution plane.

## Done
1. **`lib/app-adapter.cjs`**
   - Full **APP KNOWLEDGE** for Personal AI Hub (gateway role, providers, Ollama, pah_ tokens, /v1, admin, Feedback)
   - `getContext()`, safe `actions`, `executeAction()`
   - **`localReply()`** offline guide (Builder connect, keys, local AI, feedback, admin)

2. **Kernel integration** (`ai-app-kernel`)
   - `createAiKernel({ knowledge, localReply, getAppContext })`
   - Chat system prompt includes **APP KNOWLEDGE (authoritative)**
   - On **NO_ACTIVE_KEY** → return `localReply` text (Chat never empty)

3. **index.js** passes adapter into kernel; Feedback module unchanged (token server-only)

4. **UI (already Snake-style)**
   - FAB `#aiFab`, panel tabs Chat | Feedback | Settings | Logs
   - Badge hidden when 0; FAB hide while panel open (CSS `[hidden]`)
   - Donate from Hub sync only

## Intentionally not done
- Mounting standalone `createAIService` `/api/ai/*` as a **second** provider store (would split keys from the Hub gateway vault). Hub keeps **one** execution plane: `ai-app-kernel` + `/v1`.

## Verify
- [x] `node --check` adapter + kernel + index
- [x] localReply returns Builder `/v1` guidance
- [x] knowledge length > 2000 chars
- [x] Feedback config path still server-only token
- [x] FAB/panel CSS rules present

## Limitations
- Live Feedback Hub notices depend on network to Hub URL
- localReply is rule-based (not LLM) until a key is ACTIVE
