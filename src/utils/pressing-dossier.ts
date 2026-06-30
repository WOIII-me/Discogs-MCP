import type { DiscogsRelease } from "../clients/types.js";
import type { Factor, PressingScore } from "./pressing-scoring.js";
import type { ReputationDetail } from "./pressing-reputation.js";

/**
 * A per-pressing evidence dossier: the existing summary fields (kept for
 * backward compatibility) plus structured evidence so a model or the extension
 * can explain *why* a pressing scored, not just trust the number.
 */
export interface PressingDossier {
  releaseId: number;
  title: string;
  country?: string;
  year: number;
  released?: string;
  label: string;
  catno: string;
  format: string;
  rating: number;
  ratingCount: number;
  have: number;
  want: number;
  lowestPrice: number | null;
  numForSale: number;
  notesExcerpt: string;
  // Scoring
  overallScore: number;
  evidenceCoverage: number;
  verdict: string;
  factors: Record<string, Factor & { weight: number }>;
  signals: string[];
  reputationDetail: ReputationDetail;
  masteringCredits: string[];
  // Structured evidence
  matrixRunout: { type: string; value: string; description?: string }[];
  pressingCompanies: { name: string; entityTypeName?: string }[];
  ratingDelta: { value: number | null; albumBaselineRating: number };
  whyItScores: string;
}

function formatString(release: DiscogsRelease): string {
  return release.formats?.map((f) => [f.name, ...(f.descriptions ?? [])].join(" ")).join(", ") ?? "Unknown";
}

/** One-line, human-readable summary of the pedigree signals (with a fallback). */
function whyItScores(signals: string[]): string {
  if (signals.length === 0) return "No strong mastering or pressing reputation signals found";
  return signals.slice(0, 3).join("; ");
}

/**
 * Build the dossier for one pressing. Pure: takes the release, its already-
 * computed score, and the album's baseline rating. Adds no Discogs calls.
 */
export function buildDossier(
  release: DiscogsRelease,
  score: PressingScore,
  albumBaselineRating: number
): PressingDossier {
  const ratingAvg = release.community?.rating?.average ?? 0;
  const ratingCount = release.community?.rating?.count ?? 0;
  const hasEnoughRatings = ratingCount >= 3 && albumBaselineRating > 0;

  return {
    releaseId: release.id,
    title: release.title,
    country: release.country,
    year: release.year,
    released: release.released,
    label: release.labels?.[0]?.name ?? "Unknown",
    catno: release.labels?.[0]?.catno ?? "",
    format: formatString(release),
    rating: ratingAvg,
    ratingCount,
    have: release.community?.have ?? 0,
    want: release.community?.want ?? 0,
    lowestPrice: release.lowest_price ?? null,
    numForSale: release.num_for_sale ?? 0,
    notesExcerpt: release.notes?.slice(0, 300) ?? "",
    overallScore: score.overallScore,
    evidenceCoverage: score.evidenceCoverage,
    verdict: score.verdict,
    factors: score.factors,
    signals: score.signals,
    reputationDetail: score.reputationDetail,
    masteringCredits: score.masteringCredits,
    matrixRunout: (release.identifiers ?? [])
      .filter((i) => /matrix|runout/i.test(i.type))
      .map((i) => ({ type: i.type, value: i.value, description: i.description })),
    pressingCompanies: (release.companies ?? []).map((c) => ({
      name: c.name,
      entityTypeName: c.entity_type_name,
    })),
    ratingDelta: {
      value: hasEnoughRatings ? Math.round((ratingAvg - albumBaselineRating) * 100) / 100 : null,
      albumBaselineRating: Math.round(albumBaselineRating * 100) / 100,
    },
    whyItScores: whyItScores(score.signals),
  };
}
