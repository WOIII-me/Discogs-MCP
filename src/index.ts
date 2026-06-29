import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { DiscogsAuthHandler } from "./auth/handler.js";
import { DiscogsMcpAgent } from "./agent.js";

// Re-exported so the Durable Object binding in wrangler.toml resolves when
// this is the deploy entry point.
export { DiscogsMcpAgent };

// Production entry point: MCP clients authenticate via browser OAuth.
export default new OAuthProvider({
  apiHandlers: {
    "/mcp": DiscogsMcpAgent.serve("/mcp"), // Streamable HTTP (current standard)
    "/sse": DiscogsMcpAgent.serveSSE("/sse"), // Legacy SSE transport
  },
  defaultHandler: DiscogsAuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
