import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
function toToolResult(r: CoreResult<unknown>) {
  return r.ok ? jsonResult(r.data) : errorResult(r.error);
}

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
        "mastering credits, matrix/runout, price, a provisional verdict, and evidenceCoverage). " +
        "Costs ~15 API calls.",
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
    safeTool(async (params) => toToolResult(await findBestPressing(getContext(), params)))
  );

  server.registerTool(
    "compare_pressings",
    {
      description:
        "Side-by-side comparison of 2–5 specific pressings by release ID along a chosen axis: " +
        "mastering pedigree & signals, format, used price, ratings (incl. delta vs. the set average), " +
        "collector demand, and overall evidence-weighted scores — each as a full evidence dossier.",
      inputSchema: {
        releaseIds: z
          .array(z.number().int())
          .min(2)
          .max(5)
          .describe("Discogs release IDs to compare"),
        axis: z.enum(["sonic", "collector", "value"]).optional().describe(AXIS_DESCRIPTION),
      },
    },
    safeTool(async (params) => toToolResult(await comparePressings(getContext(), params)))
  );
}
