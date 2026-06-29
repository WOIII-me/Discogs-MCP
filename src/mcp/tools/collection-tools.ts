import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetContext } from "./context.js";
import { jsonResult, safeTool } from "./context.js";
import { fetchFullCollection, paginate } from "../../utils/collection.js";
import { buildProfile, decadeOf, topEntries } from "../../utils/similarity-scoring.js";

export function registerCollectionTools(server: McpServer, getContext: GetContext): void {
  server.registerTool(
    "get_collection_stats",
    {
      description:
        "Analytics over the authenticated user's collection: genre/style/decade/format/label " +
        "distributions, rating stats, and a taste-profile summary.",
      inputSchema: {
        topN: z.number().int().min(3).max(50).optional().describe("How many entries per breakdown (default 10)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();
      const collection = await fetchFullCollection(ctx.client, ctx.username);
      const items = collection.items;
      const topN = params.topN ?? 10;

      const count = (extract: (i: (typeof items)[number]) => string[]) => {
        const map: Record<string, number> = {};
        for (const item of items) {
          for (const key of extract(item)) {
            if (key) map[key] = (map[key] ?? 0) + 1;
          }
        }
        return Object.entries(map)
          .sort(([, a], [, b]) => b - a)
          .slice(0, topN)
          .map(([name, n]) => ({ name, count: n }));
      };

      const rated = items.filter((i) => i.rating > 0);
      const profile = buildProfile(items);

      return jsonResult({
        username: ctx.username,
        totalItems: collection.totalItems,
        analyzed: items.length,
        truncated: collection.truncated,
        genres: count((i) => i.genres),
        styles: count((i) => i.styles),
        decades: count((i) => [decadeOf(i.year) ?? "unknown"]),
        formats: count((i) => i.formats),
        topLabels: count((i) => i.labels),
        topArtists: count((i) => i.artists),
        ratings: {
          ratedCount: rated.length,
          averageRating: rated.length
            ? Math.round((rated.reduce((s, i) => s + i.rating, 0) / rated.length) * 100) / 100
            : null,
        },
        tasteProfile: {
          dominantStyles: topEntries(profile.styles, 8).map(([name, share]) => ({
            name,
            share: Math.round(share * 1000) / 10,
          })),
          dominantGenres: topEntries(profile.genres, 5).map(([name, share]) => ({
            name,
            share: Math.round(share * 1000) / 10,
          })),
        },
      });
    })
  );

  server.registerTool(
    "explore_user_collection",
    {
      description:
        "Browse another Discogs user's public collection, optionally filtered by genre/style. " +
        "Paginated: when hasMore is true, call again with offset advanced by the page size to " +
        "retrieve the rest. Fails gracefully if the collection is private.",
      inputSchema: {
        username: z.string().describe("Discogs username whose collection to explore"),
        filterGenres: z.array(z.string()).optional(),
        filterStyles: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Items per page (default 100)"),
        offset: z.number().int().min(0).optional().describe("Index of the first item to return (default 0)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();
      const collection = await fetchFullCollection(ctx.client, params.username);

      const lcGenres = params.filterGenres?.map((g) => g.toLowerCase());
      const lcStyles = params.filterStyles?.map((s) => s.toLowerCase());
      const filtered = collection.items.filter((item) => {
        if (lcGenres?.length && !item.genres.some((g) => lcGenres.includes(g.toLowerCase())))
          return false;
        if (lcStyles?.length && !item.styles.some((s) => lcStyles.includes(s.toLowerCase())))
          return false;
        return true;
      });

      const page = paginate(filtered, params.offset ?? 0, params.limit ?? 100);
      return jsonResult({
        username: params.username,
        totalItems: collection.totalItems,
        matchingItems: filtered.length,
        truncated: collection.truncated,
        offset: page.offset,
        returned: page.returned,
        hasMore: page.hasMore,
        items: page.items,
      });
    })
  );
}
