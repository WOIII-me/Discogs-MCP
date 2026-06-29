import type { DiscogsMasterVersion, DiscogsRelease } from "../../src/clients/types.js";
import type { SlimItem } from "../../src/utils/collection.js";

export function makeRelease(overrides: Partial<DiscogsRelease> = {}): DiscogsRelease {
  return {
    id: 1,
    title: "Kind Of Blue",
    artists: [{ id: 10, name: "Miles Davis" }],
    year: 1959,
    master_id: 5460,
    formats: [{ name: "Vinyl", qty: "1", descriptions: ["LP", "Album"] }],
    genres: ["Jazz"],
    styles: ["Modal"],
    labels: [{ id: 1866, name: "Columbia", catno: "CL 1355" }],
    country: "US",
    tracklist: [{ position: "A1", title: "So What", duration: "9:22" }],
    community: { rating: { average: 4.6, count: 800 }, have: 5000, want: 2000 },
    lowest_price: 40,
    num_for_sale: 9,
    resource_url: "https://api.discogs.com/releases/1",
    ...overrides,
  };
}

/** MFSL-style audiophile reissue: reputable label id + mastering credit + 45 RPM */
export const mfslPressing = makeRelease({
  id: 2,
  labels: [{ id: 35095, name: "Mobile Fidelity Sound Lab", catno: "MFSL 2-45011" }],
  formats: [{ name: "Vinyl", qty: "2", descriptions: ["LP", "45 RPM", "180 Gram"] }],
  extraartists: [{ name: "Krieg Wunderlich", role: "Lacquer Cut By" }],
  community: { rating: { average: 4.8, count: 450 }, have: 3000, want: 4000 },
  lowest_price: 120,
  num_for_sale: 30,
});

/** Original pressing with a renowned-engineer stamp in the runout */
export const rvgPressing = makeRelease({
  id: 5,
  labels: [{ id: 1866, name: "Blue Note", catno: "BLP 1577" }],
  extraartists: [{ name: "Rudy Van Gelder", role: "Mastered By" }],
  identifiers: [{ type: "Matrix / Runout", value: "BLP 1577-A RVG", description: "Side A" }],
  community: { rating: { average: 4.7, count: 300 }, have: 1500, want: 3000 },
  lowest_price: 250,
  num_for_sale: 4,
});

/** Sparse modern CD reissue */
export const cdReissue = makeRelease({
  id: 3,
  formats: [{ name: "CD", qty: "1", descriptions: ["Album", "Reissue"] }],
  notes: "Standard reissue.",
  community: { rating: { average: 4.1, count: 90 }, have: 2000, want: 150 },
  lowest_price: 8,
  num_for_sale: 200,
});

/** Perfect rating but almost no votes */
export const tinyRatedPressing = makeRelease({
  id: 4,
  community: { rating: { average: 5.0, count: 3 }, have: 12, want: 8 },
});

export function makeVersion(overrides: Partial<DiscogsMasterVersion> = {}): DiscogsMasterVersion {
  return {
    id: 1,
    title: "Kind Of Blue",
    label: "Columbia",
    catno: "CL 1355",
    country: "US",
    released: "1959",
    format: "Vinyl, LP, Album",
    resource_url: "https://api.discogs.com/releases/1",
    stats: { community: { in_collection: 5000, in_wantlist: 2000 } },
    ...overrides,
  };
}

export function makeSlimItem(overrides: Partial<SlimItem> = {}): SlimItem {
  return {
    id: 1,
    title: "Kind Of Blue",
    artists: ["Miles Davis"],
    year: 1959,
    genres: ["Jazz"],
    styles: ["Modal"],
    labels: ["Columbia"],
    formats: ["Vinyl"],
    rating: 5,
    ...overrides,
  };
}

export const jazzCollection: SlimItem[] = [
  makeSlimItem(),
  makeSlimItem({ id: 2, title: "A Love Supreme", artists: ["John Coltrane"], styles: ["Free Jazz", "Hard Bop"], year: 1965, rating: 5 }),
  makeSlimItem({ id: 3, title: "Blue Train", artists: ["John Coltrane"], styles: ["Hard Bop"], year: 1957, rating: 4 }),
  makeSlimItem({ id: 4, title: "Getz/Gilberto", artists: ["Stan Getz"], styles: ["Bossa Nova"], year: 1964, rating: 0 }),
  makeSlimItem({ id: 5, title: "Selected Ambient Works", artists: ["Aphex Twin"], genres: ["Electronic"], styles: ["Ambient", "IDM"], year: 1992, rating: 4 }),
];

export const punkCollection: SlimItem[] = [
  makeSlimItem({ id: 11, title: "Never Mind The Bollocks", artists: ["Sex Pistols"], genres: ["Rock"], styles: ["Punk"], year: 1977, rating: 5 }),
  makeSlimItem({ id: 12, title: "London Calling", artists: ["The Clash"], genres: ["Rock"], styles: ["Punk", "New Wave"], year: 1979, rating: 4 }),
  makeSlimItem({ id: 13, title: "Ramones", artists: ["Ramones"], genres: ["Rock"], styles: ["Punk"], year: 1976, rating: 0 }),
];
