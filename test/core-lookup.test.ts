import { describe, expect, it } from "vitest";
import { analyzeRelease } from "../src/core/lookup.js";
import type { CoreContext } from "../src/core/pressings.js";
import type { CachedDiscogsClient } from "../src/clients/cached-discogs.js";
import { makeRelease, mfslPressing, makeVersion } from "./mocks/discogs-fixtures.js";

function fakeCtx(counters: Record<string, number> = {}): CoreContext {
  // Memoizing withCache (like KV within one test) so call counters measure
  // genuine upstream fetches — exactly what the rate budget pays for. Client
  // methods route through it just like the real CachedDiscogsClient.
  const memo = new Map<string, unknown>();
  const count = (name: string) => {
    counters[name] = (counters[name] ?? 0) + 1;
  };
  const withCache = async (k: string, _t: number, fetcher: () => Promise<unknown>) => {
    if (!memo.has(k)) memo.set(k, await fetcher());
    return memo.get(k);
  };
  const client = {
    cacheTtls: { collection: 1, wantlist: 1, release: 1, master: 1, versions: 1, search: 1, profile: 1 },
    rateLimitRemaining: null,
    get upstreamCalls() {
      return Object.values(counters).reduce((a, b) => a + b, 0);
    },
    withCache,
    peekCache: async (k: string) => (memo.has(k) ? memo.get(k) : null),
    getCollection: async () => {
      count("getCollection");
      return { pagination: { pages: 1, items: 0, page: 1, per_page: 100 }, releases: [] };
    },
    getWantlist: async () => {
      count("getWantlist");
      return { pagination: { pages: 1, items: 0, page: 1, per_page: 100 }, wants: [] };
    },
    getMasterVersions: async () =>
      withCache("versions:5460", 1, async () => {
        count("getMasterVersions");
        return {
          pagination: { pages: 1, items: 2, page: 1, per_page: 100 },
          versions: [
            makeVersion({ id: 1, label: "Mobile Fidelity Sound Lab", format: "Vinyl, LP, 45 RPM" }),
            makeVersion({ id: 2, label: "Columbia", format: "Vinyl, LP" }),
          ],
        };
      }),
    getMaster: async () =>
      withCache("master:5460", 1, async () => {
        count("getMaster");
        return {
          id: 5460,
          title: "Kind Of Blue",
          artists: [{ id: 10, name: "Miles Davis" }],
          year: 1959,
          main_release: 1,
          main_release_url: "",
          versions_url: "",
          genres: ["Jazz"],
          tracklist: [],
          resource_url: "",
        };
      }),
    getRelease: async (id: number) =>
      withCache(`release:${id}`, 1, async () => {
        count("getRelease");
        return id === 1 ? mfslPressing : makeRelease({ id });
      }),
  } as unknown as CachedDiscogsClient;
  return { client, username: "tester" };
}

describe("core/lookup analyzeRelease", () => {
  it("returns this pressing, the album's best pressing, taste-fit and owned/wanted", async () => {
    const r = await analyzeRelease(fakeCtx(), 1, "sonic");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data;
    expect(d.release.title).toMatch(/Kind Of Blue/);
    expect(d.thisPressing).toHaveProperty("verdict");
    expect(d.thisPressing).toHaveProperty("evidenceCoverage");
    expect(d.bestPressing).not.toBeNull();
    expect(typeof d.tasteFit?.affinity).toBe("number");
    expect(d.owned).toBe(false);
    expect(d.wanted).toBe(false);
    expect(Array.isArray(d.dataCaveats)).toBe(true);
  });

  it("crawls the collection exactly once per cold analysis (taste-fit reuses it)", async () => {
    const counters: Record<string, number> = {};
    const r = await analyzeRelease(fakeCtx(counters), 1, "sonic");
    expect(r.ok).toBe(true);
    expect(counters.getCollection).toBe(1);
    expect(counters.getWantlist).toBe(1);
  });

  it("switching axes after one analysis costs zero additional upstream calls", async () => {
    const counters: Record<string, number> = {};
    const ctx = fakeCtx(counters);
    expect((await analyzeRelease(ctx, 1, "sonic")).ok).toBe(true);
    const after = { ...counters };
    expect((await analyzeRelease(ctx, 1, "collector")).ok).toBe(true);
    expect(counters).toEqual(after); // everything served from cache
  });
});

describe("core/lookup analyzeRelease — progressive contract", () => {
  it("cold summary: one upstream call, no survey, no crawl, personalization pending", async () => {
    const counters: Record<string, number> = {};
    const r = await analyzeRelease(fakeCtx(counters), 1, "sonic", "summary");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data;
    expect(d.meta.level).toBe("summary");
    expect(d.meta.personalization).toBe("pending");
    expect(d.meta.upstreamCalls).toBe(1); // the release itself — nothing else
    expect(counters.getCollection).toBeUndefined(); // cold aggregates ≠ a crawl
    expect(counters.getWantlist).toBeUndefined();
    expect(counters.getMasterVersions).toBeUndefined(); // no survey
    expect(d.bestPressing).toBeNull();
    expect(d.tasteFit).toBeNull(); // unknown, not false
    expect(d.owned).toBeNull();
    expect(d.wanted).toBeNull();
    expect(d.thisPressing).toHaveProperty("verdict");
  });

  it("summary with warm aggregates: personalization ready, still no survey", async () => {
    const counters: Record<string, number> = {};
    const ctx = fakeCtx(counters);
    expect((await analyzeRelease(ctx, 1, "sonic")).ok).toBe(true); // warms aggregates
    const surveys = counters.getMasterVersions ?? 0;
    const r = await analyzeRelease(ctx, 2, "sonic", "summary");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.meta.personalization).toBe("ready");
    expect(r.data.tasteFit).not.toBeNull();
    expect(r.data.owned).toBe(false);
    expect(counters.getMasterVersions ?? 0).toBe(surveys); // summary never surveys
  });

  it("full mode carries survey metadata", async () => {
    const r = await analyzeRelease(fakeCtx(), 1, "sonic", "full");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.meta.level).toBe("full");
    expect(r.data.meta.personalization).toBe("ready");
    expect(r.data.meta.candidatesScored).toBeGreaterThan(0);
    expect(r.data.meta.candidatesTarget).toBeGreaterThan(0);
  });

  it("defers the full analysis when the remaining budget can't cover a reduced survey", async () => {
    const ctx = fakeCtx();
    (ctx.client as { rateLimitRemaining: number | null }).rateLimitRemaining = 9;
    const r = await analyzeRelease(ctx, 1, "sonic", "full");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect("deferred" in r && r.deferred.retryAfter).toBe(60);
  });
});
