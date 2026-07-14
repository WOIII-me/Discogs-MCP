import { findBestPressing, type CoreContext, type CoreResult, type DossierEntry } from "./pressings.js";
import { tasteFitFromCollection, type TasteFit } from "./taste.js";
import { fetchFullCollection, fetchFullWantlist } from "../utils/collection.js";
import { buildDossier } from "../utils/pressing-dossier.js";
import { normalizeAxis, scorePressing, type Axis } from "../utils/pressing-scoring.js";

/**
 * The browser extension's primary call: given a release the user is looking at,
 * return a compact verdict — this pressing's score, the album's best pressing
 * on the chosen axis, taste-fit, and owned/wanted flags.
 */
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
  tasteFit: TasteFit;
  owned: boolean;
  wanted: boolean;
  dataCaveats: string[];
}

export async function analyzeRelease(
  ctx: CoreContext,
  releaseId: number,
  axisInput?: string
): Promise<CoreResult<ReleaseAnalysis>> {
  const axis: Axis = normalizeAxis(axisInput);
  const rel = await ctx.client.getRelease(releaseId);

  const [collection, wantlist] = await Promise.all([
    fetchFullCollection(ctx.client, ctx.username),
    fetchFullWantlist(ctx.client, ctx.username),
  ]);
  // Derived from the collection fetched above — never a second crawl.
  const fit = tasteFitFromCollection(collection, { genres: rel.genres, styles: rel.styles, year: rel.year });
  const owned = collection.items.some((i) => i.id === releaseId);
  const wanted = wantlist.items.some((i) => i.id === releaseId);

  // Survey the album when there's a master, to get the best pressing + a
  // proper baseline. The findBestPressing cache makes repeat overlay views cheap.
  let bestPressing: DossierEntry | null = null;
  let baseline = rel.community?.rating?.count && rel.community.rating.count >= 3 ? rel.community.rating.average : 0;
  let dataCaveats = [
    "Scoring is reputation- and community-data-based, not measured audio quality.",
  ];

  if (rel.master_id) {
    const survey = await findBestPressing(ctx, { releaseId, axis, topN: 3 });
    if (survey.ok) {
      bestPressing = survey.data.topPressings[0] ?? null;
      baseline = survey.data.albumBaselineRating;
      dataCaveats = survey.data.dataCaveats;
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
      inYourCollection: owned,
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
