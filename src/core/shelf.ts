import type { CoreContext, CoreResult } from "./pressings.js";
import { fetchFullCollection, fetchFullWantlist, type SlimItem } from "../utils/collection.js";
import { buildProfile, topEntries } from "../utils/similarity-scoring.js";
import { detectMoodFromQuery, getMoodFilters, KNOWN_MOODS } from "../utils/mood-mapping.js";

/**
 * "Your shelf" home-screen data for the extension. Everything here is served
 * from the KV-cached collection/wantlist aggregates — a casual panel open must
 * never burn the user's Discogs rate budget (first-ever call builds the
 * aggregates, exactly like taste-fit does today).
 */

export interface ShelfProfile {
  username: string;
  collectionSize: number;
  wantlistSize: number;
  truncated: boolean;
  dominantStyles: { name: string; share: number }[];
  dominantGenres: string[];
  decades: { name: string; share: number }[];
  topLabels: string[];
  formatSplit: { vinyl: number; cd: number; other: number };
  addedThisMonth: number;
  recentlyAdded: { id: number; title: string; artists: string[]; year: number; dateAdded?: string }[];
  moods: string[];
}

export interface SpinPick {
  id: number;
  title: string;
  artists: string[];
  year: number;
  rating: number;
  matchedStyles: string[];
  why: string;
}

export interface SpinResult {
  mood: string;
  poolSize: number;
  picks: SpinPick[];
}

/** Label names that say nothing about taste. */
const NOISE_LABELS = new Set(["not on label", "not on label (self-released)", "unknown"]);

function topLabels(items: SlimItem[], n: number): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const item of items) {
    for (const label of item.labels) {
      const key = label.toLowerCase();
      if (NOISE_LABELS.has(key)) continue;
      const entry = counts.get(key) ?? { name: label, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((e) => e.name);
}

function formatSplit(items: SlimItem[]): { vinyl: number; cd: number; other: number } {
  if (items.length === 0) return { vinyl: 0, cd: 0, other: 0 };
  let vinyl = 0;
  let cd = 0;
  for (const item of items) {
    const formats = item.formats.map((f) => f.toLowerCase());
    if (formats.includes("vinyl")) vinyl++;
    else if (formats.includes("cd")) cd++;
  }
  const pct = (n: number) => Math.round((n / items.length) * 100);
  return { vinyl: pct(vinyl), cd: pct(cd), other: Math.max(0, 100 - pct(vinyl) - pct(cd)) };
}

function addedThisMonth(items: SlimItem[], now: Date): number {
  const prefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return items.filter((i) => i.dateAdded?.startsWith(prefix)).length;
}

export async function shelfProfile(ctx: CoreContext, now = new Date()): Promise<ShelfProfile> {
  const [collection, wantlist] = await Promise.all([
    fetchFullCollection(ctx.client, ctx.username),
    fetchFullWantlist(ctx.client, ctx.username),
  ]);
  const profile = buildProfile(collection.items);
  const pctShare = (share: number) => Math.round(share * 1000) / 10;

  const recentlyAdded = [...collection.items]
    .filter((i) => i.dateAdded)
    .sort((a, b) => (b.dateAdded! < a.dateAdded! ? -1 : 1))
    .slice(0, 5)
    .map(({ id, title, artists, year, dateAdded }) => ({ id, title, artists, year, dateAdded }));

  return {
    username: ctx.username,
    collectionSize: collection.totalItems,
    wantlistSize: wantlist.totalItems,
    truncated: collection.truncated,
    dominantStyles: topEntries(profile.styles, 5).map(([name, share]) => ({ name, share: pctShare(share) })),
    dominantGenres: topEntries(profile.genres, 3).map(([name]) => name),
    decades: topEntries(profile.decades, 3).map(([name, share]) => ({ name, share: pctShare(share) })),
    topLabels: topLabels(collection.items, 3),
    formatSplit: formatSplit(collection.items),
    addedThisMonth: addedThisMonth(collection.items, now),
    recentlyAdded,
    moods: KNOWN_MOODS,
  };
}

function intersect(a: string[], b: string[]): string[] {
  const set = new Set(b.map((s) => s.toLowerCase()));
  return a.filter((x) => set.has(x.toLowerCase()));
}

/**
 * "What to spin tonight": mood-filter the user's own collection (style match
 * strong, genre match weak), weight by personal rating, then sample up to
 * `count` picks from the strongest candidates so repeat taps stay fresh.
 */
export async function spinPicks(
  ctx: CoreContext,
  moodQuery: string,
  count = 3,
  random: () => number = Math.random
): Promise<CoreResult<SpinResult>> {
  const mood = detectMoodFromQuery(moodQuery);
  const filters = mood ? getMoodFilters(mood) : null;
  if (!mood || !filters) {
    return { ok: false, error: `Unknown mood '${moodQuery}'. Known moods: ${KNOWN_MOODS.join(", ")}.` };
  }

  const collection = await fetchFullCollection(ctx.client, ctx.username);
  const scored = collection.items
    .map((item) => {
      const matchedStyles = intersect(item.styles, filters.styles);
      const matchedGenres = intersect(item.genres, filters.genres);
      let score = 0;
      if (matchedStyles.length) score += 2;
      if (matchedGenres.length) score += 1;
      // 4–5★ records are what the user actually reaches for — but only as a
      // boost on top of a real mood match, never a qualifier by itself
      if (score > 0 && item.rating >= 4) score += 1;
      return { item, score, matchedStyles, matchedGenres };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.item.rating - a.item.rating);

  // Sample from the strongest candidates instead of always returning the same
  // top-N, so tapping the same mood twice feels alive.
  const pool = scored.slice(0, Math.max(count * 4, 8));
  const picks: SpinPick[] = [];
  while (picks.length < count && pool.length > 0) {
    const idx = Math.floor(random() * pool.length);
    const [{ item, matchedStyles, matchedGenres }] = pool.splice(idx, 1);
    const why = matchedStyles.length
      ? `Matches ${mood}: ${matchedStyles.slice(0, 3).join(", ")}`
      : `${matchedGenres.slice(0, 2).join(", ")} lean fits ${mood}`;
    picks.push({
      id: item.id,
      title: item.title,
      artists: item.artists,
      year: item.year,
      rating: item.rating,
      matchedStyles: matchedStyles.slice(0, 3),
      why,
    });
  }

  if (picks.length === 0) {
    return { ok: false, error: `Nothing on your shelf matches '${mood}' — try another mood.` };
  }
  return { ok: true, data: { mood, poolSize: scored.length, picks } };
}
