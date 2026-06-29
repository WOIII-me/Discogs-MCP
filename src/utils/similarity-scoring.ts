import type { SlimItem } from "./collection.js";

export interface CollectionProfile {
  total: number;
  genres: Record<string, number>; // normalized frequency 0..1
  styles: Record<string, number>;
  decades: Record<string, number>;
}

function normalize(counts: Record<string, number>, total: number): Record<string, number> {
  if (total === 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) out[k] = v / total;
  return out;
}

export function decadeOf(year: number): string | null {
  if (!year || year < 1900) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

/** Build a taste profile (genre/style/decade distributions) from slim items. */
export function buildProfile(items: SlimItem[]): CollectionProfile {
  const genres: Record<string, number> = {};
  const styles: Record<string, number> = {};
  const decades: Record<string, number> = {};

  for (const item of items) {
    // Rated items count more: a 5-star record says more about taste than an unrated one
    const weight = item.rating >= 4 ? 2 : 1;
    for (const g of item.genres) genres[g] = (genres[g] ?? 0) + weight;
    for (const s of item.styles) styles[s] = (styles[s] ?? 0) + weight;
    const d = decadeOf(item.year);
    if (d) decades[d] = (decades[d] ?? 0) + weight;
  }

  const total = items.length || 1;
  return {
    total: items.length,
    genres: normalize(genres, total),
    styles: normalize(styles, total),
    decades: normalize(decades, total),
  };
}

/** Cosine similarity between two sparse frequency vectors. */
export function cosineSimilarity(
  a: Record<string, number>,
  b: Record<string, number>
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const v of Object.values(a)) normA += v * v;
  for (const v of Object.values(b)) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  for (const [k, v] of Object.entries(a)) {
    if (b[k]) dot += v * b[k];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Overall similarity between two collection profiles (0..1). */
export function profileSimilarity(a: CollectionProfile, b: CollectionProfile): number {
  return (
    0.55 * cosineSimilarity(a.styles, b.styles) +
    0.3 * cosineSimilarity(a.genres, b.genres) +
    0.15 * cosineSimilarity(a.decades, b.decades)
  );
}

/**
 * How well a candidate release matches a taste profile (0..100).
 * Style matches dominate; genre and decade refine.
 */
export function scoreAffinity(
  profile: CollectionProfile,
  candidate: { genres?: string[]; styles?: string[]; year?: number }
): number {
  let styleScore = 0;
  for (const s of candidate.styles ?? []) styleScore += profile.styles[s] ?? 0;
  let genreScore = 0;
  for (const g of candidate.genres ?? []) genreScore += profile.genres[g] ?? 0;
  const d = candidate.year ? decadeOf(candidate.year) : null;
  const decadeScore = d ? profile.decades[d] ?? 0 : 0;

  // Frequencies can exceed 1 when summed across multiple matches; squash softly
  const raw = 0.6 * Math.min(styleScore, 1) + 0.3 * Math.min(genreScore, 1) + 0.1 * Math.min(decadeScore, 1);
  return Math.round(raw * 1000) / 10;
}

/** Top-N entries of a frequency map, as [name, share] pairs. */
export function topEntries(map: Record<string, number>, n: number): [string, number][] {
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}
