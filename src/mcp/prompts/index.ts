import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function userMessage(text: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}

/**
 * MCP prompts surface as slash commands in MCP clients (e.g. Claude Code shows
 * them as `/<server>:<name>`, and connector UIs list them). Each prompt is
 * deliberately scoped to a small set of tools, so invoking it both gives a
 * one-keystroke entry point AND narrows Claude to the right tools for the job.
 */
export function registerPrompts(server: McpServer): void {
  // === Pressings ===

  server.registerPrompt(
    "find-best-pressing",
    {
      description: "Find the best-SOUNDING pressing of an album (sonic axis)",
      argsSchema: {
        album: z.string().describe("Album and artist, e.g. 'Kind of Blue by Miles Davis'"),
      },
    },
    async ({ album }) =>
      userMessage(`You are a vinyl/audio expert. Find the best-SOUNDING pressing of "${album}".

Use ONLY the find_best_pressing tool with axis: "sonic". Each pressing comes back as an evidence
dossier — use it rather than trusting the number:
1. Explain WHY each top pressing scores well from 'whyItScores', 'signals', 'reputationDetail',
   'masteringCredits', 'matrixRunout', and 'factors' (engineer, label, stamper marks, format).
2. Read 'verdict' and 'evidenceCoverage' (0–1): if coverage is low, say the call is tentative and
   feel free to override the provisional verdict with your own judgement.
3. Call out audiophile editions (Mobile Fidelity, Analogue Productions, half-speed, 45 RPM, etc.).
4. Give one clear recommendation, and pass along the response's 'dataCaveats'.
5. If I own one (inYourCollection), say so.

Each top pressing already includes 'matrixRunout' and 'masteringCredits' — don't re-fetch them
with get_release. Pressings flagged as test pressings/promos are scored down and labelled in
'verdict'; treat them as non-retail. Use get_release only to inspect a SPECIFIC pressing not in
the returned set.`)
  );

  server.registerPrompt(
    "best-value-pressing",
    {
      description: "Find the best-sounding pressing per dollar (value axis)",
      argsSchema: {
        album: z.string().describe("Album and artist, e.g. 'Blue Train by John Coltrane'"),
      },
    },
    async ({ album }) =>
      userMessage(`Find the best VALUE pressing of "${album}" — good sound without overpaying.

Use ONLY find_best_pressing with axis: "value". Then recommend the sweet-spot pressing, citing its 'lowestPrice', sonic 'signals', and why it beats both the cheap-but-poor and the expensive-but-marginal options. Note any I already own.`)
  );

  server.registerPrompt(
    "most-collectible-pressing",
    {
      description: "Find the most collectible/original pressing (collector axis)",
      argsSchema: {
        album: z.string().describe("Album and artist"),
      },
    },
    async ({ album }) =>
      userMessage(`Find the most COLLECTIBLE pressing of "${album}" — originality and desirability, not just sound.

Use ONLY find_best_pressing with axis: "collector". Explain the ranking using have/want demand, price, year/country, and originality (first pressing, original label). Flag anything I already own.`)
  );

  server.registerPrompt(
    "compare-pressings",
    {
      description: "Compare specific pressings side-by-side by release ID",
      argsSchema: {
        releaseIds: z.string().describe("Comma-separated Discogs release IDs, e.g. '123,456,789'"),
        axis: z.string().optional().describe("sonic (default), collector, or value"),
      },
    },
    async ({ releaseIds, axis }) =>
      userMessage(`Compare these pressings side-by-side: ${releaseIds}

Use ONLY compare_pressings with releaseIds ${JSON.stringify(
        releaseIds.split(",").map((s) => Number(s.trim()))
      )} and axis "${axis || "sonic"}". Present a compact table (mastering signals, format, price, ratings, score) and recommend the best for audiophile sound, for collectors, and for budget. Note any I own.`)
  );

  // === Recommendations & collection ===

  server.registerPrompt(
    "recommend-by-mood",
    {
      description: "Recommend albums matching a mood, from your collection and beyond",
      argsSchema: {
        mood: z.string().describe("e.g. 'mellow Sunday morning', 'energetic workout', 'late night jazz'"),
      },
    },
    async ({ mood }) =>
      userMessage(`Find music matching the mood: "${mood}".

1. get_collection_stats to understand my taste.
2. search_collection with this mood for albums I already own.
3. get_recommendations with this mood for new albums.
4. Explain why each fits, and split into "From your collection" vs "New discoveries".`)
  );

  server.registerPrompt(
    "pick-from-my-collection",
    {
      description: "Pick something to play from YOUR OWN collection by mood (no new purchases)",
      argsSchema: {
        mood: z.string().describe("Mood or vibe, e.g. 'rainy late night', 'smoky and noir'"),
      },
    },
    async ({ mood }) =>
      userMessage(`Suggest what to play from MY OWN collection for: "${mood}".

Use ONLY search_collection (it is mood-aware). Do not recommend anything I don't own. Offer 5–8 picks with a one-line reason each; lean on records I've rated highly.`)
  );

  server.registerPrompt(
    "discover-new-music",
    {
      description: "Discover new albums to buy, ranked against your taste profile",
      argsSchema: {
        seed: z.string().optional().describe("Optional mood, genre/style, or 'like <album>' to steer discovery"),
      },
    },
    async ({ seed }) =>
      userMessage(`Recommend NEW albums I don't own, ranked by how well they fit my taste${
        seed ? ` — steer toward: "${seed}"` : ""
      }.

1. get_collection_stats for my taste profile.
2. get_recommendations${seed ? ` (use the seed above)` : ` (use my dominant styles)`}.
3. Optionally discover_similar for profile-based finds.
Exclude anything already in my collection and explain the fit for each.`)
  );

  server.registerPrompt(
    "rank-my-wantlist",
    {
      description: "Rank your whole wantlist by how well each album fits your taste",
      argsSchema: {},
    },
    async () =>
      userMessage(`Rank my ENTIRE wantlist by how well each album fits my taste.

1. get_collection_stats for my taste profile.
2. get_wantlist — page through ALL items (use limit 500, or follow hasMore with offset) so nothing is missed.
3. Rank into tiers (bullseye / good fit / off-profile) and be honest about impulse adds that don't fit. Note the total count covered.`)
  );

  server.registerPrompt(
    "my-taste-profile",
    {
      description: "Summarize your collection's taste profile and gaps",
      argsSchema: {},
    },
    async () =>
      userMessage(`Summarize my collection's taste profile.

Use ONLY get_collection_stats. Report dominant genres/styles/decades/labels, rating habits, and 2–3 conspicuous gaps (styles adjacent to what I clearly love but barely own).`)
  );

  server.registerPrompt(
    "cross-user-discovery",
    {
      description: "Discover music by comparing your collection with another Discogs user",
      argsSchema: {
        username: z.string().describe("Discogs username to compare against"),
      },
    },
    async ({ username }) =>
      userMessage(`Compare my collection with Discogs user "${username}" to find new music.

1. get_collection_stats to profile me.
2. discover_similar with otherUsernames: ["${username}"] to mine their collection for matches (it reports our profile similarity).
3. Optionally get_wantlist for "${username}" for more leads.
Present personalized picks with explanations, and lead with how similar our tastes are.`)
  );
}
