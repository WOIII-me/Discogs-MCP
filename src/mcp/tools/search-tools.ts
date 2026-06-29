import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetContext } from "./context.js";
import { jsonResult, safeTool } from "./context.js";
import { fetchFullCollection, paginate, type SlimItem } from "../../utils/collection.js";
import { detectMoodFromQuery, getMoodFilters } from "../../utils/mood-mapping.js";

function intersects(a: string[], b: string[]): boolean {
  const set = new Set(b.map((s) => s.toLowerCase()));
  return a.some((x) => set.has(x.toLowerCase()));
}

function textMatches(item: SlimItem, query: string): boolean {
  const haystack = `${item.artists.join(" ")} ${item.title} ${item.labels.join(" ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function registerSearchTools(server: McpServer, getContext: GetContext): void {
  server.registerTool(
    "search_collection",
    {
      description:
        "Search the authenticated user's Discogs collection. Free-text queries are mood-aware: " +
        "queries like 'mellow sunday morning' map to matching genres/styles. " +
        "Explicit genre/style/decade/rating filters can be combined with or used instead of the query.",
      inputSchema: {
        query: z.string().optional().describe("Free text: artist, title, label, or a mood ('mellow', 'late night jazz')"),
        genres: z.array(z.string()).optional().describe("Filter by Discogs genres, e.g. ['Jazz']"),
        styles: z.array(z.string()).optional().describe("Filter by Discogs styles, e.g. ['Hard Bop']"),
        decades: z.array(z.string()).optional().describe("Filter by decades, e.g. ['1960s', '1970s']"),
        minRating: z.number().min(0).max(5).optional().describe("Minimum personal rating (0–5)"),
        limit: z.number().int().min(1).max(500).optional().describe("Items per page (default 50)"),
        offset: z.number().int().min(0).optional().describe("Index of the first result to return (default 0)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();
      const collection = await fetchFullCollection(ctx.client, ctx.username);

      const mood = params.query ? detectMoodFromQuery(params.query) : null;
      const moodFilters = mood ? getMoodFilters(mood) : null;

      let matches = collection.items.filter((item) => {
        if (params.genres?.length && !intersects(item.genres, params.genres)) return false;
        if (params.styles?.length && !intersects(item.styles, params.styles)) return false;
        if (params.decades?.length) {
          const decade = `${Math.floor(item.year / 10) * 10}s`;
          if (!params.decades.some((d) => d.replace(/^the\s*/i, "") === decade)) return false;
        }
        if (params.minRating !== undefined && item.rating < params.minRating) return false;
        return true;
      });

      if (moodFilters) {
        // Mood query: rank by style match (strong) then genre match (weak)
        const scored = matches
          .map((item) => {
            let score = 0;
            if (intersects(item.styles, moodFilters.styles)) score += 2;
            if (intersects(item.genres, moodFilters.genres)) score += 1;
            return { item, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || b.item.rating - a.item.rating);
        matches = scored.map((x) => x.item);
      } else if (params.query) {
        matches = matches.filter((item) => textMatches(item, params.query!));
      }

      const page = paginate(matches, params.offset ?? 0, params.limit ?? 50);
      return jsonResult({
        query: params.query ?? null,
        detectedMood: mood,
        moodFilters: moodFilters ? { genres: moodFilters.genres, styles: moodFilters.styles } : null,
        totalMatches: matches.length,
        collectionSize: collection.totalItems,
        collectionTruncated: collection.truncated,
        offset: page.offset,
        returned: page.returned,
        hasMore: page.hasMore,
        items: page.items,
      });
    })
  );

  server.registerTool(
    "search_discogs",
    {
      description:
        "Search the full Discogs catalog (releases, masters, artists, labels). " +
        "Results are cross-referenced with the user's collection and marked inCollection.",
      inputSchema: {
        query: z.string().describe("Search query, e.g. 'Miles Davis Kind of Blue'"),
        type: z.enum(["release", "master", "artist", "label"]).optional().describe("Restrict result type"),
        genre: z.string().optional(),
        style: z.string().optional(),
        year: z.string().optional().describe("Exact year, e.g. '1959'"),
        country: z.string().optional(),
        format: z.string().optional().describe("e.g. 'Vinyl', 'CD'"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 15)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();
      const [searchResp, collection] = await Promise.all([
        ctx.client.search(params.query, {
          type: params.type,
          genre: params.genre,
          style: params.style,
          year: params.year,
          country: params.country,
          format: params.format,
          per_page: params.limit ?? 15,
        }),
        fetchFullCollection(ctx.client, ctx.username),
      ]);

      const ownedIds = new Set(collection.items.map((i) => i.id));

      return jsonResult({
        totalResults: searchResp.pagination.items,
        results: searchResp.results.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          year: r.year,
          country: r.country,
          format: r.format,
          label: r.label?.slice(0, 3),
          genre: r.genre,
          style: r.style,
          masterId: r.master_id,
          communityHave: r.community?.have,
          communityWant: r.community?.want,
          inCollection: r.type === "release" && ownedIds.has(r.id),
        })),
      });
    })
  );
}
