import { DiscogsMcpAgent } from "./agent.js";
import { handleApi } from "./api/handler.js";
import type { Env } from "./types/env.js";

// Durable Object binding for `wrangler dev src/dev-server.ts`.
export { DiscogsMcpAgent };

const mcpHandler = DiscogsMcpAgent.serve("/mcp");

/**
 * LOCAL DEVELOPMENT ENTRY POINT — do not deploy.
 *
 * Serves the MCP endpoint directly with NO OAuth gate. Authentication comes
 * from DISCOGS_PERSONAL_TOKEN in .dev.vars (see agent.ts). This exists so you
 * can connect an MCP client and ask real questions against your own Discogs
 * data without registering a Discogs OAuth app. Production uses src/index.ts.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!env.DISCOGS_PERSONAL_TOKEN) {
      return new Response(
        "dev-server requires DISCOGS_PERSONAL_TOKEN in .dev.vars. " +
          "For production use src/index.ts (OAuth).",
        { status: 500 }
      );
    }

    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(
        "Discogs MCP — local dev server (personal-token auth, no OAuth).\n" +
          "MCP endpoint: /mcp\n",
        { headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return mcpHandler.fetch(request, env, ctx);
    }
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
};
