// Best-effort in-memory sliding-window rate limiter.
//
// On serverless (Vercel) this is PER-INSTANCE and resets on cold start, so it
// is NOT the primary defense against credential brute-force — that job belongs
// to the durable, DB-backed account lockout in lib/auth.ts, which holds across
// every instance. This limiter's real value is blunting bursts from a single
// IP and, crucially, throttling the unauthenticated email-send paths
// (forgot-password / resend-verification) so they can't be used to email-bomb
// an address or run up the Resend bill.

type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

/**
 * Record one hit against `key`. Returns whether it is still within `limit`
 * over the trailing `windowMs`, plus seconds until the window resets.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  // Opportunistic GC so the map can't grow unbounded under many distinct keys.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (now >= b.reset) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || now >= b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count++;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}
