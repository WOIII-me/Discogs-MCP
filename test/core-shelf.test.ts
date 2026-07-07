import { describe, expect, it } from "vitest";
import { shelfProfile, spinPicks } from "../src/core/shelf.js";
import type { CoreContext } from "../src/core/pressings.js";
import type { CachedDiscogsClient } from "../src/clients/cached-discogs.js";
import { KNOWN_MOODS } from "../src/utils/mood-mapping.js";

interface FakeItem {
  id: number;
  title: string;
  artist: string;
  year: number;
  genres: string[];
  styles: string[];
  labels?: string[];
  formats?: string[];
  rating?: number;
  dateAdded?: string;
}

function release(f: FakeItem) {
  return {
    rating: f.rating ?? 0,
    date_added: f.dateAdded,
    basic_information: {
      id: f.id,
      title: f.title,
      year: f.year,
      artists: [{ id: 1, name: f.artist }],
      genres: f.genres,
      styles: f.styles,
      labels: (f.labels ?? ["Blue Note"]).map((name) => ({ name })),
      formats: (f.formats ?? ["Vinyl"]).map((name) => ({ name })),
    },
  };
}

const SHELF: FakeItem[] = [
  { id: 1, title: "Kind Of Blue", artist: "Miles Davis", year: 1959, genres: ["Jazz"], styles: ["Modal"], labels: ["Columbia"], rating: 5, dateAdded: "2026-07-02T10:00:00-07:00" },
  { id: 2, title: "Blue Train", artist: "John Coltrane", year: 1958, genres: ["Jazz"], styles: ["Hard Bop"], labels: ["Blue Note"], rating: 5, dateAdded: "2026-07-01T10:00:00-07:00" },
  { id: 3, title: "Somethin' Else", artist: "Cannonball Adderley", year: 1958, genres: ["Jazz"], styles: ["Hard Bop"], labels: ["Blue Note"], rating: 4, dateAdded: "2026-06-20T10:00:00-07:00" },
  { id: 4, title: "Discovery", artist: "Daft Punk", year: 2001, genres: ["Electronic"], styles: ["House", "Disco"], labels: ["Virgin"], rating: 4, formats: ["CD"], dateAdded: "2026-05-01T10:00:00-07:00" },
  { id: 5, title: "Unknown Album", artist: "Nobody", year: 1971, genres: ["Rock"], styles: ["Psychedelic Rock"], labels: ["Not On Label"], dateAdded: "2026-04-01T10:00:00-07:00" },
  { id: 6, title: "Moanin'", artist: "Art Blakey", year: 1959, genres: ["Jazz"], styles: ["Hard Bop"], labels: ["Blue Note"], rating: 5, dateAdded: "2026-03-01T10:00:00-07:00" },
];

function fakeCtx(
  items: FakeItem[] = SHELF,
  wantlistCount = 2,
  opts: { liveCollection?: number; liveWantlist?: number; countsFail?: boolean } = {}
): CoreContext {
  // The 1-item pages are the fresh-counts probe; full pages are the aggregate.
  const client = {
    cacheTtls: { collection: 1, wantlist: 1 },
    withCache: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
    getCollection: async (_u: string, o?: { per_page?: number }) => {
      if (o?.per_page === 1 && opts.countsFail) throw new Error("boom");
      return {
        pagination: {
          pages: 1,
          items: o?.per_page === 1 && opts.liveCollection !== undefined ? opts.liveCollection : items.length,
          page: 1,
          per_page: o?.per_page ?? 100,
        },
        releases: o?.per_page === 1 ? [] : items.map(release),
      };
    },
    getWantlist: async (_u: string, o?: { per_page?: number }) => ({
      pagination: {
        pages: 1,
        items: o?.per_page === 1 && opts.liveWantlist !== undefined ? opts.liveWantlist : wantlistCount,
        page: 1,
        per_page: o?.per_page ?? 100,
      },
      wants: [],
    }),
  } as unknown as CachedDiscogsClient;
  return { client, username: "tester" };
}

describe("core/shelf shelfProfile", () => {
  it("aggregates counts, dominants, labels, formats and recency from the cached shelf", async () => {
    const p = await shelfProfile(fakeCtx(), new Date("2026-07-07T12:00:00Z"));

    expect(p.username).toBe("tester");
    expect(p.collectionSize).toBe(6);
    expect(p.wantlistSize).toBe(2);
    expect(p.truncated).toBe(false);

    expect(p.dominantGenres[0]).toBe("Jazz");
    expect(p.dominantStyles[0].name).toBe("Hard Bop");
    expect(p.dominantStyles[0].share).toBeGreaterThan(0);
    expect(p.decades[0].name).toBe("1950s");

    // "Not On Label" is noise; Blue Note dominates
    expect(p.topLabels[0]).toBe("Blue Note");
    expect(p.topLabels).not.toContain("Not On Label");

    // 5 of 6 vinyl, 1 CD
    expect(p.formatSplit.vinyl).toBe(83);
    expect(p.formatSplit.cd).toBe(17);
    expect(p.formatSplit.vinyl + p.formatSplit.cd + p.formatSplit.other).toBe(100);

    expect(p.addedThisMonth).toBe(2); // the two July adds
    expect(p.recentlyAdded.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(p.recentlyAdded[0]).toMatchObject({ title: "Kind Of Blue", artists: ["Miles Davis"], year: 1959 });

    expect(p.moods).toEqual(KNOWN_MOODS);
  });

  it("prefers fresh counts over stale aggregate totals", async () => {
    // Aggregate says 6/2, the live one-item probe says 5/364 (recent changes)
    const p = await shelfProfile(fakeCtx(SHELF, 2, { liveCollection: 5, liveWantlist: 364 }), new Date("2026-07-07T12:00:00Z"));
    expect(p.collectionSize).toBe(5);
    expect(p.wantlistSize).toBe(364);
    // Profile content still comes from the aggregate
    expect(p.dominantGenres[0]).toBe("Jazz");
  });

  it("falls back to aggregate totals when the counts probe fails", async () => {
    const p = await shelfProfile(fakeCtx(SHELF, 2, { countsFail: true }), new Date("2026-07-07T12:00:00Z"));
    expect(p.collectionSize).toBe(6);
    expect(p.wantlistSize).toBe(2);
  });

  it("handles an empty collection without dividing by zero", async () => {
    const p = await shelfProfile(fakeCtx([], 0), new Date("2026-07-07T12:00:00Z"));
    expect(p.collectionSize).toBe(0);
    expect(p.formatSplit).toEqual({ vinyl: 0, cd: 0, other: 0 });
    expect(p.recentlyAdded).toEqual([]);
    expect(p.addedThisMonth).toBe(0);
  });
});

describe("core/shelf spinPicks", () => {
  it("picks mood-matching, rating-weighted records from the user's own shelf", async () => {
    // 'latenight' maps to Hard Bop among others — the Blue Note records match
    const r = await spinPicks(fakeCtx(), "latenight", 3, () => 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.mood).toBe("latenight");
    expect(r.data.picks.length).toBeGreaterThan(0);
    expect(r.data.picks.length).toBeLessThanOrEqual(3);
    for (const pick of r.data.picks) {
      expect(pick.why).toBeTruthy();
    }
    // Deterministic random(0): strongest candidate first — a rated Hard Bop pick
    expect(r.data.picks[0].matchedStyles).toContain("Hard Bop");
  });

  it("resolves free-text moods via the phrase map", async () => {
    const r = await spinPicks(fakeCtx(), "late night", 2, () => 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.mood).toBe("latenight");
  });

  it("rejects unknown moods with the known-moods list", async () => {
    const r = await spinPicks(fakeCtx(), "flurbish");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Known moods/);
  });

  it("reports an honest miss when nothing on the shelf matches", async () => {
    const onlyJazz: FakeItem[] = [
      { id: 9, title: "Ballads", artist: "John Coltrane", year: 1963, genres: ["Jazz"], styles: ["Ballad"], rating: 5 },
    ];
    const r = await spinPicks(fakeCtx(onlyJazz), "pumped", 3, () => 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Nothing on your shelf/);
  });
});
