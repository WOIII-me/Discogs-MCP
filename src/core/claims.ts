import { JevClient, JevRateLimitError, type JevSystemOne } from "../clients/jev.js";
import type { DiscogsRelease } from "../clients/types.js";
import type { Env } from "../types/env.js";
import {
  buildClaimQuestions,
  buildClaimState,
  CLAIM_QUESTION_SET_VERSION,
  gateClaims,
  mapClaimAnswers,
  normalizedStateKey,
  stateForModel,
  type CatalogClaim,
} from "../utils/catalog-claims.js";

/**
 * Bounded, cached catalog-claim annotation (plans/jev-and-mcp-apps-plan.md §3.2, §3.4):
 *
 * - `peek` is cache-only and is what automatic paths (release summaries,
 *   home screen) may call.
 * - `annotate` may run uncached inference, but only under ONE aggregate
 *   deadline for the whole batch, with bounded concurrency, per-release
 *   dedupe, a per-day input-token ceiling, and no retries. Any failure
 *   (timeout, 429/529, malformed answer) yields "no annotation" for that
 *   release — never an error to the caller.
 * - Cache keys carry provenance: sha256(normalized input) + question-set
 *   version + pinned model id. A corrected Discogs note or a model bump
 *   invalidates by construction.
 */
export interface ClaimsAnnotatorOptions {
  /** Whole-batch deadline for `annotate` (ms). */
  deadlineMs: number;
  /** Concurrent Jev calls per batch. */
  concurrency: number;
  /** Input tokens per UTC day across the deployment; beyond it, inference is skipped. */
  dailyTokenCeiling: number;
  /** Top-option probability below which a claim is dropped. */
  certaintyGate: number;
  /** Cache lifetime for claim results (seconds). */
  cacheTtlSeconds: number;
}

export const DEFAULT_CLAIMS_OPTIONS: ClaimsAnnotatorOptions = {
  deadlineMs: 1500,
  concurrency: 4,
  dailyTokenCeiling: 2_000_000,
  // Dev eval 2026-09-22: at 0.7 coverage stayed 0.96 with 1 % accepted error; the
  // one clean false positive ("Original RTI test pressing" read as first pressing)
  // sat at 0.68. Revisit against the reviewed held-out set.
  certaintyGate: 0.7,
  cacheTtlSeconds: 30 * 86400,
};

export type ClaimsByRelease = Map<number, CatalogClaim[]>;

interface CachedClaims {
  claims: CatalogClaim[];
  observedAt: string;
}

/** Minimal KV surface used here; matches Cloudflare's KVNamespace for get/put with json. */
export interface ClaimsKV {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export class ClaimsAnnotator {
  private readonly opts: ClaimsAnnotatorOptions;
  /** In-isolate dedupe: identical cache keys share one inference. */
  private static inFlight = new Map<string, Promise<CatalogClaim[] | null>>();

  constructor(
    private readonly client: JevSystemOne,
    private readonly kv: ClaimsKV,
    opts: Partial<ClaimsAnnotatorOptions> = {},
    private readonly now: () => Date = () => new Date()
  ) {
    this.opts = { ...DEFAULT_CLAIMS_OPTIONS, ...opts };
  }

  get options(): Readonly<ClaimsAnnotatorOptions> {
    return this.opts;
  }

  private cacheKey(stateKey: string): Promise<string> {
    return sha256Hex(stateKey).then(
      (h) => `claims:${h}:${CLAIM_QUESTION_SET_VERSION}:${this.client.model}`
    );
  }

  private usageKey(): string {
    return `jev:usage:${utcDay(this.now())}`;
  }

  /** Cache-only. Safe on automatic paths: never calls the model. */
  async peek(releases: DiscogsRelease[]): Promise<ClaimsByRelease> {
    const out: ClaimsByRelease = new Map();
    await Promise.all(
      releases.map(async (release) => {
        const state = buildClaimState(release);
        if (!state) return;
        const key = await this.cacheKey(normalizedStateKey(state));
        const cached = (await this.kv.get(key, "json")) as CachedClaims | null;
        if (cached?.claims) out.set(release.id, cached.claims);
      })
    );
    return out;
  }

  /**
   * Cache first; misses run under one shared deadline. Releases whose
   * inference fails or times out are simply absent from the result.
   */
  async annotate(releases: DiscogsRelease[]): Promise<ClaimsByRelease> {
    const out: ClaimsByRelease = new Map();
    const misses: { release: DiscogsRelease; key: string; state: ReturnType<typeof buildClaimState> & object }[] = [];

    await Promise.all(
      releases.map(async (release) => {
        const state = buildClaimState(release);
        if (!state) return;
        const key = await this.cacheKey(normalizedStateKey(state));
        const cached = (await this.kv.get(key, "json")) as CachedClaims | null;
        if (cached?.claims) out.set(release.id, cached.claims);
        else misses.push({ release, key, state });
      })
    );
    if (misses.length === 0) return out;

    // Spend ceiling: one read per batch; the write below is best-effort and
    // non-atomic (KV has no counters). Good enough for a soft daily cap.
    const usageKey = this.usageKey();
    const used = Number((await this.kv.get(usageKey, "json")) ?? 0);
    if (used >= this.opts.dailyTokenCeiling) return out;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.deadlineMs);
    let spent = 0;

    const runOne = async (m: (typeof misses)[number]): Promise<void> => {
      const existing = ClaimsAnnotator.inFlight.get(m.key);
      const flight =
        existing ??
        (async (): Promise<CatalogClaim[] | null> => {
          try {
            const res = await this.client.systemOne(
              stateForModel(m.state),
              buildClaimQuestions(m.state),
              { signal: controller.signal }
            );
            spent += res.usage?.input_tokens ?? 0;
            const observedAt = this.now().toISOString();
            const mapped = mapClaimAnswers(res.answers, m.state, { model: res.model, observedAt });
            const claims = gateClaims(mapped.all, this.opts.certaintyGate);
            const value: CachedClaims = { claims, observedAt };
            await this.kv.put(m.key, JSON.stringify(value), { expirationTtl: this.opts.cacheTtlSeconds });
            return claims;
          } catch (e) {
            // Deadline, 429/529, network, malformed — all mean "no annotation".
            if (e instanceof JevRateLimitError) controller.abort(); // stop the rest of the batch too
            return null;
          }
        })();
      if (!existing) {
        ClaimsAnnotator.inFlight.set(m.key, flight);
        flight.finally(() => ClaimsAnnotator.inFlight.delete(m.key));
      }
      const claims = await flight;
      if (claims) out.set(m.release.id, claims);
    };

    try {
      // Bounded concurrency without pulling in a dependency.
      let next = 0;
      const workers = Array.from({ length: Math.min(this.opts.concurrency, misses.length) }, async () => {
        while (next < misses.length && !controller.signal.aborted) {
          const m = misses[next++];
          await runOne(m);
        }
      });
      await Promise.all(workers);
    } finally {
      clearTimeout(timer);
      if (spent > 0) {
        await this.kv
          .put(usageKey, JSON.stringify(used + spent), { expirationTtl: 2 * 86400 })
          .catch(() => undefined);
      }
    }
    return out;
  }
}

/**
 * Per-user gate for the beta allowlist. Mirrors the semantics of
 * ALLOWED_DISCOGS_USERS in src/auth/allowlist.ts: comma-separated usernames
 * (case-insensitive) and/or numeric user IDs. An unset or blank list allows
 * everyone; a set list allows only its members.
 */
export function jevUserAllowed(env: Pick<Env, "JEV_BETA_USERS">, username: string, userId?: number): boolean {
  const raw = env.JEV_BETA_USERS?.trim();
  if (!raw) return true;
  const entries = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (entries.length === 0) return true;
  const uname = username.trim().toLowerCase();
  return entries.some((e) => e === uname || (userId !== undefined && e === String(userId)));
}

/**
 * The annotator for one authenticated user, or undefined when the feature is
 * off, unkeyed, or the user is outside the beta allowlist.
 */
export function claimsForUser(
  annotator: ClaimsAnnotator | undefined,
  env: Pick<Env, "JEV_BETA_USERS">,
  username: string,
  userId?: number
): ClaimsAnnotator | undefined {
  if (!annotator) return undefined;
  return jevUserAllowed(env, username, userId) ? annotator : undefined;
}

/**
 * Wire the annotator from env. Returns undefined unless explicitly enabled
 * AND keyed — every caller treats `undefined` as "feature absent".
 */
export function makeClaimsAnnotator(env: Env): ClaimsAnnotator | undefined {
  if (env.JEV_ENABLED !== "true" || !env.JEV_API_KEY) return undefined;
  const client = new JevClient({ apiKey: env.JEV_API_KEY, model: env.JEV_MODEL || undefined });
  const num = (v: string | undefined, fallback: number) => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return new ClaimsAnnotator(client, env.CACHE_KV, {
    dailyTokenCeiling: num(env.JEV_DAILY_TOKEN_CEILING, DEFAULT_CLAIMS_OPTIONS.dailyTokenCeiling),
    certaintyGate: Math.min(1, num(env.JEV_CERTAINTY_GATE, DEFAULT_CLAIMS_OPTIONS.certaintyGate)),
  });
}
