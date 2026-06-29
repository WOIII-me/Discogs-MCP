import { describe, expect, it } from "vitest";
import { detectMoodFromQuery, getMoodFilters, KNOWN_MOODS, MOOD_MAP } from "../src/utils/mood-mapping.js";

describe("detectMoodFromQuery", () => {
  it("matches a bare mood word", () => {
    expect(detectMoodFromQuery("mellow")).toBe("mellow");
    expect(detectMoodFromQuery("  Energetic ")).toBe("energetic");
  });

  it("matches moods embedded in longer queries", () => {
    expect(detectMoodFromQuery("some mellow jazz please")).toBe("mellow");
    expect(detectMoodFromQuery("dark brooding electronics")).toBe("dark");
  });

  it("matches keyword synonyms", () => {
    expect(detectMoodFromQuery("something chill")).toBe("mellow");
    expect(detectMoodFromQuery("funky records")).toBe("groovy");
  });

  it("matches multi-word phrases", () => {
    expect(detectMoodFromQuery("sunday morning records")).toBe("sunday");
    expect(detectMoodFromQuery("late night listening")).toBe("latenight");
    expect(detectMoodFromQuery("a rainy day album")).toBe("rainy");
    expect(detectMoodFromQuery("music for working out")).toBe("pumped");
  });

  it("returns null for literal artist/album searches", () => {
    expect(detectMoodFromQuery("Kind of Blue")).toBeNull();
    expect(detectMoodFromQuery("Miles Davis")).toBeNull();
    expect(detectMoodFromQuery("Sade Diamond Life")).toBeNull(); // "sad" must not fire inside "Sade"
    expect(detectMoodFromQuery("")).toBeNull();
  });
});

describe("getMoodFilters", () => {
  it("returns mapping for known moods, null otherwise", () => {
    expect(getMoodFilters("mellow")?.styles).toContain("Ambient");
    expect(getMoodFilters("MELLOW")).not.toBeNull();
    expect(getMoodFilters("nonexistent")).toBeNull();
  });
});

describe("MOOD_MAP integrity", () => {
  it("every mood has at least one genre and style", () => {
    for (const mood of KNOWN_MOODS) {
      expect(MOOD_MAP[mood].genres.length, mood).toBeGreaterThan(0);
      expect(MOOD_MAP[mood].styles.length, mood).toBeGreaterThan(0);
    }
  });
});
