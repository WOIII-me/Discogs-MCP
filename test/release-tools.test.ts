import { describe, expect, it } from "vitest";
import { slimRelease } from "../src/mcp/tools/release-tools.js";
import { makeRelease, mfslPressing, rvgPressing } from "./mocks/discogs-fixtures.js";

describe("slimRelease (enriched get_release output)", () => {
  it("exposes matrix/runout, price, and a pedigree assessment", () => {
    const s = slimRelease(rvgPressing);
    expect(s.matrixRunout.length).toBeGreaterThan(0);
    expect(s.matrixRunout[0].value).toMatch(/RVG/);
    expect(s.lowestPrice).toBe(rvgPressing.lowest_price);
    expect(s.pedigree.signals.join(" ")).toMatch(/Van Gelder/);
    expect(s.pedigree.detail.engineers.join(" ")).toMatch(/Van Gelder/);
  });

  it("includes mastering credits and a reputable-label pedigree", () => {
    const s = slimRelease(mfslPressing);
    expect(s.pedigree.detail.label?.name).toMatch(/Mobile Fidelity/);
    expect(s.numForSale).toBe(mfslPressing.num_for_sale);
  });

  it("degrades cleanly for a release with no structured evidence", () => {
    const plain = makeRelease({ identifiers: [], extraartists: [], companies: [] });
    const s = slimRelease(plain);
    expect(s.matrixRunout).toEqual([]);
    expect(s.masteringCredits).toEqual([]);
    expect(s.pressingCompanies).toEqual([]);
    // still returns the existing fields
    expect(s.id).toBe(plain.id);
    expect(s.community?.ratingCount).toBe(plain.community?.rating.count);
  });
});
