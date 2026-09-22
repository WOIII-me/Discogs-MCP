/**
 * Minimal client for TypeSafe AI's System One endpoint (the "Jev" model).
 *
 * Jev is a non-autoregressive decision model: you send a `state` (text or
 * JSON) plus typed questions and get back typed answers with probability
 * distributions. It cannot generate text. See docs.typesafe.ai/api.
 *
 * Deliberately dependency-free (plain `fetch`) so it runs unchanged in the
 * Cloudflare Worker and in the Node eval harness under scripts/eval/jev/.
 *
 * Posture (plans/jev-and-mcp-apps-plan.md §3): no retries in the request
 * path, caller-supplied AbortSignal for the aggregate deadline, pinned model.
 */

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Pinned per docs.typesafe.ai/models: thresholds are tuned against a version, not an alias. */
export const JEV_DEFAULT_MODEL = "jev-1.13.0";

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  /** option id → description (or null for self-describing ids). Max 255 options. */
  criteria: Record<string, string | null>;
}
export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered levels, 2–10. */
  criteria: string[];
}
export interface JevNoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}
export type JevQuestion = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion;

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  /** Shape of the distribution (0–1). NOT an accuracy estimate. */
  confidence: number;
}
export interface JevScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface JevNoulAnswer {
  type: "noul";
  /** P(statement is true). Nouls carry no separate confidence field. */
  noul: number;
}
export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export type JevState = string | Record<string, unknown> | unknown[];

// No TS parameter properties here: the eval harness loads this file under
// Node's strip-only TypeScript mode, which rejects that syntax.
export class JevError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}
/** 429 Too Many Requests or 529 Overloaded — callers back off, never retry inline. */
export class JevRateLimitError extends JevError {
  constructor(status: number) {
    super(`Jev ${status === 529 ? "overloaded" : "rate-limited"} (HTTP ${status})`, status);
    this.name = "JevRateLimitError";
  }
}

export interface JevClientOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
  /** Injectable for tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

/** The subset of the client the annotator and the eval harness depend on. */
export interface JevSystemOne {
  readonly model: string;
  systemOne(
    state: JevState,
    questions: Record<string, JevQuestion>,
    opts?: { signal?: AbortSignal }
  ): Promise<JevResponse>;
}

export class JevClient implements JevSystemOne {
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: JevClientOptions) {
    if (!opts.apiKey) throw new JevError("JevClient requires an apiKey");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? JEV_DEFAULT_MODEL;
    this.endpoint = opts.endpoint ?? JEV_ENDPOINT;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async systemOne(
    state: JevState,
    questions: Record<string, JevQuestion>,
    opts: { signal?: AbortSignal } = {}
  ): Promise<JevResponse> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ model: this.model, state, questions }),
      signal: opts.signal,
    });

    if (res.status === 429 || res.status === 529) throw new JevRateLimitError(res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new JevError(`Jev HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, res.status);
    }
    const body = (await res.json()) as Partial<JevResponse>;
    if (!body || typeof body !== "object" || !body.answers) {
      throw new JevError("Jev response missing `answers`");
    }
    return {
      model: body.model ?? this.model,
      answers: body.answers,
      usage: body.usage ?? { input_tokens: 0, output_tokens: 0 },
    };
  }
}
