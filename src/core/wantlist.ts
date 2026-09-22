import type { CoreContext, CoreResult } from "./pressings.js";
import { fetchFullCollection, fetchFullWantlist, type SlimItem } from "../utils/collection.js";
import { buildProfile, decadeOf, scoreAffinity, topEntries, type CollectionProfile } from "../utils/similarity-scoring.js";

/**
 * Server-side wantlist ranking by taste fit.
 *
 * Why this exists: without it, clients page the whole wantlist and collection
 * into their context (673 items in one observed Codex session) and invent
 * their own scoring — different in every client, non-reproducible, and
 * expensive in tokens. One call, one deterministic method, one page of output.
 *
 * Grouping: alternate editions of the same album (matching normalised artist
 * + title) are ranked once, with all wantlisted editions listed under it.
 */
export interface RankWantlistParams {
  /** Groups to return (default 50, max 500). */
  limit?: number;
  /** Include albums whose title already sits in the collection (default true; they are flagged). */
  includeOwned?: boolean;
}

export type FitTier = "bullseye" | "good fit" | "off-profile";

export interface RankedWant {
  rank: number;
  artist: string;
  title: string;
  /** 0–100 taste affinity (styles 60 %, genres 30 %, decade 10 %), same scale as tasteFit. */
  fit: number;
  tier: FitTier;
  matchedStyles: string[];
  matchedGenres: string[];
  decade: string | null;
  /** Same normalised artist + title already in the collection (an ownership flag, not proof of the same edition). */
  ownedTitle: boolean;
  editions: { releaseId: number; year: number; labels: string[]; formats: string[]; dateAdded?: string }[];
}

export interface RankWantlistResult {
  username: string;
  wantlistItems: number;
  groups: number;
  returned: number;
  collectionItems: number;
  truncated: { wantlist: boolean; collection: boolean };
  method: string;
  tiers: Record<FitTier, number>;
  thresholds: { bullseye: number; goodFit: number };
  dominantStyles: { name: string; share: number }[];
  ranked: RankedWant[];
  caveats: string[];
}

export const MAX_RANK_LIMIT = 500;

/** Lower-case, strip diacritics/punctuation/disambiguation suffixes like "(2)", collapse spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(\d+\)/g, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function groupKey(item: SlimItem): string {
  return `${normalizeName(item.artists.join(" "))}|${normalizeName(item.title)}`;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

interface Group {
  key: string;
  artist: string;
  title: string;
  items: SlimItem[];
}

function groupWants(items: SlimItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const it of items) {
    const key = groupKey(it);
    const g = map.get(key);
    if (g) g.items.push(it);
    else map.set(key, { key, artist: it.artists.join(", "), title: it.title, items: [it] });
  }
  return [...map.values()];
}

function fitFor(profile: CollectionProfile, g: Group) {
  const styles = uniq(g.items.flatMap((i) => i.styles));
  const genres = uniq(g.items.flatMap((i) => i.genres));
  const years = g.items.map((i) => i.year).filter((y) => y > 0);
  const year = years.length ? Math.min(...years) : 0;
  const fit = scoreAffinity(profile, { genres, styles, year });
  const matchedStyles = styles.filter((s) => (profile.styles[s] ?? 0) > 0).sort((a, b) => profile.styles[b] - profile.styles[a]);
  const matchedGenres = genres.filter((s) => (profile.genres[s] ?? 0) > 0).sort((a, b) => profile.genres[b] - profile.genres[a]);
  return { fit, matchedStyles, matchedGenres, decade: year ? decadeOf(year) : null };
}

/** Quantile-based tiers: top 20 % bullseye, next 40 % good fit, rest off-profile; a hard floor keeps near-zero fits off-profile. */
export function tierThresholds(fits: number[]): { bullseye: number; goodFit: number } {
  if (fits.length === 0) return { bullseye: 0, goodFit: 0 };
  const sorted = [...fits].sort((a, b) => b - a);
  // Value at the boundary of the top q share: ceil(q·n)-1 so "top 20 %" of 5 is exactly the first item.
  const at = (q: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1))];
  return { bullseye: Math.max(at(0.2), 5), goodFit: Math.max(at(0.6), 5) };
}

export async function rankWantlist(ctx: CoreContext, params: RankWantlistParams = {}): Promise<CoreResult<RankWantlistResult>> {
  const [collection, wantlist] = await Promise.all([
    fetchFullCollection(ctx.client, ctx.username),
    fetchFullWantlist(ctx.client, ctx.username),
  ]);
  if (wantlist.items.length === 0) {
    return { ok: false, error: `Wantlist for ${ctx.username} is empty (or private).` };
  }
  const profile = buildProfile(collection.items);
  const ownedKeys = new Set(collection.items.map(groupKey));

  const groups = groupWants(wantlist.items);
  const scored = groups.map((g) => ({ g, ...fitFor(profile, g), ownedTitle: ownedKeys.has(g.key) }));
  const thresholds = tierThresholds(scored.map((s) => s.fit));
  const tierOf = (fit: number): FitTier =>
    fit >= thresholds.bullseye ? "bullseye" : fit >= thresholds.goodFit ? "good fit" : "off-profile";

  const includeOwned = params.includeOwned ?? true;
  const visible = scored.filter((s) => includeOwned || !s.ownedTitle);
  visible.sort((a, b) => b.fit - a.fit || b.g.items.length - a.g.items.length || a.g.title.localeCompare(b.g.title));

  const tiers: Record<FitTier, number> = { bullseye: 0, "good fit": 0, "off-profile": 0 };
  for (const s of visible) tiers[tierOf(s.fit)]++;

  const limit = Math.max(1, Math.min(params.limit ?? 50, MAX_RANK_LIMIT));
  const ranked: RankedWant[] = visible.slice(0, limit).map((s, i) => ({
    rank: i + 1,
    artist: s.g.artist,
    title: s.g.title,
    fit: s.fit,
    tier: tierOf(s.fit),
    matchedStyles: s.matchedStyles.slice(0, 5),
    matchedGenres: s.matchedGenres.slice(0, 3),
    decade: s.decade,
    ownedTitle: s.ownedTitle,
    editions: s.g.items.map((i) => ({ releaseId: i.id, year: i.year, labels: i.labels, formats: i.formats, ...(i.dateAdded ? { dateAdded: i.dateAdded } : {}) })),
  }));

  const rated = collection.items.filter((i) => i.rating >= 4).length;
  const caveats = [
    "Fit measures overlap with the styles/genres/decades already in the collection — not artistic merit, sound quality, availability or price.",
    "Tiers are relative to this wantlist (top 20 % / next 40 % / rest), so a small wantlist still produces all three tiers.",
    "ownedTitle is a normalised artist+title match: it flags a likely duplicate, not the same edition; aliases and box-set contents can escape it.",
  ];
  if (rated === 0) caveats.push("No collection items are rated 4–5 stars, so every item weighs equally in the taste profile.");
  if (collection.truncated || wantlist.truncated) caveats.push("The collection or wantlist exceeded the fetch cap (3,000 items); the profile and ranking are based on the fetched part.");

  return {
    ok: true,
    data: {
      username: ctx.username,
      wantlistItems: wantlist.items.length,
      groups: groups.length,
      returned: ranked.length,
      collectionItems: collection.items.length,
      truncated: { wantlist: wantlist.truncated, collection: collection.truncated },
      method:
        "fit = 60 % style overlap + 30 % genre overlap + 10 % decade overlap with the collection profile " +
        "(4–5★ items count double); editions grouped by normalised artist + title; deterministic.",
      tiers,
      thresholds,
      dominantStyles: topEntries(profile.styles, 5).map(([name, share]) => ({ name, share: Math.round(share * 1000) / 10 })),
      ranked,
      caveats,
    },
  };
}
