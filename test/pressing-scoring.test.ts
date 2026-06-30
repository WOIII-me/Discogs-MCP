import { describe, expect, it } from "vitest";
import {
  normalizeAxis,
  rankVersionsByQuickSignals,
  scoreConsensus,
  scoreFormat,
  scorePressing,
  scorePrice,
  scoreRating,
  scoreRatingDelta,
} from "../src/utils/pressing-scoring.js";
import {
  cdReissue,
  makeRelease,
  makeVersion,
  mfslPressing,
  rvgPressing,
  tinyRatedPressing,
} from "./mocks/discogs-fixtures.js";

describe("scoreRating", () => {
  it("returns 0 with fewer than 3 ratings", () => {
    expect(scoreRating(5, 2)).toBe(0);
    expect(scoreRating(5, 0)).toBe(0);
  });

  it("weights by confidence: 4.7 from 500 votes beats 5.0 from 3", () => {
    expect(scoreRating(4.7, 500)).toBeGreaterThan(scoreRating(5.0, 3));
  });

  it("reaches full confidence at 50+ ratings", () => {
    expect(scoreRating(5, 50)).toBe(100);
  });
});

describe("scorePrice", () => {
  it("is 0 when unknown and rises with price (log-scaled, capped)", () => {
    expect(scorePrice(undefined)).toBe(0);
    expect(scorePrice(0)).toBe(0);
    expect(scorePrice(250)).toBeGreaterThan(scorePrice(20));
    expect(scorePrice(5000)).toBeLessThanOrEqual(100);
  });
});

describe("scoreRatingDelta", () => {
  it("is neutral (50) at the baseline and when data is thin", () => {
    expect(scoreRatingDelta(4.5, 100, 4.5)).toBe(50);
    expect(scoreRatingDelta(5, 2, 4.5)).toBe(50); // too few votes
  });
  it("rises above baseline and falls below", () => {
    expect(scoreRatingDelta(4.9, 100, 4.5)).toBeGreaterThan(50);
    expect(scoreRatingDelta(4.0, 100, 4.5)).toBeLessThan(50);
  });
});

describe("scoreConsensus", () => {
  it("rewards high want-to-have ratio and caps at 100", () => {
    expect(scoreConsensus(100, 900)).toBeGreaterThan(scoreConsensus(900, 100));
    expect(scoreConsensus(5000, 50000)).toBeLessThanOrEqual(100);
  });
});

describe("scoreFormat", () => {
  it("scores vinyl above CD", () => {
    expect(scoreFormat(makeRelease())).toBeGreaterThan(scoreFormat(cdReissue));
  });
});

describe("normalizeAxis", () => {
  it("maps legacy values and defaults to sonic", () => {
    expect(normalizeAxis("rating")).toBe("sonic");
    expect(normalizeAxis("balanced")).toBe("sonic");
    expect(normalizeAxis("rarity")).toBe("collector");
    expect(normalizeAxis(undefined)).toBe("sonic");
    expect(normalizeAxis("value")).toBe("value");
  });
});

describe("scorePressing — sonic axis", () => {
  it("ranks the MFSL audiophile reissue above a plain CD reissue", () => {
    const mfsl = scorePressing(mfslPressing, "sonic");
    const cd = scorePressing(cdReissue, "sonic");
    expect(mfsl.overallScore).toBeGreaterThan(cd.overallScore);
  });

  it("surfaces pedigree signals for reputable label + engineer + format", () => {
    const s = scorePressing(mfslPressing, "sonic");
    expect(s.signals.join(" ")).toMatch(/Mobile Fidelity/);
    expect(s.factors.pedigree.score).toBeGreaterThan(0);
    expect(s.factors.pedigree.confidence).toBeGreaterThan(0);
  });

  it("detects renowned engineer and stamper marks on an original", () => {
    const s = scorePressing(rvgPressing, "sonic");
    expect(s.signals.join(" ")).toMatch(/Van Gelder/);
    expect(s.masteringCredits.join(" ")).toMatch(/Rudy Van Gelder/);
  });

  it("a bare release with no audiophile evidence has zero pedigree confidence", () => {
    const plain = makeRelease({ extraartists: [], identifiers: [], labels: [{ id: 999, name: "Generic", catno: "X" }] });
    const s = scorePressing(plain, "sonic");
    expect(s.factors.pedigree.confidence).toBe(0);
  });

  it("evidence weighting: missing data does not zero out the overall score", () => {
    const noPrice = makeRelease({ lowest_price: undefined, num_for_sale: 0 });
    const s = scorePressing(noPrice, "sonic");
    expect(s.overallScore).toBeGreaterThan(0);
    expect(s.factors.marketValue.confidence).toBe(0);
  });

  it("reports evidenceCoverage in 0..1 and a verdict, plus structured reputationDetail", () => {
    const s = scorePressing(mfslPressing, "sonic", { baselineRating: 4.6 });
    expect(s.evidenceCoverage).toBeGreaterThan(0);
    expect(s.evidenceCoverage).toBeLessThanOrEqual(1);
    expect(typeof s.verdict).toBe("string");
    expect(s.verdict.length).toBeGreaterThan(0);
    expect(s.reputationDetail.label?.name).toMatch(/Mobile Fidelity/);
  });

  it("penalises and flags a test pressing vs. the same release as a retail copy", () => {
    const retail = scorePressing(mfslPressing, "sonic", { baselineRating: 4.6 });
    const testPress = scorePressing(
      makeRelease({
        ...mfslPressing,
        formats: [{ name: "Vinyl", qty: "2", descriptions: ["LP", "45 RPM", "Test Pressing"] }],
      }),
      "sonic",
      { baselineRating: 4.6 }
    );
    expect(testPress.overallScore).toBeLessThan(retail.overallScore);
    expect(testPress.verdict).toMatch(/test pressing/i);
    expect(testPress.signals.join(" ")).toMatch(/not a standard retail copy/i);
  });

  it("a thin-evidence pressing gets the low-confidence verdict", () => {
    const plain = makeRelease({
      extraartists: [],
      identifiers: [],
      labels: [{ id: 999, name: "Generic", catno: "X" }],
      community: { rating: { average: 5, count: 2 }, have: 0, want: 0 },
      lowest_price: undefined,
      num_for_sale: 0,
      formats: [{ name: "CD", qty: "1", descriptions: ["Album"] }],
    });
    const s = scorePressing(plain, "sonic", { baselineRating: 4.6 });
    expect(s.evidenceCoverage).toBeLessThan(0.35);
    expect(s.verdict).toBe("thin data - low confidence");
  });
});

describe("scorePressing — axes differ", () => {
  it("value axis rewards the cheap pressing more than collector axis does", () => {
    const cheapValue = scorePressing(cdReissue, "value");
    const cheapCollector = scorePressing(cdReissue, "collector");
    // affordability lifts the cheap CD under 'value'
    expect(cheapValue.factors.affordability.score).toBeGreaterThan(50);
    expect(cheapValue.overallScore).toBeGreaterThan(cheapCollector.overallScore);
  });

  it("collector axis rewards the expensive, high-demand original", () => {
    const collector = scorePressing(rvgPressing, "collector");
    expect(collector.factors.marketValue.score).toBeGreaterThan(0);
    expect(collector.factors.consensus.score).toBeGreaterThan(0);
  });

  it("down-weights a 3-vote rating so it can't drive the score", () => {
    const tiny = scorePressing(tinyRatedPressing, "sonic", { baselineRating: 4.6 });
    // The 5.0/3-vote rating contributes with near-zero confidence...
    expect(tiny.factors.ratingDelta.confidence).toBeLessThan(0.1);
    // ...and on the collector axis (which uses absolute rating) the well-attested
    // classic decisively beats the 3-vote pressing.
    const tinyC = scorePressing(tinyRatedPressing, "collector", { baselineRating: 4.6 });
    const classicC = scorePressing(makeRelease(), "collector", { baselineRating: 4.6 });
    expect(classicC.overallScore).toBeGreaterThan(tinyC.overallScore);
  });
});

describe("rankVersionsByQuickSignals", () => {
  it("prefers vinyl over CD and does not mutate input", () => {
    const cd = makeVersion({ id: 1, format: "CD, Album", stats: { community: { in_collection: 9000, in_wantlist: 9000 } } });
    const vinyl = makeVersion({ id: 2, format: "Vinyl, LP", stats: { community: { in_collection: 10, in_wantlist: 5 } } });
    const input = [cd, vinyl];
    expect(rankVersionsByQuickSignals(input)[0].id).toBe(2);
    expect(input[0].id).toBe(1);
  });
});
