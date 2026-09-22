import { describe, expect, it } from "vitest";
import {
  applyVersionFilters,
  comparePressings,
  countryMatches,
  findBestPressing,
  formatMatches,
  getReleaseVersions,
  MAX_VERSIONS_LIMIT,
  versionYear,
  type CoreContext,
} from "../src/core/pressings.js";
import type { CachedDiscogsClient } from "../src/clients/cached-discogs.js";
import { makeRelease, mfslPressing, makeVersion } from "./mocks/discogs-fixtures.js";

/**
 * Minimal fake client covering only what the core pressing functions touch.
 * fetchFullCollection calls withCache + getCollection; we stub both.
 */
function fakeCtx(releasesById: Record<number, ReturnType<typeof makeRelease>>): CoreContext {
  const client = {
    cacheTtls: { collection: 1, wantlist: 1, release: 1, master: 1, versions: 1, search: 1, profile: 1 },
    withCache: async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
    getCollection: async () => ({ pagination: { pages: 1, items: 0, page: 1, per_page: 100 }, releases: [] }),
    getMasterVersions: async () => ({
      pagination: { pages: 1, items: 2, page: 1, per_page: 100 },
      versions: [
        makeVersion({ id: 1, label: "Mobile Fidelity Sound Lab", format: "Vinyl, LP, 45 RPM" }),
        makeVersion({ id: 2, label: "Columbia", format: "Vinyl, LP" }),
      ],
    }),
    getMaster: async () => ({
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
    }),
    getRelease: async (id: number) => releasesById[id],
  } as unknown as CachedDiscogsClient;
  return { client, username: "tester" };
}

describe("core/pressings", () => {
  it("findBestPressing returns a ranked dossier on the happy path", async () => {
    const ctx = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) });
    // releaseId path (mfslPressing.master_id === 5460) avoids needing client.search
    const r = await findBestPressing(ctx, { releaseId: 1, axis: "sonic", topN: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as any;
    expect(Array.isArray(data.dataCaveats)).toBe(true);
    expect(data.topPressings.length).toBeGreaterThan(0);
    const top = data.topPressings[0];
    expect(top).toHaveProperty("verdict");
    expect(top).toHaveProperty("evidenceCoverage");
    expect(top).toHaveProperty("whyItScores");
    expect(top).toHaveProperty("matrixRunout");
  });

  it("stops fetching candidates preemptively when the remaining budget is low", async () => {
    const ctx = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) });
    const client = ctx.client as unknown as {
      rateLimitRemaining: number | null;
      getRelease: (id: number) => Promise<unknown>;
    };
    // Simulate a nearly-exhausted per-minute budget reported by Discogs:
    // the candidate batch must never launch — zero getRelease calls beyond
    // the master resolution, and an honest rate-limit error.
    const original = client.getRelease.bind(client);
    let candidateFetches = 0;
    client.getRelease = async (id: number) => {
      candidateFetches++;
      return original(id);
    };
    client.rateLimitRemaining = 5;
    const r = await findBestPressing(ctx, { masterId: 5460, axis: "sonic", topN: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/rate-limiting/i);
    expect(candidateFetches).toBe(0);
  });

  it("findBestPressing errors clearly when given no album reference", async () => {
    const ctx = fakeCtx({});
    const r = await findBestPressing(ctx, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Provide masterId, releaseId, or albumTitle/);
  });

  it("comparePressings ranks the given releases and returns dossiers", async () => {
    const ctx = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) });
    const r = await comparePressings(ctx, { releaseIds: [1, 2], axis: "sonic" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as any;
    expect(data.pressings).toHaveLength(2);
    expect(data.topPick).toMatch(/Highest scoring/);
    expect(data.pressings[0]).toHaveProperty("evidenceCoverage");
  });
});

describe("core/pressings — catalog claims wiring", () => {
  const claim = {
    claim: "analogSource" as const,
    status: "stated" as const,
    certainty: 0.93,
    sourceSentence: "Cut from the original analog tapes.",
    observedAt: "2026-09-22T00:00:00.000Z",
    model: "jev-1.13.0",
    questionSetVersion: "cc-v3",
  };
  function fakeAnnotator() {
    const calls = { annotate: 0, peek: 0 };
    const annotator = {
      async annotate(releases: { id: number }[]) {
        calls.annotate++;
        return new Map(releases.map((r) => [r.id, [claim]]));
      },
      async peek() {
        calls.peek++;
        return new Map();
      },
    };
    return { annotator: annotator as unknown as NonNullable<CoreContext["claims"]>, calls };
  }

  it("emits no catalogClaims and never touches the annotator when the feature is off", async () => {
    const ctx = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2, notes: "AAA cut." }) });
    const r = await comparePressings(ctx, { releaseIds: [1, 2], inferClaims: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const p of r.data.pressings) expect(p.catalogClaims).toBeUndefined();
  });

  it("uses cache-only peek unless inferClaims is explicitly true", async () => {
    const { annotator, calls } = fakeAnnotator();
    const ctx = { ...fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) }), claims: annotator };
    await comparePressings(ctx, { releaseIds: [1, 2] });
    expect(calls).toEqual({ annotate: 0, peek: 1 });
    await findBestPressing(ctx, { releaseId: 1, topN: 2 });
    expect(calls).toEqual({ annotate: 0, peek: 2 });
  });

  it("attaches claims to dossiers on deliberate actions without changing scores", async () => {
    const { annotator, calls } = fakeAnnotator();
    const base = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) });
    const plain = await comparePressings(base, { releaseIds: [1, 2] });
    const withClaims = await comparePressings({ ...base, claims: annotator }, { releaseIds: [1, 2], inferClaims: true });
    expect(calls.annotate).toBe(1);
    expect(plain.ok && withClaims.ok).toBe(true);
    if (!plain.ok || !withClaims.ok) return;
    withClaims.data.pressings.forEach((p, i) => {
      expect(p.catalogClaims).toEqual([claim]);
      expect(p.overallScore).toBe(plain.data.pressings[i].overallScore);
      expect(p.evidenceCoverage).toBe(plain.data.pressings[i].evidenceCoverage);
      expect(p.verdict).toBe(plain.data.pressings[i].verdict);
      expect(p.factors).toEqual(plain.data.pressings[i].factors);
    });
  });

  it("swallows annotator failures", async () => {
    const boom = { annotate: async () => { throw new Error("jev down"); }, peek: async () => { throw new Error("kv down"); } };
    const ctx = { ...fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) }), claims: boom as unknown as CoreContext["claims"] };
    const r = await comparePressings(ctx, { releaseIds: [1, 2], inferClaims: true });
    expect(r.ok).toBe(true);
  });
});


describe("getReleaseVersions — filters and limits (v1.6.2)", () => {
  it("countryMatches is exact with aliases, never a substring", () => {
    expect(countryMatches("Australia", "US")).toBe(false);
    expect(countryMatches("US", "us")).toBe(true);
    expect(countryMatches("US", "United States")).toBe(true);
    expect(countryMatches("UK", "United Kingdom")).toBe(true);
    expect(countryMatches("UK & Europe", "UK")).toBe(true);
    expect(countryMatches("US, Canada & Europe", "Canada")).toBe(true);
    expect(countryMatches("Germany", "West Germany")).toBe(false);
    expect(countryMatches(undefined, "US")).toBe(false);
  });

  it("filters versions by exact country and clamps oversized limits", async () => {
    const versions = [
      makeVersion({ id: 1, country: "US" }),
      makeVersion({ id: 2, country: "Australia" }),
      makeVersion({ id: 3, country: "US, Canada & Europe" }),
      ...Array.from({ length: 150 }, (_, i) => makeVersion({ id: 100 + i, country: "US" })),
    ];
    const ctx = fakeCtx({});
    (ctx.client as unknown as { getMasterVersions: unknown }).getMasterVersions = async () => ({
      pagination: { pages: 1, items: versions.length, page: 1, per_page: 100 },
      versions,
    });
    const r = await getReleaseVersions(ctx, { masterId: 4170, filterCountry: "US", limit: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.matchingVersions).toBe(152);
    expect(r.data.versions.every((v) => v.country !== "Australia")).toBe(true);
    expect(r.data.versions.length).toBe(MAX_VERSIONS_LIMIT);
  });
});

describe("dataCaveats — catalogClaims (v1.6.2)", () => {
  it("adds the claims caveat only when claims are present", async () => {
    const base = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) });
    const without = await comparePressings(base, { releaseIds: [1, 2] });
    const claim = { claim: "dmm" as const, status: "stated" as const, certainty: 0.9, observedAt: "", model: "jev-1.13.0", questionSetVersion: "cc-v3" };
    const annotator = { annotate: async (rs: { id: number }[]) => new Map(rs.map((r) => [r.id, [claim]])), peek: async () => new Map() };
    const withClaims = await comparePressings({ ...base, claims: annotator as unknown as CoreContext["claims"] }, { releaseIds: [1, 2], inferClaims: true });
    expect(without.ok && withClaims.ok).toBe(true);
    if (!without.ok || !withClaims.ok) return;
    expect(without.data.dataCaveats.join(" ")).not.toMatch(/catalogClaims/);
    expect(withClaims.data.dataCaveats.join(" ")).toMatch(/catalogClaims are a model's reading/);
  });
});


describe("version filters — format, year, paging (v1.7.0)", () => {
  it("formatMatches consults major_formats so 'Vinyl' catches rows listed as 'LP, Album'", () => {
    const lp = makeVersion({ format: "LP, Album, Reissue", major_formats: ["Vinyl"] });
    expect(formatMatches(lp, "Vinyl")).toBe(true);
    expect(formatMatches(lp, "vinyl")).toBe(true);
    expect(formatMatches(makeVersion({ format: "CD, Album", major_formats: ["CD"] }), "Vinyl")).toBe(false);
  });

  it("versionYear parses '1972', '1972-05-01' and rejects blanks", () => {
    expect(versionYear(makeVersion({ released: "1972" }))).toBe(1972);
    expect(versionYear(makeVersion({ released: "1972-05-01" }))).toBe(1972);
    expect(versionYear(makeVersion({ released: "" }))).toBeUndefined();
  });

  it("applyVersionFilters combines country, inclusive year range and format; unknown years drop when bounded", () => {
    const rows = [
      makeVersion({ id: 1, country: "US", released: "1969", format: "LP, Album", major_formats: ["Vinyl"] }),
      makeVersion({ id: 2, country: "US", released: "1970", format: "LP, Album, Reissue", major_formats: ["Vinyl"] }),
      makeVersion({ id: 3, country: "US", released: "1979-06", format: "LP", major_formats: ["Vinyl"] }),
      makeVersion({ id: 4, country: "US", released: "1980", format: "LP", major_formats: ["Vinyl"] }),
      makeVersion({ id: 5, country: "Australia", released: "1972", format: "LP", major_formats: ["Vinyl"] }),
      makeVersion({ id: 6, country: "US", released: "", format: "LP", major_formats: ["Vinyl"] }),
      makeVersion({ id: 7, country: "US", released: "1975", format: "Cassette", major_formats: ["Cassette"] }),
    ];
    const ids = (f: Parameters<typeof applyVersionFilters>[1]) => applyVersionFilters(rows, f).map((v) => v.id);
    expect(ids({ filterCountry: "US", yearFrom: 1970, yearTo: 1979, filterFormat: "Vinyl" })).toEqual([2, 3]);
    expect(ids({ yearFrom: 1975 })).toEqual([3, 4, 7]);
    expect(ids({})).toHaveLength(7);
  });

  it("fetches up to 5 version pages when filtered, 3 when not", async () => {
    const calls: number[] = [];
    const ctx = fakeCtx({});
    (ctx.client as unknown as { getMasterVersions: unknown }).getMasterVersions = async (_id: number, opts: { page: number }) => {
      calls.push(opts.page);
      return { pagination: { pages: 8, items: 800, page: opts.page, per_page: 100 }, versions: [makeVersion({ id: opts.page, country: "US", released: "1972" })] };
    };
    await getReleaseVersions(ctx, { masterId: 4170 });
    expect(calls).toEqual([1, 2, 3]);
    calls.length = 0;
    const r = await getReleaseVersions(ctx, { masterId: 4170, filterCountry: "US", yearFrom: 1970, yearTo: 1979 });
    expect(calls).toEqual([1, 2, 3, 4, 5]);
    expect(r.ok && r.data.truncated).toBe(true);
    expect(r.ok && r.data.versions[0].majorFormats).toEqual([]);
  });
});

describe("findBestPressing — filtered survey (v1.7.0)", () => {
  function filteredCtx() {
    const releases = {
      1: makeRelease({ id: 1, country: "US", year: 1969 }),
      2: makeRelease({ id: 2, country: "US", year: 1972 }),
      3: makeRelease({ id: 3, country: "Japan", year: 1972 }),
      4: makeRelease({ id: 4, country: "US", year: 1977 }),
    };
    const ctx = fakeCtx(releases);
    (ctx.client as unknown as { getMasterVersions: unknown }).getMasterVersions = async () => ({
      pagination: { pages: 1, items: 4, page: 1, per_page: 100 },
      versions: [
        makeVersion({ id: 1, country: "US", released: "1969", format: "LP, Album", major_formats: ["Vinyl"] }),
        makeVersion({ id: 2, country: "US", released: "1972", format: "LP, Album, Reissue", major_formats: ["Vinyl"] }),
        makeVersion({ id: 3, country: "Japan", released: "1972", format: "LP, Album", major_formats: ["Vinyl"] }),
        makeVersion({ id: 4, country: "US", released: "1977", format: "LP, Album, Reissue", major_formats: ["Vinyl"] }),
      ],
    });
    return ctx;
  }

  it("hard filters restrict the candidate pool and topN can return every scored candidate", async () => {
    const r = await findBestPressing(filteredCtx(), { masterId: 5460, filterCountry: "US", yearFrom: 1970, yearTo: 1979, topN: 16 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.topPressings.map((p) => p.releaseId).sort()).toEqual([2, 4]);
    expect(r.data.album.candidatesScored).toBe(2);
  });

  it("returns an honest error instead of widening when nothing matches the hard filters", async () => {
    const r = await findBestPressing(filteredCtx(), { masterId: 5460, filterCountry: "Germany" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/No versions .* match the filters/);
  });

  it("preferredFormats stays a soft preference and matches major_formats", async () => {
    const r = await findBestPressing(filteredCtx(), { masterId: 5460, preferredFormats: ["Vinyl"], topN: 16 });
    expect(r.ok && r.data.topPressings.length).toBe(4);
    const none = await findBestPressing(filteredCtx(), { masterId: 5460, preferredFormats: ["8-Track"], topN: 16 });
    expect(none.ok && none.data.topPressings.length).toBe(4);
  });
});
