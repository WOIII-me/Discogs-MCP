/**
 * Live smoke tests against the real Discogs API using a personal access token.
 * Skipped unless DISCOGS_TOKEN is set:
 *
 *   DISCOGS_TOKEN=xxx npx vitest run test/live-api.test.ts
 */
import { describe, expect, it } from "vitest";
import { DiscogsClient, USER_AGENT } from "../src/clients/discogs.js";
import {
  rankVersionsByQuickSignals,
  scorePressing,
} from "../src/utils/pressing-scoring.js";
import { slimItem } from "../src/utils/collection.js";
import { buildProfile, scoreAffinity, topEntries } from "../src/utils/similarity-scoring.js";
import { detectMoodFromQuery, getMoodFilters } from "../src/utils/mood-mapping.js";

const token = process.env.DISCOGS_TOKEN;

describe.skipIf(!token)("live Discogs API", () => {
  const client = new DiscogsClient({ kind: "token", token: token! });

  it("authenticates: identity resolves to a username", async () => {
    const resp = await fetch("https://api.discogs.com/oauth/identity", {
      headers: { Authorization: `Discogs token=${token}`, "User-Agent": USER_AGENT },
    });
    expect(resp.ok).toBe(true);
    const identity = (await resp.json()) as { username: string; id: number };
    expect(identity.username).toBeTruthy();
    console.log(`  ✓ authenticated as: ${identity.username} (id ${identity.id})`);
  }, 30000);

  it("search finds the Kind of Blue master release", async () => {
    const result = await client.search("Miles Davis Kind of Blue", {
      type: "master",
      per_page: 5,
    });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title.toLowerCase()).toContain("kind of blue");
    console.log(`  ✓ master: ${result.results[0].title} (id ${result.results[0].id})`);
  }, 30000);

  it("runs the find_best_pressing pipeline on real data", async () => {
    // Same steps as the tool: search master → versions → quick-rank → details → score
    const search = await client.search("Miles Davis Kind of Blue", { type: "master", per_page: 1 });
    const masterId = search.results[0].id;

    const versionsResp = await client.getMasterVersions(masterId, { per_page: 100 });
    expect(versionsResp.versions.length).toBeGreaterThan(10);

    const candidates = rankVersionsByQuickSignals(versionsResp.versions).slice(0, 4);
    const releases = [];
    for (const v of candidates) releases.push(await client.getRelease(v.id));
    const rated = releases.filter((r) => (r.community?.rating?.count ?? 0) >= 3);
    const baseline = rated.reduce((s, r) => s + (r.community?.rating?.average ?? 0), 0) / (rated.length || 1);
    const scored = releases
      .map((release) => ({ release, score: scorePressing(release, "sonic", { baselineRating: baseline }) }))
      .sort((a, b) => b.score.overallScore - a.score.overallScore);

    expect(scored[0].score.overallScore).toBeGreaterThan(0);
    console.log(`  ✓ surveyed ${versionsResp.pagination.items} versions of master ${masterId}`);
    for (const s of scored) {
      console.log(
        `    #${s.release.id} ${s.release.country ?? "?"} ${s.release.year || "?"} ` +
          `[${s.release.labels?.[0]?.catno ?? "?"}] score=${s.score.overallScore} ` +
          `(rating ${s.release.community?.rating?.average} × ${s.release.community?.rating?.count}, ` +
          `$${s.release.lowest_price ?? "?"}) signals: ${s.score.signals.join(", ") || "none"}`
      );
    }
  }, 120000);

  it("fetches the user's collection and builds a taste profile", async () => {
    const identityResp = await fetch("https://api.discogs.com/oauth/identity", {
      headers: { Authorization: `Discogs token=${token}`, "User-Agent": USER_AGENT },
    });
    const { username } = (await identityResp.json()) as { username: string };

    const collection = await client.getCollection(username, { per_page: 100 });
    console.log(`  ✓ collection: ${collection.pagination.items} items`);

    if (collection.releases.length === 0) {
      console.log("    (collection is empty — profile/mood/recommendation steps skipped)");
      return;
    }

    const items = collection.releases.map((r) =>
      slimItem(r.basic_information, r.rating, r.date_added)
    );
    const profile = buildProfile(items);
    const styles = topEntries(profile.styles, 5);
    const genres = topEntries(profile.genres, 3);
    console.log(`    top styles: ${styles.map(([n, s]) => `${n} (${Math.round(s * 100)}%)`).join(", ")}`);
    console.log(`    top genres: ${genres.map(([n]) => n).join(", ")}`);
    expect(profile.total).toBe(items.length);

    // Mood search over the real collection
    const mood = detectMoodFromQuery("mellow sunday morning");
    const filters = getMoodFilters(mood!)!;
    const moodMatches = items.filter(
      (i) =>
        i.styles.some((s) => filters.styles.includes(s)) ||
        i.genres.some((g) => filters.genres.includes(g))
    );
    console.log(`    mood "mellow sunday morning" matches ${moodMatches.length}/${items.length} items`);

    // Recommendation-style catalog search along the dominant style
    if (styles.length > 0) {
      const recs = await client.search("", {
        type: "master",
        style: styles[0][0],
        per_page: 10,
      });
      const ownedTitles = new Set(items.map((i) => i.title.toLowerCase()));
      const fresh = recs.results.filter((r) => !ownedTitles.has(r.title.toLowerCase()));
      const ranked = fresh
        .map((r) => ({
          r,
          affinity: scoreAffinity(profile, {
            genres: r.genre,
            styles: r.style,
            year: r.year ? Number.parseInt(r.year, 10) : undefined,
          }),
        }))
        .sort((a, b) => b.affinity - a.affinity);
      expect(ranked.length).toBeGreaterThan(0);
      console.log(
        `    sample recommendations via "${styles[0][0]}": ` +
          ranked.slice(0, 3).map((x) => `${x.r.title} (affinity ${x.affinity})`).join("; ")
      );
    }
  }, 120000);
});
