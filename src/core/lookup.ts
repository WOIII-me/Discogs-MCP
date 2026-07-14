import { findBestPressing, type CoreContext, type CoreResult, type DossierEntry } from "./pressings.js";
import { tasteFitFromCollection, type TasteFit } from "./taste.js";
import {
  fetchFullCollection,
  fetchFullWantlist,
  peekFullCollection,
  peekFullWantlist,
  type FullCollection,
} from "../utils/collection.js";
import { buildDossier } from "../utils/pressing-dossier.js";
import { normalizeAxis, scorePressing, type Axis } from "../utils/pressing-scoring.js";

/**
 * The browser extension's primary call: given a release the user is looking at,
 * return a compact verdict — this pressing's score, the album's best pressing
 * on the chosen axis, taste-fit, and owned/wanted flags.
 *
 * Two levels:
 * - `summary` — at most one cold Discogs call (the release itself). The
 *   collection/wantlist aggregates are consulted READ-ONLY: cold aggregates
 *   mean personalization fields are null ("unknown", not "no"), never a crawl.
 *   No album survey.
 * - `full` (default) — everything, including the best-pressing survey. The
 *   candidate budget adapts to the remaining Discogs rate budget, and when
 *   even a reduced survey can't safely start, the result is a deferral the
 *   API maps to HTTP 202 + retryAfter.
 */

export type AnalyzeLevel = "summary" | "full";

export interface AnalyzeMeta {
  level: AnalyzeLevel;
  /** "hit" = served entirely from cache (zero Discogs calls). */
  cacheStatus: "hit" | "miss";
  /** "pending" = aggregates were cold in summary mode; fields are null. */
  personalization: "ready" | "pending";
  candidatesScored: number | null;
  candidatesTarget: number | null;
  /** Discogs requests this analysis actually issued. */
  upstreamCalls: number;
}

export interface ReleaseAnalysis {
  release: {
    id: number;
    title: string;
    artists?: string[];
    year: number;
    country?: string;
    label: string;
    catno: string;
    format: string;
  };
  axis: Axis;
  thisPressing: DossierEntry;
  bestPressing: DossierEntry | null;
  albumBaselineRating: number;
  /** null in summary mode when the aggregates were cold (unknown ≠ false). */
  tasteFit: TasteFit | null;
  owned: boolean | null;
  wanted: boolean | null;
  dataCaveats: string[];
  meta: AnalyzeMeta;
}

export type AnalyzeReleaseResult =
  | { ok: true; data: ReleaseAnalysis }
  | { ok: false; error: string }
  | { ok: false; deferred: { retryAfter: number } };

/** Shrink the survey to fit the remaining rate budget; null = can't start. */
function surveyBudget(remaining: number | null): number | null {
  if (remaining === null) return 16; // no signal yet — caches may cover it all
  if (remaining >= 28) return 16;
  if (remaining >= 14) return 6;
  return null;
}

export async function analyzeRelease(
  ctx: CoreContext,
  releaseId: number,
  axisInput?: string,
  level: AnalyzeLevel = "full"
): Promise<AnalyzeReleaseResult> {
  const axis: Axis = normalizeAxis(axisInput);
  const rel = await ctx.client.getRelease(releaseId);

  // Personalization: full mode builds the aggregates (one crawl each at
  // most, single-flighted); summary mode only peeks at what's already cached.
  let collection: FullCollection | null;
  let wantlist: FullCollection | null;
  if (level === "full") {
    [collection, wantlist] = await Promise.all([
      fetchFullCollection(ctx.client, ctx.username),
      fetchFullWantlist(ctx.client, ctx.username),
    ]);
  } else {
    [collection, wantlist] = await Promise.all([
      peekFullCollection(ctx.client, ctx.username),
      peekFullWantlist(ctx.client, ctx.username),
    ]);
  }
  // Derived from the aggregate fetched/peeked above — never a second crawl.
  const fit = collection
    ? tasteFitFromCollection(collection, { genres: rel.genres, styles: rel.styles, year: rel.year })
    : null;
  const owned = collection ? collection.items.some((i) => i.id === releaseId) : null;
  const wanted = wantlist ? wantlist.items.some((i) => i.id === releaseId) : null;

  // Survey the album when there's a master, to get the best pressing + a
  // proper baseline. Summary mode skips it; full mode sizes it to the budget.
  let bestPressing: DossierEntry | null = null;
  let baseline = rel.community?.rating?.count && rel.community.rating.count >= 3 ? rel.community.rating.average : 0;
  let dataCaveats = [
    "Scoring is reputation- and community-data-based, not measured audio quality.",
  ];
  let candidatesScored: number | null = null;
  let candidatesTarget: number | null = null;

  if (level === "full" && rel.master_id) {
    const detailBudget = surveyBudget(ctx.client.rateLimitRemaining);
    if (detailBudget === null) {
      // Not enough budget for even a reduced survey — defer instead of
      // grinding into a guaranteed 429. The client retries after cooldown;
      // everything fetched so far is KV-cached, so the retry is cheap.
      return { ok: false, deferred: { retryAfter: 60 } };
    }
    const survey = await findBestPressing(ctx, { releaseId, axis, topN: 3, detailBudget });
    if (survey.ok) {
      bestPressing = survey.data.topPressings[0] ?? null;
      baseline = survey.data.albumBaselineRating;
      dataCaveats = survey.data.dataCaveats;
      candidatesScored = survey.data.album.candidatesScored;
      candidatesTarget = survey.data.album.candidatesAttempted;
    }
  }

  // This pressing's own dossier (reuse the surveyed entry if it was scored).
  const fromSurvey =
    bestPressing && bestPressing.releaseId === releaseId
      ? bestPressing
      : null;
  const thisPressing: DossierEntry =
    fromSurvey ?? {
      ...buildDossier(rel, scorePressing(rel, axis, { baselineRating: baseline }), baseline),
      inYourCollection: owned ?? false,
    };

  return {
    ok: true,
    data: {
      release: {
        id: rel.id,
        title: rel.title,
        artists: rel.artists?.map((a) => a.name),
        year: rel.year,
        country: rel.country,
        label: rel.labels?.[0]?.name ?? "Unknown",
        catno: rel.labels?.[0]?.catno ?? "",
        format: rel.formats?.map((f) => [f.name, ...(f.descriptions ?? [])].join(" ")).join(", ") ?? "Unknown",
      },
      axis,
      thisPressing,
      bestPressing,
      albumBaselineRating: Math.round(baseline * 100) / 100,
      tasteFit: fit,
      owned,
      wanted,
      dataCaveats,
      meta: {
        level,
        cacheStatus: ctx.client.upstreamCalls === 0 ? "hit" : "miss",
        personalization: collection ? "ready" : "pending",
        candidatesScored,
        candidatesTarget,
        upstreamCalls: ctx.client.upstreamCalls,
      },
    },
  };
}

/** Analyze an album by artist+title (resolves to its master, then ranks pressings). */
export async function analyzeAlbum(
  ctx: CoreContext,
  query: { artist?: string; title: string },
  axisInput?: string
): Promise<CoreResult<unknown>> {
  const axis: Axis = normalizeAxis(axisInput);
  const survey = await findBestPressing(ctx, {
    albumTitle: query.title,
    artistName: query.artist,
    axis,
    topN: 3,
  });
  if (!survey.ok) return survey;
  return { ok: true, data: { ...survey.data } };
}
