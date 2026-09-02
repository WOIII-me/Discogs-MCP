import type { Env } from "../types/env.js";

/**
 * Discogs rate-limits its OAuth endpoints per source IP (~25/min,
 * unauthenticated) — and our source IP is Cloudflare egress, shared with
 * every other Discogs app on Workers. When a login attempt hits that wall we
 * record it here so the health endpoint (and through it the extension) can
 * explain the outage honestly instead of surfacing an opaque failure.
 */

const KEY = "login-throttle:discogs";
const DEFAULT_RETRY_AFTER = 60; // seconds
const MAX_RETRY_AFTER = 600;

export interface LoginThrottle {
  retryAfter: number;
  since: string;
}

export async function markLoginThrottled(env: Env, retryAfter = DEFAULT_RETRY_AFTER): Promise<number> {
  const seconds = Math.min(Math.max(retryAfter || DEFAULT_RETRY_AFTER, DEFAULT_RETRY_AFTER), MAX_RETRY_AFTER);
  const record: LoginThrottle = { retryAfter: seconds, since: new Date().toISOString() };
  await env.CACHE_KV?.put(KEY, JSON.stringify(record), { expirationTtl: seconds });
  return seconds;
}

/** Null when logins are believed healthy (or no KV is bound, e.g. in tests). */
export async function getLoginThrottle(env: Env): Promise<LoginThrottle | null> {
  if (!env.CACHE_KV) return null;
  return (await env.CACHE_KV.get(KEY, "json")) as LoginThrottle | null;
}
