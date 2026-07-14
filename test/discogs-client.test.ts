import { afterEach, describe, expect, it, vi } from "vitest";
import { CachedDiscogsClient } from "../src/clients/cached-discogs.js";
import { DiscogsClient, RateLimitError } from "../src/clients/discogs.js";

function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => {
      const v = store.get(key);
      return v === undefined ? null : JSON.parse(v);
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CachedDiscogsClient.withCache single-flight", () => {
  it("joins concurrent misses on the same key into one fetch", async () => {
    const client = new CachedDiscogsClient({ kind: "token", token: "x" }, fakeKV());
    let calls = 0;
    const slowFetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { value: 42 };
    };

    const [a, b, c] = await Promise.all([
      client.withCache("sf-test", 60, slowFetcher),
      client.withCache("sf-test", 60, slowFetcher),
      client.withCache("sf-test", 60, slowFetcher),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual({ value: 42 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("does not join distinct keys", async () => {
    const client = new CachedDiscogsClient({ kind: "token", token: "x" }, fakeKV());
    let calls = 0;
    const fetcher = async () => ({ n: ++calls });
    await Promise.all([client.withCache("k1", 60, fetcher), client.withCache("k2", 60, fetcher)]);
    expect(calls).toBe(2);
  });

  it("clears the in-flight slot after a failure so the next call can retry", async () => {
    const client = new CachedDiscogsClient({ kind: "token", token: "x" }, fakeKV());
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("boom");
    };
    await expect(client.withCache("fail-key", 60, failing)).rejects.toThrow("boom");
    await expect(client.withCache("fail-key", 60, async () => ({ ok: true }))).resolves.toEqual({ ok: true });
    expect(calls).toBe(1);
  });
});

describe("DiscogsClient 429 handling", () => {
  class TestClient extends DiscogsClient {
    fetchPublic<R>(path: string): Promise<R> {
      return this.request<R>(path);
    }
  }

  it("throws RateLimitError immediately on 429 — no automatic retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 429, headers: { "Retry-After": "42" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TestClient({ kind: "token", token: "x" });
    await expect(client.fetchPublic("/releases/1")).rejects.toThrow(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.rateLimitRemaining).toBe(0);
  });

  it("surfaces the server's Retry-After on the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "42" } }))
    );
    const client = new TestClient({ kind: "token", token: "x" });
    const err = await client.fetchPublic("/releases/1").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(42);
  });

  it("tracks the remaining budget from response headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "X-Discogs-Ratelimit-Remaining": "37" },
        })
      )
    );
    const client = new TestClient({ kind: "token", token: "x" });
    await client.fetchPublic("/releases/1");
    expect(client.rateLimitRemaining).toBe(37);
  });
});
