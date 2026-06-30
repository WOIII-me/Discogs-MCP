import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api/handler.js";
import type { Env } from "../src/types/env.js";

const env = {} as unknown as Env; // health/OPTIONS/401 paths don't touch bindings

describe("REST API handler", () => {
  it("answers CORS preflight with 204 and CORS headers", async () => {
    const res = await handleApi(
      new Request("https://x/api/analyze", { method: "OPTIONS", headers: { Origin: "chrome-extension://abc" } }),
      env
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abc");
    expect(res.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
  });

  it("serves an unauthenticated health check", async () => {
    const res = await handleApi(new Request("https://x/api/health"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "discogs-mcp" });
  });

  it("rejects requests without a Bearer token", async () => {
    const res = await handleApi(new Request("https://x/api/analyze?release=1"), env);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toMatch(/Bearer/);
  });
});
