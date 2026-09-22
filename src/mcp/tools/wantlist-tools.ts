import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GetContext } from "./context.js";
import { errorResult, jsonResult, safeTool } from "./context.js";
import { MAX_RANK_LIMIT, rankWantlist } from "../../core/wantlist.js";
import { fetchFullWantlist, paginate } from "../../utils/collection.js";

export function registerWantlistTools(server: McpServer, getContext: GetContext): void {
  server.registerTool(
    "get_wantlist",
    {
      description:
        "Fetch a Discogs wantlist — the authenticated user's own by default, or another " +
        "user's public wantlist when a username is given. The entire wantlist is fetched and " +
        "returned in pages: when hasMore is true, call again with offset advanced by the page " +
        "size to retrieve the rest before reasoning over the whole list.",
      inputSchema: {
        username: z.string().optional().describe("Discogs username (defaults to the authenticated user)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Items per page (default 100). Raise to cover a large wantlist in one call."),
        offset: z.number().int().min(0).optional().describe("Index of the first item to return (default 0)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();
      const username = params.username ?? ctx.username;
      const wantlist = await fetchFullWantlist(ctx.client, username);
      const page = paginate(wantlist.items, params.offset ?? 0, params.limit ?? 100);

      return jsonResult({
        username,
        totalItems: wantlist.totalItems,
        fetched: wantlist.items.length,
        truncated: wantlist.truncated,
        offset: page.offset,
        returned: page.returned,
        hasMore: page.hasMore,
        items: page.items,
      });
    })
  );

  server.registerTool(
    "rank_wantlist",
    {
      description:
        "Rank the authenticated user's ENTIRE wantlist by taste fit in ONE call — server-side, " +
        "deterministic, identical across clients. Groups alternate editions of the same album, scores " +
        "each group against the collection's style/genre/decade profile (the same scale as tasteFit), " +
        "assigns tiers (bullseye / good fit / off-profile), flags titles already in the collection, and " +
        "returns the method and caveats. Use this instead of paging get_wantlist + get_collection_stats " +
        "and computing your own ranking.",
      inputSchema: {
        limit: z.number().int().min(1).optional().describe(`Groups to return (default 50, maximum ${MAX_RANK_LIMIT}; larger values are clamped)`),
        includeOwned: z.boolean().optional().describe("Include albums whose title is already in the collection, flagged ownedTitle (default true)"),
      },
    },
    safeTool(async (params) => {
      const r = await rankWantlist(getContext(), params);
      return r.ok ? jsonResult(r.data) : errorResult(r.error);
    })
  );
}
