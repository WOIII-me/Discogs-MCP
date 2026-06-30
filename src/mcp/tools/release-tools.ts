import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetContext } from "./context.js";
import { jsonResult, safeTool } from "./context.js";
import { masteringCredits, scoreReputation } from "../../utils/pressing-reputation.js";
import type { DiscogsRelease } from "../../clients/types.js";

export function slimRelease(r: DiscogsRelease) {
  const rep = scoreReputation(r);
  return {
    id: r.id,
    title: r.title,
    artists: r.artists?.map((a) => a.name),
    year: r.year,
    released: r.released,
    country: r.country,
    masterId: r.master_id ?? null,
    labels: r.labels?.map((l) => ({ name: l.name, catno: l.catno })),
    formats: r.formats?.map((f) => [f.name, ...(f.descriptions ?? [])].join(", ")),
    genres: r.genres,
    styles: r.styles,
    notes: r.notes?.slice(0, 1000),
    tracklist: r.tracklist?.map((t) => `${t.position}. ${t.title} (${t.duration})`),
    community: r.community
      ? {
          ratingAverage: r.community.rating?.average,
          ratingCount: r.community.rating?.count,
          have: r.community.have,
          want: r.community.want,
        }
      : null,
    lowestPrice: r.lowest_price ?? null,
    numForSale: r.num_for_sale ?? 0,
    // Structured pressing evidence — what audiophiles actually use to ID a pressing.
    matrixRunout: (r.identifiers ?? [])
      .filter((i) => /matrix|runout/i.test(i.type))
      .map((i) => ({ type: i.type, value: i.value, description: i.description })),
    masteringCredits: masteringCredits(r),
    pressingCompanies: (r.companies ?? []).map((c) => ({
      name: c.name,
      entityTypeName: c.entity_type_name,
    })),
    // Pedigree assessment for this specific pressing (label/engineer/stamper signals).
    pedigree: { score: rep.score, confidence: rep.confidence, signals: rep.signals, detail: rep.detail },
    coverImage: r.images?.[0]?.uri,
  };
}

export function registerReleaseTools(server: McpServer, getContext: GetContext): void {
  server.registerTool(
    "get_release",
    {
      description:
        "Get full details of a specific Discogs release (one concrete pressing/edition): " +
        "community ratings, have/want, formats, labels, notes, used price, AND the structured " +
        "pressing evidence — matrix/runout stampers, mastering credits, pressing companies, and a " +
        "pedigree assessment (reputable label/engineer/stamper signals). Use this to inspect a " +
        "specific pressing without dropping to the raw Discogs API.",
      inputSchema: {
        releaseId: z.number().int().describe("Discogs release ID"),
      },
    },
    safeTool(async ({ releaseId }) => {
      const ctx = getContext();
      const release = await ctx.client.getRelease(releaseId);
      return jsonResult(slimRelease(release));
    })
  );

  server.registerTool(
    "get_master_release",
    {
      description:
        "Get a Discogs master release (the abstract album grouping all its pressings). " +
        "Includes the main release ID and total versions URL — use get_release_versions to list pressings.",
      inputSchema: {
        masterId: z.number().int().describe("Discogs master release ID"),
      },
    },
    safeTool(async ({ masterId }) => {
      const ctx = getContext();
      const master = await ctx.client.getMaster(masterId);
      return jsonResult({
        id: master.id,
        title: master.title,
        artists: master.artists?.map((a) => a.name),
        year: master.year,
        genres: master.genres,
        styles: master.styles,
        mainReleaseId: master.main_release,
        numForSale: master.num_for_sale,
        lowestPrice: master.lowest_price,
        tracklist: master.tracklist?.map((t) => `${t.position}. ${t.title} (${t.duration})`),
        coverImage: master.images?.[0]?.uri,
      });
    })
  );
}
