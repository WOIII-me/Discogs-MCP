import { describe, expect, it } from "vitest";
import { paginate } from "../src/utils/collection.js";

const items = Array.from({ length: 365 }, (_, i) => i);

describe("paginate", () => {
  it("returns the first page and flags more", () => {
    const page = paginate(items, 0, 100);
    expect(page.totalMatches).toBe(365);
    expect(page.offset).toBe(0);
    expect(page.returned).toBe(100);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toBe(0);
    expect(page.items.at(-1)).toBe(99);
  });

  it("pages through with offset until exhausted", () => {
    const collected: number[] = [];
    let offset = 0;
    for (;;) {
      const page = paginate(items, offset, 100);
      collected.push(...page.items);
      if (!page.hasMore) break;
      offset += page.returned;
    }
    expect(collected).toHaveLength(365);
    expect(collected).toEqual(items); // no gaps, no duplicates
  });

  it("the last page has no more", () => {
    const page = paginate(items, 300, 100);
    expect(page.returned).toBe(65);
    expect(page.hasMore).toBe(false);
  });

  it("a single large page covers everything", () => {
    const page = paginate(items, 0, 500);
    expect(page.returned).toBe(365);
    expect(page.hasMore).toBe(false);
  });

  it("offset past the end returns empty without more", () => {
    const page = paginate(items, 1000, 100);
    expect(page.returned).toBe(0);
    expect(page.hasMore).toBe(false);
  });

  it("clamps negative offset to 0", () => {
    expect(paginate(items, -5, 10).offset).toBe(0);
  });
});
