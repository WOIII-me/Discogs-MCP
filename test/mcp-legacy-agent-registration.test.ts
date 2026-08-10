import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer as McpServerV2 } from "@modelcontextprotocol/server";
import { registerAllTools } from "../src/mcp/tools/index.js";
import { registerPrompts } from "../src/mcp/prompts/index.js";
import { registerResources } from "../src/mcp/resources/discogs.js";
import type { GetContext, ToolContext } from "../src/mcp/tools/context.js";

/**
 * The deprecated /sse endpoint still runs on an SDK v1 McpServer inside
 * McpAgent, but the registration code is shared with the v2 stateless path
 * (see src/agent.ts). This locks in the two cross-version assumptions that
 * make the cast safe:
 *   1. v2 kept v1-call-compatible registerTool/registerPrompt/registerResource;
 *   2. a v2 ResourceTemplate duck-types v1's (uriTemplate/listCallback/
 *      completeCallback), so template resources still list and read.
 */

function fakeContext(): GetContext {
  const client = {
    getRelease: vi.fn().mockResolvedValue({
      id: 123,
      title: "Kind of Blue",
      artists: [{ name: "Miles Davis" }],
      year: 1959,
      labels: [],
      formats: [],
      genres: ["Jazz"],
      styles: [],
      tracklist: [],
    }),
  };
  return () =>
    ({ client, username: "vinylfan", userId: 42 }) as unknown as ToolContext;
}

async function v1ServerWithSharedRegistrations() {
  const server = new McpServer({ name: "discogs", version: "0.0.0-test" });
  const v2View = server as unknown as McpServerV2;
  const getContext = fakeContext();
  registerAllTools(v2View, getContext);
  registerPrompts(v2View);
  registerResources(v2View, getContext);

  const client = new Client({ name: "legacy-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("shared registrations on the legacy v1 server (/sse path)", () => {
  it("lists tools, prompts, and template resources", async () => {
    const client = await v1ServerWithSharedRegistrations();

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("search_collection");

    const prompts = await client.listPrompts();
    expect(prompts.prompts.length).toBeGreaterThan(0);

    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((t) => t.uriTemplate)).toContain(
      "discogs://release/{id}"
    );
  });

  it("reads a template resource through the v2 ResourceTemplate duck-type", async () => {
    const client = await v1ServerWithSharedRegistrations();
    const result = await client.readResource({ uri: "discogs://release/123" });
    const first = result.contents[0];
    expect(first && "text" in first ? first.text : "").toContain("Kind of Blue");
  });
});
