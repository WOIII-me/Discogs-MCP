import { describe, expect, it } from "vitest";
import {
  comparePressings,
  findBestPressing,
  type CoreContext,
} from "../src/core/pressings.js";
import type { CachedDiscogsClient } from "../src/clients/cached-discogs.js";
import { makeRelease, mfslPressing, makeVersion } from "./mocks/discogs-fixtures.js";

/**
 * Minimal fake client covering only what the core pressing functions touch.
 * fetchFullCollection calls withCache + getCollection; we stub both.
 */
function fakeCtx(releasesById: Record<number, ReturnType<typeof makeRelease>>): CoreContext {
  const client = {
    cacheTtls: { collection: 1, wantlist: 1, release: 1, master: 1, versions: 1, search: 1, profile: 1 },
    withCache: async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
    getCollection: async () => ({ pagination: { pages: 1, items: 0, page: 1, per_page: 100 }, releases: [] }),
    getMasterVersions: async () => ({
      pagination: { pages: 1, items: 2, page: 1, per_page: 100 },
      versions: [
        makeVersion({ id: 1, label: "Mobile Fidelity Sound Lab", format: "Vinyl, LP, 45 RPM" }),
        makeVersion({ id: 2, label: "Columbia", format: "Vinyl, LP" }),
      ],
    }),
    getMaster: async () => ({
      id: 5460,
      title: "Kind Of Blue",
      artists: [{ id: 10, name: "Miles Davis" }],
      year: 1959,
      main_release: 1,
      main_release_url: "",
      versions_url: "",
      genres: ["Jazz"],
      tracklist: [],
      resource_url: "",
    }),
    getRelease: async (id: number) => releasesById[id],
  } as unknown as CachedDiscogsClient;
  return { client, username: "tester" };
}

describe("core/pressings", () => {
  it("findBestPressing returns a ranked dossier on the happy path", async () => {
    const ctx = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) });
    // releaseId path (mfslPressing.master_id === 5460) avoids needing client.search
    const r = await findBestPressing(ctx, { releaseId: 1, axis: "sonic", topN: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as any;
    expect(Array.isArray(data.dataCaveats)).toBe(true);
    expect(data.topPressings.length).toBeGreaterThan(0);
    const top = data.topPressings[0];
    expect(top).toHaveProperty("verdict");
    expect(top).toHaveProperty("evidenceCoverage");
    expect(top).toHaveProperty("whyItScores");
    expect(top).toHaveProperty("matrixRunout");
  });

  it("stops fetching candidates preemptively when the remaining budget is low", async () => {
    const ctx = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) });
    const client = ctx.client as unknown as {
      rateLimitRemaining: number | null;
      getRelease: (id: number) => Promise<unknown>;
    };
    // Simulate a nearly-exhausted per-minute budget reported by Discogs:
    // the candidate batch must never launch — zero getRelease calls beyond
    // the master resolution, and an honest rate-limit error.
    const original = client.getRelease.bind(client);
    let candidateFetches = 0;
    client.getRelease = async (id: number) => {
      candidateFetches++;
      return original(id);
    };
    client.rateLimitRemaining = 5;
    const r = await findBestPressing(ctx, { masterId: 5460, axis: "sonic", topN: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/rate-limiting/i);
    expect(candidateFetches).toBe(0);
  });

  it("findBestPressing errors clearly when given no album reference", async () => {
    const ctx = fakeCtx({});
    const r = await findBestPressing(ctx, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Provide either releaseId/);
  });

  it("comparePressings ranks the given releases and returns dossiers", async () => {
    const ctx = fakeCtx({ 1: mfslPressing, 2: makeRelease({ id: 2 }) });
    const r = await comparePressings(ctx, { releaseIds: [1, 2], axis: "sonic" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as any;
    expect(data.pressings).toHaveLength(2);
    expect(data.topPick).toMatch(/Highest scoring/);
    expect(data.pressings[0]).toHaveProperty("evidenceCoverage");
  });
});
