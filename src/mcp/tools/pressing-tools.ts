import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GetContext } from "./context.js";
import { errorResult, jsonResult, safeTool } from "./context.js";
import {
  comparePressings,
  findBestPressing,
  getReleaseVersions,
  type CoreResult,
} from "../../core/pressings.js";

const AXIS_DESCRIPTION =
  "Scoring axis: 'sonic' (best-sounding — mastering pedigree, format, rating vs. album baseline; default), " +
  "'collector' (most desirable/original — demand, value, originality), " +
  "'value' (best sound per dollar).";

/** Map a core result to an MCP tool result. */
function toToolResult<T>(r: CoreResult<T>) {
  return r.ok ? jsonResult(r.data) : errorResult(r.error);
}

export function registerPressingTools(server: McpServer, getContext: GetContext): void {
  server.registerTool(
    "get_release_versions",
    {
      description:
        "List pressings/versions of a master release with optional country, year-range and format " +
        "filters (filters are exact/inclusive and fetch deeper into long version lists). Rows carry " +
        "label, catno, country, released, format and majorFormats but NO ratings, runouts or credits " +
        "(Discogs API limitation). To inspect many filtered versions in detail — runouts, mastering " +
        "credits, scores — call find_best_pressing with the same filters and topN up to 16 instead of " +
        "fetching releases one by one.",
      inputSchema: {
        masterId: z.number().int().describe("Discogs master release ID"),
        filterCountry: z.string().optional().describe("Only versions from this country — exact match with aliases, e.g. 'US', 'UK', 'Japan'"),
        filterFormat: z.string().optional().describe("Only versions whose format or majorFormats contain this, e.g. 'Vinyl' (also matches rows listed as 'LP')"),
        yearFrom: z.number().int().optional().describe("Earliest release year, inclusive, e.g. 1970"),
        yearTo: z.number().int().optional().describe("Latest release year, inclusive, e.g. 1979"),
        limit: z.number().int().min(1).optional().describe("Max results (default 50, maximum 100; larger values are clamped)"),
      },
    },
    safeTool(async (params) => toToolResult(await getReleaseVersions(getContext(), params)))
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
        "missing data doesn't penalise a pressing. Returns an evidence dossier per pressing (signals, " +
        "mastering credits, matrix/runout, price, a provisional verdict, evidenceCoverage and, when " +
        "enabled, catalogClaims read from the notes). Optional filterCountry / yearFrom / yearTo / " +
        "filterFormat narrow the survey (e.g. US pressings 1970–1979) and topN up to 16 returns every " +
        "scored candidate — use this ONE call to compare a filtered set instead of many get_release " +
        "calls. Costs ~15 API calls; results are cached.",
      inputSchema: {
        masterId: z.number().int().optional().describe("Discogs master release ID, if known (e.g. from get_release_versions) — skips resolution"),
        releaseId: z.number().int().optional().describe("Discogs release ID, if known"),
        albumTitle: z.string().optional().describe("Album title to search for"),
        artistName: z.string().optional().describe("Artist name (improves search accuracy)"),
        axis: z.enum(["sonic", "collector", "value"]).optional().describe(AXIS_DESCRIPTION),
        preferredFormats: z
          .array(z.string())
          .optional()
          .describe("Soft preference for formats, e.g. ['Vinyl'] — falls back to all if nothing matches"),
        filterCountry: z.string().optional().describe("Hard filter: only versions from this country (exact, with aliases), e.g. 'US'"),
        yearFrom: z.number().int().optional().describe("Hard filter: earliest release year, inclusive"),
        yearTo: z.number().int().optional().describe("Hard filter: latest release year, inclusive"),
        topN: z.number().int().min(1).optional().describe("How many scored pressings to return (default 3, maximum 16; larger values are clamped)"),
      },
    },
    // MCP tool calls are deliberate actions: bounded claim inference is allowed.
    safeTool(async (params) => toToolResult(await findBestPressing(getContext(), { ...params, inferClaims: true })))
  );

  server.registerTool(
    "compare_pressings",
    {
      description:
        "Side-by-side comparison of 2–8 specific pressings by release ID along a chosen axis: " +
        "mastering pedigree & signals, format, used price, ratings (incl. delta vs. the set average), " +
        "collector demand, and overall evidence-weighted scores — each as a full evidence dossier.",
      inputSchema: {
        releaseIds: z
          .array(z.number().int())
          .min(2)
          .max(8)
          .describe("Discogs release IDs to compare"),
        axis: z.enum(["sonic", "collector", "value"]).optional().describe(AXIS_DESCRIPTION),
      },
    },
    safeTool(async (params) => toToolResult(await comparePressings(getContext(), { ...params, inferClaims: true })))
  );
}
