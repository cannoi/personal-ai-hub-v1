/**
 * Lightweight security helpers: rate limit (in-memory), SSRF URL checks.
 */
const buckets = new Map(); // key -> { count, resetAt, concurrent }

// Periodic cleanup so Map does not grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now && b.concurrent === 0) buckets.delete(k);
  }
}, 120_000).unref?.();

export function createRateLimiter({
  perMinute = 60,
  maxConcurrent = 10
} = {}) {
  // Each limiter gets its own Map so admin login and gateway do not share counters
  const localBuckets = new Map();
  return {
    tryAcquire(tokenId) {
      const id = tokenId || 'anonymous';
      const now = Date.now();
      let b = localBuckets.get(id);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + 60_000, concurrent: 0 };
        localBuckets.set(id, b);
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
    },
    // Expose for tests / admin diagnostics
    _size() { return localBuckets.size; }
  };
}

const BLOCKED_HOSTS = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'metadata.google.internal', 'metadata'
]);

function isPrivateIpv4(host) {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function mappedIpv4(host) {
  // WHATWG URL canonicalizes IPv4-mapped IPv6 into two hexadecimal words.
  const m = host.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i);
  if (!m) return null;
  const high = Number.parseInt(m[1], 16);
  const low = Number.parseInt(m[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

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
  const mapped = mappedIpv4(host);
  if (mapped && isPrivateIpv4(mapped)) return true;
  // IPv4 private / link-local / metadata
  if (isPrivateIpv4(host)) return true;
  // IPv6 local/private rough check
  if (host.includes(':')) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  }
  return false;
}

/**
 * Validate a manually configured local-model endpoint.
 * Loopback is allowed for Ollama running in this container; other private,
 * link-local, metadata and non-HTTP(S) targets remain blocked.
 */
export function assertSafeUrl(url) {
  if (isPrivateOrBlockedUrl(url, { allowLocalhost: true })) {
    const e = new Error('URL_BLOCKED');
    e.statusCode = 400;
    throw e;
  }
}

export function assertSafeProviderUrl(url) {
  if (isPrivateOrBlockedUrl(url, { allowLocalhost: false })) {
    const e = new Error('PROVIDER_URL_BLOCKED');
    e.statusCode = 400;
    throw e;
  }
}
