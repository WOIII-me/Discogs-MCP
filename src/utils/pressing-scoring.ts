import type { DiscogsRelease, DiscogsMasterVersion } from "../clients/types.js";
import {
  scoreReputation,
  masteringCredits,
  nonConsumerPressing,
  type ReputationDetail,
  type ReputationResult,
} from "./pressing-reputation.js";

/**
 * Pressing quality is judged along an explicit AXIS, because "best" is
 * ambiguous: the best-sounding pressing, the most collectible one, and the
 * best value are often different records.
 */
export type Axis = "sonic" | "collector" | "value";

/** Backward-compatible aliases for the previous preferenceMetric values. */
export function normalizeAxis(value: string | undefined): Axis {
  switch (value) {
    case "collector":
    case "rarity":
      return "collector";
    case "value":
      return "value";
    case "sonic":
    case "rating":
    case "balanced":
    default:
      return "sonic";
  }
}

export interface Factor {
  score: number; // 0–100
  confidence: number; // 0–1: how much evidence backs this score
}

export interface PressingScore {
  releaseId: number;
  axis: Axis;
  overallScore: number; // 0–100, evidence-weighted
  /** 0–1: Σ(weightᵢ·confidenceᵢ)/Σ(weightᵢ) for the axis — how well-supported the score is. */
  evidenceCoverage: number;
  /** Provisional, deterministic label, e.g. "strong sonic pick", "thin data - low confidence". */
  verdict: string;
  factors: Record<string, Factor & { weight: number }>;
  signals: string[]; // human-readable provenance for the sonic/pedigree signals
  masteringCredits: string[];
  reputationDetail: ReputationDetail;
}

/** Deterministic, concise verdict from score + coverage + reputation. */
function deriveVerdict(
  axis: Axis,
  overallScore: number,
  coverage: number,
  rep: ReputationResult
): string {
  if (coverage < 0.35) return "thin data - low confidence";
  const high = overallScore >= 70;
  const isReissue = Boolean(rep.detail.label) || rep.detail.formatCues.length > 0;
  if (axis === "sonic") {
    if (high && rep.score >= 60 && rep.confidence > 0) return "strong sonic pick";
    if (high && isReissue) return "audiophile reissue";
  }
  if (axis === "collector" && high) return "strong collector pick";
  if (axis === "value" && high) return "strong value pick";
  if (high && isReissue) return "audiophile reissue";
  return overallScore >= 50 ? "solid pick" : "weak evidence";
}

// Base weights per axis. Effective weight is wᵢ · confidenceᵢ, so factors with
// no evidence drop out instead of dragging the score toward zero.
const AXIS_WEIGHTS: Record<Axis, Record<string, number>> = {
  // Best-sounding: mastering pedigree and format dominate; how this pressing
  // rates relative to the album baseline matters more than absolute rating.
  sonic: { pedigree: 0.45, format: 0.15, ratingDelta: 0.25, marketValue: 0.1, consensus: 0.05 },
  // Most collectible: demand, real-money value, originality.
  collector: { consensus: 0.35, marketValue: 0.25, ratingAbsolute: 0.15, pedigree: 0.1, format: 0.05 },
  // Best value: sonic goodness per dollar — affordability replaces market value.
  value: { pedigree: 0.4, format: 0.15, ratingDelta: 0.2, affordability: 0.25 },
};

// Format quality bonuses (medium/cut quality, independent of mastering pedigree).
const FORMAT_SCORES: { pattern: RegExp; score: number }[] = [
  { pattern: /\bvinyl\b|\blp\b|\b12"/i, score: 60 },
  { pattern: /\bsacd\b|\bhdcd\b/i, score: 45 },
  { pattern: /180\s*g/i, score: 20 },
  { pattern: /45\s*rpm/i, score: 15 },
  { pattern: /\bmono\b/i, score: 5 },
  { pattern: /\bcd\b/i, score: 20 },
  { pattern: /\bfile\b|\bmp3\b|\bflac\b/i, score: 5 },
];

function formatString(release: DiscogsRelease): string {
  return release.formats?.map((f) => [f.name, ...(f.descriptions ?? [])].join(" ")).join(", ") ?? "";
}

/**
 * Rating score with confidence weighting: a 5.0 from 3 ratings should not beat
 * a 4.7 from 500. Confidence saturates at 50 ratings.
 */
export function scoreRating(average: number, count: number): number {
  if (count < 3) return 0;
  const confidence = Math.min(count, 50) / 50;
  const normalized = (average / 5) * 100;
  return Math.round(normalized * (0.5 + 0.5 * confidence) * 10) / 10;
}

function ratingConfidence(count: number): number {
  if (count < 3) return 0;
  return Math.min(count, 50) / 50;
}

/**
 * Collector-demand signal from have/want counts. Blends want-ratio (desirability)
 * with absolute want volume (log-scaled) so an ultra-scarce pressing with a few
 * hundred wants can't outrank a classic with thousands of wants on ratio alone.
 */
export function scoreConsensus(have: number, want: number): number {
  if (have + want === 0) return 0;
  const wantRatio = want / (have + want); // 0–1 desirability
  const volume = Math.min(Math.log10(want + 1) / Math.log10(10000), 1); // 0–1, saturates ~10k wants
  return Math.round(Math.min(wantRatio * 65 + volume * 35, 100) * 10) / 10;
}

export function scoreFormat(release: DiscogsRelease): number {
  const fmt = formatString(release);
  let score = 0;
  for (const { pattern, score: s } of FORMAT_SCORES) {
    if (pattern.test(fmt)) score += s;
  }
  return Math.max(0, Math.min(score, 100));
}

/** Used-market price as a desirability proxy. Log-scaled; ~$300 ≈ 100. */
export function scorePrice(lowestPrice?: number): number {
  if (!lowestPrice || lowestPrice <= 0) return 0;
  return Math.min(Math.round((Math.log10(lowestPrice + 1) / Math.log10(301)) * 100), 100);
}

/**
 * How this pressing's community rating compares to the album's baseline
 * (mean across the compared pressings). 50 = on par; +1.0 star ≈ 100.
 */
export function scoreRatingDelta(average: number, count: number, baseline: number): number {
  if (count < 3 || baseline <= 0) return 50; // neutral when we can't tell
  const delta = average - baseline; // in stars
  return Math.max(0, Math.min(100, Math.round(50 + delta * 50)));
}

export interface ScoreContext {
  /** Mean community rating across the compared pressings, for the delta factor. */
  baselineRating?: number;
}

export function scorePressing(
  release: DiscogsRelease,
  axis: Axis = "sonic",
  ctx: ScoreContext = {}
): PressingScore {
  const rep = scoreReputation(release);
  const ratingAvg = release.community?.rating?.average ?? 0;
  const ratingCount = release.community?.rating?.count ?? 0;
  const price = release.lowest_price;
  const priceScore = scorePrice(price);
  const priceConf = price && price > 0 ? Math.min((release.num_for_sale ?? 0) / 3 + 0.34, 1) : 0;

  const all: Record<string, Factor> = {
    pedigree: { score: rep.score, confidence: rep.confidence },
    format: { score: scoreFormat(release), confidence: 1 },
    ratingDelta: {
      score: scoreRatingDelta(ratingAvg, ratingCount, ctx.baselineRating ?? 0),
      confidence: ratingConfidence(ratingCount),
    },
    ratingAbsolute: { score: scoreRating(ratingAvg, ratingCount), confidence: ratingConfidence(ratingCount) },
    consensus: {
      score: scoreConsensus(release.community?.have ?? 0, release.community?.want ?? 0),
      confidence: (release.community?.have ?? 0) + (release.community?.want ?? 0) > 0 ? 1 : 0,
    },
    marketValue: { score: priceScore, confidence: priceConf },
    affordability: { score: 100 - priceScore, confidence: priceConf },
  };

  const weights = AXIS_WEIGHTS[axis];
  const factors: Record<string, Factor & { weight: number }> = {};
  let weightedSum = 0;
  let weightTotal = 0; // Σ(weightᵢ·confidenceᵢ)
  let coverageDenom = 0; // Σ(weightᵢ) over the axis's configured factors
  for (const [name, weight] of Object.entries(weights)) {
    const f = all[name];
    if (!f) continue;
    factors[name] = { ...f, weight };
    coverageDenom += weight;
    const effective = weight * f.confidence;
    weightedSum += effective * f.score;
    weightTotal += effective;
  }

  const rawScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
  // Coverage uses the configured-weight sum as denominator (NOT 1 — collector
  // weights sum to 0.9, so hardcoding 1 would understate coverage).
  const evidenceCoverage = coverageDenom > 0 ? Math.round((weightTotal / coverageDenom) * 100) / 100 : 0;

  // A test pressing / promo / acetate carries a reputable label's pedigree but
  // isn't a buyable, representative copy — penalise it so it can't top a "best
  // pressing to buy" ranking, and flag it explicitly.
  const isNonConsumer = nonConsumerPressing(formatString(release));
  const overallScore = Math.round(rawScore * (isNonConsumer ? 0.5 : 1) * 10) / 10;
  const signals = isNonConsumer
    ? [...rep.signals, "Test pressing / promo — not a standard retail copy"]
    : rep.signals;
  const verdict = isNonConsumer
    ? "test pressing / promo — not a retail copy"
    : deriveVerdict(axis, overallScore, evidenceCoverage, rep);

  return {
    releaseId: release.id,
    axis,
    overallScore,
    evidenceCoverage,
    verdict,
    factors,
    signals,
    masteringCredits: masteringCredits(release),
    reputationDetail: rep.detail,
  };
}

/**
 * Pre-rank versions by quick signals to choose which to fetch in detail (the
 * versions endpoint carries no ratings). Used to fill the demand-based slots
 * of the candidate set; audiophile reissues are added separately by the tool.
 */
export function rankVersionsByQuickSignals(
  versions: DiscogsMasterVersion[]
): DiscogsMasterVersion[] {
  return [...versions].sort((a, b) => {
    const aVinyl = /vinyl|\blp\b/i.test(a.format) ? 1 : 0;
    const bVinyl = /vinyl|\blp\b/i.test(b.format) ? 1 : 0;
    if (bVinyl !== aVinyl) return bVinyl - aVinyl;

    const aWant = a.stats?.community?.in_wantlist ?? 0;
    const bWant = b.stats?.community?.in_wantlist ?? 0;
    if (bWant !== aWant) return bWant - aWant;

    const aHave = a.stats?.community?.in_collection ?? 0;
    const bHave = b.stats?.community?.in_collection ?? 0;
    return bHave - aHave;
  });
}
