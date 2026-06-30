import { describe, expect, it } from "vitest";
import { analyzeRelease } from "../src/core/lookup.js";
import type { CoreContext } from "../src/core/pressings.js";
import type { CachedDiscogsClient } from "../src/clients/cached-discogs.js";
import { makeRelease, mfslPressing, makeVersion } from "./mocks/discogs-fixtures.js";

function fakeCtx(): CoreContext {
  const client = {
    cacheTtls: { collection: 1, wantlist: 1, release: 1, master: 1, versions: 1, search: 1, profile: 1 },
    withCache: async (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher(),
    getCollection: async () => ({ pagination: { pages: 1, items: 0, page: 1, per_page: 100 }, releases: [] }),
    getWantlist: async () => ({ pagination: { pages: 1, items: 0, page: 1, per_page: 100 }, wants: [] }),
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
    getRelease: async (id: number) => (id === 1 ? mfslPressing : makeRelease({ id })),
  } as unknown as CachedDiscogsClient;
  return { client, username: "tester" };
}

describe("core/lookup analyzeRelease", () => {
  it("returns this pressing, the album's best pressing, taste-fit and owned/wanted", async () => {
    const r = await analyzeRelease(fakeCtx(), 1, "sonic");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data;
    expect(d.release.title).toMatch(/Kind Of Blue/);
    expect(d.thisPressing).toHaveProperty("verdict");
    expect(d.thisPressing).toHaveProperty("evidenceCoverage");
    expect(d.bestPressing).not.toBeNull();
    expect(typeof d.tasteFit.affinity).toBe("number");
    expect(d.owned).toBe(false);
    expect(d.wanted).toBe(false);
    expect(Array.isArray(d.dataCaveats)).toBe(true);
  });
});
