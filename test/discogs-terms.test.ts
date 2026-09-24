import { describe, expect, it } from "vitest";
import { DISCOGS_ATTRIBUTION, jsonResult, textResult } from "../src/mcp/tools/context.js";
import { CachedDiscogsClient } from "../src/clients/cached-discogs.js";

// Discogs API Terms of Use: attribution next to API data, and no API content
// displayed more than six hours behind discogs.com.
describe("Discogs API Terms compliance", () => {
  it("attaches the attribution to every tool result without breaking the JSON block", () => {
    const json = jsonResult({ a: 1 });
    expect(JSON.parse(json.content[0].text)).toEqual({ a: 1 });
    expect(json.content.at(-1)?.text).toBe(DISCOGS_ATTRIBUTION);
    expect(textResult("hi").content.at(-1)?.text).toBe(DISCOGS_ATTRIBUTION);
  });

  it("caches API content short enough that server + extension caches stay within six hours", () => {
    const client = new CachedDiscogsClient({ kind: "token", token: "t" }, {} as KVNamespace);
    const extensionMemoryCacheS = 10 * 60; // CACHE_TTL_MS in extension/background.js
    for (const ttl of Object.values(client.cacheTtls)) {
      expect(ttl + extensionMemoryCacheS).toBeLessThanOrEqual(6 * 3600);
    }
  });
});
