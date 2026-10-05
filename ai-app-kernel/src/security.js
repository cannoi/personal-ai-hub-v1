/**
 * Lightweight security helpers: rate limit (in-memory), SSRF URL checks.
 */
const buckets = new Map(); // key -> { count, resetAt, concurrent }

export function createRateLimiter({
  perMinute = 60,
  maxConcurrent = 10
} = {}) {
  return {
    tryAcquire(tokenId) {
      const id = tokenId || 'anonymous';
      const now = Date.now();
      let b = buckets.get(id);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + 60_000, concurrent: 0 };
        buckets.set(id, b);
      }
      if (b.concurrent >= maxConcurrent) {
        return { ok: false, status: 429, retryAfter: 1, reason: 'CONCURRENT_LIMIT' };
      }
      if (b.count >= perMinute) {
        const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
        return { ok: false, status: 429, retryAfter, reason: 'RATE_LIMIT' };
      }
      b.count += 1;
      b.concurrent += 1;
      return { ok: true, release: () => { b.concurrent = Math.max(0, b.concurrent - 1); } };
    }
  };
}

const BLOCKED_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'metadata.google.internal', 'metadata'
]);

export function isPrivateOrBlockedUrl(raw, { allowLocalhost = false } = {}) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return true; // invalid = blocked
  }
  if (!['http:', 'https:'].includes(u.protocol)) return true;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (allowLocalhost && (host === '127.0.0.1' || host === 'localhost' || host === '::1')) {
    return false;
  }
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  // IPv4 private / link-local / metadata
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // IPv6 local/private rough check
  if (host.includes(':')) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  }
  return false;
}

export function assertSafeProviderUrl(url) {
  if (isPrivateOrBlockedUrl(url, { allowLocalhost: false })) {
    const e = new Error('PROVIDER_URL_BLOCKED');
    e.statusCode = 400;
    throw e;
  }
}
