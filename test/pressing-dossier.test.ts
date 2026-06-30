import { describe, expect, it } from "vitest";
import { buildDossier } from "../src/utils/pressing-dossier.js";
import { scorePressing } from "../src/utils/pressing-scoring.js";
import { makeRelease, mfslPressing, rvgPressing } from "./mocks/discogs-fixtures.js";

describe("buildDossier", () => {
  it("extracts matrix/runout identifiers only", () => {
    const score = scorePressing(rvgPressing, "sonic", { baselineRating: 4.6 });
    const d = buildDossier(rvgPressing, score, 4.6);
    expect(d.matrixRunout.length).toBeGreaterThan(0);
    expect(d.matrixRunout[0].value).toMatch(/RVG/);
  });

  it("maps pressing companies to stable fields", () => {
    const rel = makeRelease({
      companies: [{ name: "Quality Record Pressings", entity_type_name: "Pressed By" }],
    });
    const d = buildDossier(rel, scorePressing(rel, "sonic"), 4.6);
    expect(d.pressingCompanies[0]).toEqual({
      name: "Quality Record Pressings",
      entityTypeName: "Pressed By",
    });
  });

  it("includes the album baseline and a numeric rating delta when ratings suffice", () => {
    const d = buildDossier(mfslPressing, scorePressing(mfslPressing, "sonic", { baselineRating: 4.6 }), 4.6);
    expect(d.ratingDelta.albumBaselineRating).toBe(4.6);
    expect(typeof d.ratingDelta.value).toBe("number"); // mfsl has 450 votes
  });

  it("nulls the rating delta when there aren't enough votes", () => {
    const rel = makeRelease({ community: { rating: { average: 5, count: 2 }, have: 1, want: 1 } });
    const d = buildDossier(rel, scorePressing(rel, "sonic", { baselineRating: 4.6 }), 4.6);
    expect(d.ratingDelta.value).toBeNull();
  });

  it("gives whyItScores a useful fallback when there are no signals", () => {
    const plain = makeRelease({
      extraartists: [],
      identifiers: [],
      labels: [{ id: 999, name: "Generic", catno: "X" }],
      formats: [{ name: "CD", qty: "1", descriptions: ["Album"] }],
      notes: "",
    });
    const d = buildDossier(plain, scorePressing(plain, "sonic"), 4.6);
    expect(d.whyItScores).toMatch(/No strong/i);
  });

  it("carries the score fields (verdict, coverage) through to the dossier", () => {
    const score = scorePressing(mfslPressing, "sonic", { baselineRating: 4.6 });
    const d = buildDossier(mfslPressing, score, 4.6);
    expect(d.verdict).toBe(score.verdict);
    expect(d.evidenceCoverage).toBe(score.evidenceCoverage);
    expect(d.reputationDetail).toEqual(score.reputationDetail);
  });
});
