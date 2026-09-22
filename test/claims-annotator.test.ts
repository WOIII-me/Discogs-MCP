import { describe, expect, it, vi } from "vitest";
import { ClaimsAnnotator, makeClaimsAnnotator, type ClaimsKV } from "../src/core/claims.js";
import { JevRateLimitError, type JevResponse, type JevSystemOne } from "../src/clients/jev.js";
import type { Env } from "../src/types/env.js";
import { makeRelease } from "./mocks/discogs-fixtures.js";

function fakeKV(): ClaimsKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      const v = store.get(key);
      return v === undefined ? null : JSON.parse(v);
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

const statedAnalog = (tokens = 100): JevResponse => ({
  model: "jev-1.13.0",
  answers: {
    analogSource: { type: "choice", choice: "stated", probabilities: { stated: 0.92 }, confidence: 0.9 },
    analogSource__source: { type: "choice", choice: "s1", probabilities: { s1: 0.9 }, confidence: 0.9 },
    firstPressing: { type: "choice", choice: "denied", probabilities: { denied: 0.88 }, confidence: 0.8 },
    dmm: { type: "choice", choice: "not_stated", probabilities: { not_stated: 0.97 }, confidence: 0.95 },
  },
  usage: { input_tokens: tokens, output_tokens: 10 },
});

function fakeClient(impl: JevSystemOne["systemOne"]): JevSystemOne & { calls: number } {
  const c = { model: "jev-1.13.0", calls: 0, systemOne: vi.fn() as unknown as JevSystemOne["systemOne"] };
  c.systemOne = (async (...args: Parameters<JevSystemOne["systemOne"]>) => {
    c.calls++;
    return impl(...args);
  }) as JevSystemOne["systemOne"];
  return c;
}

const rel = (id: number, notes = "Cut from the original analog tapes. Not the first press.") => makeRelease({ id, notes });

describe("ClaimsAnnotator", () => {
  it("peek never calls the model and returns only cached claims", async () => {
    const client = fakeClient(async () => statedAnalog());
    const kv = fakeKV();
    const a = new ClaimsAnnotator(client, kv, { deadlineMs: 500 });
    expect((await a.peek([rel(1)])).size).toBe(0);
    expect(client.calls).toBe(0);

    await a.annotate([rel(1)]);
    expect(client.calls).toBe(1);
    const peeked = await a.peek([rel(1)]);
    expect(peeked.get(1)?.map((c) => `${c.claim}:${c.status}`)).toEqual(["analogSource:stated", "firstPressing:denied"]);
  });

  it("gates not_stated and low-certainty claims out of the stored result", async () => {
    const client = fakeClient(async () => statedAnalog());
    const a = new ClaimsAnnotator(client, fakeKV(), { certaintyGate: 0.9 });
    const out = await a.annotate([rel(1)]);
    // firstPressing certainty 0.88 < 0.9 gate; dmm is not_stated.
    expect(out.get(1)?.map((c) => c.claim)).toEqual(["analogSource"]);
  });

  it("skips releases with no free text without calling the model", async () => {
    const client = fakeClient(async () => statedAnalog());
    const a = new ClaimsAnnotator(client, fakeKV());
    const out = await a.annotate([makeRelease({ id: 7, notes: undefined, identifiers: [] })]);
    expect(out.size).toBe(0);
    expect(client.calls).toBe(0);
  });

  it("dedupes identical text across releases via the content-hash cache key", async () => {
    const client = fakeClient(async () => statedAnalog());
    const kv = fakeKV();
    const a = new ClaimsAnnotator(client, kv);
    const out = await a.annotate([rel(1, "Same notes."), rel(2, "Same notes.")]);
    expect(out.size).toBe(2);
    expect(client.calls).toBe(1);
    const claimKeys = [...kv.store.keys()].filter((k) => k.startsWith("claims:"));
    expect(claimKeys.length).toBe(1);
    expect(claimKeys[0]).toMatch(/^claims:[0-9a-f]{64}:cc-v2:jev-1\.13\.0$/);
  });

  it("changed notes text produces a different cache key", async () => {
    const client = fakeClient(async () => statedAnalog());
    const kv = fakeKV();
    const a = new ClaimsAnnotator(client, kv);
    await a.annotate([rel(1, "Version one.")]);
    await a.annotate([rel(1, "Version two.")]);
    expect(client.calls).toBe(2);
    expect([...kv.store.keys()].filter((k) => k.startsWith("claims:")).length).toBe(2);
  });

  it("enforces the whole-batch deadline and yields no annotation for slow releases", async () => {
    const client = fakeClient(
      (_s, _q, opts) =>
        new Promise((_, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    const a = new ClaimsAnnotator(client, fakeKV(), { deadlineMs: 30 });
    const t0 = Date.now();
    const out = await a.annotate([rel(1), rel(2), rel(3)]);
    expect(out.size).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("stops the batch on a rate-limit error and reports nothing for it", async () => {
    let n = 0;
    const client = fakeClient(async () => {
      n++;
      if (n === 1) throw new JevRateLimitError(429);
      return statedAnalog();
    });
    const a = new ClaimsAnnotator(client, fakeKV(), { concurrency: 1 });
    const out = await a.annotate([rel(1, "A."), rel(2, "B."), rel(3, "C.")]);
    expect(out.has(1)).toBe(false);
    // With concurrency 1, the abort after the first failure prevents later calls.
    expect(client.calls).toBe(1);
    expect(out.size).toBe(0);
  });

  it("bounds concurrency", async () => {
    let active = 0;
    let peak = 0;
    const client = fakeClient(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return statedAnalog();
    });
    const a = new ClaimsAnnotator(client, fakeKV(), { concurrency: 2 });
    const releases = Array.from({ length: 6 }, (_, i) => rel(i + 1, `Notes ${i}.`));
    await a.annotate(releases);
    expect(peak).toBeLessThanOrEqual(2);
    expect(client.calls).toBe(6);
  });

  it("records spend per UTC day and skips inference once the ceiling is reached", async () => {
    const client = fakeClient(async () => statedAnalog(600));
    const kv = fakeKV();
    const now = () => new Date("2026-09-22T12:00:00Z");
    const a = new ClaimsAnnotator(client, kv, { dailyTokenCeiling: 1000 }, now);
    await a.annotate([rel(1, "One.")]);
    expect(JSON.parse(kv.store.get("jev:usage:2026-09-22")!)).toBe(600);
    await a.annotate([rel(2, "Two.")]); // 600 < 1000 → allowed, brings total to 1200
    expect(client.calls).toBe(2);
    await a.annotate([rel(3, "Three.")]); // 1200 ≥ 1000 → skipped
    expect(client.calls).toBe(2);
    // Cached results are still served during the freeze.
    expect((await a.annotate([rel(1, "One.")])).size).toBe(1);
  });
});

describe("makeClaimsAnnotator", () => {
  const base = { CACHE_KV: fakeKV() } as unknown as Env;

  it("is undefined unless JEV_ENABLED is exactly 'true' and a key is present", () => {
    expect(makeClaimsAnnotator({ ...base })).toBeUndefined();
    expect(makeClaimsAnnotator({ ...base, JEV_ENABLED: "true" })).toBeUndefined();
    expect(makeClaimsAnnotator({ ...base, JEV_API_KEY: "k" })).toBeUndefined();
    expect(makeClaimsAnnotator({ ...base, JEV_ENABLED: "1", JEV_API_KEY: "k" })).toBeUndefined();
    expect(makeClaimsAnnotator({ ...base, JEV_ENABLED: "true", JEV_API_KEY: "k" })).toBeInstanceOf(ClaimsAnnotator);
  });

  it("reads numeric knobs with safe fallbacks", () => {
    const a = makeClaimsAnnotator({ ...base, JEV_ENABLED: "true", JEV_API_KEY: "k", JEV_DAILY_TOKEN_CEILING: "abc", JEV_CERTAINTY_GATE: "0.75" })!;
    expect(a.options.dailyTokenCeiling).toBe(2_000_000);
    expect(a.options.certaintyGate).toBe(0.75);
  });
});
