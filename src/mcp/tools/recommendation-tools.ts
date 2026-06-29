import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetContext, ToolContext } from "./context.js";
import { errorResult, jsonResult, safeTool } from "./context.js";
import { fetchFullCollection, fetchFullWantlist } from "../../utils/collection.js";
import { detectMoodFromQuery, getMoodFilters, KNOWN_MOODS } from "../../utils/mood-mapping.js";
import {
  buildProfile,
  profileSimilarity,
  scoreAffinity,
  topEntries,
  type CollectionProfile,
} from "../../utils/similarity-scoring.js";
import type { DiscogsSearchResult } from "../../clients/types.js";

interface Candidate {
  result: DiscogsSearchResult;
  matchedStyle: string;
  affinity: number;
}

/**
 * Search the catalog for masters in the given styles, dedupe, exclude owned
 * titles, and rank by taste affinity + community popularity.
 */
async function searchCandidates(
  ctx: ToolContext,
  styles: string[],
  genres: string[],
  profile: CollectionProfile,
  ownedKeys: Set<string>,
  options: { decade?: string; perStyle?: number }
): Promise<Candidate[]> {
  const seen = new Set<number>();
  const candidates: Candidate[] = [];

  const searches = styles.slice(0, 4).map(async (style) => {
    const resp = await ctx.client.search("", {
      type: "master",
      style,
      genre: genres[0],
      per_page: options.perStyle ?? 25,
    });
    return { style, results: resp.results };
  });

  for (const settled of await Promise.allSettled(searches)) {
    if (settled.status !== "fulfilled") continue;
    const { style, results } = settled.value;
    for (const r of results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (ownedKeys.has(r.title.toLowerCase())) continue;
      if (options.decade) {
        const decadePrefix = options.decade.replace(/s$/, "").slice(0, 3);
        if (!r.year?.startsWith(decadePrefix)) continue;
      }
      const affinity = scoreAffinity(profile, {
        genres: r.genre,
        styles: r.style,
        year: r.year ? Number.parseInt(r.year, 10) : undefined,
      });
      candidates.push({ result: r, matchedStyle: style, affinity });
    }
  }

  // Blend taste affinity with community popularity (log-scaled have count)
  candidates.sort((a, b) => {
    const pop = (c: Candidate) => Math.log10(1 + (c.result.community?.have ?? 0)) * 10;
    return b.affinity + pop(b) - (a.affinity + pop(a));
  });
  return candidates;
}

function presentCandidate(c: Candidate) {
  return {
    masterId: c.result.id,
    title: c.result.title,
    year: c.result.year,
    genres: c.result.genre,
    styles: c.result.style,
    matchedVia: c.matchedStyle,
    tasteAffinity: c.affinity,
    communityHave: c.result.community?.have,
    communityWant: c.result.community?.want,
  };
}

/** Build the set of owned title keys (lowercased "Artist - Title") for exclusion. */
function ownedTitleKeys(items: { title: string; artists: string[] }[]): Set<string> {
  const keys = new Set<string>();
  for (const i of items) {
    keys.add(`${i.artists[0] ?? ""} - ${i.title}`.toLowerCase());
    keys.add(i.title.toLowerCase());
  }
  return keys;
}

export function registerRecommendationTools(server: McpServer, getContext: GetContext): void {
  server.registerTool(
    "get_recommendations",
    {
      description:
        "Recommend albums by mood, genre/style, or similarity to a reference release. " +
        "Searches the Discogs catalog, excludes albums already in the user's collection, and ranks " +
        `by taste affinity (from the user's collection profile) plus community popularity. ` +
        `Known moods: ${KNOWN_MOODS.join(", ")}.`,
      inputSchema: {
        mood: z.string().optional().describe("Mood or vibe, e.g. 'mellow', 'late night', 'rainy day'"),
        genre: z.string().optional().describe("Discogs genre, e.g. 'Jazz'"),
        style: z.string().optional().describe("Discogs style, e.g. 'Hard Bop'"),
        decade: z.string().optional().describe("Restrict to a decade, e.g. '1970s'"),
        basedOnReleaseId: z
          .number()
          .int()
          .optional()
          .describe("Recommend albums similar to this Discogs release ID"),
        limit: z.number().int().min(1).max(30).optional().describe("Max recommendations (default 10)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();

      // Resolve target styles/genres from mood, reference release, or explicit filters
      let styles: string[] = params.style ? [params.style] : [];
      let genres: string[] = params.genre ? [params.genre] : [];
      let basis = "explicit filters";

      if (params.mood) {
        const mood = detectMoodFromQuery(params.mood);
        const filters = mood ? getMoodFilters(mood) : null;
        if (!filters) {
          return errorResult(
            `Could not map "${params.mood}" to a mood. Known moods: ${KNOWN_MOODS.join(", ")}.`
          );
        }
        styles = [...filters.styles, ...styles];
        genres = [...filters.genres.slice(0, 1), ...genres];
        basis = `mood "${mood}"`;
      } else if (params.basedOnReleaseId) {
        const ref = await ctx.client.getRelease(params.basedOnReleaseId);
        styles = [...(ref.styles ?? []), ...styles];
        genres = [...ref.genres.slice(0, 1), ...genres];
        basis = `similar to "${ref.title}"`;
      }

      if (styles.length === 0 && genres.length === 0) {
        return errorResult("Provide at least one of: mood, genre, style, or basedOnReleaseId.");
      }

      const collection = await fetchFullCollection(ctx.client, ctx.username);
      const profile = buildProfile(collection.items);
      const owned = ownedTitleKeys(collection.items);

      const candidates = await searchCandidates(ctx, styles, genres, profile, owned, {
        decade: params.decade,
      });

      return jsonResult({
        basis,
        searchedStyles: styles.slice(0, 4),
        recommendations: candidates.slice(0, params.limit ?? 10).map(presentCandidate),
      });
    })
  );

  server.registerTool(
    "discover_similar",
    {
      description:
        "Profile-based music discovery. Builds a taste profile from the user's collection " +
        "(optionally boosted by their wantlist), then either mines other named users' public " +
        "collections for albums matching that profile, or searches the catalog along the user's " +
        "dominant styles. Reports profile similarity for each compared user.",
      inputSchema: {
        otherUsernames: z
          .array(z.string())
          .max(3)
          .optional()
          .describe("Discogs usernames whose public collections to mine for matches"),
        useWantlist: z
          .boolean()
          .optional()
          .describe("Also fold the user's wantlist into the taste profile (default false)"),
        limit: z.number().int().min(1).max(30).optional().describe("Max suggestions (default 10)"),
      },
    },
    safeTool(async (params) => {
      const ctx = getContext();
      const limit = params.limit ?? 10;

      const collection = await fetchFullCollection(ctx.client, ctx.username);
      let profileItems = collection.items;
      if (params.useWantlist) {
        const wantlist = await fetchFullWantlist(ctx.client, ctx.username);
        profileItems = [...profileItems, ...wantlist.items];
      }
      const profile = buildProfile(profileItems);
      const ownedIds = new Set(collection.items.map((i) => i.id));
      const ownedTitles = ownedTitleKeys(collection.items);

      if (params.otherUsernames?.length) {
        // Cross-user mode: mine each user's collection for albums I don't have
        const users = [];
        for (const username of params.otherUsernames) {
          const theirs = await fetchFullCollection(ctx.client, username);
          const theirProfile = buildProfile(theirs.items);
          const similarity = Math.round(profileSimilarity(profile, theirProfile) * 1000) / 10;

          const suggestions = theirs.items
            .filter((i) => !ownedIds.has(i.id) && !ownedTitles.has(i.title.toLowerCase()))
            .map((i) => ({
              item: i,
              affinity: scoreAffinity(profile, { genres: i.genres, styles: i.styles, year: i.year }),
            }))
            .sort((a, b) => b.affinity - a.affinity || b.item.rating - a.item.rating)
            .slice(0, limit);

          users.push({
            username,
            collectionSize: theirs.totalItems,
            profileSimilarity: similarity,
            suggestions: suggestions.map((s) => ({
              releaseId: s.item.id,
              title: s.item.title,
              artists: s.item.artists,
              year: s.item.year,
              genres: s.item.genres,
              styles: s.item.styles,
              theirRating: s.item.rating,
              tasteAffinity: s.affinity,
            })),
          });
        }
        return jsonResult({ mode: "cross-user", profileBoostedByWantlist: !!params.useWantlist, users });
      }

      // Catalog mode: search along the profile's dominant styles
      const dominantStyles = topEntries(profile.styles, 4).map(([name]) => name);
      const dominantGenres = topEntries(profile.genres, 1).map(([name]) => name);
      if (dominantStyles.length === 0) {
        return errorResult("Your collection profile has no styles to work from — is the collection empty?");
      }

      const candidates = await searchCandidates(ctx, dominantStyles, dominantGenres, profile, ownedTitles, {});
      return jsonResult({
        mode: "catalog",
        profileBoostedByWantlist: !!params.useWantlist,
        dominantStyles,
        suggestions: candidates.slice(0, limit).map(presentCandidate),
      });
    })
  );
}
