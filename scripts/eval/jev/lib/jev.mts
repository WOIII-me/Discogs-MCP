import { JevClient, JevRateLimitError } from "../../../../src/clients/jev.ts";
import {
  buildClaimQuestions,
  buildClaimState,
  mapClaimAnswers,
  stateForModel,
} from "../../../../src/utils/catalog-claims.ts";
import { fixtureToRelease } from "./rules.mts";
import type { Interpreter, NotesFixture } from "./types.mts";

/**
 * Baseline (b): Jev through the SAME question set and mapping the Worker
 * ships (src/utils/catalog-claims.ts), so the eval measures the production
 * path, not a flattering variant of it.
 */
export function jevInterpreter(opts: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Which injection guards to apply in the mapper; default both, as in production. */
  guards?: { regexGuard?: boolean; noulGuard?: boolean };
  nameSuffix?: string;
}): Interpreter {
  const client = new JevClient({ apiKey: opts.apiKey, model: opts.model });
  return {
    name: `jev:${client.model}${opts.nameSuffix ?? ""}`,
    async interpret(f: NotesFixture) {
      const state = buildClaimState(fixtureToRelease(f));
      const t0 = performance.now();
      if (!state) {
        return { fixtureId: f.id, predictions: [], latencyMs: 0, error: "no text" };
      }
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 8000);
      try {
        const res = await client.systemOne(stateForModel(state), buildClaimQuestions(state), { signal: ac.signal });
        const mapped = mapClaimAnswers(res.answers, state, { model: res.model, observedAt: new Date().toISOString() }, opts.guards);
        return {
          fixtureId: f.id,
          predictions: mapped.all.map((c) => ({ claim: c.claim, status: c.status, certainty: c.certainty })),
          latencyMs: performance.now() - t0,
          inputTokens: res.usage.input_tokens,
        };
      } catch (e) {
        const msg = e instanceof JevRateLimitError ? `rate-limited (${e.status})` : e instanceof Error ? e.message : String(e);
        return { fixtureId: f.id, predictions: [], latencyMs: performance.now() - t0, error: msg };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
