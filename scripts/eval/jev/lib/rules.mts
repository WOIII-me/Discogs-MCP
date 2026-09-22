import type { DiscogsRelease } from "../../../../src/clients/types.ts";
import { CLAIM_KINDS, type ClaimKind, type ClaimStatus } from "../../../../src/utils/catalog-claims.ts";
import type { Interpreter, NotesFixture, Prediction } from "./types.mts";

/**
 * Baseline (a): what the shipped regex layer effectively "believes". It can
 * only say stated or not_stated — it has no notion of denial — which is the
 * gap this eval measures. Patterns mirror src/utils/pressing-reputation.ts
 * and src/utils/pressing-scoring.ts where they exist, and use the obvious
 * keyword for claims the shipped code does not read at all.
 */
const PATTERNS: Record<ClaimKind, RegExp> = {
  analogSource: /\bAAA\b|all[- ]analog|analog(?:ue)? (?:master )?tapes?|original (?:analog(?:ue)? )?master tapes?|analog(?:ue)? cut/i,
  digitalSource: /digital(?:ly)? (?:re)?master|from (?:the )?(?:\d+ ?k(?:hz)?|\d+[- ]bit|dsd|digital|files?)|hi-?res(?:olution)? (?:files|transfer)/i,
  dmm: /\bDMM\b|direct metal master/i,
  pressingPlant: /pressed (?:at|by)|plated (?:and|&) pressed|\bRTI\b|\bQRP\b|quality record pressings|\bpallas\b|\boptimal\b|\bGZ\b|\bMPO\b|united record pressing|record technology/i,
  qcComplaints: /surface noise|warp|off[- ]cent(?:er|re)|non[- ]fill|defect|noisy|pops? and clicks|scratch/i,
  nonConsumer: /test\s*pressing|white\s*label|acetate|\bpromo\b|promotional|sampler|jukebox|not\s*for\s*sale/i,
  firstPressing: /first\s*press|original\s*press|1st\s*press/i,
};

export function fixtureToRelease(f: NotesFixture): DiscogsRelease {
  return {
    id: f.releaseId,
    title: f.title,
    artists: [],
    year: f.year ?? 0,
    formats: f.formats.map((name) => ({ name, qty: "1" })),
    genres: [],
    labels: f.label ? [{ id: 0, name: f.label, catno: "" }] : [],
    country: f.country,
    notes: f.notes,
    identifiers: f.identifiers,
    companies: (f.companies ?? []).map((c) => ({ name: c.name, entity_type_name: c.role })),
    tracklist: [],
    resource_url: "",
  };
}

export const rulesInterpreter: Interpreter = {
  name: "rules",
  async interpret(f) {
    const t0 = performance.now();
    const blob = [f.notes, ...f.identifiers.map((i) => `${i.type} ${i.value} ${i.description ?? ""}`), ...f.formats].join("\n");
    const predictions: Prediction[] = CLAIM_KINDS.map((claim) => {
      const status: ClaimStatus = PATTERNS[claim].test(blob) ? "stated" : "not_stated";
      return { claim, status, certainty: 1 };
    });
    return { fixtureId: f.id, predictions, latencyMs: performance.now() - t0 };
  },
};
