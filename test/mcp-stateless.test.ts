import { describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StatelessDiscogsMcp } from "../src/mcp/stateless.js";
import type { Env } from "../src/types/env.js";

/**
 * End-to-end smoke tests for the stateless /mcp handler (MCP 2026-07-28).
 * The real SDK v2 client talks to the real Worker handler through a
 * fetch bridge — no HTTP server, no Durable Object, no session state.
 */

function mockEnv(): Env {
  return {
    DISCOGS_CONSUMER_KEY: "ck",
    DISCOGS_CONSUMER_SECRET: "cs",
    CACHE_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
  } as unknown as Env;
}

/** Routes the client's fetches into the Worker handler, with optional OAuth props on ctx. */
function bridgedFetch(env: Env, props?: Record<string, unknown>): typeof fetch {
  const ctx = { props, waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  return async (input, init) => {
    // Node's fetch/Request strips the Host header (forbidden header), but in
    // workerd every request carries one and the handler validates it.
    const original = new Request(input as RequestInfo, init);
    const headers = new Headers(original.headers);
    headers.set("host", new URL(original.url).host);
    const request = new Request(original, { headers });
    return StatelessDiscogsMcp.fetch(request, env, ctx);
  };
}

async function connectedClient(env: Env, props?: Record<string, unknown>, versionNegotiation?: unknown) {
  const client = new Client(
    { name: "smoke-test", version: "0.0.0" },
    versionNegotiation ? ({ versionNegotiation } as never) : undefined
  );
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: bridgedFetch(env, props),
  });
  await client.connect(transport);
  return client;
}

describe("stateless /mcp handler", () => {
  it("serves a 2026-07-28 client: lists tools, prompts, and resource templates", async () => {
    const client = await connectedClient(mockEnv(), undefined, { mode: "auto" });

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("search_collection");
    expect(names).toContain("find_best_pressing");
    // Deterministic ordering (2026-07-28 SHOULD): two runs, same order.
    const again = await client.listTools();
    expect(again.tools.map((t) => t.name)).toEqual(names);

    const prompts = await client.listPrompts();
    expect(prompts.prompts.length).toBeGreaterThan(0);

    const templates = await client.listResourceTemplates();
    const uris = templates.resourceTemplates.map((t) => t.uriTemplate);
    expect(uris).toContain("discogs://release/{id}");

    await client.close();
  });

  it("serves a 2025-era (legacy) client through the same endpoint", async () => {
    // Default client options perform the legacy initialize handshake.
    const client = await connectedClient(mockEnv());
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("search_collection");
    await client.close();
  });

  it("rejects tool calls without OAuth props as a readable tool error", async () => {
    const client = await connectedClient(mockEnv(), undefined, { mode: "auto" });
    const result = await client.callTool({
      name: "search_collection",
      arguments: { query: "jazz" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Not authenticated");
    await client.close();
  });

  it("threads OAuth props from ctx into the tool context", async () => {
    const env = mockEnv();
    // Serve the collection fetch from the KV cache so no network is touched.
    (env.CACHE_KV.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) =>
      key.includes("collection") ? { items: [], totalItems: 0 } : null
    );
    const client = await connectedClient(env, {
      username: "vinylfan",
      userId: 42,
      accessToken: "tok",
      accessTokenSecret: "sec",
    });
    const result = await client.callTool({
      name: "search_collection",
      arguments: { query: "jazz" },
    });
    expect(result.isError).toBeFalsy();
    await client.close();
  });
});
