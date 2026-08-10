import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer as McpServerV2 } from "@modelcontextprotocol/server";
import { McpAgent } from "agents/mcp";
import { makeGetContext } from "./mcp/server-factory.js";
import { registerAllTools } from "./mcp/tools/index.js";
import { registerPrompts } from "./mcp/prompts/index.js";
import { registerResources } from "./mcp/resources/discogs.js";
import type { DiscogsProps, Env } from "./types/env.js";
import { VERSION } from "./version.js";

/**
 * LEGACY /sse SESSIONS ONLY. The primary /mcp endpoint is served statelessly
 * by src/mcp/stateless.ts (MCP 2026-07-28); this Durable Object remains for
 * clients still configured against the deprecated HTTP+SSE transport.
 *
 * McpAgent is feature-frozen upstream and requires an SDK v1 server, so the
 * shared registration code (typed against SDK v2) is applied through a cast:
 * v2 kept the v1-compatible registerTool/registerPrompt/registerResource
 * signatures, and the v2 ResourceTemplate duck-types v1's
 * (uriTemplate/listCallback/completeCallback).
 */
export class DiscogsMcpAgent extends McpAgent<Env, unknown, DiscogsProps> {
  server = new McpServer({ name: "discogs", version: VERSION });

  async init(): Promise<void> {
    const getContext = await makeGetContext(this.env, () => this.props);
    const server = this.server as unknown as McpServerV2;
    registerAllTools(server, getContext);
    registerPrompts(server);
    registerResources(server, getContext);
  }
}
