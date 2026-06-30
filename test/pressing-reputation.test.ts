import { describe, expect, it } from "vitest";
import {
  masteringCredits,
  nonConsumerPressing,
  scoreReputation,
  versionLooksAudiophile,
} from "../src/utils/pressing-reputation.js";
import { makeRelease, mfslPressing, rvgPressing } from "./mocks/discogs-fixtures.js";

describe("scoreReputation", () => {
  it("scores a reputable-label reissue with credits highly and confidently", () => {
    const r = scoreReputation(mfslPressing);
    expect(r.score).toBeGreaterThan(60);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.signals.join(" ")).toMatch(/Mobile Fidelity/);
  });

  it("matches a reputable label by Discogs id even with a generic name", () => {
    const r = scoreReputation(
      makeRelease({ labels: [{ id: 35095, name: "MoFi sublabel", catno: "X" }], extraartists: [] })
    );
    expect(r.score).toBeGreaterThan(0);
    expect(r.signals.join(" ")).toMatch(/Mobile Fidelity/);
  });

  it("detects renowned engineer credits and runout stamps", () => {
    const r = scoreReputation(rvgPressing);
    expect(r.signals.join(" ")).toMatch(/Van Gelder/);
    expect(r.score).toBeGreaterThan(20);
  });

  it("exposes structured detail alongside the signal strings", () => {
    const mofi = scoreReputation(mfslPressing);
    expect(mofi.detail.label?.name).toMatch(/Mobile Fidelity/);
    expect(mofi.detail.formatCues.length).toBeGreaterThan(0);

    const rvg = scoreReputation(rvgPressing);
    expect(rvg.detail.engineers.join(" ")).toMatch(/Van Gelder/);
    expect(rvg.detail.stampers.length).toBeGreaterThan(0);
  });

  it("returns empty detail when there is no structured evidence", () => {
    const plain = makeRelease({
      labels: [{ id: 999, name: "Nondescript", catno: "X" }],
      extraartists: [],
      identifiers: [],
      formats: [{ name: "CD", qty: "1", descriptions: ["Album"] }],
      notes: "",
    });
    const r = scoreReputation(plain);
    expect(r.detail.label).toBeUndefined();
    expect(r.detail.engineers).toEqual([]);
    expect(r.detail.stampers).toEqual([]);
    expect(r.detail.formatCues).toEqual([]);
  });

  it("returns zero confidence when no structured evidence exists", () => {
    const plain = makeRelease({
      labels: [{ id: 999, name: "Nondescript", catno: "X" }],
      extraartists: [],
      identifiers: [],
      formats: [{ name: "CD", qty: "1", descriptions: ["Album"] }],
      notes: "",
    });
    const r = scoreReputation(plain);
    expect(r.confidence).toBe(0);
    expect(r.score).toBe(0);
  });

  it("caps the score at 100", () => {
    const stacked = makeRelease({
      labels: [{ id: 35095, name: "Mobile Fidelity Sound Lab", catno: "X" }],
      extraartists: [
        { name: "Bernie Grundman", role: "Mastered By" },
        { name: "Kevin Gray", role: "Lacquer Cut By" },
      ],
      identifiers: [{ type: "Matrix / Runout", value: "STERLING KG-1A", description: "A" }],
      formats: [{ name: "Vinyl", qty: "2", descriptions: ["LP", "45 RPM", "180 Gram", "Half-Speed Mastered"] }],
    });
    expect(scoreReputation(stacked).score).toBeLessThanOrEqual(100);
  });
});

describe("masteringCredits", () => {
  it("extracts mastering/cutting roles only", () => {
    const credits = masteringCredits(
      makeRelease({
        extraartists: [
          { name: "Miles Davis", role: "Trumpet" },
          { name: "Bob Ludwig", role: "Mastered By" },
        ],
      })
    );
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatch(/Bob Ludwig/);
  });
});

describe("versionLooksAudiophile", () => {
  it("flags reputable labels and telltale formats", () => {
    expect(versionLooksAudiophile("Mobile Fidelity Sound Lab", "Vinyl, LP")).toBe(true);
    expect(versionLooksAudiophile("Analogue Productions", "12\", 45 RPM")).toBe(true);
    expect(versionLooksAudiophile("Columbia", "SACD, Hybrid")).toBe(true);
    expect(versionLooksAudiophile("Columbia", "Vinyl, LP, Album")).toBe(false);
  });

  it("does NOT flag test pressings/promos even on a reputable label", () => {
    expect(versionLooksAudiophile("Classic Records", "LP, Album, Reissue, Test Pressing")).toBe(false);
    expect(versionLooksAudiophile("Analogue Productions", "LP, 45 RPM, White Label, Promo")).toBe(false);
  });
});

describe("nonConsumerPressing", () => {
  it("detects test pressings, promos, acetates, white labels", () => {
    expect(nonConsumerPressing("LP, Album, Test Pressing")).toBe(true);
    expect(nonConsumerPressing("LP, Promo")).toBe(true);
    expect(nonConsumerPressing("Acetate")).toBe(true);
    expect(nonConsumerPressing("LP, White Label")).toBe(true);
    expect(nonConsumerPressing("Vinyl, LP, Album, Reissue")).toBe(false);
  });
});
