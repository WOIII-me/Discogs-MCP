import type { CachedDiscogsClient } from "../clients/cached-discogs.js";
import { RateLimitError } from "../clients/discogs.js";
import type { DiscogsMasterVersion, DiscogsRelease } from "../clients/types.js";
import { fetchFullCollection } from "../utils/collection.js";
import { buildDossier, type PressingDossier } from "../utils/pressing-dossier.js";
import { versionLooksAudiophile } from "../utils/pressing-reputation.js";
import {
  normalizeAxis,
  rankVersionsByQuickSignals,
  scorePressing,
  type Axis,
} from "../utils/pressing-scoring.js";

/**
 * Transport-agnostic pressing engine. Both the MCP tools and the REST API call
 * these. Functions return a discriminated `CoreResult` (no transport-specific
 * formatting), so callers map success/error to their own response shape.
 */
export interface CoreContext {
  client: CachedDiscogsClient;
  username: string;
}

export type CoreResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A scored pressing dossier as returned in tool/API responses. */
export type DossierEntry = PressingDossier & { inYourCollection: boolean; rank?: number };

export interface FindBestPressingResult {
  album: {
    title: string;
    artists?: string[];
    originalYear: number;
    masterId: number;
    totalVersionsSurveyed: number;
    candidatesScored: number;
    candidatesAttempted: number;
    versionsListTruncated: boolean;
  };
  axis: Axis;
  partial: boolean;
  note?: string;
  albumBaselineRating: number;
  dataCaveats: string[];
  topPressings: DossierEntry[];
}

export interface ComparePressingsResult {
  axis: Axis;
  partial?: boolean;
  note?: string;
  albumBaselineRating: number;
  dataCaveats: string[];
  topPick: string;
  pressings: DossierEntry[];
}

export interface GetReleaseVersionsResult {
  masterId: number;
  totalVersions: number;
  matchingVersions: number;
  truncated: boolean;
  versions: {
    releaseId: number;
    title: string;
    label: string;
    catno: string;
    country: string;
    released: string;
    format: string;
    inCollection: number;
    inWantlist: number;
  }[];
}

const MAX_VERSION_PAGES = 3; // 3 × 100 = 300 versions
const DETAIL_BUDGET = 16; // max /releases/{id} fetches per find_best_pressing call

const RATE_LIMIT_NOTE =
  "Discogs rate-limited some pressing lookups, so this ranking is PARTIAL. The " +
  "pressings shown are real; rerun the same request in ~60s for the complete ranking " +
  "— already-fetched pressings are cached, so the rerun is fast.";

/**
 * Fetch release details for candidates in small concurrent batches, stopping
 * early the moment Discogs rate-limits us (rather than grinding through every
 * candidate with retries). Returns whatever was retrieved plus a rateLimited
 * flag so callers can report a partial result honestly.
 */
async function fetchReleases(
  ctx: CoreContext,
  candidates: { id: number }[],
  concurrency = 4
): Promise<{ releases: DiscogsRelease[]; rateLimited: boolean; attempted: number }> {
  const releases: DiscogsRelease[] = [];
  let rateLimited = false;
  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map((c) => ctx.client.getRelease(c.id)));
    for (const s of settled) {
      if (s.status === "fulfilled") releases.push(s.value);
      else if (s.reason instanceof RateLimitError) rateLimited = true;
    }
    if (rateLimited) break; // don't keep hammering a rate-limited API
  }
  return { releases, rateLimited, attempted: candidates.length };
}

/**
 * Choose which versions to fetch in detail. Stratified so the candidate set
 * always spans BOTH worlds: audiophile reissues (which the demand-based ranking
 * would otherwise exclude) and the most in-demand pressings (the vintage
 * originals). Always includes the master's main release. Audiophile picks are
 * capped so they can't crowd out the demand-ranked originals, and vice versa.
 */
function selectCandidates(
  versions: DiscogsMasterVersion[],
  mainReleaseId: number | undefined,
  budget: number
): DiscogsMasterVersion[] {
  const picked = new Map<number, DiscogsMasterVersion>();
  const add = (v?: DiscogsMasterVersion) => {
    if (v && !picked.has(v.id) && picked.size < budget) picked.set(v.id, v);
  };

  add(versions.find((v) => v.id === mainReleaseId));

  const audiophileCap = Math.max(4, Math.floor(budget / 2));
  let audiophileCount = 0;
  for (const v of versions) {
    if (audiophileCount >= audiophileCap) break;
    if (versionLooksAudiophile(v.label ?? "", v.format ?? "")) {
      const before = picked.size;
      add(v);
      if (picked.size > before) audiophileCount++;
    }
  }

  for (const v of rankVersionsByQuickSignals(versions)) add(v);
  return [...picked.values()];
}

async function fetchAllVersions(
  ctx: CoreContext,
  masterId: number
): Promise<{ versions: DiscogsMasterVersion[]; truncated: boolean }> {
  const versions: DiscogsMasterVersion[] = [];
  let page = 1;
  let truncated = false;
  for (;;) {
    const resp = await ctx.client.getMasterVersions(masterId, { page, per_page: 100 });
    versions.push(...resp.versions);
    if (page >= resp.pagination.pages) break;
    if (page >= MAX_VERSION_PAGES) {
      truncated = true;
      break;
    }
    page++;
  }
  return { versions, truncated };
}

/** Resolve a master ID from a master ID, a release ID, or an artist+title search. */
async function resolveMasterId(
  ctx: CoreContext,
  params: { masterId?: number; releaseId?: number; albumTitle?: string; artistName?: string }
): Promise<{ masterId: number } | { error: string }> {
  if (params.masterId) return { masterId: params.masterId };
  if (params.releaseId) {
    const release = await ctx.client.getRelease(params.releaseId);
    if (!release.master_id) {
      return {
        error:
          `Release ${params.releaseId} ("${release.title}") has no master release — ` +
          `it appears to be the only known version, so there is nothing to compare.`,
      };
    }
    return { masterId: release.master_id };
  }
  if (params.albumTitle) {
    const q = [params.artistName, params.albumTitle].filter(Boolean).join(" ");
    const search = await ctx.client.search(q, { type: "master", per_page: 5 });
    if (search.results.length === 0) {
      return { error: `No master release found for "${q}".` };
    }
    return { masterId: search.results[0].id };
  }
  return { error: "Provide either releaseId, or albumTitle (ideally with artistName)." };
}

/** Mean community rating across scored pressings, for the rating-delta factor. */
function baselineRating(releases: DiscogsRelease[]): number {
  const rated = releases.filter((r) => (r.community?.rating?.count ?? 0) >= 3);
  if (rated.length === 0) return 0;
  const sum = rated.reduce((s, r) => s + (r.community?.rating?.average ?? 0), 0);
  return sum / rated.length;
}

/** Response-level caveats so a model/user reads the scores with the right priors. */
function buildCaveats(opts: { rateLimited?: boolean; truncated?: boolean; versionListing?: boolean }): string[] {
  const caveats = [
    "Scoring is reputation- and community-data-based, not measured audio quality.",
    "Ratings are user-submitted and can be thin for obscure pressings.",
  ];
  if (opts.versionListing) {
    caveats.push(
      "Discogs version listings carry no ratings, so only the bounded candidate set is fully scored."
    );
  }
  if (opts.truncated) {
    caveats.push("The version list was truncated; not every pressing was surveyed.");
  }
  if (opts.rateLimited) {
    caveats.push("Discogs rate-limited some lookups, so results are partial — rerun in ~60s for the full set.");
  }
  return caveats;
}

// === Public params & functions ===

export interface GetReleaseVersionsParams {
  masterId: number;
  filterCountry?: string;
  filterFormat?: string;
  limit?: number;
}

export async function getReleaseVersions(
  ctx: CoreContext,
  params: GetReleaseVersionsParams
): Promise<CoreResult<GetReleaseVersionsResult>> {
  const { versions, truncated } = await fetchAllVersions(ctx, params.masterId);

  let filtered = versions;
  if (params.filterCountry) {
    const c = params.filterCountry.toLowerCase();
    filtered = filtered.filter((v) => v.country?.toLowerCase().includes(c));
  }
  if (params.filterFormat) {
    const f = params.filterFormat.toLowerCase();
    filtered = filtered.filter((v) => v.format?.toLowerCase().includes(f));
  }

  const ranked = rankVersionsByQuickSignals(filtered);
  return {
    ok: true,
    data: {
      masterId: params.masterId,
      totalVersions: versions.length,
      matchingVersions: filtered.length,
      truncated,
      versions: ranked.slice(0, params.limit ?? 50).map((v) => ({
        releaseId: v.id,
        title: v.title,
        label: v.label,
        catno: v.catno,
        country: v.country,
        released: v.released,
        format: v.format,
        inCollection: v.stats?.community?.in_collection ?? 0,
        inWantlist: v.stats?.community?.in_wantlist ?? 0,
      })),
    },
  };
}

export interface FindBestPressingParams {
  masterId?: number;
  releaseId?: number;
  albumTitle?: string;
  artistName?: string;
  axis?: string;
  preferredFormats?: string[];
  topN?: number;
}

export async function findBestPressing(
  ctx: CoreContext,
  params: FindBestPressingParams
): Promise<CoreResult<FindBestPressingResult>> {
  const resolved = await resolveMasterId(ctx, params);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { masterId } = resolved;

  const [{ versions, truncated }, master, collection] = await Promise.all([
    fetchAllVersions(ctx, masterId),
    ctx.client.getMaster(masterId),
    fetchFullCollection(ctx.client, ctx.username),
  ]);

  let pool = versions;
  if (params.preferredFormats?.length) {
    const wanted = params.preferredFormats.map((f) => f.toLowerCase());
    pool = pool.filter((v) => wanted.some((f) => v.format?.toLowerCase().includes(f)));
    if (pool.length === 0) pool = versions;
  }

  const axis: Axis = normalizeAxis(params.axis);
  const candidates = selectCandidates(pool, master.main_release, DETAIL_BUDGET);

  const { releases, rateLimited, attempted } = await fetchReleases(ctx, candidates);
  if (releases.length === 0) {
    return {
      ok: false,
      error: "Couldn't fetch any pressing details — Discogs is rate-limiting. Wait ~60s and try again.",
    };
  }
  const baseline = baselineRating(releases);
  const albumTrackCount = master.tracklist?.length ?? 0;
  const scored = releases
    .map((release) => ({
      release,
      score: scorePressing(release, axis, { baselineRating: baseline, albumTrackCount }),
    }))
    .sort((a, b) => b.score.overallScore - a.score.overallScore);

  const ownedIds = new Set(collection.items.map((i) => i.id));
  const topN = params.topN ?? 3;

  return {
    ok: true,
    data: {
      album: {
        title: master.title,
        artists: master.artists?.map((a) => a.name),
        originalYear: master.year,
        masterId: master.id,
        totalVersionsSurveyed: versions.length,
        candidatesScored: scored.length,
        candidatesAttempted: attempted,
        versionsListTruncated: truncated,
      },
      axis,
      partial: rateLimited || scored.length < attempted,
      ...(rateLimited ? { note: RATE_LIMIT_NOTE } : {}),
      albumBaselineRating: Math.round(baseline * 100) / 100,
      dataCaveats: buildCaveats({ rateLimited, truncated, versionListing: true }),
      topPressings: scored.slice(0, topN).map((p, i) => ({
        rank: i + 1,
        ...buildDossier(p.release, p.score, baseline),
        inYourCollection: ownedIds.has(p.release.id),
      })),
    },
  };
}

export interface ComparePressingsParams {
  releaseIds: number[];
  axis?: string;
}

export async function comparePressings(
  ctx: CoreContext,
  params: ComparePressingsParams
): Promise<CoreResult<ComparePressingsResult>> {
  const axis: Axis = normalizeAxis(params.axis);

  const [{ releases, rateLimited }, collection] = await Promise.all([
    fetchReleases(ctx, params.releaseIds.map((id) => ({ id })), 3),
    fetchFullCollection(ctx.client, ctx.username),
  ]);
  if (releases.length === 0) {
    return {
      ok: false,
      error:
        "None of the given release IDs could be fetched" +
        (rateLimited ? " — Discogs is rate-limiting; wait ~60s and retry." : "."),
    };
  }
  const ownedIds = new Set(collection.items.map((i) => i.id));
  const baseline = baselineRating(releases);

  const compared = releases
    .map((release) => ({ release, score: scorePressing(release, axis, { baselineRating: baseline }) }))
    .sort((a, b) => b.score.overallScore - a.score.overallScore);

  return {
    ok: true,
    data: {
      axis,
      ...(rateLimited ? { partial: true, note: RATE_LIMIT_NOTE } : {}),
      albumBaselineRating: Math.round(baseline * 100) / 100,
      dataCaveats: buildCaveats({ rateLimited }),
      topPick: `Highest scoring (${axis}): release ${compared[0].release.id} (${compared[0].release.title}, ${compared[0].release.country ?? "?"} ${compared[0].release.year || "?"})`,
      pressings: compared.map((p) => ({
        ...buildDossier(p.release, p.score, baseline),
        inYourCollection: ownedIds.has(p.release.id),
      })),
    },
  };
}
