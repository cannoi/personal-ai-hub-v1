# Personal AI Hub Hardening and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified IPv4-mapped IPv6 SSRF validation gap and keep dashboard status panels useful when an independent diagnostic request fails.

**Architecture:** Preserve the Express app, AI kernel, static UI, and SoloHost deployment. Harden the shared URL classifier and independently settle dashboard provider, health, Local AI, and activity requests.

**Tech Stack:** Node.js 22 ESM, Express 4, browser JavaScript, Node assert tests.

**Spec:** User-approved focused hardening and polish plan in the conversation.

## Global Constraints

- Preserve existing provider, gateway, Ollama, Feedback Hub, and SoloHost behavior.
- Continue allowing direct loopback URLs only for the managed Local AI endpoint.
- Do not add dependencies, privileged containers, Docker socket access, or architecture changes.

## Review Focus

- IPv4-mapped public IPv6 remains usable while mapped loopback, private, link-local, and unspecified addresses are blocked.
- Direct IPv4 loopback remains allowed only where `allowLocalhost` is true.
- A failure in one dashboard diagnostic request does not prevent successful independent panels from rendering.
- Local AI offline state includes actionable context when the API supplies a hint or error.

---

### Task 1: Close IPv4-mapped IPv6 SSRF gap

**Files:**
- Modify: `ai-app-kernel/src/security.js`
- Modify: `test-security.js`

**Interfaces:**
- Preserve `isPrivateOrBlockedUrl(raw, { allowLocalhost })` and existing URL assertion APIs.

- [ ] Add assertions that mapped loopback/private/link-local/unspecified addresses are blocked, mapped public IPv6 is allowed, and managed direct loopback remains allowed.
- [ ] Run `node test-security.js` and confirm the mapped-private assertions fail before the fix.
- [ ] Normalize IPv4-mapped IPv6 addresses before private IPv4 classification, without changing the `allowLocalhost` exception.
- [ ] Run `node test-security.js` and `npm test`.

### Task 2: Isolate dashboard diagnostics and improve Local AI offline guidance

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Keep existing dashboard element IDs and `/ai/*` endpoints.

- [ ] Change `refreshDashboard()` so each diagnostic panel renders from its own settled request result.
- [ ] Keep the hub health error visible when its request fails; render Local AI's API-provided hint/error in the existing Local AI area when unavailable.
- [ ] Run `node --check` on extracted dashboard script if practical and run `npm test`.

### Task 3: Production verification and report

**Files:**
- No further production code unless verification finds a regression.

- [ ] Run the complete configured test suite.
- [ ] Attempt the production Docker image build; report any Docker daemon/configuration blocker accurately.
- [ ] Review the final changed-file list and report the checkpoint path, fixes, test/build results, and remaining issues.
