import { describe, expect, it } from "vitest";
import { groupKey, normalizeName, rankWantlist, tierThresholds, MAX_RANK_LIMIT } from "../src/core/wantlist.js";
import type { CoreContext } from "../src/core/pressings.js";
import type { SlimItem } from "../src/utils/collection.js";

const item = (o: Partial<SlimItem> & { id: number }): SlimItem => ({
  title: "Untitled",
  artists: ["Someone"],
  year: 1970,
  genres: [],
  styles: [],
  labels: [],
  formats: ["Vinyl"],
  rating: 0,
  ...o,
});

/** Fake ctx: collection aggregate + wantlist aggregate via withCache pass-through. */
function ctxWith(collection: SlimItem[], wants: SlimItem[]): CoreContext {
  const page = (items: SlimItem[]) => ({
    pagination: { pages: 1, items: items.length, page: 1, per_page: 100 },
    releases: items.map((i) => ({ id: i.id, rating: i.rating, date_added: i.dateAdded, basic_information: toBasic(i) })),
    wants: items.map((i) => ({ id: i.id, rating: i.rating, date_added: i.dateAdded, basic_information: toBasic(i) })),
  });
  const toBasic = (i: SlimItem) => ({
    id: i.id, title: i.title, year: i.year, genres: i.genres, styles: i.styles,
    artists: i.artists.map((n, k) => ({ id: k, name: n })),
    labels: i.labels.map((n, k) => ({ id: k, name: n, catno: "" })),
    formats: i.formats.map((n) => ({ name: n, qty: "1" })),
  });
  const client = {
    cacheTtls: { collection: 1, wantlist: 1, release: 1, master: 1, versions: 1, search: 1, profile: 1 },
    withCache: async (_k: string, _t: number, f: () => Promise<unknown>) => f(),
    getCollection: async () => page(collection),
    getWantlist: async () => page(wants),
  };
  return { client: client as unknown as CoreContext["client"], username: "tester" };
}

const jazzCollection = [
  item({ id: 1, title: "Kind Of Blue", artists: ["Miles Davis"], year: 1959, genres: ["Jazz"], styles: ["Modal", "Hard Bop"], rating: 5 }),
  item({ id: 2, title: "Blue Train", artists: ["John Coltrane"], year: 1958, genres: ["Jazz"], styles: ["Hard Bop"], rating: 5 }),
  item({ id: 3, title: "A Love Supreme", artists: ["John Coltrane"], year: 1965, genres: ["Jazz"], styles: ["Modal", "Free Jazz"] }),
  item({ id: 4, title: "Somethin' Else", artists: ["Cannonball Adderley"], year: 1958, genres: ["Jazz"], styles: ["Hard Bop"] }),
];

describe("core/wantlist — grouping and normalisation", () => {
  it("normalises case, diacritics, punctuation, leading 'The' and Discogs '(2)' suffixes", () => {
    expect(normalizeName("The Bill Holman Band")).toBe("bill holman band");
    expect(normalizeName("Esbjörn Svensson Trio")).toBe("esbjorn svensson trio");
    expect(normalizeName("Coronet (2)")).toBe("coronet");
    expect(normalizeName("Agharta = アガルタの凱歌")).toBe("agharta");
  });

  it("groups alternate editions under one key", () => {
    const a = item({ id: 10, title: "Kind Of Blue", artists: ["Miles Davis"] });
    const b = item({ id: 11, title: "Kind of Blue", artists: ["Miles Davis"] });
    expect(groupKey(a)).toBe(groupKey(b));
  });

  it("tier thresholds are quantile-based with a floor", () => {
    expect(tierThresholds([50, 40, 30, 20, 10])).toEqual({ bullseye: 50, goodFit: 30 });
    expect(tierThresholds([1, 1, 1])).toEqual({ bullseye: 5, goodFit: 5 });
    expect(tierThresholds([])).toEqual({ bullseye: 0, goodFit: 0 });
  });
});

describe("core/wantlist — rankWantlist", () => {
  const wants = [
    item({ id: 100, title: "Moanin'", artists: ["Art Blakey"], year: 1958, genres: ["Jazz"], styles: ["Hard Bop"], labels: ["Blue Note"] }),
    item({ id: 101, title: "Moanin'", artists: ["Art Blakey"], year: 2014, genres: ["Jazz"], styles: ["Hard Bop"], labels: ["Music Matters"] }),
    item({ id: 102, title: "Kind Of Blue", artists: ["Miles Davis"], year: 2015, genres: ["Jazz"], styles: ["Modal"], labels: ["MoFi"] }),
    item({ id: 103, title: "Dookie", artists: ["Green Day"], year: 1994, genres: ["Rock"], styles: ["Punk"] }),
    item({ id: 104, title: "Selected Ambient Works", artists: ["Aphex Twin"], year: 1992, genres: ["Electronic"], styles: ["Ambient"] }),
  ];

  it("ranks grouped albums by fit, flags owned titles, and reports tiers and method", async () => {
    const r = await rankWantlist(ctxWith(jazzCollection, wants));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data;
    expect(d.wantlistItems).toBe(5);
    expect(d.groups).toBe(4);
    const moanin = d.ranked.find((x) => x.title === "Moanin'")!;
    expect(moanin.editions.map((e) => e.releaseId).sort()).toEqual([100, 101]);
    expect(moanin.matchedStyles).toContain("Hard Bop");
    expect(d.ranked[0].fit).toBeGreaterThan(d.ranked[d.ranked.length - 1].fit);
    expect(d.ranked.find((x) => x.title === "Kind Of Blue")!.ownedTitle).toBe(true);
    expect(d.ranked.find((x) => x.title === "Dookie")!.tier).toBe("off-profile");
    expect(d.ranked.find((x) => x.title === "Dookie")!.matchedStyles).toEqual([]);
    expect(d.tiers.bullseye + d.tiers["good fit"] + d.tiers["off-profile"]).toBe(4);
    expect(d.method).toMatch(/60 % style/);
    expect(d.caveats.join(" ")).toMatch(/not artistic merit/);
  });

  it("can exclude owned titles and clamps the limit", async () => {
    const r = await rankWantlist(ctxWith(jazzCollection, wants), { includeOwned: false, limit: 100000 });
    expect(r.ok && r.data.ranked.some((x) => x.ownedTitle)).toBe(false);
    expect(r.ok && r.data.returned).toBe(3);
    expect(MAX_RANK_LIMIT).toBe(500);
  });

  it("errors on an empty wantlist", async () => {
    const r = await rankWantlist(ctxWith(jazzCollection, []));
    expect(r.ok).toBe(false);
  });
});
