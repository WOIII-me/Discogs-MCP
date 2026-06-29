import { describe, expect, it } from "vitest";
import {
  buildProfile,
  cosineSimilarity,
  decadeOf,
  profileSimilarity,
  scoreAffinity,
  topEntries,
} from "../src/utils/similarity-scoring.js";
import { jazzCollection, punkCollection } from "./mocks/discogs-fixtures.js";

describe("decadeOf", () => {
  it("maps years to decades", () => {
    expect(decadeOf(1959)).toBe("1950s");
    expect(decadeOf(1992)).toBe("1990s");
    expect(decadeOf(0)).toBeNull();
  });
});

describe("buildProfile", () => {
  it("captures dominant styles with rating boost", () => {
    const profile = buildProfile(jazzCollection);
    expect(profile.total).toBe(5);
    // Hard Bop appears on two rated items (weight 2 each) — should dominate
    const top = topEntries(profile.styles, 3).map(([name]) => name);
    expect(top).toContain("Hard Bop");
    expect(profile.genres.Jazz).toBeGreaterThan(profile.genres.Electronic);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for disjoint ones", () => {
    expect(cosineSimilarity({ a: 1, b: 2 }, { a: 1, b: 2 })).toBeCloseTo(1);
    expect(cosineSimilarity({ a: 1 }, { b: 1 })).toBe(0);
    expect(cosineSimilarity({}, { a: 1 })).toBe(0);
  });
});

describe("profileSimilarity", () => {
  it("scores similar collections higher than dissimilar ones", () => {
    const jazz = buildProfile(jazzCollection);
    const alsoJazz = buildProfile(jazzCollection.slice(0, 3));
    const punk = buildProfile(punkCollection);
    expect(profileSimilarity(jazz, alsoJazz)).toBeGreaterThan(profileSimilarity(jazz, punk));
  });
});

describe("scoreAffinity", () => {
  it("scores in-profile candidates above out-of-profile ones", () => {
    const profile = buildProfile(jazzCollection);
    const hardBop = scoreAffinity(profile, { genres: ["Jazz"], styles: ["Hard Bop"], year: 1958 });
    const metal = scoreAffinity(profile, { genres: ["Rock"], styles: ["Doom Metal"], year: 2015 });
    expect(hardBop).toBeGreaterThan(metal);
    expect(metal).toBe(0);
  });

  it("stays within 0..100", () => {
    const profile = buildProfile(jazzCollection);
    const score = scoreAffinity(profile, {
      genres: ["Jazz", "Electronic"],
      styles: ["Modal", "Hard Bop", "Free Jazz", "Bossa Nova", "Ambient"],
      year: 1959,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
