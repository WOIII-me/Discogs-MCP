import type { ClaimKind, ClaimStatus } from "../../../../src/utils/catalog-claims.ts";

/**
 * One labelled release for the notes eval. Labels are per claim, four-way.
 * `labelStatus` records how trustworthy the label is:
 *  - "provisional": drafted by an assistant from the text, not yet human-reviewed
 *  - "reviewed": a human collector checked it
 * Go/no-go decisions (plan §1.5) count only "reviewed" items in the held-out set.
 */
export interface NotesFixture {
  id: string;
  releaseId: number;
  title: string;
  label?: string;
  country?: string;
  year?: number;
  notes: string;
  identifiers: { type: string; value: string; description?: string }[];
  formats: string[];
  labels: Partial<Record<ClaimKind, ClaimStatus>>;
  labelStatus: "provisional" | "reviewed";
  /** Free-text rationale for tricky labels (negations, contradictions). */
  labelNotes?: string;
  /** Set on generated adversarial variants: the id of the clean item this was derived from. */
  pairOf?: string;
  /** For injected variants: which claim the injected sentence tries to flip. */
  injectedClaim?: ClaimKind;
  /** "instruction" = addressed to a reader/AI (must resist); "assertion" = plain unsupported claim (uptake is informational). */
  injectionKind?: "instruction" | "assertion";
  /** Split membership. */
  split: "dev" | "heldout";
}

export interface Prediction {
  claim: ClaimKind;
  status: ClaimStatus;
  /** 0–1 model certainty; 1 for deterministic rules. */
  certainty: number;
}

export interface InterpretationResult {
  fixtureId: string;
  predictions: Prediction[];
  latencyMs: number;
  inputTokens?: number;
  error?: string;
}

export interface Interpreter {
  name: string;
  interpret(fixture: NotesFixture): Promise<InterpretationResult>;
}
