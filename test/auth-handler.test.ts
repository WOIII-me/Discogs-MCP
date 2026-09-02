import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscogsAuthHandler } from "../src/auth/handler.js";
import { DiscogsOAuthError, getRequestToken } from "../src/auth/discogs-oauth.js";
import type { Env } from "../src/types/env.js";

function throttledFetch(retryAfter?: string) {
  return vi.fn().mockResolvedValue(
    new Response('{"message":"You are making requests too quickly."}', {
      status: 429,
      headers: retryAfter ? { "Retry-After": retryAfter } : {},
    })
  );
}

function authorizeEnv(kvPut = vi.fn().mockResolvedValue(undefined)): Env {
  return {
    DISCOGS_CONSUMER_KEY: "ck",
    DISCOGS_CONSUMER_SECRET: "cs",
    CACHE_KV: { put: kvPut, get: vi.fn().mockResolvedValue(null) },
    OAUTH_PROVIDER: {
      parseAuthRequest: vi.fn().mockResolvedValue({ clientId: "ext", scope: [] }),
    },
  } as unknown as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Discogs OAuth request-token failures", () => {
  it("surfaces a 429 (after the built-in backoff) as a typed, rate-limited error", async () => {
    vi.useFakeTimers();
    const fetchMock = throttledFetch("120");
    vi.stubGlobal("fetch", fetchMock);

    const pending = getRequestToken("ck", "cs", "https://x/callback");
    const settled = pending.catch((e) => e);
    await vi.runAllTimersAsync(); // drain the 1s/2s/4s retry sleeps
    const err = await settled;

    expect(err).toBeInstanceOf(DiscogsOAuthError);
    expect((err as DiscogsOAuthError).isRateLimited).toBe(true);
    expect((err as DiscogsOAuthError).retryAfter).toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 attempt + 3 retries, then give up
  });
});

describe("/authorize when Discogs throttles the login endpoint", () => {
  it("answers 503 + Retry-After with an explanation, and flags the throttle in KV", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", throttledFetch("60"));
    const kvPut = vi.fn().mockResolvedValue(undefined);
    const env = authorizeEnv(kvPut);

    const pending = DiscogsAuthHandler.fetch!(
      new Request("https://worker.test/authorize?client_id=ext&redirect_uri=x"),
      env,
      {} as ExecutionContext
    );
    await vi.runAllTimersAsync();
    const res = await pending;

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.text()).toMatch(/throttling logins/i);
    // The health endpoint reads this flag to explain the outage to clients
    expect(kvPut).toHaveBeenCalledWith(
      "login-throttle:discogs",
      expect.stringContaining('"retryAfter":60'),
      expect.objectContaining({ expirationTtl: 60 })
    );
  });

  it("still fails loudly (500) on non-rate-limit Discogs errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Invalid consumer.", { status: 401 }))
    );
    const res = await DiscogsAuthHandler.fetch!(
      new Request("https://worker.test/authorize?client_id=ext"),
      authorizeEnv(),
      {} as ExecutionContext
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/Discogs OAuth error 401/);
  });
});
