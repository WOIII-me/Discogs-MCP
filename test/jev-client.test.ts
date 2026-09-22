import { describe, expect, it, vi } from "vitest";
import { JEV_DEFAULT_MODEL, JEV_ENDPOINT, JevClient, JevError, JevRateLimitError } from "../src/clients/jev.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  ) as unknown as typeof fetch;
}

describe("JevClient", () => {
  it("posts state + questions with the pinned model and bearer auth", async () => {
    const f = fakeFetch(200, {
      model: "jev-1.13.0",
      answers: { q: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.8 } },
      usage: { input_tokens: 120, output_tokens: 10 },
    });
    const client = new JevClient({ apiKey: "k", fetch: f });
    const res = await client.systemOne({ document: "x" }, { q: { type: "choice", instructions: "?", criteria: { a: null, b: null } } });

    expect(res.answers.q.type).toBe("choice");
    expect(res.usage.input_tokens).toBe(120);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(JEV_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe(JEV_DEFAULT_MODEL);
    expect(sent.state).toEqual({ document: "x" });
    expect(sent.questions.q.type).toBe("choice");
  });

  it("never defaults to an alias", () => {
    expect(JEV_DEFAULT_MODEL).not.toMatch(/latest|preview/);
  });

  it("maps 429 and 529 to JevRateLimitError without retrying", async () => {
    for (const status of [429, 529]) {
      const f = fakeFetch(status, { error: "slow down" });
      const client = new JevClient({ apiKey: "k", fetch: f });
      await expect(client.systemOne("s", {})).rejects.toBeInstanceOf(JevRateLimitError);
      expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    }
  });

  it("maps other failures to JevError with the status", async () => {
    const client = new JevClient({ apiKey: "k", fetch: fakeFetch(422, { error: "bad question" }) });
    const err = await client.systemOne("s", {}).catch((e) => e);
    expect(err).toBeInstanceOf(JevError);
    expect(err.status).toBe(422);
  });

  it("rejects a 200 without answers", async () => {
    const client = new JevClient({ apiKey: "k", fetch: fakeFetch(200, { model: "x" }) });
    await expect(client.systemOne("s", {})).rejects.toBeInstanceOf(JevError);
  });

  it("forwards the caller's abort signal", async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const client = new JevClient({ apiKey: "k", fetch: f });
    const ac = new AbortController();
    ac.abort();
    await expect(client.systemOne("s", {}, { signal: ac.signal })).rejects.toThrow(/aborted/);
  });

  it("requires an api key", () => {
    expect(() => new JevClient({ apiKey: "" })).toThrow(JevError);
  });
});
