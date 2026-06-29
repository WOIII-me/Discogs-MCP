import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetContext, ToolContext } from "./context.js";
import { errorResult, jsonResult, safeTool } from "./context.js";
import {
  normalizeAxis,
  rankVersionsByQuickSignals,
  scorePressing,
  type Axis,
} from "../../utils/pressing-scoring.js";
import { versionLooksAudiophile } from "../../utils/pressing-reputation.js";
import { fetchFullCollection } from "../../utils/collection.js";
import { RateLimitError } from "../../clients/discogs.js";
import type { DiscogsMasterVersion, DiscogsRelease } from "../../clients/types.js";

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
 * flag so the tool can report a partial result honestly.
 */
async function fetchReleases(
  ctx: ToolContext,
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

  // Reserve roughly half the remaining budget for audiophile reissues so the
  // other half is left for demand-ranked originals.
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

  // Fill the rest with the most in-demand pressings (vintage originals, etc.).
  for (const v of rankVersionsByQuickSignals(versions)) add(v);
  return [...picked.values()];
}

async function fetchAllVersions(
  ctx: ToolContext,
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

/** Resolve a master ID from either a release ID or an artist+title search. */
async function resolveMasterId(
  ctx: ToolContext,
  params: { releaseId?: number; albumTitle?: string; artistName?: string }
): Promise<{ masterId: number } | { error: string }> {
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

function pressingSummary(release: DiscogsRelease) {
  return {
    releaseId: release.id,
    title: release.title,
    country: release.country,
    year: release.year,
    released: release.released,
    label: release.labels?.[0]?.name ?? "Unknown",
    catno: release.labels?.[0]?.catno ?? "",
    format:
      release.formats?.map((f) => [f.name, ...(f.descriptions ?? [])].join(" ")).join(", ") ??
      "Unknown",
    rating: release.community?.rating?.average ?? 0,
    ratingCount: release.community?.rating?.count ?? 0,
    have: release.community?.have ?? 0,
    want: release.community?.want ?? 0,
    lowestPrice: release.lowest_price ?? null,
    numForSale: release.num_for_sale ?? 0,
    notesExcerpt: release.notes?.slice(0, 300) ?? "",
  };
}

/** Mean community rating across scored pressings, for the rating-delta factor. */
function baselineRating(releases: DiscogsRelease[]): number {
  const rated = releases.filter((r) => (r.community?.rating?.count ?? 0) >= 3);
  if (rated.length === 0) return 0;
  const sum = rated.reduce((s, r) => s + (r.community?.rating?.average ?? 0), 0);
  return sum / rated.length;
}

const AXIS_DESCRIPTION =
  "Scoring axis: 'sonic' (best-sounding — mastering pedigree, format, rating vs. album baseline; default), " +
  "'collector' (most desirable/original — demand, value, originality), " +
  "'value' (best sound per dollar).";

export function registerPressingTools(server: McpServer, getContext: GetContext): void {
  server.registerTool(
    "get_release_versions",
    {
      description:
        "List all pressings/versions of a master release, with optional country/format filters. " +
        "Note: this listing has no community ratings (Discogs API limitation) — " +
        "use find_best_pressing or compare_pressings for rated comparisons.",
      inputSchema: {
        masterId: z.number().int().describe("Discogs master release ID"),
        filterCountry: z.string().optional().describe("Only versions from this country, e.g. 'Japan'"),
        filterFormat: z.string().optional().describe("Only versions whose format contains this, e.g. 'Vinyl'"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 50)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();
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
      return jsonResult({
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
      });
    })
  );

  server.registerTool(
    "find_best_pressing",
    {
      description:
        "Find the best pressing of an album along a chosen axis. Identifies the master release, " +
        "surveys all versions, and fetches full details for a stratified candidate set that ALWAYS " +
        "includes audiophile reissues (Mobile Fidelity, Analogue Productions, Tone Poet, etc.) plus the " +
        "top pressings by collector demand. Each candidate is scored on multiple weighted signals — " +
        "mastering pedigree (reputable label by id, renowned engineer credits, matrix/runout stamper " +
        "marks, pressing studio), format/medium quality, used-market price & scarcity, collector demand, " +
        "and how its community rating compares to the album baseline — using evidence-weighting so " +
        "missing data doesn't penalise a pressing. Returns ranked results with a per-factor breakdown, " +
        "the concrete signals found, mastering credits, and price. Costs ~15 API calls.",
      inputSchema: {
        releaseId: z.number().int().optional().describe("Discogs release ID, if known"),
        albumTitle: z.string().optional().describe("Album title to search for"),
        artistName: z.string().optional().describe("Artist name (improves search accuracy)"),
        axis: z.enum(["sonic", "collector", "value"]).optional().describe(AXIS_DESCRIPTION),
        preferredFormats: z
          .array(z.string())
          .optional()
          .describe("Restrict to formats, e.g. ['Vinyl'] — matched against the version format string"),
        topN: z.number().int().min(1).max(10).optional().describe("How many top pressings to return (default 3)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();

      const resolved = await resolveMasterId(ctx, params);
      if ("error" in resolved) return errorResult(resolved.error);
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
        if (pool.length === 0) pool = versions; // don't dead-end on a too-strict filter
      }

      const axis: Axis = normalizeAxis(params.axis);
      // Stratified: always score audiophile reissues + main release, then fill
      // by demand. Fetch detail only for this bounded set (no ratings in the list).
      const candidates = selectCandidates(pool, master.main_release, DETAIL_BUDGET);

      const { releases, rateLimited, attempted } = await fetchReleases(ctx, candidates);
      if (releases.length === 0) {
        return errorResult(
          "Couldn't fetch any pressing details — Discogs is rate-limiting. Wait ~60s and try again."
        );
      }
      const baseline = baselineRating(releases);
      const scored = releases
        .map((release) => ({ release, score: scorePressing(release, axis, { baselineRating: baseline }) }))
        .sort((a, b) => b.score.overallScore - a.score.overallScore);

      const ownedIds = new Set(collection.items.map((i) => i.id));
      const topN = params.topN ?? 3;

      return jsonResult({
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
        topPressings: scored.slice(0, topN).map((p, i) => ({
          rank: i + 1,
          ...pressingSummary(p.release),
          overallScore: p.score.overallScore,
          factors: p.score.factors,
          signals: p.score.signals,
          masteringCredits: p.score.masteringCredits,
          inYourCollection: ownedIds.has(p.release.id),
        })),
      });
    })
  );

  server.registerTool(
    "compare_pressings",
    {
      description:
        "Side-by-side comparison of 2–5 specific pressings by release ID along a chosen axis: " +
        "mastering pedigree & signals, format, used price, ratings (incl. delta vs. the set average), " +
        "collector demand, and overall evidence-weighted scores.",
      inputSchema: {
        releaseIds: z
          .array(z.number().int())
          .min(2)
          .max(5)
          .describe("Discogs release IDs to compare"),
        axis: z.enum(["sonic", "collector", "value"]).optional().describe(AXIS_DESCRIPTION),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();
      const axis: Axis = normalizeAxis(params.axis);

      const [{ releases, rateLimited }, collection] = await Promise.all([
        fetchReleases(ctx, params.releaseIds.map((id) => ({ id })), 3),
        fetchFullCollection(ctx.client, ctx.username),
      ]);
      if (releases.length === 0) {
        return errorResult(
          "None of the given release IDs could be fetched" +
            (rateLimited ? " — Discogs is rate-limiting; wait ~60s and retry." : ".")
        );
      }
      const ownedIds = new Set(collection.items.map((i) => i.id));
      const baseline = baselineRating(releases);

      const compared = releases
        .map((release) => ({ release, score: scorePressing(release, axis, { baselineRating: baseline }) }))
        .sort((a, b) => b.score.overallScore - a.score.overallScore);

      return jsonResult({
        axis,
        ...(rateLimited ? { partial: true, note: RATE_LIMIT_NOTE } : {}),
        albumBaselineRating: Math.round(baseline * 100) / 100,
        verdict: `Highest scoring (${axis}): release ${compared[0].release.id} (${compared[0].release.title}, ${compared[0].release.country ?? "?"} ${compared[0].release.year || "?"})`,
        pressings: compared.map((p) => ({
          ...pressingSummary(p.release),
          overallScore: p.score.overallScore,
          factors: p.score.factors,
          signals: p.score.signals,
          masteringCredits: p.score.masteringCredits,
          inYourCollection: ownedIds.has(p.release.id),
        })),
      });
    })
  );
}
