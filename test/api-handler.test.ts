import { describe, expect, it, vi } from "vitest";
import { handleApi } from "../src/api/handler.js";
import type { DiscogsProps, Env } from "../src/types/env.js";

const env = {} as unknown as Env; // health/OPTIONS/401 paths don't touch bindings

/** A Worker-issued token summary as unwrapToken would return it. */
function tokenSummary(props: Partial<DiscogsProps> = {}) {
  return {
    id: "tok",
    grantId: "grant",
    userId: "vinylfan",
    createdAt: 0,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    scope: [],
    grant: {
      clientId: "client",
      scope: [],
      props: {
        username: "vinylfan",
        userId: 42,
        accessToken: "discogs-token",
        accessTokenSecret: "discogs-secret",
        ...props,
      },
    },
  };
}

/** Env with a mocked OAuth provider and an empty identity cache. */
function mockedEnv(overrides: Partial<Env> = {}): Env {
  return {
    DISCOGS_CONSUMER_KEY: "ck",
    DISCOGS_CONSUMER_SECRET: "cs",
    CACHE_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    OAUTH_PROVIDER: {
      unwrapToken: vi.fn().mockResolvedValue(tokenSummary()),
    },
    ...overrides,
  } as unknown as Env;
}

describe("REST API handler", () => {
  it("answers CORS preflight with 204 and CORS headers", async () => {
    const res = await handleApi(
      new Request("https://x/api/analyze", { method: "OPTIONS", headers: { Origin: "chrome-extension://abc" } }),
      env
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abc");
    expect(res.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
  });

  it("serves an unauthenticated health check", async () => {
    const res = await handleApi(new Request("https://x/api/health"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "discogs-mcp" });
  });

  it("rejects requests without a Bearer token", async () => {
    const res = await handleApi(new Request("https://x/api/analyze?release=1"), env);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toMatch(/Bearer/);
  });

  it("accepts a Worker-issued OAuth token and answers /api/whoami from props", async () => {
    const e = mockedEnv();
    const res = await handleApi(
      new Request("https://x/api/whoami", { headers: { Authorization: "Bearer user:grant:secret" } }),
      e
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: "vinylfan" });
    expect(e.OAUTH_PROVIDER.unwrapToken).toHaveBeenCalledWith("user:grant:secret");
    // Identity came from decrypted props — no Discogs identity lookup cached
    expect(e.CACHE_KV.get).not.toHaveBeenCalled();
  });

  it("rejects an expired/unknown Worker token without retrying it as a PAT", async () => {
    const e = mockedEnv();
    (e.OAUTH_PROVIDER.unwrapToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await handleApi(
      new Request("https://x/api/whoami", { headers: { Authorization: "Bearer user:grant:stale" } }),
      e
    );
    expect(res.status).toBe(401);
    expect(e.CACHE_KV.get).not.toHaveBeenCalled(); // PAT path never ran
  });

  it("answers /api/whoami for a PAT via the cached identity path", async () => {
    const e = mockedEnv();
    (e.CACHE_KV.get as ReturnType<typeof vi.fn>).mockResolvedValue({ username: "patuser", userId: 7 });
    const res = await handleApi(
      new Request("https://x/api/whoami", { headers: { Authorization: "Bearer plainpat123" } }),
      e
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: "patuser" });
    expect(e.OAUTH_PROVIDER.unwrapToken).not.toHaveBeenCalled();
  });

  it("enforces the allowlist on Worker-token identities", async () => {
    const e = mockedEnv({ ALLOWED_DISCOGS_USERS: "someoneelse" });
    const res = await handleApi(
      new Request("https://x/api/whoami", { headers: { Authorization: "Bearer user:grant:secret" } }),
      e
    );
    expect(res.status).toBe(403);
  });
});
