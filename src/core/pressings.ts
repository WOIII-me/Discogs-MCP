import type { CachedDiscogsClient } from "../clients/cached-discogs.js";
import type { ClaimsAnnotator, ClaimsByRelease } from "./claims.js";
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
  /** Optional Jev-backed notes reader. Undefined = feature off (dead code path). */
  claims?: ClaimsAnnotator;
}

/**
 * Catalog claims for a set of releases. `infer` may run bounded uncached
 * inference and is only ever true on deliberate actions (MCP pressing tools,
 * REST /api/compare); automatic paths get cache-only `peek`. Never throws.
 */
async function claimsFor(
  ctx: CoreContext,
  releases: DiscogsRelease[],
  infer: boolean
): Promise<ClaimsByRelease> {
  if (!ctx.claims) return new Map();
  try {
    return infer ? await ctx.claims.annotate(releases) : await ctx.claims.peek(releases);
  } catch {
    return new Map();
  }
}

export type CoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; rateLimited?: boolean };

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
    majorFormats: string[];
    inCollection: number;
    inWantlist: number;
  }[];
}

const MAX_VERSION_PAGES = 3; // 3 × 100 = 300 versions
/**
 * When the caller filters (country / year / format) they are asking a precise
 * question, and two more pages cost two calls — far cheaper than the fetch loop
 * a model runs when the list is truncated (36 get_release calls, 2026-09-22).
 */
const FILTERED_MAX_VERSION_PAGES = 5;

/** Shared version filters for get_release_versions and find_best_pressing. */
export interface VersionFilters {
  filterCountry?: string;
  /** Substring match against the format string AND major_formats, so "Vinyl" catches rows listed as "LP, Album". */
  filterFormat?: string;
  /** Inclusive release-year range; rows without a parseable year are excluded when a bound is set. */
  yearFrom?: number;
  yearTo?: number;
}

export function hasVersionFilters(f: VersionFilters): boolean {
  return Boolean(f.filterCountry || f.filterFormat || f.yearFrom !== undefined || f.yearTo !== undefined);
}

/** Year of a Discogs version row: `released` is "1972", "1972-05-01" or "". */
export function versionYear(v: DiscogsMasterVersion): number | undefined {
  const m = /^(\d{4})/.exec(v.released ?? "");
  return m ? Number(m[1]) : undefined;
}

export function formatMatches(v: DiscogsMasterVersion, filter: string): boolean {
  const blob = `${v.format ?? ""} ${(v.major_formats ?? []).join(" ")}`.toLowerCase();
  return blob.includes(filter.trim().toLowerCase());
}

export function applyVersionFilters(versions: DiscogsMasterVersion[], f: VersionFilters): DiscogsMasterVersion[] {
  let out = versions;
  if (f.filterCountry) out = out.filter((v) => countryMatches(v.country, f.filterCountry!));
  if (f.filterFormat) out = out.filter((v) => formatMatches(v, f.filterFormat!));
  if (f.yearFrom !== undefined || f.yearTo !== undefined) {
    out = out.filter((v) => {
      const y = versionYear(v);
      if (y === undefined) return false;
      if (f.yearFrom !== undefined && y < f.yearFrom) return false;
      if (f.yearTo !== undefined && y > f.yearTo) return false;
      return true;
    });
  }
  return out;
}
/** Hard cap on versions returned by getReleaseVersions; larger requests are clamped, not rejected. */
export const MAX_VERSIONS_LIMIT = 100;

/**
 * Country filter with exact matching (case-insensitive) plus common aliases.
 * A substring test let "US" match "Australia" (2026-09-22). Discogs country
 * strings are canonical names, so equality after alias normalisation is right.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  us: "us", usa: "us", "u.s.": "us", "u.s.a.": "us", "united states": "us", "united states of america": "us",
  uk: "uk", "u.k.": "uk", "united kingdom": "uk", "great britain": "uk", britain: "uk", england: "uk",
  germany: "germany", "west germany": "west germany", deutschland: "germany",
  japan: "japan", nippon: "japan",
  netherlands: "netherlands", holland: "netherlands", "the netherlands": "netherlands",
};
function normalizeCountry(value: string): string {
  const v = value.trim().toLowerCase();
  return COUNTRY_ALIASES[v] ?? v;
}
export function countryMatches(country: string | undefined, filter: string): boolean {
  if (!country) return false;
  const want = normalizeCountry(filter);
  const have = normalizeCountry(country);
  if (have === want) return true;
  // Discogs multi-country strings: "UK & Europe", "US, Canada & Europe".
  return country
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map(normalizeCountry)
    .includes(want);
}
const DETAIL_BUDGET = 16; // max /releases/{id} fetches per find_best_pressing call

const RATE_LIMIT_NOTE =
  "Discogs rate-limited some pressing lookups, so this ranking is PARTIAL. The " +
  "pressings shown are real; rerun the same request in ~60s for the complete ranking " +
  "— already-fetched pressings are cached, so the rerun is fast.";

/**
 * Keep this many requests of the user's per-minute budget in reserve while
 * fetching optional survey candidates — enough headroom that the rest of the
 * analysis (and the user's own browsing) doesn't slam into a 429.
 */
const BUDGET_RESERVE = 8;

/**
 * Fetch release details for candidates in small concurrent batches, stopping
 * early the moment Discogs rate-limits us — and preemptively, before starting
 * a chunk the remaining budget can't afford. Returns whatever was retrieved
 * plus a rateLimited flag so callers can report a partial result honestly.
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
    // Candidates come from KV first; only cache misses cost budget. Stop
    // launching new chunks once the reported remaining budget can no longer
    // cover a full chunk plus the reserve. (No header seen yet = no gating.)
    const remaining = ctx.client.rateLimitRemaining;
    if (typeof remaining === "number" && remaining < chunk.length + BUDGET_RESERVE) {
      rateLimited = true;
      break;
    }
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
  masterId: number,
  maxPages: number = MAX_VERSION_PAGES
): Promise<{ versions: DiscogsMasterVersion[]; truncated: boolean }> {
  const versions: DiscogsMasterVersion[] = [];
  let page = 1;
  let truncated = false;
  for (;;) {
    const resp = await ctx.client.getMasterVersions(masterId, { page, per_page: 100 });
    versions.push(...resp.versions);
    if (page >= resp.pagination.pages) break;
    if (page >= maxPages) {
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
const CLAIMS_CAVEAT =
  "catalogClaims are a model's reading of each release's free-text notes (stated / denied / " +
  "contradictory, with a certainty score that is model certainty, not evidence strength). They are " +
  "annotations for you to weigh and quote with the cited sentence — not verified facts — and they do " +
  "not affect the scores. Surface QC complaints and denials to the user.";

function buildCaveats(opts: {
  rateLimited?: boolean;
  truncated?: boolean;
  versionListing?: boolean;
  hasClaims?: boolean;
}): string[] {
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
  if (opts.hasClaims) caveats.push(CLAIMS_CAVEAT);
  return caveats;
}

// === Public params & functions ===

export interface GetReleaseVersionsParams extends VersionFilters {
  masterId: number;
  limit?: number;
}

export async function getReleaseVersions(
  ctx: CoreContext,
  params: GetReleaseVersionsParams
): Promise<CoreResult<GetReleaseVersionsResult>> {
  const { versions, truncated } = await fetchAllVersions(
    ctx,
    params.masterId,
    hasVersionFilters(params) ? FILTERED_MAX_VERSION_PAGES : MAX_VERSION_PAGES
  );
  const filtered = applyVersionFilters(versions, params);

  const ranked = rankVersionsByQuickSignals(filtered);
  return {
    ok: true,
    data: {
      masterId: params.masterId,
      totalVersions: versions.length,
      matchingVersions: filtered.length,
      truncated,
      versions: ranked.slice(0, Math.max(1, Math.min(params.limit ?? 50, MAX_VERSIONS_LIMIT))).map((v) => ({
        releaseId: v.id,
        title: v.title,
        label: v.label,
        catno: v.catno,
        country: v.country,
        released: v.released,
        format: v.format,
        majorFormats: v.major_formats ?? [],
        inCollection: v.stats?.community?.in_collection ?? 0,
        inWantlist: v.stats?.community?.in_wantlist ?? 0,
      })),
    },
  };
}

export interface FindBestPressingParams extends VersionFilters {
  masterId?: number;
  releaseId?: number;
  albumTitle?: string;
  artistName?: string;
  axis?: string;
  preferredFormats?: string[];
  /** How many scored pressings to return; up to DETAIL_BUDGET so one call can survey a filtered set. */
  topN?: number;
  /** Cap on candidate detail fetches (default DETAIL_BUDGET). Progressive
   * analysis shrinks this when the remaining rate budget is constrained. */
  detailBudget?: number;
  /** Run bounded Jev inference for cache misses (deliberate actions only). Default: cache-only. */
  inferClaims?: boolean;
}

export async function findBestPressing(
  ctx: CoreContext,
  params: FindBestPressingParams
): Promise<CoreResult<FindBestPressingResult>> {
  const resolved = await resolveMasterId(ctx, params);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const { masterId } = resolved;

  const [{ versions, truncated }, master, collection] = await Promise.all([
    fetchAllVersions(ctx, masterId, hasVersionFilters(params) ? FILTERED_MAX_VERSION_PAGES : MAX_VERSION_PAGES),
    ctx.client.getMaster(masterId),
    fetchFullCollection(ctx.client, ctx.username),
  ]);

  let pool = versions;
  if (params.preferredFormats?.length) {
    // Soft preference: fall back to everything if nothing matches.
    const preferred = pool.filter((v) => params.preferredFormats!.some((f) => formatMatches(v, f)));
    if (preferred.length > 0) pool = preferred;
  }
  if (hasVersionFilters(params)) {
    // Hard filters: an explicit country/year/format question must not silently widen.
    pool = applyVersionFilters(pool, params);
    if (pool.length === 0) {
      return {
        ok: false,
        error:
          `No versions of "${master.title}" match the filters` +
          (truncated ? " within the first 500 versions surveyed (the list was truncated)." : "."),
      };
    }
  }

  const axis: Axis = normalizeAxis(params.axis);
  const candidates = selectCandidates(
    pool,
    master.main_release,
    Math.max(1, Math.min(params.detailBudget ?? DETAIL_BUDGET, DETAIL_BUDGET))
  );

  const { releases, rateLimited, attempted } = await fetchReleases(ctx, candidates);
  if (releases.length === 0) {
    return {
      ok: false,
      error: "Couldn't fetch any pressing details — Discogs is rate-limiting. Wait ~60s and try again.",
      rateLimited,
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
  const topN = Math.max(1, Math.min(params.topN ?? 3, DETAIL_BUDGET));
  const claims = await claimsFor(ctx, scored.slice(0, topN).map((p) => p.release), params.inferClaims === true);

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
      dataCaveats: buildCaveats({ rateLimited, truncated, versionListing: true, hasClaims: claims.size > 0 }),
      topPressings: scored.slice(0, topN).map((p, i) => ({
        rank: i + 1,
        ...buildDossier(p.release, p.score, baseline, claims.get(p.release.id)),
        inYourCollection: ownedIds.has(p.release.id),
      })),
    },
  };
}

export interface ComparePressingsParams {
  releaseIds: number[];
  axis?: string;
  /** Run bounded Jev inference for cache misses (deliberate actions only). Default: cache-only. */
  inferClaims?: boolean;
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
  const claims = await claimsFor(ctx, releases, params.inferClaims === true);

  return {
    ok: true,
    data: {
      axis,
      ...(rateLimited ? { partial: true, note: RATE_LIMIT_NOTE } : {}),
      albumBaselineRating: Math.round(baseline * 100) / 100,
      dataCaveats: buildCaveats({ rateLimited, hasClaims: claims.size > 0 }),
      topPick: `Highest scoring (${axis}): release ${compared[0].release.id} (${compared[0].release.title}, ${compared[0].release.country ?? "?"} ${compared[0].release.year || "?"})`,
      pressings: compared.map((p) => ({
        ...buildDossier(p.release, p.score, baseline, claims.get(p.release.id)),
        inYourCollection: ownedIds.has(p.release.id),
      })),
    },
  };
}
