import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { DiscogsAuthHandler } from "./auth/handler.js";
import { DiscogsMcpAgent } from "./agent.js";
import { StatelessDiscogsMcp } from "./mcp/stateless.js";

// Re-exported so the Durable Object binding in wrangler.toml resolves when
// this is the deploy entry point (only /sse sessions use it).
export { DiscogsMcpAgent };

// Production entry point: MCP clients authenticate via browser OAuth.
export default new OAuthProvider({
  apiHandlers: {
    "/mcp": StatelessDiscogsMcp, // Streamable HTTP, stateless (2026-07-28 + 2025-era clients)
    "/sse": DiscogsMcpAgent.serveSSE("/sse"), // Deprecated HTTP+SSE transport
  },
  defaultHandler: DiscogsAuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  // Legacy Dynamic Client Registration (RFC 7591) — deprecated by MCP
  // 2026-07-28 in favor of CIMD below, kept for older clients.
  clientRegistrationEndpoint: "/register",
  // Client ID Metadata Documents: clients identify with an HTTPS URL serving
  // their metadata, no /register roundtrip. Needs the
  // global_fetch_strictly_public compatibility flag (see wrangler.toml).
  clientIdMetadataDocumentEnabled: true,
});
